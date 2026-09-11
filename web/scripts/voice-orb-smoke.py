"""Real pinned WGSL compilation/drawing + disposal. Software GPU is deliberate CI coverage."""
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
base = os.environ.get('SET_WEB_TEST_BASE', 'http://127.0.0.1:5173')
assert urlparse(base).hostname in {'localhost', '127.0.0.1'}
artifacts = Path('/tmp/voice-orb'); artifacts.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    # Use full Chromium's modern headless compositor; ANGLE's WebGL SwiftShader
    # switch alone does not select a WebGPU Vulkan adapter on GPU-less Linux CI.
    # A slow software shader compiler must not be killed by the hardware watchdog.
    # https://developer.chrome.com/blog/supercharge-web-ai-testing
    # https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
    args = ['--enable-unsafe-webgpu', '--disable-gpu-watchdog']
    if sys.platform.startswith('linux'):
        args += ['--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader',
                 '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface']
    # ubuntu-latest ships current stable Chrome. Keep legacy Chromium for the
    # shell suites, but exercise 2026 WebGPU on a current supported browser.
    channel = os.environ.get('SET_BROWSER_CHANNEL', 'chrome' if os.environ.get('GITHUB_ACTIONS') == 'true' else 'chromium')
    browser = p.chromium.launch(channel=channel, executable_path=os.environ.get('SET_BROWSER_EXECUTABLE'), args=args)
    print('Real WebGPU browser:', browser.version, channel, flush=True)
    page = browser.new_page(viewport={'width': 440, 'height': 560})
    errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    console = []; page.on('console', lambda message: console.append({'type': message.type, 'text': message.text}))
    # Isolate environment/device availability before loading React or adding
    # lifecycle instrumentation; an unavailable GPU is a hard failure, not a skip.
    page.route('**/voice-gpu-probe.html', lambda route: route.fulfill(content_type='text/html', body='<!doctype html><title>GPU probe</title>'))
    page.goto(base + '/voice-gpu-probe.html')
    probe = page.evaluate('''async () => {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) return {available:false, reason:'No adapter'};
      const device = await adapter.requestDevice();
      window.probeDevice = device;
      const result = await Promise.race([
        device.lost.then(info => ({available:false, reason:info.reason, message:info.message})),
        new Promise(resolve => setTimeout(() => resolve({available:true}), 300)),
      ]);
      device.destroy(); window.probeDevice = null;
      return result;
    }''')
    print('Uninstrumented GPU device:', json.dumps(probe), flush=True)
    if not probe.get('available'):
        (artifacts / 'environment.json').write_text(json.dumps({'browser':browser.version, 'probe':probe, 'console':console}, indent=2))
        browser.close()
        raise AssertionError('Real GPU environment failed before renderer startup: ' + json.dumps(probe))
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
        diagnostics = {'errors': errors, 'console': console,
                       'renderer': page.locator('[data-set-voice-orb]').get_attribute('data-renderer'),
                       'rendererError': page.locator('[data-set-voice-orb]').get_attribute('data-renderer-error'),
                       'lifecycle': page.evaluate('window.gpuLifecycle')}
        (artifacts / 'errors.json').write_text(json.dumps(diagnostics, indent=2))
        print(json.dumps(diagnostics, indent=2), flush=True)
        raise
    finally:
        browser.close()
