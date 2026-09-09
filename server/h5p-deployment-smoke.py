"""Deployment contract: built SET web + real Nginx + server + disposable PostgreSQL.

Run only with server/test/h5p-compose.yml. No application, H5P or database mocks.
All libraries are provisioned offline from the committed bundle. Authoring has no iframe.
"""
import io
import json
import os
from pathlib import Path
import random
import re
import ssl
import struct
import uuid
import zipfile
import zlib
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

if os.environ.get("H5P_TEST_DATABASE") != "1":
    raise RuntimeError("H5P_TEST_DATABASE=1 is required; use the disposable test compose stack.")
origin = os.environ.get("SET_DEPLOYMENT_BASE", "http://localhost:8088").rstrip("/")
endpoint = urlsplit(origin)
if endpoint.hostname not in ["localhost", "127.0.0.1"] or endpoint.port not in [8088, 8448] or endpoint.scheme not in ["http", "https"] or endpoint.path or endpoint.query or endpoint.fragment or endpoint.username or endpoint.password:
    raise RuntimeError("Use only the disposable test stack on localhost:8088 or localhost:8448.")
artifacts = Path(os.environ.get("H5P_BROWSER_ARTIFACTS", "/tmp/h5p-deployment"))
artifacts.mkdir(parents=True, exist_ok=True)
# Only the explicitly disposable TLS fixture uses its generated self-signed certificate.
ssl_context = ssl._create_unverified_context() if os.environ.get("H5P_TEST_SELF_SIGNED") == "1" else ssl.create_default_context()
token = ""


def request(method, path, data=None, content_type="application/json", auth=True):
    headers = {"content-type": content_type, "origin": origin}
    if auth:
        headers["authorization"] = "Bearer " + token
    raw = json.dumps(data).encode() if data is not None and content_type == "application/json" else data
    try:
        with urlopen(Request(origin + path, data=raw, headers=headers, method=method), context=ssl_context, timeout=90) as response:
            return response.status, response.read(), response.headers
    except HTTPError as error:
        return error.code, error.read(), error.headers


def api(method, path, data=None):
    status, raw, _ = request(method, "/api" + path, data)
    assert status == 200, f"{method} {path}: HTTP {status}: {raw[:200]!r}"
    return json.loads(raw)


def png():
    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data))
    rng = random.Random(42)
    pixels = b"".join(b"\0" + rng.randbytes(1024 * 3) for _ in range(1024))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1024, 1024, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


def redact(text):
    return re.sub(r"/api/h5p/runtime/[^/\s\"']+", "/api/h5p/runtime/[redacted]", str(text)).replace(token, "[session]")


