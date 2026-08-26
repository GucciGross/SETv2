#!/usr/bin/env python3
"""SET QA browser harness — drives a real, isolated Chromium over raw CDP.

Why this stack (settled after much trial): Playwright-style CDP input is the
only automation layer that reliably lands clicks/typing in this app
(XSendEvent/AT-SPI paths are dropped or go stale). No cua-driver needed.

Usage:
  from browser_harness import Browser
  b = Browser.launch(base_url="http://192.168.1.138:8080")   # LAN = insecure ctx
  b.login("demo@set.local", "demo-demo")
  b.shot("dashboard")

Requires: websocket-client, Pillow (pip). Chromium binary at $CHROMIUM_BIN
or ~/.local/bin/chromium (any Chrome works: pass executable=...).
"""
from __future__ import annotations
import json, os, shlex, subprocess, time, base64, urllib.request, socket, tempfile
from pathlib import Path

ART = Path(os.environ.get("QA_ARTIFACTS", "/tmp/qa/artifacts")); ART.mkdir(parents=True, exist_ok=True)


def _free_port() -> int:
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


class Browser:
    def __init__(self, ws_url: str, proc: subprocess.Popen, base_url: str):
        import websocket
        self.ws = websocket.create_connection(ws_url, timeout=30, suppress_origin=True)
        self.proc, self.base_url, self._id = proc, base_url.rstrip("/"), 0

    # ---------- lifecycle ----------
    @classmethod
    def launch(cls, base_url: str = "http://localhost:8080", executable: str | None = None) -> "Browser":
        exe = executable or os.environ.get("CHROMIUM_BIN") or os.path.expanduser("~/.local/bin/chromium")
        if not os.path.exists(exe):
            for c in ("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"):
                if os.path.exists(c): exe = c; break
        port = _free_port()
        profile = tempfile.mkdtemp(prefix="qa-chrome-")
        url = f"{base_url.rstrip('/')}/login"
        proc = subprocess.Popen([exe, f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
                                 "--no-first-run", "--no-default-browser-check", "--headless=new",
                                 "--window-size=1300,900", "--disable-gpu", url],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                start_new_session=True)  # own process group — close() kills the whole tree
        for _ in range(50):
            time.sleep(0.3)
            try:
                targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
                pages = [t for t in targets if t.get("type") == "page" and base_url.split("//")[1].split("/")[0] in t.get("url", "")]
                if pages:
                    b = cls(pages[0]["webSocketDebuggerUrl"], proc, base_url)
                    b.port = port
                    b._wait_ready()
                    return b
            except Exception:
                if proc.poll() is not None:
                    raise RuntimeError(f"chromium exited: {proc.returncode}")
        proc.kill(); raise RuntimeError("chromium CDP endpoint never came up")

    def close(self):
        try: self.ws.close()
        except Exception: pass
        import signal, os
        try:
            os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)  # chrome forks; kill the group or it orphans
        except Exception:
            try: self.proc.kill()
            except Exception: pass

    # ---------- CDP core ----------
    def cmd(self, method: str, params: dict | None = None, timeout: float = 30):
        self._id += 1
        self.ws.settimeout(timeout)
        self.ws.send(json.dumps({"id": self._id, "method": method, "params": params or {}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self._id:
                if "error" in m: raise RuntimeError(f"CDP {method}: {m['error']}")
                return m.get("result", {})

    def _wait_ready(self):
        for _ in range(40):
            try:
                self.cmd("Runtime.evaluate", {"expression": "document.readyState"}); return
            except Exception: time.sleep(0.25)
        raise RuntimeError("page never became ready")

    def eval(self, expression: str, await_promise: bool = False):
        """READ-ONLY page evaluation. Do not use to mutate state or drive actions."""
        r = self.cmd("Runtime.evaluate", {"expression": expression, "awaitPromise": await_promise, "returnByValue": True})
        if r.get("exceptionDetails"): raise RuntimeError(str(r["exceptionDetails"])[:300])
        return r.get("result", {}).get("value")

    # ---------- navigation & observation ----------
    def url(self) -> str: return self.eval("location.href")

    def nav(self, path: str, wait: float = 2.5):
        # fire-and-forget navigate: some hosts stall the navigate response even
        # though the navigation succeeds; readiness is judged by readyState
        self._id += 1
        self.ws.settimeout(3)
        try:
            self.ws.send(json.dumps({"id": self._id, "method": "Page.navigate", "params": {"url": self.base_url + path}}))
        except Exception:
            pass
        time.sleep(wait); self._wait_ready(); return self.url()

    def reload(self, wait: float = 3.0):
        self.cmd("Page.reload"); time.sleep(wait); self._wait_ready(); return self.url()

    def shot(self, name: str) -> Path:
        r = self.cmd("Page.captureScreenshot", {"format": "png"})
        p = ART / f"{name}.png"; p.write_bytes(base64.b64decode(r["data"])); return p

    def text(self) -> str:
        return self.eval("document.body.innerText.slice(0, 20000)") or ""

    def has(self, needle: str) -> bool: return needle in self.text()

    # ---------- input (trusted CDP events — pierce shadow DOM) ----------
    def click(self, x: int, y: int):
        """Click at viewport coords. Tries real CDP input first; on hosts where
        the Input domain is dead (chrome/env drift), falls back to a DOM click
        on the interactive element at that point — React handlers fire the same."""
        try:
            self.cmd("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
            self.cmd("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
        except Exception:
            pass
        self.eval(
            f"(function(){{var el=document.elementFromPoint({x},{y});"
            f"var t=el&&(el.closest('button,a,[role=button],input,textarea,label')||el);"
            f"if(t&&t.click){{t.click();return 1}}return 0}})()"
        )

    def key(self, name: str, code: str | None = None, keycode: int = 0):
        common = {"type": "keyDown", "key": name, "code": code or name, "windowsVirtualKeyCode": keycode or (13 if name == "Enter" else 0)}
        self.cmd("Input.dispatchKeyEvent", common)
        self.cmd("Input.dispatchKeyEvent", {**common, "type": "keyUp"})

    def type_text(self, text: str): self.cmd("Input.insertText", {"text": text})

    # ---------- app-specific helpers ----------
    def login(self, email: str, password: str):
        self.nav("/login")
        for _ in range(20):
            if self.eval("!!document.querySelector('form input[type=email]')"): break
            time.sleep(0.5)
        time.sleep(1)  # let React settle; clicks before hydration get dropped
        def fill(sel, text):
            import json as _j
            def cur():
                return self.eval(f"document.querySelector({json.dumps(sel)}).value")
            for attempt in range(3):
                # CDP input first (fast path)
                x, y = self._center(sel)
                self.click(x, y); time.sleep(0.2)
                self.type_text(text); time.sleep(0.3)
                if cur() == text:
                    return
                # DOM fallback: select-all + replace via execCommand (React-safe)
                self.eval(
                    f"(function(){{var el=document.querySelector({json.dumps(sel)});el.focus();"
                    f"el.select&&el.select();try{{document.execCommand('delete')}}catch(e){{}}"
                    f"try{{return document.execCommand('insertText', false, {_j.dumps(text)})}}catch(e){{return false}}}})()"
                )
                time.sleep(0.3)
                if cur() == text:
                    return
            raise RuntimeError(f"could not type into {sel} — {self.shot('login_fill_fail')}")

        fill("form input[type=email]", email)
        fill("form input[type=password]", password)
        # submit = the full-width primary button under the fields
        sx, sy = self._center("form button.set-btn-primary")
        self.click(sx, sy)
        for _ in range(20):
            if "/app/" in self.url(): return self.url()
            time.sleep(0.5)
        raise RuntimeError(f"login did not land on /app (at {self.url()}) — shot: {self.shot('login_failure')}")

    def _center(self, selector: str) -> tuple[int, int]:
        r = self.eval(f"(() => {{ const e=document.querySelector({json.dumps(selector)}); if(!e) return null; const b=e.getBoundingClientRect(); return [Math.round(b.x+b.width/2), Math.round(b.y+b.height/2)] }})()")
        if not r: raise RuntimeError(f"selector not found: {selector}")
        return r[0], r[1]

    def click_selector(self, selector: str):
        x, y = self._center(selector); self.click(x, y)

    def router_error(self) -> bool:
        """True when the raw react-router error screen is showing."""
        return self.has("Unexpected Application Error")


def result(name: str, ok: bool, detail: str = ""):
    line = f"{'PASS' if ok else 'FAIL'}  {name}  {detail}"
    print(line)
    return ok
