"""Real browser contract, invoked by h5p-smoke.mjs inside its disposable workspace."""
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright, expect

base = os.environ.get("SET_BASE", "http://localhost:4000/api")
origin = base.removesuffix("/api")
token = os.environ["H5P_TEST_TOKEN"]
space = os.environ["H5P_TEST_SPACE"]
artifacts = Path(os.environ.get("H5P_BROWSER_ARTIFACTS", "/tmp/h5p-browser"))
artifacts.mkdir(parents=True, exist_ok=True)


def api(method, path, data=None):
    url = origin + path if path.startswith("/api/") else base + path
    request = Request(url, method=method, data=None if data is None else json.dumps(data).encode(), headers={
        "authorization": "Bearer " + token,
        "content-type": "application/json",
        "origin": "http://localhost:5173",
    })
    with urlopen(request, timeout=30) as response:
        return json.load(response)


activity = api("POST", f"/spaces/{space}/h5p/activities", {"title": "Browser authoring contract"})["activity"]
activity_id = activity["id"]
launch = api("POST", f"/h5p/activities/{activity_id}/launch", {"mode": "edit"})
api("POST", launch["url"].removesuffix("/editor") + "/save", {
    "library": "H5P.StudioSmoke 1.0",
    "params": {"metadata": {"title": "Browser authoring contract", "license": "U"}, "params": {"text": "Original browser content"}},
})
launch = api("POST", f"/h5p/activities/{activity_id}/launch", {"mode": "edit"})

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(origin + launch["url"], wait_until="domcontentloaded")
        # This is H5PEditor's own iframe, not a SET replacement form.
        native = page.frame_locator("iframe").first
        field = native.get_by_label("Content", exact=True)
        expect(field).to_be_visible(timeout=30000)
        field.fill("Saved from the native H5P editor")
        with page.expect_response(lambda response: response.request.method == "POST" and response.url.endswith("/save"), timeout=30000) as saved:
            page.get_by_role("button", name="Save draft", exact=True).click()
        assert saved.value.status == 200, "Native editor save request failed"
        assert saved.value.json()["activity"]["draftRevision"] == 2, "Native editor did not create a new revision"
        expect(page.get_by_role("status")).to_have_text("Draft saved.")
        page.screenshot(path=str(artifacts / "native-editor.png"), full_page=True)
        api("POST", f"/h5p/activities/{activity_id}/publish", {"expectedRevision": 2})
        play = api("POST", f"/h5p/activities/{activity_id}/launch", {"mode": "play"})
        page.goto(origin + play["url"], wait_until="domcontentloaded")
        expect(page.locator(".h5p-content")).to_have_text("Saved from the native H5P editor", timeout=15000)
        page.set_viewport_size({"width": 390, "height": 844})
        expect(page.locator(".h5p-content")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Player overflows a phone viewport"
        assert not errors, "Native runtime JavaScript errors: " + "; ".join(errors)
        page.screenshot(path=str(artifacts / "native-player-phone.png"), full_page=True)
        print("PASS native browser editor: load, edit, save immutable revision, publish, play, phone viewport")
    except Exception:
        page.screenshot(path=str(artifacts / "native-browser-failure.png"), full_page=True)
        # Page content may contain short-lived disposable launch grants; do not print it.
        (artifacts / "runtime-errors.json").write_text(json.dumps(errors, indent=2))
        raise
    finally:
        browser.close()
