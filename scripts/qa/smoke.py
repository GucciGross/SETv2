#!/usr/bin/env python3
"""SET smoke test — run after every deploy. Exercises the flows that have
regressed before: insecure-context crypto, login, stat-card navigation,
deep links, the 404 catch-all, and the copilot popup rendering.

  python3 scripts/qa/smoke.py                     # http://localhost:8080
  python3 scripts/qa/smoke.py http://192.168.1.138:8080   # LAN / insecure ctx

Exits non-zero if any check fails. Screenshots land in /tmp/qa/artifacts.
"""
import sys, time
sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from browser_harness import Browser, result, ART

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"
EMAIL, PASSWORD = "demo@set.local", "demo-demo"
checks = []

b = Browser.launch(BASE)
try:
    # T0 — no insecure-context crypto crash on boot (the LAN-IP regression)
    b.nav("/login", wait=4)
    checks.append(result("T0 no router crash on load", not b.router_error(),
                         "" if not b.router_error() else b.text()[:200]))
    b.shot("t0_login")

    # T1 — login lands on the dashboard
    url = b.login(EMAIL, PASSWORD)
    checks.append(result("T1 login → dashboard", "/app/" in url, url))
    b.shot("t1_dashboard")
    checks.append(result("T1b no crash after login", not b.router_error()))

    # T1c — session survives reload
    b.reload(); time.sleep(1)
    checks.append(result("T1c session survives reload", "/app/" in b.url() and not b.router_error(), b.url()))

    # T2 — stat cards open lists (click the Pages card via its accessible name)
    pages_card = b.eval(r"(() => { const btns=[...document.querySelectorAll('button')]; const b=btns.find(x=>/PAGES/.test(x.innerText)&&/^\d/.test(x.innerText.trim())); if(!b) return null; const r=b.getBoundingClientRect(); return [r.x+r.width/2|0, r.y+r.height/2|0] })()")
    if pages_card:
        b.click(*pages_card); time.sleep(2)
        ok = "/pages" in b.url() and b.has("New page") and not b.router_error()
        checks.append(result("T2 Pages card → /pages list", ok, b.url()))
        b.shot("t2_pages")
    else:
        checks.append(result("T2 Pages card → /pages list", False, "card not found"))

    # T2b — databases list deep link
    b.nav("/app/space/x/databases", wait=2)
    checks.append(result("T2b /databases renders", b.has("Databases") and not b.router_error()))

    # T7 — unknown route → friendly 404, never the raw router error
    b.nav("/app/nope/nope", wait=2)
    friendly = b.has("doesn't exist") or b.has("Back to workspace")
    checks.append(result("T7 friendly 404", friendly and not b.router_error(),
                         "" if friendly else b.text()[:150]))
    b.shot("t7_404")

    # T3 — copilot popup opens without crashing the app (shadow DOM: click launcher)
    b.nav("/app", wait=2.5)
    launcher = b.eval("(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'').includes('copilot')); if(!b) return null; const r=b.getBoundingClientRect(); return [r.x+r.width/2|0, r.y+r.height/2|0] })()")
    if launcher:
        b.click(*launcher); time.sleep(3)
        crashed = b.router_error()
        # the popup's transcript is closed shadow DOM; its input-row buttons are
        # the reliable light-DOM signal that it rendered
        open_signals = b.eval(r"(() => { const els=[...document.querySelectorAll('[data-slot]')].filter(e=>{const r=e.getBoundingClientRect(); return r.x>840 && r.width>20 && r.width<60}); return els.length })()")
        welcome = b.has("on-screen guide") or b.has("Show me around")
        checks.append(result("T3 copilot popup opens, no crash", (bool(open_signals) or welcome) and not crashed,
                             f"input_row={open_signals} welcome={welcome} crashed={crashed}"))
        b.shot("t3_chat")
    else:
        checks.append(result("T3 copilot popup opens, no crash", False, "launcher not found"))

    # T4 — chat input accepts text. The input lives in a closed shadow DOM;
    # verify by pixel change in the popup (innerText can't see shadow content).
    inp = b.eval(r"(() => { const els=[...document.querySelectorAll('[data-slot]')].filter(e=>{const r=e.getBoundingClientRect(); return r.x>840 && r.y>540 && r.height>20 && r.height<60}); if(els.length<2) return null; const xs=els.map(e=>e.getBoundingClientRect().x); const rightmost=els.reduce((a,e)=>e.getBoundingClientRect().x>a.getBoundingClientRect().x?e:a); const rr=rightmost.getBoundingClientRect(); return [((Math.min(...xs)+rr.x)/2)|0, (rr.y+rr.height/2)|0] })()")
    if inp:
        before = b.shot("t4_before")
        b.click(inp[0], inp[1]); time.sleep(0.4); b.type_text("hello from qa"); time.sleep(0.6)
        after = b.shot("t4_after")
        from PIL import Image, ImageChops
        a, c = Image.open(before).convert("RGB"), Image.open(after).convert("RGB")
        diff = ImageChops.difference(a, c).getbbox()
        checks.append(result("T4 chat input accepts text", diff is not None, f"pixel-diff bbox={diff}"))
    else:
        checks.append(result("T4 chat input accepts text", False, "input row not located"))

    # T9 — editor page loads without insecure-context crash (block ids).
    # Open the first page from the real /app/space/<id>/pages list.
    import re as _re
    m = _re.search(r"/app/space/([^/]+)", url)
    if m:
        b.nav(f"/app/space/{m.group(1)}/pages", wait=2.5)
        b.eval(r"(() => { const btn=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('Robotics Lab Home')); if(btn) btn.scrollIntoView({block:'center'}); return 'ok' })()")
        time.sleep(0.5)
        row = b.eval(r"(() => { const btn=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('Robotics Lab Home')); if(!btn) return null; const r=btn.getBoundingClientRect(); return [r.x+r.width/2|0, r.y+r.height/2|0] })()")
        if row:
            b.click(row[0], row[1]); time.sleep(3)
        ok = "/page/" in b.url() and not b.router_error()
        checks.append(result("T9 page editor loads", ok, b.url()))
        b.shot("t9_editor")
    else:
        checks.append(result("T9 page editor loads", False, "spaceId not derived"))

finally:
    b.close()

print(f"\n{'='*50}\n{'ALL PASS' if all(checks) else 'FAILURES PRESENT'}: {sum(checks)}/{len(checks)}")
sys.exit(0 if all(checks) else 1)
