"""Raw-CDP client for the in-stack real Chrome (chromedp/headless-shell).

Same pattern as our QA harness (scripts/qa/browser_harness.py) and the same
"attach to a real browser over CDP" approach as browser-harness/cua — no
Playwright in the primary path. One reusable tab per layer instance.
"""
from __future__ import annotations

import json
import socket
import time
import urllib.request
from urllib.parse import urlparse

import websocket


def _materialize_ip(base_url: str) -> str:
    """Chrome's DevTools HTTP endpoint rejects non-IP/localhost Host headers,
    so resolve docker service names (http://chrome:9222) to their container IP."""
    parsed = urlparse(base_url)
    host = parsed.hostname or ""
    try:
        socket.inet_aton(host)  # already an IP
        return base_url
    except OSError:
        pass
    try:
        ip = socket.getaddrinfo(host, parsed.port or 9222, socket.AF_INET)[0][4][0]
        return f"{parsed.scheme}://{ip}:{parsed.port or 9222}"
    except Exception:
        return base_url


class ChromeTab:
    def __init__(self, base_url: str, settle_s: float = 2.5, timeout_s: float = 35.0):
        self.base = _materialize_ip(base_url.rstrip("/"))
        self.settle_s = settle_s
        self.timeout_s = timeout_s
        self._id = 0
        self._tab: dict | None = None
        self._ws = None

    # ---- lifecycle -------------------------------------------------------
    def _connect(self) -> None:
        req = urllib.request.Request(f"{self.base}/json/new?about:blank", method="PUT")
        self._tab = json.load(urllib.request.urlopen(req, timeout=10))
        self._ws = websocket.create_connection(
            self._tab["webSocketDebuggerUrl"], timeout=self.timeout_s, suppress_origin=True
        )
        self._cmd("Page.enable")

    def close(self) -> None:
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass
        if self._tab:
            try:
                urllib.request.urlopen(
                    urllib.request.Request(f"{self.base}/json/close/{self._tab['id']}", method="PUT"),
                    timeout=5,
                )
            except Exception:
                pass
        self._ws, self._tab = None, None

    def _reset(self) -> None:
        self.close()
        self._connect()

    def _cmd(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        self._ws.settimeout(self.timeout_s)
        self._ws.send(json.dumps({"id": self._id, "method": method, "params": params or {}}))
        while True:
            m = json.loads(self._ws.recv())
            if m.get("id") == self._id:
                if "error" in m:
                    raise RuntimeError(f"CDP {method}: {m['error']}")
                return m.get("result", {})

    # ---- public ----------------------------------------------------------
    def screenshot(self) -> str | None:
        """JPEG (base64) of the current viewport."""
        try:
            if self._ws is None:
                return None
            r = self._cmd("Page.captureScreenshot", {"format": "jpeg", "quality": 70})
            return r.get("data")
        except Exception:
            return None

    def render(self, url: str) -> str | None:
        """Navigate, wait for load + settle, return rendered outerHTML."""
        for attempt in (1, 2):
            try:
                if self._ws is None:
                    self._connect()
                self._cmd("Page.navigate", {"url": url})
                deadline = time.time() + self.timeout_s
                loaded = False
                while time.time() < deadline and not loaded:
                    self._ws.settimeout(2)
                    try:
                        m = json.loads(self._ws.recv())
                        if m.get("method") == "Page.loadEventFired":
                            loaded = True
                    except websocket.WebSocketTimeoutException:
                        continue
                time.sleep(self.settle_s)
                # include open shadow-root content — modern SPAs render into
                # web-component shadow trees invisible to plain outerHTML
                r = self._cmd("Runtime.evaluate", {"expression": (
                    "(() => { const out = []; const walk = (root) => {"
                    "  root.querySelectorAll('*').forEach((el) => {"
                    "    if (el.shadowRoot) { out.push(el.shadowRoot.innerHTML); walk(el.shadowRoot); }"
                    "  }); };"
                    "  walk(document);"
                    "  return document.documentElement.outerHTML + out.join('\\n');"
                    "})()"
                )})
                html = r.get("result", {}).get("value")
                if html:
                    return html
                raise RuntimeError("empty render")
            except Exception:
                if attempt == 2:
                    self.close()
                    return None
                self._reset()
        return None