login = api("POST", "/auth/login", {"email": "demo@set.local", "password": "demo-demo"})
token = login["token"]
api("PUT", "/users/onboarding", {"welcomed": True})
space = api("POST", "/spaces", {"name": "H5P deployed browser " + uuid.uuid4().hex[:8]})["space"]["id"]
studio_path = f"/app/space/{space}/h5p"

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    context = browser.new_context(ignore_https_errors=os.environ.get("H5P_TEST_SELF_SIGNED") == "1", viewport={"width": 1440, "height": 1000})
    context.add_init_script("if (location.origin === " + json.dumps(origin) + ") localStorage.setItem('set_token', " + json.dumps(token) + ");")
    page = context.new_page()
    page.set_default_timeout(30000)
    errors = []
    failed = []
    page.on("pageerror", lambda error: errors.append(redact(error)))
    page.on("response", lambda response: failed.append({"url": redact(response.url), "status": response.status}) if "/h5p/" in response.url and response.status >= 400 else None)
    try:
        response = page.goto(origin + studio_path, wait_until="domcontentloaded")
        assert response.status == 200
        assert "no-cache" in response.headers.get("cache-control", ""), "Deployed SPA HTML must revalidate"
        expect(page.get_by_role("heading", name="H5P Studio", exact=True)).to_be_visible()
        page.get_by_role("button", name="Content types", exact=True).click()
        card = page.locator("article").filter(has=page.get_by_role("heading", name="Fill in the Blanks", exact=True))
        expect(card).to_be_visible(timeout=90000)
        expect(card.get_by_text(re.compile(r"Ready 1\."))).to_be_visible()
        status = api("GET", f"/spaces/{space}/h5p/status")
        assert status["bundle"]["ready"] and status["bundle"]["contentTypes"] == 53 and status["bundle"]["libraries"] == 145
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/h5p/libraries")) as installed:
            card.get_by_role("button", name="Verify type", exact=True).click()
        assert installed.value.status == 200 and installed.value.json()["verified"] is True
        print("PASS bundled catalog ready on fresh deployment; verify confirms real assets and dependencies")
        page.get_by_role("button", name=re.compile(r"^Activities")).click()
        page.get_by_role("button", name="Create activity", exact=True).click()
        page.wait_for_url(re.compile(r"/h5p/[0-9a-f-]{36}$"))
        activity = page.url.rsplit("/", 1)[1]
        native = page.get_by_role("region", name="Native H5P editor", exact=True)
        expect(native.get_by_label("Content type", exact=True)).to_be_visible()
        assert page.locator('iframe[title^="Edit "], iframe.h5p-editor-iframe').count() == 0, "Authoring must mount in SET, not a frame"
        native.get_by_label("Content type", exact=True).select_option(label="Fill in the Blanks")
        title = native.locator(".field-name-extraTitle input").first
        expect(title).to_be_visible()
        native.get_by_role("button", name="Save draft", exact=True).first.click()
        expect(native.get_by_role("alert")).to_contain_text("required fields")
        page.set_viewport_size({"width": 390, "height": 844})
        title.fill("Deployed H5P lesson")
        native.locator('.field-name-question [contenteditable="true"]').first.fill("SET uses *H5P*.")
        title.click()
        native.get_by_role("button", name="Metadata", exact=True).first.click()
        metadata = native.locator('.h5p-metadata-popup-overlay')
        expect(metadata.locator('.field-name-source input')).to_be_visible()
        metadata.locator('.field-name-source input').fill('https://example.org/lesson-source')
        page.screenshot(path=str(artifacts / "native-metadata-phone.png"), full_page=True)
        metadata.get_by_role("button", name="Save metadata", exact=True).click()
        expect(metadata).not_to_be_visible()
        publish = page.get_by_role("button", name="Publish saved draft", exact=True)
        expect(publish).to_be_disabled()
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/draft")) as saved:
            native.get_by_role("button", name="Save draft", exact=True).first.click()
        assert saved.value.status == 200, "First native save failed"
        assert saved.value.json()["activity"]["draftRevision"] == 1
        expect(page.get_by_role("heading", name="Deployed H5P lesson", exact=True)).to_be_visible()
        expect(publish).to_be_enabled()
        expect(title).to_have_value("Deployed H5P lesson")
        title.fill("Deployed H5P lesson revised")
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/draft")) as saved_again:
            native.get_by_role("button", name="Save draft", exact=True).first.click()
        assert saved_again.value.status == 200
        assert saved_again.value.json()["activity"]["draftRevision"] == 2
        expect(title).to_have_value("Deployed H5P lesson revised")
        expect(native.locator('.field-name-question [contenteditable="true"]').first).to_be_visible()
        expect(native.get_by_role("button", name="Save draft", exact=True).first).to_be_enabled()
        expect(publish).to_be_enabled()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Native authoring overflows a phone"
        page.screenshot(path=str(artifacts / "native-authoring-phone.png"), full_page=True)
        page.set_viewport_size({"width": 1440, "height": 1000})
        publish.click()
        page.get_by_role("button", name="Published activity", exact=True).click()
        player = page.frame_locator('iframe[title^="Play "]')
        expect(player.locator(".h5p-content")).to_contain_text("SET uses")
        player.get_by_role("textbox").fill("H5P")
        # Hub Blanks 1.14 sets aria-label "Check the answers…" which overrides the visible label.
        player.get_by_role("button", name=re.compile(r"^Check\b")).click()
        expect(player.locator(".h5p-content")).to_contain_text("1")
        page.screenshot(path=str(artifacts / "published-lesson.png"), full_page=True)
        print("PASS empty activity → native authoring → two saves → parent publish → actual question playback")
        with page.expect_download() as download:
            page.get_by_role("button", name="Export H5P package", exact=True).click()
        package = Path(download.value.path()).read_bytes()
        image = png()
        source, output = zipfile.ZipFile(io.BytesIO(package)), io.BytesIO()
        metadata = json.loads(source.read("h5p.json"))
        metadata["title"] = "Imported media lesson"
        dependency = {"machineName": "H5P.Image", "majorVersion": 1, "minorVersion": 1}
        if dependency not in metadata["preloadedDependencies"]:
            metadata["preloadedDependencies"].append(dependency)
        params = json.loads(source.read("content/content.json"))
        params["media"] = {"type": {"library": "H5P.Image 1.1", "subContentId": str(uuid.uuid4()), "params": {"file": {"path": "images/regression.png", "mime": "image/png", "width": 1024, "height": 1024}, "alt": "Regression image", "decorative": False}}, "disableImageZooming": False}
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as modified:
            for name in source.namelist():
                if name not in ["h5p.json", "content/content.json"]:
                    modified.writestr(name, source.read(name))
            modified.writestr("h5p.json", json.dumps(metadata))
            modified.writestr("content/content.json", json.dumps(params))
            modified.writestr("content/images/regression.png", image)
        data = output.getvalue()
        assert len(data) > 2 * 1024 * 1024
        page.goto(origin + studio_path, wait_until="domcontentloaded")
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/h5p/import"), timeout=60000) as imported:
            page.get_by_label("Import H5P package", exact=True).set_input_files({"name": "media.h5p", "mimeType": "application/zip", "buffer": data})
        assert imported.value.status == 200, f"Proxy package import: HTTP {imported.value.status}"
        expect(page.get_by_role("heading", name="Imported media lesson", exact=True)).to_be_visible()
        page.get_by_role("button", name="Preview draft", exact=True).click()
        image_view = page.frame_locator('iframe[title^="Play "]').get_by_alt_text("Regression image", exact=True)
        expect(image_view).to_be_visible()
        assert image_view.evaluate("img => img.complete && img.naturalWidth === 1024"), "Imported media did not load"
        page.get_by_role("button", name="Phone-width preview", exact=True).click()
        page.set_viewport_size({"width": 390, "height": 844})
        expect(image_view).to_be_visible()
        page.screenshot(path=str(artifacts / "imported-media-phone.png"), full_page=True)
        assert not failed, "Failed H5P requests: " + json.dumps(failed)
        assert not errors, "Browser JavaScript errors: " + json.dumps(errors)
        print("PASS multi-megabyte package import through Nginx, native media rendering and phone preview")
        page.set_viewport_size({"width": 1440, "height": 1000})
        page.goto(origin + studio_path + "/" + activity, wait_until="domcontentloaded")
        page.get_by_role("button", name="Published activity", exact=True).click()
        expect(player.locator(".h5p-content")).to_contain_text("SET uses")
        api("POST", f"/h5p/activities/{activity}/unpublish", {"expectedRevision": 2})
        page.locator('iframe[title^="Play "]').evaluate("frame => frame.contentWindow.location.reload()")
        error_panel = page.get_by_role("alert").filter(has=page.get_by_role("button", name="Reopen activity", exact=True))
        expect(error_panel).to_be_visible(timeout=10000)
        assert any(item["status"] in [403, 404] for item in failed), "A revoked grant must be denied"
        failed.clear()
        api("POST", f"/h5p/activities/{activity}/publish", {"expectedRevision": 2})
        page.get_by_role("button", name="Reopen activity", exact=True).click()
        expect(player.locator(".h5p-content")).to_contain_text("SET uses")
        expect(error_panel).not_to_be_visible()
        expect(page.get_by_text("Loading interactive content…", exact=True)).not_to_be_visible()
        assert not errors, "Browser JavaScript errors: " + json.dumps(errors)
        assert not failed, "Failed recovery requests: " + json.dumps(failed)
        print("PASS revoked-launch error is visible in Studio; reopening obtains a fresh authorized player")
        page.on("dialog", lambda dialog: dialog.accept())  # Disposable unsaved test drafts only.
        for library, label, selector in [
            ("H5P.GameMap 1.5", "Game Map", ".h5peditor-panes"),
            ("H5P.CoursePresentation 1.26", "Course Presentation", ".h5p-course-presentation"),
            ("H5P.BranchingScenario 1.8", "Branching Scenario", ".bs-editor-content-tab"),
        ]:
            draft = api("POST", f"/spaces/{space}/h5p/activities", {"title": label + " authoring check"})["activity"]
            page.set_viewport_size({"width": 1440, "height": 1000})
            page.goto(origin + studio_path + "/" + draft["id"], wait_until="domcontentloaded")
            expect(native.get_by_label("Content type", exact=True)).to_be_visible()
            before = page.evaluate("""() => {
                const probe = document.createElement('div'); probe.id = 'set-style-scope-probe'; probe.className = 'canvas tabs-nav'; document.body.append(probe);
                const css = getComputedStyle(probe); return [css.position, css.display, css.backgroundColor, css.padding, css.margin];
            }""")
            native.get_by_label("Content type", exact=True).select_option(library)
            expect(native.locator(selector).first).to_be_visible(timeout=30000)
            assert page.locator('iframe[title^="Edit "], iframe.h5p-editor-iframe').count() == 0
            after = page.evaluate("""() => { const css = getComputedStyle(document.querySelector('#set-style-scope-probe')); return [css.position, css.display, css.backgroundColor, css.padding, css.margin]; }""")
            assert before == after, label + " leaked editor styles into SET"
            page.set_viewport_size({"width": 390, "height": 844})
            expect(native.locator(selector).first).to_be_visible()
            page.screenshot(path=str(artifacts / (library.split()[0] + "-phone.png")), full_page=True)
            assert not errors, label + ": " + json.dumps(errors)
            assert not failed, label + ": " + json.dumps(failed)
            print("PASS composite native authoring: " + label + ", phone viewport and CSS isolation")

    except Exception:
        page.screenshot(path=str(artifacts / "failure.png"), full_page=True)
        frame_text = []
        for frame in page.frames:
            try:
                frame_text.append(redact(frame.locator("body").inner_text(timeout=3000))[:12000])
            except Exception:
                frame_text.append("Frame detached during diagnostic capture")
        (artifacts / "diagnostics.json").write_text(json.dumps({"errors": errors, "failed": failed, "frames": frame_text}, indent=2))
        raise
    finally:
        browser.close()
