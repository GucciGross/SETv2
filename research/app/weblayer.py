"""Self-hosted web-access layer for SET deep research.

Everything runs inside the compose stack — no cloud keys required:
  - search: SearXNG (in-stack, JSON API)
  - fetch: static HTTP first; JS-heavy pages rendered by the Playwright
    service (Firecrawl's prebuilt image); optional Firecrawl-compatible
    endpoint overrides everything when configured (self-hosted or cloud)

Principles (PLAN.md): no detection evasion, robots.txt respected on every
path we fetch directly, per-domain rate limits, hard page budget. When a
site declines, we record it and move on — never fight it.
"""
from __future__ import annotations

import time
import urllib.robotparser as robotparser
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx
import trafilatura

from .cdp import ChromeTab

USER_AGENT = "SET-Research/1.0 (self-hosted knowledge assistant; +https://github.com/GucciGross/SETv2)"
MIN_DOMAIN_INTERVAL_S = 2.0
FETCH_TIMEOUT_S = 25.0
RENDER_TIMEOUT_S = 45.0
MAX_BYTES = 2_000_000
MIN_EXTRACT_CHARS = 300  # below this, try the JS renderer


@dataclass
class WebLayer:
    searxng_url: str = ""               # http://searxng:8080 (in-stack)
    chrome_url: str = ""                # http://chrome:9222 — real Chrome over raw CDP (in-stack)
    playwright_url: str = ""            # optional fallback renderer; not shipped by default
    firecrawl_url: str = ""             # optional Firecrawl-compatible endpoint (self-host or cloud)
    firecrawl_key: str | None = None
    _tab: object = None
    _last_hit: dict = field(default_factory=dict)
    _robots_cache: dict = field(default_factory=dict)

    # ---- primitives -----------------------------------------------------
    def _throttle(self, url: str) -> None:
        domain = urlparse(url).netloc
        last = self._last_hit.get(domain, 0.0)
        wait = MIN_DOMAIN_INTERVAL_S - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
        self._last_hit[domain] = time.monotonic()

    def _robots_allows(self, url: str) -> bool:
        """Direct-fetch paths only (a configured Firecrawl governs itself)."""
        parsed = urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        rp = self._robots_cache.get(base)
        if rp is None:
            rp = robotparser.RobotFileParser()
            try:
                with httpx.Client(timeout=8, follow_redirects=True, headers={"user-agent": USER_AGENT}) as c:
                    r = c.get(f"{base}/robots.txt")
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])
            except Exception:
                rp.parse([])  # unreachable robots → allow
            self._robots_cache[base] = rp
        return rp.can_fetch(USER_AGENT, url)

    # ---- search ----------------------------------------------------------
    @property
    def has_search(self) -> bool:
        return bool(self.searxng_url or self.firecrawl_url)

    def search(self, query: str, limit: int = 8) -> list[dict]:
        """[{url, title, snippet}] — SearXNG (self-hosted) with Firecrawl fallback."""
        results = self._searxng_search(query, limit) if self.searxng_url else []
        if not results and self.firecrawl_url:
            results = self._firecrawl_search(query, limit)
        return results

    def _searxng_search(self, query: str, limit: int) -> list[dict]:
        try:
            r = httpx.get(
                f"{self.searxng_url.rstrip('/')}/search",
                params={"q": query, "format": "json"},
                headers={"user-agent": USER_AGENT},
                timeout=FETCH_TIMEOUT_S,
            )
            r.raise_for_status()
            out = []
            for hit in r.json().get("results", [])[:limit]:
                url = hit.get("url")
                if not url or not url.startswith("http"):
                    continue
                out.append({
                    "url": url,
                    "title": hit.get("title") or url,
                    "snippet": (hit.get("content") or "")[:220],
                })
            return out
        except Exception:
            return []

    def _firecrawl_search(self, query: str, limit: int) -> list[dict]:
        if not self.firecrawl_url:
            return []
        try:
            r = httpx.post(
                f"{self.firecrawl_url.rstrip('/')}/v1/search",
                headers={"Authorization": f"Bearer {self.firecrawl_key or 'self-hosted'}"},
                json={"query": query, "limit": limit, "scrapeOptions": {"formats": []}},
                timeout=FETCH_TIMEOUT_S,
            )
            r.raise_for_status()
            out = []
            for hit in r.json().get("data", []):
                url = hit.get("url") or hit.get("link")
                if url:
                    out.append({"url": url, "title": hit.get("title") or url, "snippet": hit.get("description") or ""})
            return out
        except Exception:
            return []

    # ---- fetch -----------------------------------------------------------
    def fetch_markdown(self, url: str) -> tuple[str, str] | None:
        """(title, markdown) or None when blocked/unreachable."""
        self._throttle(url)
        if self.firecrawl_url:
            got = self._firecrawl_scrape(url)
            if got is not None:
                return got
        return self._direct_fetch(url)

    def _firecrawl_scrape(self, url: str) -> tuple[str, str] | None:
        try:
            r = httpx.post(
                f"{self.firecrawl_url.rstrip('/')}/v1/scrape",
                headers={"Authorization": f"Bearer {self.firecrawl_key or 'self-hosted'}"},
                json={"url": url, "formats": ["markdown"], "onlyMainContent": True},
                timeout=90,
            )
            if r.status_code in (402, 403, 429):
                return None  # quota/blocked — fall through to direct fetch
            r.raise_for_status()
            data = r.json().get("data", {})
            md = data.get("markdown")
            if md:
                return (data.get("metadata", {}).get("title") or url, md)
            return None
        except Exception:
            return None

    def _direct_fetch(self, url: str) -> tuple[str, str] | None:
        if not self._robots_allows(url):
            return None
        html, final_url, ctype = self._http_get(url)
        if html is None:
            return None
        extracted = self._extract(html, final_url)
        if extracted and len(extracted[1]) >= MIN_EXTRACT_CHARS:
            return extracted
        # JS-shell suspicion (or non-HTML): render if we can, once
        if ctype.startswith("text/html") or html.startswith("<"):
            for renderer in (self._render_cdp, self._render_playwright):
                rendered = renderer(url)
                if rendered:
                    got = self._extract(rendered, url)
                    if got and len(got[1]) >= MIN_EXTRACT_CHARS:
                        return got
                    # trafilatura can't parse some SPA/web-component DOMs;
                    # fall back to crude text so the researcher gets content
                    crude = self._html_to_text(rendered)
                    if len(crude) >= MIN_EXTRACT_CHARS:
                        return (url, crude)
        return extracted if extracted and extracted[1].strip() else None

    @staticmethod
    def _html_to_text(html: str) -> str:
        """Dependency-free HTML → readable text (last-resort extractor)."""
        import re

        text = re.sub(r"(?is)<(script|style|noscript|svg|nav|footer|header|aside)[^>]*>.*?</\1>", " ", html)
        text = re.sub(r"(?is)<br\s*/?>", "\n", text)
        text = re.sub(r"(?is)</(p|div|h[1-6]|li|tr|section)>", "\n", text)
        text = re.sub(r"(?is)<h([1-6])[^>]*>", lambda m: "\n" + "#" * int(m.group(1)) + " ", text)
        text = re.sub(r"(?is)<li[^>]*>", "- ", text)
        text = re.sub(r"(?is)<[^>]+>", "", text)
        text = (
            text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")
            .replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'")
            .replace("&mdash;", "—").replace("&ndash;", "–")
        )
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def _render_cdp(self, url: str) -> str | None:
        """Primary: the in-stack real Chrome over raw CDP (browser-harness pattern)."""
        if not self.chrome_url:
            return None
        try:
            if self._tab is None:
                self._tab = ChromeTab(self.chrome_url)
            return self._tab.render(url)
        except Exception:
            self._tab = None
            return None

    def shutdown(self) -> None:
        if self._tab is not None:
            try:
                self._tab.close()
            except Exception:
                pass
            self._tab = None

    def _http_get(self, url: str) -> tuple[str | None, str, str]:
        try:
            with httpx.Client(
                timeout=FETCH_TIMEOUT_S, follow_redirects=True, headers={"user-agent": USER_AGENT}
            ) as c:
                r = c.get(url)
            if r.status_code != 200 or len(r.content) > MAX_BYTES:
                return None, url, ""
            ctype = r.headers.get("content-type", "")
            if ctype.startswith("text/html") or not ctype:
                return r.text, str(r.url), ctype
            if ctype.startswith("text/") or "json" in ctype or "xml" in ctype:
                return f"<pre>{r.text[:MAX_BYTES]}</pre>", str(r.url), ctype
            return None, url, ctype
        except Exception:
            return None, url, ""

    def _render_playwright(self, url: str) -> str | None:
        """Optional fallback renderer (PLAYWRIGHT_URL); not shipped in the stack."""
        if not self.playwright_url:
            return None
        try:
            r = httpx.post(
                f"{self.playwright_url.rstrip('/')}/scrape",
                json={"url": url, "timeout": RENDER_TIMEOUT_S * 1000},
                timeout=RENDER_TIMEOUT_S + 15,
            )
            r.raise_for_status()
            return r.json().get("content")
        except Exception:
            return None

    @staticmethod
    def _extract(html: str, url: str) -> tuple[str, str] | None:
        try:
            md = trafilatura.extract(
                html, output_format="markdown", include_links=True, include_tables=True, url=url
            )
            if not md:
                return None
            meta = trafilatura.extract_metadata(html) or {}
            title = (meta.as_dict().get("title") if hasattr(meta, "as_dict") else None) or url
            return (title, md)
        except Exception:
            return None
