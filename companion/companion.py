"""SET teaching companion — the Phase 2 local agent (PLAN.md).

Runs on the USER'S OWN machine. Pairs with their SET instance via a revocable
token, then claims teach tasks and demonstrates IN THEIR REAL BROWSER:
opens a tab, navigates, highlights an element, shows a caption.

Phase 3 added native desktop demos (cua-driver): launch an app, point the
animated agent cursor at an element, caption it. Still visible-actions-only.

Phase 4 added agent computer use: the SET agent's screen_capture / screen_act
tools queue kind='cua' tasks executed here against cua-driver — annotated
captures (numbered element index + screenshot) and, when the companion runs
with SET_ALLOW_INPUT=1, click/type/key/scroll actions (each followed by a
fresh capture). Input is opt-in per machine; without the flag the companion
remains observe-only.

Principles (PLAN.md): visible foreground action only — no headless browsing,
no background operation. The user can quit any time (Ctrl-C) and revoke the
token in SET settings.

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
            time.sleep(2.0)  # the user watches the page load
        # wait for the target element (SPAs render late) before highlighting
        sel = selector or "body"
        for _ in range(10):
            r = self._cmd("Runtime.evaluate", {"expression": f"!!document.querySelector({json.dumps(sel)})"})
            if r.get("result", {}).get("value"):
                break
            time.sleep(0.8)
        # optional spoken narration — browser-local speech, no cloud calls
        narration = ""
        if message:
            try:
                self._cmd("Runtime.evaluate", {
                    "expression": f"try{{const u=new SpeechSynthesisUtterance({json.dumps(message)});u.rate=1.02;speechSynthesis.speak(u);'spoken'}}catch(e){{'no-speech'}}"
                })
                narration = " +narrated"
            except Exception:
                pass
        js = (
            HIGHLIGHT_JS.replace("%SELECTOR%", json.dumps(sel))
            .replace("%MESSAGE%", json.dumps(message or ""))
        )
        r = self._cmd("Runtime.evaluate", {"expression": js})
        return str(r.get("result", {}).get("value", "unknown")) + narration




# ---------------- native desktop demos (Phase 3, cua-driver) ----------------
# Visible actions only: launch the app, point the animated agent cursor at the
# element, show a desktop-notification caption. No clicks, no edits.

def cua(*args: str) -> dict:
    import subprocess as sp
    r = sp.run(["cua-driver", *args], capture_output=True, text=True, timeout=90)
    try:
        return json.loads(r.stdout) if r.stdout.strip() else {"error": r.stderr[:300]}
    except Exception:
        return {"error": (r.stdout + r.stderr)[:300]}


def native_demo(app: str, element: str, message: str | None) -> str:
    import time as _t
    st = cua("status")
    if "running" not in str(st).lower():
        return "error: cua-driver daemon is not running (start it with `cua-driver serve`)"

    before = {w.get("window_id") for w in cua("list_windows", "{}").get("windows", [])}
    launched = cua("launch_app", json.dumps({"name": app}))
    pid = launched.get("pid")
    if not pid and not launched.get("running"):
        return f"error: could not launch {app} ({launched.get('error') or launched})"
    # X11 window lists often report pid=None and launch responses lag; the
    # reliable signal is a NEW top-level window appearing after launch
    win = None
    for _ in range(12):
        _t.sleep(1.0)
        wins = [w for w in cua("list_windows", "{}").get("windows", []) if w.get("window_id") not in before]
        if wins:
            win = wins[0]
            break
    if not win:
        return f"error: launched {app} (pid {pid}) but no new window appeared"
    log(f"launched {app} (pid {pid}, window {win['window_id']}: {win.get('title')})")
    _t.sleep(2.0)  # AT-SPI tree starts settling — the user watches it open
    state_pid = win.get("pid") or pid or 0
    state = cua("get_window_state", json.dumps({"pid": state_pid, "window_id": win["window_id"], "include_screenshot": False}))
    if state.get("degraded"):
        return "error: accessibility tree unavailable (AT-SPI not exposed for this app)"

    # element match: "role:name" (either side optional) against role+label;
    # GTK populates AT-SPI lazily, so retry the walk a few times
    want_role, _, want_name = element.partition(":")
    want_role = want_role.strip().lower()
    want_name = want_name.strip().lower()
    hit = None
    for _attempt in range(4):
        for el in state.get("elements", []):
            role = str(el.get("role") or "").lower()
            label = str(el.get("label") or "").lower()
            f = el.get("frame") or {}
            try:
                ok_frame = f and isinstance(f.get("x"), (int, float)) and f.get("w", 0) > 0
            except Exception:
                ok_frame = False
            if not ok_frame:
                continue
            if want_role and want_name:
                if want_role in role and want_name in label:
                    hit = el; break
            elif want_role:
                if want_role in role:
                    hit = el; break
            elif want_name and want_name in label:
                hit = el; break
        if hit:
            break
        _t.sleep(1.5)
        state = cua("get_window_state", json.dumps({"pid": state_pid, "window_id": win["window_id"], "include_screenshot": False}))
    if not hit:
        roles = sorted({str(e.get("role")) for e in state.get("elements", []) if e.get("role")})[:12]
        return f"error: element '{element}' not found; roles seen: {', '.join(roles)}"

    f = hit["frame"]
    cx = int(f["x"] + f.get("w", 0) / 2)
    cy = int(f["y"] + f.get("h", 0) / 2)
    cua("start_session", json.dumps({"session": "set-teach"}))
    cua("move_cursor", json.dumps({"x": cx, "y": cy, "session": "set-teach"}))
    if message:
        try:
            import subprocess as sp
            sp.run(["notify-send", "-t", "20000", "SET demo", message or hit.get("label") or element], timeout=10)
        except Exception:
            pass  # caption is best-effort; the pointer is the demo
    log(f"pointing at {hit.get('role')} '{hit.get('label')}' @({cx},{cy})")
    _t.sleep(6.0)  # the user watches the pointer pulse on the element
    cua("end_session", json.dumps({"session": "set-teach"}))
    return f"pointed at {hit.get('role')} '{hit.get('label') or element}'"


# ---------------- agent computer use (Phase 4, cua-driver) ----------------
# The SET agent's `computer_use` tool queues kind='cua' teach tasks; the
# companion executes them here. Reads (capture/list/launch) are always
# allowed. Input actions (click/type/key/scroll) additionally require the
# companion to run with SET_ALLOW_INPUT=1 — the user opts in per machine,
# mirroring hermes-agent's per-action approval gate (MIT, Nous Research).

INPUT_ALLOWED = os.environ.get("SET_ALLOW_INPUT", "") in ("1", "true", "yes")
CAPTURE_WALK_LIMIT = 600        # AT-SPI elements fetched (frames land deep in the tree)
CAPTURE_MAX_LINES = 120         # framed elements surfaced in the agent-visible summary
SCREENSHOT_LONGEST_EDGE = 1024   # downscale before sending to the model


def _resolve_window(op: dict) -> dict | None:
    """Pick the window an op targets: explicit window_id/pid, else the
    topmost window whose title/app matches `app`, else the newest window."""
    wins = cua("list_windows", "{}").get("windows") or []
    if not wins:
        return None
    if op.get("window_id"):
        return next((w for w in wins if w.get("window_id") == op["window_id"]), None)
    if op.get("pid"):
        return next((w for w in wins if w.get("pid") == op["pid"]), None)
    app = str(op.get("app") or "").lower()
    if app:
        by_title = next((w for w in wins if app in str(w.get("title") or "").lower()
                         or app in str(w.get("app") or "").lower()), None)
        if by_title:
            return by_title
    return wins[-1]


def _downscale_png_b64(b64: str) -> tuple[str, int, int]:
    try:
        import base64
        import io
        from PIL import Image
        img = Image.open(io.BytesIO(base64.b64decode(b64)))
        w, h = img.size
        if max(w, h) > SCREENSHOT_LONGEST_EDGE:
            scale = SCREENSHOT_LONGEST_EDGE / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)))
            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
            return base64.b64encode(buf.getvalue()).decode(), img.size[0], img.size[1]
        return b64, w, h
    except Exception:
        return b64, 0, 0


def cua_capture(op: dict) -> dict:
    win = _resolve_window(op)
    if not win:
        return {"error": "no windows open — launch_app first"}
    # Two calls: the tree WITHOUT the screenshot carries usable element frames
    # (with include_screenshot=true most frames come back empty on GTK4), and
    # `zoom` 0,0–w,h is the full-window image without a second AT-SPI walk.
    args: dict = {"window_id": win["window_id"], "include_screenshot": False,
                  "max_elements": CAPTURE_WALK_LIMIT}
    if win.get("pid"):
        args["pid"] = win["pid"]
    state = cua("get_window_state", json.dumps(args))
    if state.get("error"):
        return {"error": f"cua-driver: {state['error']}"}
    elements = state.get("elements") or []
    title = win.get("title") or win.get("app") or "window"
    lines = [f"capture {title} (window_id={win['window_id']}) — {len(elements)} interactable element(s):"]
    max_lines = 500 if op.get("detail") else CAPTURE_MAX_LINES
    shown = 0
    for el in elements:
        f = el.get("frame") or {}
        if not (isinstance(f.get("x"), (int, float)) and (f.get("w") or 0) > 0):
            continue  # unaddressable elements only confuse the model
        if shown >= max_lines:
            continue
        shown += 1
        label = str(el.get("label") or "")[:60]
        flag = "" if el.get("enabled", True) else " [disabled]"
        lines.append(f"  [{el.get('element_index')}] {el.get('role')} \"{label}\" "
                     f"({int(f['x'])},{int(f['y'])} {int(f['w'])}x{int(f['h'])}){flag}")
    out: dict = {"summary": "\n".join(lines), "window_id": win["window_id"],
                 "total_elements": len(elements)}
    # full tree spills to disk so the model can grep details we truncated
    total = state.get("total_element_count") or len(elements)
    framed = sum(1 for el in elements
                 if isinstance((el.get("frame") or {}).get("x"), (int, float))
                 and (el.get("frame") or {}).get("w", 0) > 0)
    if total > len(elements) or framed > shown:
        import pathlib
        import tempfile
        spill = pathlib.Path(tempfile.gettempdir()) / f"set-cua-elements-{int(time.time())}.json"
        spill.write_text(json.dumps(state, indent=1)[:2_000_000])
        out["elements_file"] = str(spill)
        out["summary"] += (f"\n  (showing {shown} of {framed} addressable, {total} total — "
                           f"screen_capture again with detail=true for the full index)")
    shot = cua("zoom", json.dumps({"window_id": win["window_id"],
                                   "x1": 0, "y1": 0,
                                   "x2": win.get("width") or 9999, "y2": win.get("height") or 9999}))
    png = shot.get("screenshot_png_b64")
    if png:
        b64, w, h = _downscale_png_b64(png)
        out.update(png_b64=b64, width=w, height=h)
    else:
        out["summary"] += "\n  (no screenshot available — AT-SPI tree only)"
    return out


def cua_action(op: dict) -> dict:
    """Execute one computer-use op. Read ops always run; input ops need
    SET_ALLOW_INPUT=1 on the companion."""
    st = cua("status")
    if "running" not in str(st).lower():
        return {"error": "cua-driver daemon is not running (start with `cua-driver serve`)"}
    action = str(op.get("action") or "")

    read_ops = {
        "capture": lambda: cua_capture(op),
        "list_windows": lambda: {"windows": cua("list_windows", "{}").get("windows") or []},
        "list_apps": lambda: cua("list_apps", "{}"),
        "launch_app": lambda: cua("launch_app", json.dumps({"name": op.get("app") or ""})),
    }
    if action in read_ops:
        return read_ops[action]()

    if not INPUT_ALLOWED:
        return {"error": "input actions (click/type/key/scroll) are disabled on this companion — "
                         "restart it with SET_ALLOW_INPUT=1 to permit them"}
    win = _resolve_window(op) or {}
    # cua-driver input pairing: pixel actions want window_id + x/y; AX actions
    # want pid + element_index. Sending both ids makes the driver expect an
    # element_index and silently drop the coordinates.
    def _px() -> dict:
        return {"window_id": win.get("window_id")} if win.get("window_id") else {}
    def _ax() -> dict:
        return {"pid": win["pid"]} if win.get("pid") else {}
    has_index = op.get("element_index") is not None

    # Element tokens go stale the moment the daemon snapshots again, and GTK4
    # apps ignore background XSendEvent delivery — so AX actions re-resolve a
    # fresh token and use foreground delivery (brief focus swap, then restore).
    def _fresh_token() -> dict:
        args = {"include_screenshot": False, "max_elements": 400}
        if win.get("pid"):
            args["pid"] = win["pid"]
        if win.get("window_id"):
            args["window_id"] = win["window_id"]
        st = cua("get_window_state", json.dumps(args))
        want = op.get("element_index")
        for e in st.get("elements", []):
            if e.get("element_index") == want and e.get("element_token"):
                return {"pid": win["pid"], "window_id": win["window_id"],
                        "element_token": e["element_token"]}
        return {}

    fg = {"delivery_mode": "foreground"}
    ax_kwargs = _fresh_token() if has_index else _ax()
    input_ops = {
        "click": lambda: cua("click", json.dumps({
            **(ax_kwargs if has_index else _px()), **fg,
            **({"element_index": op["element_index"]} if has_index
               else {"x": op.get("x"), "y": op.get("y")}),
            "button": op.get("button", "left"), "count": op.get("count", 1)})),
        "type": lambda: cua("type_text", json.dumps({
            **(ax_kwargs if has_index else _px()), **fg,
            **({"element_index": op["element_index"]} if has_index else {}),
            "text": str(op.get("text") or "")})),
        "key": lambda: cua("hotkey", json.dumps({
            **({"pid": win["pid"], "window_id": win["window_id"]} if win.get("pid") else {}),
            "keys": [k.strip() for k in str(op.get("keys") or "").split("+") if k.strip()],
            "delivery_mode": "foreground"})),
        "scroll": lambda: cua("scroll", json.dumps({
            **({"pid": win["pid"]} if win.get("pid") else {}),
            "direction": op.get("direction", "down"), "amount": int(op.get("amount") or 3)})),
        "set_value": lambda: cua("set_value", json.dumps({
            **(ax_kwargs if has_index else _px()),
            **({"element_index": op["element_index"]} if has_index else {}),
            "value": str(op.get("value") or "")})),
    }
    fn = input_ops.get(action)
    if not fn:
        return {"error": f"unknown action '{action}' — use capture/click/type/key/scroll/"
                         "set_value/launch_app/list_windows/list_apps"}
    res = fn()
    if isinstance(res, dict) and res.get("error"):
        return {"error": str(res["error"])[:400]}
    # every input op ends with a fresh capture so the model sees the result
    follow = cua_capture(op)
    # some targets silently drop synthetic input (GTK4 keys); pass the
    # driver's own effect verdict through so the model re-grounds
    effect = (res.get("effect") or "delivered") if isinstance(res, dict) else "delivered"
    note = (" — driver could not verify the effect; compare the capture and "
            "retry differently if nothing changed" if effect == "unverifiable" else "")
    return {"action_result": f"ok{note}", "effect": effect,
            "after": {k: v for k, v in follow.items() if k != "png_b64"},
            "png_b64": follow.get("png_b64"), "width": follow.get("width"), "height": follow.get("height")}


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
                result_data: dict | None = None
                try:
                    if task.get("kind") == "cua":
                        outcome = cua_action(task.get("op") or {})
                        status = "error" if "error" in outcome else "done"
                        result = outcome.get("error") or "ok"
                        result_data = outcome
                    elif task.get("kind") == "native":
                        outcome = native_demo(task.get("app") or "", task.get("element") or "window",
                                              task.get("message") or task["title"])
                        status = "error" if outcome.startswith("error") else "done"
                        result = outcome
                    else:
                        if not tab.ensure():
                            raise RuntimeError("companion cannot attach to the browser (remote debugging off?)")
                        url = task.get("url") or "/"
                        if url.startswith("/"):
                            url = SET_URL + url
                        outcome = tab.demo(url, task.get("selector"), task.get("message") or task["title"])
                        status, result = "done", outcome
                except Exception as e:
                    status, result = "error", str(e)[:300]
                    result_data = {"error": result}
                post_body = {"status": status, "result": result}
                if task.get("kind") == "cua" and result_data:
                    post_body["result_data"] = result_data
                httpx.post(
                    f"{SET_URL}/api/companion/tasks/{task['id']}/result",
                    headers={"authorization": f"Bearer {TOKEN}"},
                    json=post_body,
                    timeout=60,  # capture payloads carry a screenshot
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
