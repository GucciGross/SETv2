"""Actual shell at phone sizes; synthetic viewport/audio/server, not a physical iPhone test."""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = os.environ.get('SET_WEB_TEST_BASE', 'http://127.0.0.1:5173')
assert urlparse(base).hostname in {'localhost', '127.0.0.1'}
artifacts = Path('/tmp/copilot-controls'); artifacts.mkdir(parents=True, exist_ok=True)
viewport_shim = """(() => {
  const viewport = new EventTarget(); Object.assign(viewport, { height: innerHeight, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  window.resizeVisibleViewport = (height, top = 0, scale = 1) => {
    Object.assign(viewport, { height, offsetTop: top, scale }); viewport.dispatchEvent(new Event('resize'));
  };
  // A gesture-scoped recognizer catches an await/network hop before start().
  class Recognition {
    start() {
      window.recognitionStarts = (window.recognitionStarts || 0) + 1;
      window.recognitionInTap = window.event?.type === 'click';
      if (!window.recognitionInTap) throw new Error('Microphone startup lost the tap');
    }
    abort() {}
    stop() { this.onend?.(); }
  }
  window.SpeechRecognition = Recognition;
})();"""
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('SET_BROWSER_EXECUTABLE'))
    for width, height in [(320, 667), (390, 844), (430, 932)]:
        page = browser.new_page(viewport={'width': width, 'height': height}, reduced_motion='reduce')
        page.add_init_script(viewport_shim)
        errors, providers, created, cap_calls = [], [], [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        state = {'connected': True, 'selected': False, 'busy': False, 'account': {'email': 'test@example.invalid', 'planType': 'plus'}, 'login': None, 'error': None}
        mode = {'codex': 'disabled', 'fail_voice': False}
        def transport(route):
            request = route.request; path = urlparse(request.url).path
            if path.endswith('/voice/capabilities'):
                cap_calls.append(path)
                if mode['fail_voice']: route.fulfill(status=503, json={'error': 'Offline'})
                else: route.fulfill(json={'serverTranscription': False, 'codexRealtime': {'enabled': False, 'selected': False}})
            elif path.endswith('/codex/capabilities'):
                route.fulfill(json={'available': mode['codex'] == 'enabled', 'deploymentMode': 'self-hosted'})
            elif path.endswith('/codex/account'): route.fulfill(json=state)
            elif path.endswith('/codex/selection'): route.fulfill(status=503, json={'error': 'Selection failed'})
            elif path.endswith('/providers/presets'): route.fulfill(json={'presets': []})
            elif '/spaces/' in path and path.endswith('/providers'):
                if request.method == 'POST':
                    data = request.post_data_json; created.append(data)
                    providers.append({'id': 'local-model', 'name': data['name'], 'is_default': data['isDefault'], 'base_url': data['baseUrl'], 'chat_model': data['chatModel']})
                    route.fulfill(json={'provider': providers[-1]})
                else: route.fulfill(json={'providers': providers})
            elif path.endswith('/providers/local-model/test'): route.fulfill(status=503, json={'error': 'Endpoint unreachable'})
            else: route.fulfill(json={'settings': {}, 'pages': [], 'notebooks': [], 'databases': [], 'subjects': [], 'notifications': [], 'members': [], 'providers': [], 'presets': []})
        page.route('**/api/**', transport)
        try:
            page.goto(base + '/scripts/fixtures/copilot-controls.html', wait_until='domcontentloaded')
            dock = page.locator('.set-copilot-command-dock'); expect(dock).to_be_visible(timeout=60000)
            page.wait_for_function("document.documentElement.style.getPropertyValue('--set-viewport-height') !== ''")
            shell = page.locator('.app-shell')
            shell_box = shell.bounding_box(); dock_box = dock.bounding_box()
            assert abs(shell_box['height'] - height) < 2
            assert abs((dock_box['y'] + dock_box['height']) - (shell_box['y'] + shell_box['height'])) < 2, 'Mobile dock must meet the shell bottom without an artificial gap'
            expect(page.get_by_role('button', name='AI connection settings')).to_be_visible()
            # Full height from the first welcome frame, before a message is sent.
            dock.get_by_role('button', name='Type to Copilot', exact=True).click()
            popup = page.locator('[data-copilot-popup]'); expect(popup).to_be_visible()
            page.wait_for_function('(height) => Math.abs(document.querySelector("[data-copilot-popup]").getBoundingClientRect().height-height)<2', arg=height)
            assert abs(popup.bounding_box()['y']) < 2
            # Simulated Safari keyboard pan and resize use one shared geometry.
            page.evaluate('resizeVisibleViewport(410, 45)')
            page.wait_for_function('document.querySelector(".app-shell").getBoundingClientRect().height === 410')
            assert abs(shell.bounding_box()['y'] - 45) < 2
            assert abs(popup.bounding_box()['height'] - 410) < 2
            assert abs(popup.bounding_box()['y'] - 45) < 2
            page.evaluate('resizeVisibleViewport(205, 90, 2)')
            page.wait_for_timeout(50)
            assert abs(shell.bounding_box()['height'] - 410) < 2, 'Pinch zoom must not reflow the app'
            page.evaluate('(h) => resizeVisibleViewport(h)', height)
            # No capability request between tap and speech recognition startup.
            before = len(cap_calls)
            popup.locator('.set-copilot-mode--compact').get_by_role('button', name='Talk to Copilot', exact=True).click()
            page.wait_for_function('window.recognitionStarts > 0')
            assert page.evaluate('window.recognitionInTap'), 'Recognition must start inside the user gesture'
            assert len(cap_calls) == before, 'Voice tap unexpectedly fetched capabilities'
            expect(popup.locator('[data-set-voice-orb]')).to_be_visible()
            popup.locator('.set-copilot-mode--compact').get_by_role('button', name='Stop recording and send to Copilot').click()
            expect(popup.get_by_role('alert')).to_contain_text('No speech was heard')
            # Direct recovery path closes capture/popup and opens AI Providers.
            popup.get_by_role('button', name='AI connection settings').first.click()
            expect(popup).not_to_be_visible()
            expect(page.get_by_role('button', name='AI Providers', exact=True)).to_have_attribute('aria-pressed', 'true')
            setup = page.get_by_role('region', name='Personal Codex connection')
            expect(setup).to_be_visible(); expect(setup).to_contain_text('SET_CODEX_OAUTH_ENABLED=1')
            page.screenshot(path=str(artifacts / f'mobile-setup-{width}.png'))
            # Enabling/rechecking the deployment reveals existing official sign-in.
            mode['codex'] = 'enabled'
            setup.get_by_role('button', name='Recheck and enable sign-in').click()
            card = page.get_by_role('region', name='Codex · Sign in with ChatGPT')
            checkbox = card.get_by_role('checkbox', name='Use Codex for my Copilot')
            expect(checkbox).to_be_visible(); checkbox.click()
            expect(card.get_by_role('alert')).to_contain_text('Selection failed')
            expect(checkbox).not_to_be_checked()
            # Reachable LLM form, first provider default, masked/cleared key, visible errors.
            page.get_by_role('button', name='Add provider', exact=True).click()
            expect(page.get_by_role('alert').filter(has_text='Enter a provider name')).to_be_visible()
            page.get_by_role('textbox', name='Provider name', exact=True).fill('My Ollama')
            page.get_by_role('textbox', name='Provider base URL').fill('http://192.168.1.50:11434/v1')
            page.get_by_role('textbox', name='Chat model', exact=True).fill('local-model')
            key = page.get_by_label('Provider API key'); expect(key).to_have_attribute('type', 'password'); key.fill('synthetic-not-a-secret')
            page.get_by_role('button', name='Add provider', exact=True).click()
            saved_provider = page.locator('.set-card').filter(has=page.get_by_role('button', name='Remove My Ollama', exact=True))
            expect(saved_provider).to_contain_text('My Ollama')
            expect(saved_provider).to_contain_text('default')
            assert created[0]['isDefault'] is True; expect(key).to_have_value('')
            page.get_by_role('button', name='Test', exact=True).click()
            expect(page.get_by_text('Endpoint unreachable', exact=True)).to_be_visible()
            voice = page.get_by_role('region', name='Voice setup'); expect(voice).to_be_visible()
            assert page.evaluate('window.controlsFixture.permissionRequests') == 0, 'Setup must not request microphone permission'
            mode['fail_voice'] = True
            voice.get_by_role('button', name='Recheck voice setup').click()
            expect(voice).to_contain_text('could not be checked')
            # Keyboard/landscape restore without leaving a gap in the shell.
            page.set_viewport_size({'width': 844, 'height': 390})
            page.evaluate('resizeVisibleViewport(390)')
            page.wait_for_function('document.querySelector(".app-shell").getBoundingClientRect().height === 390')
            assert not errors, errors
            print('PASS mobile setup', width, height, 'viewport/bottom-edge/keyboard/zoom, gesture, no-speech, setup, provider save/test, selection rollback')
        except Exception:
            page.screenshot(path=str(artifacts / f'mobile-setup-{width}-failure.png'), full_page=True)
            (artifacts / f'mobile-setup-{width}-errors.json').write_text(json.dumps(errors))
            raise
        finally: page.close()
    browser.close()
