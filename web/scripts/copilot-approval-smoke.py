"""Exercise SET's actual Copilot popup/slots with a deterministic AG-UI agent.

Only the LLM/decision transport is a fixture. No user accounts or live data are used.
Run against Vite on loopback; production artifacts never import the fixture entry.
"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = os.environ.get("SET_WEB_TEST_BASE", "http://127.0.0.1:5173")
if urlparse(base).hostname not in {"localhost", "127.0.0.1"}:
    raise RuntimeError("Copilot fixtures must run against a disposable loopback Vite server")
artifacts = Path(os.environ.get("COPILOT_BROWSER_ARTIFACTS", "/tmp/copilot-approvals"))
artifacts.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    for name, viewport, outcome in [
        ("mobile-approve", {"width": 390, "height": 844}, "approve"),
        ("desktop-deny", {"width": 1440, "height": 1000}, "reject"),
        ("mobile-retry", {"width": 390, "height": 844}, "retry"),
        ("mobile-expire", {"width": 390, "height": 844}, "expired"),
        ("mobile-stop", {"width": 390, "height": 844}, "cancelled"),
    ]:
        page = browser.new_page(viewport=viewport)
        errors = []
        decisions = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def transport(route):
            request = route.request
            path = urlparse(request.url).path
            if request.method == "POST" and path.endswith("/approve"):
                data = request.post_data_json
                assert data.get("callId") and data.get("decision") in {"approve", "reject"}, data
                decisions.append({"path": path, **data})
                if outcome == "retry" and len(decisions) == 1:
                    route.fulfill(status=503, json={"error": "Connection interrupted. Please retry this action."})
                else:
                    route.fulfill(json={"ok": True, "callId": data["callId"], "status": "approved" if data["decision"] == "approve" else "rejected"})
            elif "/approvals/" in path:
                # Retry scenario: first submission was not accepted. Keep the card pending.
                route.fulfill(json={"callId": path.rsplit("/", 1)[1], "status": "pending"})
            else:
                # Nonessential welcome/preferences reads have deterministic empty responses.
                route.fulfill(json={})

        page.route("**/api/**", transport)
        try:
            page.goto(base + "/scripts/fixtures/copilot-approvals.html", wait_until="domcontentloaded")
            toggle = page.locator("[data-slot='chat-toggle-button']")
            expect(toggle).to_be_visible(timeout=60000)
            toggle.click()
            popup = page.locator("[data-copilot-popup]")
            expect(popup).to_be_visible()
            if outcome == "expired":
                page.evaluate("window.approvalFixture.timeoutMs = 1500")
            prompt = popup.locator("textarea").last
            expect(prompt).to_be_visible()
            prompt.fill("Create an interactive H5P lesson")
            prompt.press("Enter")
            card = popup.locator("[data-set-approval]").last
            expect(card).to_be_visible(timeout=20000)
            expect(card).to_have_attribute("data-status", "pending")
            assert card.evaluate("el => !!el.closest('.set-chat-assistant')"), "Card is outside the chat message"
            assert page.locator("[data-set-approval]").count() == 1, "Duplicate/outside approval card"
            expect(card.get_by_text("Create an H5P draft", exact=True)).to_be_visible()
            for label in ["Approve", "Deny"]:
                button = card.get_by_role("button", name=label, exact=True)
                box = button.bounding_box()
                assert box and box["height"] >= 44, "Touch target is smaller than 44px"
            page.evaluate("window.approvalFixture.repeat()")
            expect(page.locator("[data-set-approval]")).to_have_count(1)
            bounds = card.bounding_box()
            assert bounds and bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= viewport["width"] + 1, "Approval overflows viewport"
            page.screenshot(path=str(artifacts / f"{name}-pending.png"), full_page=True)

            if outcome == "expired":
                expect(card).to_have_attribute("data-status", "expired", timeout=10000)
                expect(card.get_by_text("Expired without a decision.", exact=False)).to_be_visible()
                expect(card.get_by_role("button", name="Approve", exact=True)).to_have_count(0)
                page.evaluate("window.approvalFixture.finish('expired')")
                assert not decisions, "An expired card submitted a decision"
            elif outcome == "cancelled":
                # Cancel via the real Copilot input's stop button, not by resolving the fixture.
                stop = popup.locator("[data-testid='copilot-send-button']").first
                expect(stop).to_be_visible()
                stop.click()
                expect(card).to_have_attribute("data-status", "cancelled", timeout=10000)
                assert not decisions, "Stop must not imply a human approval/rejection"
            else:
                if outcome == "approve":
                    # Closing the panel must not render approvals behind it or discard them.
                    # On mobile the popup is fullscreen and covers the FAB; close via the popup's own control.
                    popup.get_by_role("button", name="Close", exact=True).click()
                    expect(page.locator("[data-set-approval]:visible")).to_have_count(0)
                    page.locator("[data-slot='chat-toggle-button']").click()
                    expect(card).to_have_attribute("data-status", "pending")
                button = card.get_by_role("button", name="Deny" if outcome == "reject" else "Approve", exact=True)
                # A double tap before React re-renders must still submit only one decision.
                button.evaluate("el => { el.click(); el.click(); }")
                if outcome == "retry":
                    expect(card.get_by_role("alert")).to_contain_text("Connection interrupted")
                    expect(card).to_have_attribute("data-status", "pending")
                    expect(card.get_by_role("button", name="Approve", exact=True)).to_be_enabled()
                    card.get_by_role("button", name="Approve", exact=True).click()
                status = "rejected" if outcome == "reject" else "approved"
                expect(card).to_have_attribute("data-status", status)
                assert len(decisions) == (2 if outcome == "retry" else 1), decisions
                if outcome == "retry":
                    assert decisions[0] == decisions[1], "A retry targeted a different tool call"
                # Receipt is not execution success: the actual tool result arrives separately.
                expect(popup.get_by_role("button", name="Open in H5P Studio")).to_have_count(0)
                page.evaluate("status => window.approvalFixture.finish(status)", status)
                if status == "approved":
                    expect(popup.get_by_role("button", name="Open in H5P Studio")).to_be_visible()
                    expect(popup.get_by_text("not a playable activity yet", exact=False)).to_be_visible()
                else:
                    expect(card.get_by_text("Rejected. This action was not run.", exact=True)).to_be_visible()
                    expect(popup.get_by_role("button", name="Open in H5P Studio")).to_have_count(0)
            assert not errors, "Browser errors: " + "; ".join(errors)
            page.screenshot(path=str(artifacts / f"{name}-settled.png"), full_page=True)
            print("PASS", name, "inline chat, exact decision, truthful result and accessible touch controls")
        except Exception:
            page.screenshot(path=str(artifacts / f"{name}-failure.png"), full_page=True)
            (artifacts / f"{name}-errors.json").write_text(json.dumps(errors, indent=2))
            # Fixture content only: useful DOM diagnostics without session tokens or personal data.
            (artifacts / f"{name}-page.html").write_text(page.content())
            raise
        finally:
            page.close()
    browser.close()
