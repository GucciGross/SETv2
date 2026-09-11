"""Real pinned WGSL compilation/drawing + disposal. Software GPU is deliberate CI coverage.
Run with SET_BROWSER_HEADED=1 under xvfb-run: Chrome headless loses the device
when a canvas presents, so honest backend selection needs a headed display."""
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
base = os.environ.get('SET_WEB_TEST_BASE', 'http://127.0.0.1:5173')
assert urlparse(base).hostname in {'localhost', '127.0.0.1'}
artifacts = Path('/tmp/voice-orb'); artifacts.mkdir(parents=True, exist_ok=True)
headless = os.environ.get('SET_BROWSER_HEADED') != '1'
with sync_playwright() as p:
    # Select a healthy software device before testing the renderer. Chrome builds
    # differ in whether SwiftShader is exposed through ANGLE or native Vulkan.
    # No WebGPU validation is disabled and lack of a device is a hard failure.
    common = ['--enable-unsafe-webgpu', '--disable-gpu-watchdog']
    angle = common + ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    vulkan = common + ['--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader',
                       '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface']
    channel = os.environ.get('SET_BROWSER_CHANNEL', 'chrome' if os.environ.get('GITHUB_ACTIONS') == 'true' else 'chromium')
    candidates = [('angle', angle), ('vulkan', vulkan)] if sys.platform.startswith('linux') else [('native', common)]
    attempts = []
    browser = page = None
    for backend, args in candidates:
        candidate = p.chromium.launch(channel=channel, headless=headless, executable_path=os.environ.get('SET_BROWSER_EXECUTABLE'), args=args)
        candidate_page = candidate.new_page(viewport={'width': 440, 'height': 560})
        candidate_page.route('**/voice-gpu-probe.html', lambda route: route.fulfill(content_type='text/html', body='<!doctype html><title>GPU probe</title>'))
        candidate_page.goto(base + '/voice-gpu-probe.html')
        probe = candidate_page.evaluate('''async () => {
          const adapter = await navigator.gpu?.requestAdapter();
          if (!adapter) return {available:false, reason:'No adapter'};
          const device = await adapter.requestDevice();
          window.probeDevice = device;
          const canvas = document.createElement('canvas');
          canvas.width = 64; canvas.height = 64;
          document.body.appendChild(canvas);
          const context = canvas.getContext('webgpu');
          if (!context) { device.destroy(); canvas.remove(); return {available:false, reason:'No webgpu canvas context'}; }
          context.configure({device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode:'premultiplied'});
          // Present composited frames: Chrome destroys software devices only
          // once a visible canvas actually presents, so a detached or
          // never-presented canvas hides the loss the renderer will hit.
          context.getCurrentTexture();
          const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
          await nextFrame(); await nextFrame(); await nextFrame();
          const result = await Promise.race([
            device.lost.then(info => ({available:false, reason:info.reason, message:info.message})),
            new Promise(resolve => setTimeout(() => resolve({available:true}), 500)),
          ]);
          device.destroy(); canvas.remove(); window.probeDevice = null;
          return result;
        }''')
        report = {'browser': candidate.version, 'channel':channel, 'backend':backend, 'probe':probe,
                  'gpu':candidate.new_browser_cdp_session().send('SystemInfo.getInfo')['gpu']}
        attempts.append(report)
        print('Uninstrumented device probe:', json.dumps({k:v for k,v in report.items() if k != 'gpu'}), flush=True)
        if probe.get('available'):
            candidate.close()
            # The availability probe owns and destroys its device; keep that
            # document/context out of the renderer lifecycle under test.
            browser = p.chromium.launch(channel=channel, headless=headless, executable_path=os.environ.get('SET_BROWSER_EXECUTABLE'), args=args)
            page = browser.new_page(viewport={'width': 440, 'height': 560})
            break
        candidate.close()
    (artifacts / 'environment.json').write_text(json.dumps(attempts, indent=2))
    if browser is None or page is None:
        raise AssertionError('No healthy real WebGPU adapter; see environment.json. Renderer test was not skipped.')
    errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    console = []; page.on('console', lambda message: console.append({'type': message.type, 'text': message.text}))
    # Prove a real frame without patching any GPU API before lifecycle tracing.
    page.goto(base + '/scripts/fixtures/voice-orb.html', wait_until='domcontentloaded')
    uninstrumented = page.locator('[data-set-voice-orb]')
    try:
        page.wait_for_function("() => { const orb = document.querySelector('[data-set-voice-orb]'); return orb && orb.dataset.renderer !== 'loading'; }", timeout=90000)
        expect(uninstrumented).to_have_attribute('data-renderer', 'webgpu', timeout=10000)
        page.wait_for_timeout(600)
        expect(uninstrumented).to_have_attribute('data-renderer', 'webgpu')
        expect(uninstrumented.locator('img')).to_be_hidden()
        uninstrumented.screenshot(path=str(artifacts / 'uninstrumented.png'))
    except Exception:
        page.screenshot(path=str(artifacts / 'failure.png'))
        diagnostic = {'phase':'uninstrumented', 'console':console, 'errors':errors,
                      'renderer':uninstrumented.get_attribute('data-renderer'),
                      'rendererError':uninstrumented.get_attribute('data-renderer-error')}
        (artifacts / 'errors.json').write_text(json.dumps(diagnostic, indent=2))
        print(json.dumps(diagnostic, indent=2), flush=True)
        browser.close()
        raise
    page.close()
    page = browser.new_page(viewport={'width':440, 'height':560})
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: console.append({'type':message.type, 'text':message.text}))
    # Observe actual device creation/destruction; no fake GPU, shader or renderer.
    page.add_init_script("""window.gpuLifecycle = {created:0, destroyed:0, events:[]};
      if (typeof GPUAdapter !== 'undefined') {
        const request = GPUAdapter.prototype.requestDevice;
        GPUAdapter.prototype.requestDevice = async function (...args) {
          const device = await request.apply(this, args); window.gpuLifecycle.created++;
          window.gpuLifecycle.events.push({type:'created',at:performance.now()});
          device.lost.then(info => window.gpuLifecycle.events.push({type:'lost',reason:info.reason,message:info.message,at:performance.now()}));
          device.addEventListener('uncapturederror', event => window.gpuLifecycle.events.push({type:'validation',message:event.error.message,at:performance.now()}));
          const destroy = device.destroy.bind(device); let done = false;
          device.destroy = () => {
            window.gpuLifecycle.events.push({type:'destroy',stack:new Error().stack,at:performance.now()});
            if (!done) { done = true; window.gpuLifecycle.destroyed++; } destroy();
          };
          return device;
        };
      }""")
    try:
        page.goto(base + '/scripts/fixtures/voice-orb.html', wait_until='domcontentloaded')
        orb = page.locator('[data-set-voice-orb]')
        page.wait_for_function("() => { const orb = document.querySelector('[data-set-voice-orb]'); return orb && orb.dataset.renderer !== 'loading'; }", timeout=90000)
        expect(orb).to_have_attribute('data-renderer', 'webgpu', timeout=10000)
        assert page.evaluate('window.gpuLifecycle.created > 0'), 'Must exercise the real WebGPU renderer'
        page.wait_for_timeout(600)
        expect(orb).to_have_attribute('data-renderer', 'webgpu')
        expect(orb.locator('img')).to_be_hidden()
        orb.screenshot(path=str(artifacts / 'listening.png'))
        page.evaluate("window.orbFixture.setState('speaking'); window.orbFixture.setLevel(.5)")
        page.wait_for_timeout(600)
        expect(orb).to_have_attribute('data-renderer', 'webgpu')
        expect(orb.locator('img')).to_be_hidden()
        orb.screenshot(path=str(artifacts / 'speaking.png'))
        assert page.evaluate("!window.gpuLifecycle.events.some(event => event.type === 'validation')"), 'Unexpected WebGPU validation errors'
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
        diagnostics = {'errors': errors, 'console': console,
                       'renderer': page.locator('[data-set-voice-orb]').get_attribute('data-renderer'),
                       'rendererError': page.locator('[data-set-voice-orb]').get_attribute('data-renderer-error'),
                       'lifecycle': page.evaluate('window.gpuLifecycle')}
        (artifacts / 'errors.json').write_text(json.dumps(diagnostics, indent=2))
        print(json.dumps(diagnostics, indent=2), flush=True)
        raise
    finally:
        browser.close()
