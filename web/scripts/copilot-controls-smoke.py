"""Actual SET shell, popup and personal settings; fake external agent/audio/account only."""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = os.environ.get('SET_WEB_TEST_BASE', 'http://127.0.0.1:5173')
assert urlparse(base).hostname in {'localhost', '127.0.0.1'}, 'Disposable loopback only'
artifacts = Path('/tmp/copilot-controls'); artifacts.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('SET_BROWSER_EXECUTABLE'))
    for name, width, settings in [('phone', 390, False), ('small-phone', 320, False), ('desktop', 1440, False), ('account', 390, True), ('cloud', 390, True)]:
        page = browser.new_page(viewport={'width': width, 'height': 900}, reduced_motion='reduce')
        errors, uploads, selections = [], [], []
        account = {'connected': False, 'selected': False, 'busy': False, 'account': None, 'login': None, 'error': None}
        page.on('pageerror', lambda e: errors.append(str(e)))
        def transport(route):
            request = route.request; path = urlparse(request.url).path
            if path.endswith('/voice/capabilities'): route.fulfill(json={'serverTranscription': True})
            elif path.endswith('/voice/transcribe'):
                uploads.append(path); route.fulfill(json={'text': 'Summarize the joint limits'})
            elif path.endswith('/codex/capabilities'): route.fulfill(json={'available': name != 'cloud'})
            elif path.endswith('/codex/login'):
                account['login'] = {'userCode': 'TEST-1234', 'verificationUrl': 'https://auth.openai.com/codex/device'}
                route.fulfill(json=account)
            elif path.endswith('/codex/login/cancel'):
                account['login'] = None; route.fulfill(json=account)
            elif path.endswith('/codex/logout'):
                account.update(connected=False, selected=False, account=None, login=None); route.fulfill(json={'disconnected': True})
            elif path.endswith('/codex/selection'):
                selections.append(request.post_data_json); account['selected'] = request.post_data_json['enabled']; route.fulfill(json={'selected': account['selected']})
            elif path.endswith('/codex/account'): route.fulfill(json=account)
            else: route.fulfill(json={'settings': {}, 'pages': [], 'notebooks': [], 'databases': [], 'subjects': [], 'notifications': [], 'providers': [], 'presets': [], 'members': []})
        page.route('**/api/**', transport)
        try:
            page.goto(base + '/scripts/fixtures/copilot-controls.html' + ('?settings=1' if settings else ''), wait_until='domcontentloaded')
            dock = page.locator('.set-copilot-command-dock')
            expect(dock).to_be_visible(timeout=60000)
            mic = dock.get_by_role('button', name='Talk to Copilot', exact=True)
            expect(mic).to_be_enabled()
            if settings:
                card = page.get_by_role('region', name='Codex · Sign in with ChatGPT')
                if name == 'cloud':
                    expect(card).to_have_count(0)
                else:
                    expect(card).to_be_visible(); card.scroll_into_view_if_needed()
                    card.get_by_role('button', name='Sign in with ChatGPT', exact=True).click()
                    expect(card.get_by_text('TEST-1234', exact=True)).to_be_visible()
                    expect(card.get_by_role('link', name='Continue with ChatGPT')).to_have_attribute('href', 'https://auth.openai.com/codex/device')
                    page.screenshot(path=str(artifacts / 'personal-codex-sign-in.png'))
                    card.get_by_role('button', name='Cancel sign-in').click()
                    expect(card.get_by_role('button', name='Sign in with ChatGPT', exact=True)).to_be_visible()
                    # Complete a fresh synthetic login through the same polling path.
                    card.get_by_role('button', name='Sign in with ChatGPT', exact=True).click()
                    account.update(connected=True, login=None, account={'email': 'tester@example.invalid', 'planType': 'plus'})
                    checkbox = card.get_by_role('checkbox', name='Use Codex for my Copilot')
                    expect(checkbox).to_be_visible(timeout=10000); checkbox.check()
                    expect(checkbox).to_be_checked()
                    expect(card.get_by_text('tester@example.invalid · plus')).to_be_visible()
                    assert selections == [{'enabled': True}]
                    card.get_by_role('button', name='Disconnect Codex').click()
                    expect(card.get_by_role('button', name='Sign in with ChatGPT', exact=True)).to_be_visible()
                print('PASS', name, 'personal settings lifecycle/cloud absence')
                assert not errors, errors
                continue
            box = dock.bounding_box(); assert box and box['x'] >= 0 and box['x'] + box['width'] <= width + 1
            for b in dock.locator('button').all():
                bounds = b.bounding_box(); assert bounds['height'] >= 44 and bounds['width'] >= 44
            if width < 768:
                nav = dock.get_by_role('navigation', name='Workspace navigation')
                expect(nav).to_be_visible()
                assert nav.bounding_box()['y'] >= dock.locator('.set-copilot-rocker').bounding_box()['y'] + 60
                nav.get_by_role('link', name='Tasks').click()
                expect(nav.get_by_role('link', name='Tasks')).to_have_attribute('aria-current', 'page')
                nav.get_by_role('link', name='Home').click()
            else:
                expect(page.get_by_role('button', name='Collapse', exact=True)).to_be_visible()
                expect(page.get_by_role('button', name='Create a new workspace')).to_be_visible()
            page.screenshot(path=str(artifacts / (name + '-workspace.png')))
            dock.screenshot(path=str(artifacts / (name + '-dock.png')))
            # Voice from the CLOSED dock opens the orb directly, not a welcome/text flash.
            mic.click()
            popup = page.locator('[data-copilot-popup]'); expect(popup).to_be_visible()
            orb = popup.locator('[data-set-voice-orb]')
            expect(orb).to_be_visible()
            expect(orb).to_have_attribute('data-renderer', 'reduced-motion')
            expect(popup.locator('textarea')).to_have_count(0)
            expect(popup.locator('.set-welcome')).to_have_count(0)
            expect(popup.locator('[data-testid="copilot-message-list"]')).to_have_count(0)
            header = popup.locator('.set-copilot-mode--compact')
            expect(header.get_by_role('button', name='Stop recording and send to Copilot')).to_be_visible()
            header.get_by_role('button', name='Type to Copilot', exact=True).click()
            popup = page.locator('[data-copilot-popup]'); expect(popup).to_be_visible()
            text = popup.locator('textarea').last
            text.fill('Keep my unsent draft')
            header.get_by_role('button', name='Talk to Copilot', exact=True).click()
            expect(orb).to_be_visible(); expect(popup.locator('textarea')).to_have_count(0)
            header.get_by_role('button', name='Type to Copilot', exact=True).click()
            expect(text).to_have_value('Keep my unsent draft')
            expect(text).to_be_focused()
            assert not uploads, 'Changing modality must cancel capture, not submit it'
            text.fill('Explain the actuator'); text.press('Enter')
            expect(popup.get_by_text('Received in the same Copilot conversation: Explain the actuator', exact=True)).to_be_visible()
            page.wait_for_function('window.controlsFixture.calls.length === 1')
            thread = page.evaluate('window.controlsFixture.calls[0].threadId')
            # Programmatic asks must never toggle an already open chat closed.
            page.evaluate("window.dispatchEvent(new CustomEvent('set:ask-copilot', {detail:'Keep this conversation open'}))")
            expect(popup.get_by_text('Received in the same Copilot conversation: Keep this conversation open', exact=True)).to_be_visible()
            assert page.evaluate('window.controlsFixture.calls[1].threadId') == thread
            # In-chat controls = the compact rocker the header renders (the dock's
            # copy is hidden while the chat is open); CopilotKit 1.69 has no
            # copilot-modal-header wrapper when a custom header slot is used.
            header = popup.locator('.set-copilot-mode--compact')
            voice = header.get_by_role('button', name='Talk to Copilot', exact=True)
            expect(voice).to_be_visible()
            # Rejecting permission is visible and does not produce a user message.
            page.evaluate('window.controlsFixture.denyPermission = true'); voice.click()
            expect(popup.get_by_role('alert')).to_contain_text('permission was denied')
            expect(orb).to_be_visible(); expect(popup.locator('textarea')).to_have_count(0)
            page.evaluate('window.controlsFixture.denyPermission = false; window.controlsFixture.deferPermission = true')
            voice.click(); expect(header.get_by_role('button', name='Cancel voice input')).to_be_visible()
            header.get_by_role('button', name='Type to Copilot', exact=True).click()
            before = page.evaluate('window.controlsFixture.stoppedTracks')
            page.evaluate('window.controlsFixture.grant()')
            page.wait_for_function('(n) => window.controlsFixture.stoppedTracks > n', arg=before)
            assert not uploads, 'Cancelled permission request uploaded audio'
            page.evaluate('window.controlsFixture.deferPermission = false')
            voice.click()
            stop = header.get_by_role('button', name='Stop recording and send to Copilot')
            expect(stop).to_be_visible()
            stop.click()
            page.wait_for_function('window.controlsFixture.calls.length === 3')
            expect(orb).to_be_visible()
            expect(popup.locator('[data-testid="copilot-message-list"]')).to_have_count(0)
            expect(popup.locator('textarea')).to_have_count(0)
            expect(popup.get_by_text('Received in the same Copilot conversation: Summarize the joint limits', exact=True)).to_have_count(0)
            page.screenshot(path=str(artifacts / (name + '-voice-orb.png')))
            popup.get_by_role('button', name='Mute spoken replies').click()
            expect(popup.get_by_role('button', name='Enable spoken replies')).to_be_visible()
            header.get_by_role('button', name='Type to Copilot', exact=True).click()
            expect(orb).to_have_count(0)
            expect(popup.get_by_text('Received in the same Copilot conversation: Summarize the joint limits', exact=True)).to_be_visible()
            assert len(uploads) == 1
            assert page.evaluate('window.controlsFixture.calls.at(-1).threadId') == thread
            assert page.evaluate('window.controlsFixture.calls.at(-1).messages.filter(m => m.role === "user").length') == 3
            page.screenshot(path=str(artifacts / (name + '-conversation.png')))
            voice.click(); expect(stop).to_be_visible()
            before = page.evaluate('window.controlsFixture.stoppedTracks')
            popup.locator('[data-testid="copilot-close-button"]').click()
            expect(dock).to_be_visible()
            page.wait_for_function('(n) => window.controlsFixture.stoppedTracks > n', arg=before)
            assert len(uploads) == 1, 'Closing recording must not send it'
            assert not errors, errors
            print('PASS', name, 'real shell, accessible rocker, navigation, same thread, permission/cancellation/recording lifecycle')
        except Exception:
            page.screenshot(path=str(artifacts / (name + '-failure.png')), full_page=True)
            (artifacts / (name + '-errors.json')).write_text(json.dumps(errors))
            (artifacts / (name + '-page.html')).write_text(page.content())
            raise
        finally: page.close()
    browser.close()

# Keep viewport/setup regressions in the existing browser CI entry point.
import runpy
runpy.run_path(str(Path(__file__).with_name('mobile-setup-smoke.py')), run_name='__main__')
