"""Real pinned WGSL compilation/drawing + disposal. Software GPU is deliberate CI coverage."""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
base = os.environ.get('SET_WEB_TEST_BASE', 'http://127.0.0.1:5173')
assert urlparse(base).hostname in {'localhost', '127.0.0.1'}
artifacts = Path('/tmp/voice-orb'); artifacts.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('SET_BROWSER_EXECUTABLE'), args=['--enable-unsafe-webgpu', '--use-angle=swiftshader'])
    page = browser.new_page(viewport={'width': 440, 'height': 560})
    errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    # Observe actual device creation/destruction; no fake GPU, shader or renderer.
    page.add_init_script("""window.gpuLifecycle = {created:0, destroyed:0};
      if (typeof GPUAdapter !== 'undefined') {
        const request = GPUAdapter.prototype.requestDevice;
        GPUAdapter.prototype.requestDevice = async function (...args) {
          const device = await request.apply(this, args); window.gpuLifecycle.created++;
          const destroy = device.destroy.bind(device); let done = false;
          device.destroy = () => { if (!done) { done = true; window.gpuLifecycle.destroyed++; } destroy(); };
          return device;
        };
      }""")
    try:
        page.goto(base + '/scripts/fixtures/voice-orb.html', wait_until='domcontentloaded')
        orb = page.locator('[data-set-voice-orb]')
        expect(orb).to_have_attribute('data-renderer', 'webgpu', timeout=90000)
        assert page.evaluate('window.gpuLifecycle.created > 0'), 'Must exercise the real WebGPU renderer'
        page.wait_for_timeout(600)
        orb.screenshot(path=str(artifacts / 'listening.png'))
        page.evaluate("window.orbFixture.setState('speaking'); window.orbFixture.setLevel(.5)")
        page.wait_for_timeout(600)
        orb.screenshot(path=str(artifacts / 'speaking.png'))
        page.emulate_media(reduced_motion='reduce')
        expect(orb).to_have_attribute('data-renderer', 'reduced-motion')
        page.wait_for_function('window.gpuLifecycle.created === window.gpuLifecycle.destroyed')
        expect(orb.locator('img')).to_be_visible()
        page.emulate_media(reduced_motion='no-preference')
        expect(orb).to_have_attribute('data-renderer', 'webgpu', timeout=90000)
        page.evaluate('window.orbFixture.setMounted(false)')
        expect(orb).to_have_count(0)
        page.wait_for_function('window.gpuLifecycle.created === window.gpuLifecycle.destroyed')
        page.evaluate('window.orbFixture.setMounted(true); window.orbFixture.setMounted(false)')
        page.wait_for_timeout(500)
        page.wait_for_function('window.gpuLifecycle.created === window.gpuLifecycle.destroyed')
        assert not errors, errors
        # Unsupported rendering must retain an orb, not change the voice modality.
        page.add_init_script("Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true })")
        page.reload(wait_until='domcontentloaded')
        expect(orb).to_have_attribute('data-renderer', 'unsupported')
        expect(orb.locator('img')).to_be_visible()
        assert not errors, errors
        print('PASS real WebGPU shader, state changes, reduced motion, cleanup, StrictMode, unsupported fallback')
    except Exception:
        page.screenshot(path=str(artifacts / 'failure.png'))
        (artifacts / 'errors.json').write_text(json.dumps(errors))
        raise
    finally:
        browser.close()
