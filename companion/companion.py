"""SET teaching companion — the Phase 2 local agent (PLAN.md).

Runs on the USER'S OWN machine. Pairs with their SET instance via a revocable
token, then claims teach tasks and demonstrates IN THEIR REAL BROWSER:
opens a tab, navigates, highlights an element, shows a caption.

Principles (PLAN.md): visible foreground action only — no headless browsing,
no background operation, no clicking or editing. The user can quit any time
(Ctrl-C) and revoke the token in SET settings.

Setup (one time):
  1. SET → Settings → Companion → create a pairing token
  2. Enable remote debugging in Chrome/Brave/Edge:
     chrome://inspect/#devices → "Open dedicated DevTools for Node"? No —
     simplest: relaunch the browser with
       chrome --remote-debugging-port=9222
     (Brave: brave --remote-debugging-port=9222)
  3. Run:
       export SET_URL=http://your-set-host:8080
       export COMPANION_TOKEN=<token from step 1>
       uv run companion.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request

import httpx
import websocket

SET_URL = os.environ.get("SET_URL", "http://localhost:8080").rstrip("/")
TOKEN = os.environ.get("COMPANION_TOKEN", "")
CDP = os.environ.get("CHROME_CDP", "http://localhost:9222").rstrip("/")
POLL_S = float(os.environ.get("COMPANION_POLL_SECONDS", "3"))

HIGHLIGHT_JS = """
(() => {
  const prev = document.getElementById('__set_demo_ring');
  if (prev) prev.remove();
  const el = document.querySelector(%SELECTOR%);
  const ring = document.createElement('div');
  ring.id = '__set_demo_ring';
  ring.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #6c8cff;border-radius:12px;box-shadow:0 0 0 4000px rgba(10,14,32,0.45);transition:all .4s;';
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:50%;transform:translateX(-50%%);bottom:28px;max-width:70vw;background:#101422;color:#e6ebff;padding:12px 18px;border-radius:12px;border:1px solid #2a3350;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);';
  document.body.append(ring, bar);
  const place = (target) => {
    const r = target.getBoundingClientRect();
    ring.style.left = (r.x - 6) + 'px'; ring.style.top = (r.y - 6) + 'px';
    ring.style.width = (r.width + 12) + 'px'; ring.style.height = (r.height + 12) + 'px';
  };
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => place(el), 450); }
  else ring.style.cssText += 'left:-9999px;';
  bar.textContent = %MESSAGE%;
  setTimeout(() => { ring.remove(); bar.remove(); }, 25000);
  return el ? 'highlighted' : 'selector-not-found';
})()
"""


def log(msg: str) -> None:
    print(f"[companion {time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Tab:
    """One reusable tab in the user's browser (created via /json/new)."""

    def __init__(self) -> None:
        self._ws = None
        self._id = 0

    def ensure(self) -> bool:
        if self._ws:
            return True
        try:
            req = urllib.request.Request(f"{CDP}/json/new?about:blank", method="PUT")
            target = json.load(urllib.request.urlopen(req, timeout=5))
            self._ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=30, suppress_origin=True)
            self._ws.send(json.dumps({"id": 0, "method": "Page.enable"}))
            return True
        except Exception as e:
            log(f"cannot attach to browser at {CDP}: {e}")
            log("is it running with --remote-debugging-port=9222 ?")
            return False

    def _cmd(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        self._ws.settimeout(30)
        self._ws.send(json.dumps({"id": self._id, "method": method, "params": params or {}}))
        while True:
            m = json.loads(self._ws.recv())
            if m.get("id") == self._id:
                return m.get("result", m.get("error", {}))

    def demo(self, url: str | None, selector: str | None, message: str | None) -> str:
        if url:
            self._cmd("Page.navigate", {"url": url})
            time.sleep(2.5)  # let the SPA settle — the user watches it load
        js = (
            HIGHLIGHT_JS.replace("%SELECTOR%", json.dumps(selector or "body"))
            .replace("%MESSAGE%", json.dumps(message or ""))
        )
        r = self._cmd("Runtime.evaluate", {"expression": js})
        return r.get("result", {}).get("value", "unknown")


def main() -> int:
    if not TOKEN:
        print(__doc__)
        print("ERROR: COMPANION_TOKEN is not set.")
        return 2
    tab = Tab()
    log(f"paired with {SET_URL} — watching for teach tasks (Ctrl-C to stop)")
    while True:
        try:
            r = httpx.get(
                f"{SET_URL}/api/companion/next",
                headers={"authorization": f"Bearer {TOKEN}"},
                timeout=15,
            )
            if r.status_code == 401:
                log("pairing token rejected — revoke + recreate it in SET Settings → Companion")
                return 2
            task = (r.json() if r.status_code == 200 else {}).get("task")
            if task:
                log(f"teach task: {task['title']}")
                if not tab.ensure():
                    status, result = "error", "companion cannot attach to the browser (remote debugging off?)"
                else:
                    url = task.get("url") or "/"
                    if url.startswith("/"):
                        url = SET_URL + url
                    try:
                        outcome = tab.demo(url, task.get("selector"), task.get("message") or task["title"])
                        status, result = "done", outcome
                    except Exception as e:
                        status, result = "error", str(e)[:300]
                httpx.post(
                    f"{SET_URL}/api/companion/tasks/{task['id']}/result",
                    headers={"authorization": f"Bearer {TOKEN}"},
                    json={"status": status, "result": result},
                    timeout=15,
                )
                log(f"task {status}: {result}")
            time.sleep(POLL_S)
        except KeyboardInterrupt:
            log("stopped by user")
            return 0
        except Exception as e:
            log(f"poll error: {e} — retrying")
            time.sleep(POLL_S)


if __name__ == "__main__":
    sys.exit(main())
