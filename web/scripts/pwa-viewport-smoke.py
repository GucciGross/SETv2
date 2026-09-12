"""Real shell/dashboard in Chromium + WebKit; synthetic OS metrics, not an iPhone simulator."""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = os.environ.get('SET_WEB_TEST_BASE', 'http://127.0.0.1:5173')
assert urlparse(base).hostname in {'localhost', '127.0.0.1'}, 'Disposable loopback only'
artifacts = Path('/tmp/copilot-controls/pwa-viewport')
artifacts.mkdir(parents=True, exist_ok=True)

# Deliberately leave BOTH JS heights short. PR16 only tested a short visual
# viewport with an already-correct innerHeight, which missed the cold-start bug.
shim = """(() => {
  let mode = 'legacy', layout = innerHeight - 62;
  const viewport = new EventTarget();
  Object.assign(viewport, { height: layout - 34, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => layout });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => mode === 'legacy' });
  const match = window.matchMedia.bind(window), queries = new Map();
  window.matchMedia = query => {
    const kind = /^\\(display-mode: (standalone|fullscreen)\\)$/.exec(query)?.[1];
    if (!kind) return match(query);
    if (!queries.has(kind)) {
      const target = new EventTarget();
      Object.defineProperty(target, 'matches', { get: () => mode === kind });
      queries.set(kind, target);
    }
    return queries.get(kind);
  };
  window.pwaViewport = {
    set(values) {
      if ('mode' in values) { mode = values.mode; queries.forEach(q => q.dispatchEvent(new Event('change'))); }
      if ('layout' in values) layout = values.layout;
      for (const key of ['height', 'offsetTop', 'scale']) if (key in values) viewport[key] = values[key];
      viewport.dispatchEvent(new Event('resize'));
    }
  };
})();"""

measure = """() => {
  const rect = element => {
    const r = element.getBoundingClientRect();
    return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom, right:r.right };
  };
  const shell = document.querySelector('.app-shell');
  const dock = document.querySelector('.set-copilot-command-dock');
  const main = shell.querySelector('main');
  const scroll = main.querySelector('[data-scroll-root]');
  const d = rect(dock), s = rect(shell);
  // elementFromPoint accounts for actual clipping, unlike bounding rectangles.
  const painted = [0.2, 0.5, 0.8].every(x => {
    const target = document.elementFromPoint(d.x + d.width*x, d.bottom-2);
    return target && dock.contains(target);
  });
  return {
    shell: s, main: rect(main), scroll: rect(scroll), dock: d, painted,
    installed: document.documentElement.hasAttribute('data-set-installed'),
    cssHeight: document.documentElement.style.getPropertyValue('--set-viewport-height'),
    documentHeight: getComputedStyle(document.documentElement).height,
    bodyHeight: getComputedStyle(document.body).height,
    innerHeight, visualHeight: visualViewport.height,
    documentScrollWidth: document.documentElement.scrollWidth,
    contentScrollWidth: scroll.scrollWidth, contentClientWidth: scroll.clientWidth,
    dockPadding: parseFloat(getComputedStyle(dock).paddingBottom),
    mainOverflow: getComputedStyle(main).overflow,
    navigation: [...dock.querySelectorAll('nav a')].map(rect),
  };
}"""


def assert_layout(page, width, height, *, bottom=0, top=0, installed=True):
    page.wait_for_function("""({height,top}) => {
      const r = document.querySelector('.app-shell').getBoundingClientRect();
      return Math.abs(r.height-height) < 1 && Math.abs(r.top-top) < 1;
    }""", arg={'height': height, 'top': top})
    m = page.evaluate(measure)
    assert m['installed'] == installed, m
    assert m['documentScrollWidth'] <= width + 1, m
    assert m['scroll']['bottom'] <= m['dock']['y'] + 1, 'Content must not be covered by the footer'
    if width < 768:
        assert abs(m['dock']['bottom'] - m['shell']['bottom']) < 1, m
        assert abs(m['main']['bottom'] - m['shell']['bottom']) < 1, 'Main must include the footer safe area'
        assert m['painted'], f'Dock reaches the edge numerically but is clipped: {m}'
        assert abs(m['dockPadding'] - bottom) < 1, m
        for target in m['navigation']:
            assert target['height'] >= 44, target
            assert target['bottom'] <= m['shell']['bottom'] - bottom + 1, 'Navigation overlaps home indicator'
    return m


def transport(route):
    path = urlparse(route.request.url).path
    result = {'settings': {}, 'pages': [], 'notebooks': [], 'databases': [],
              'subjects': [], 'notifications': [], 'members': [], 'providers': [],
              'presets': [], 'tasks': [], 'paths': [], 'activities': [], 'checklist': []}
    if path.endswith('/voice/capabilities'):
        result = {'serverTranscription': False, 'codexRealtime': {'enabled': False, 'selected': False}}
    elif path.endswith('/codex/capabilities'):
        result = {'available': False, 'deploymentMode': 'self-hosted'}
    elif path.endswith('/terminal/exec'):
        result = {'output': 'pages: 37 notebooks: 15 databases: 3'}
    elif path.endswith('/brief'):
        result = {'brief': {'reviews': {'dueNow': 0}, 'decaying': [], 'builds': [], 'next': [
            {'pageId': 'actuator', 'title': 'Actuator selection', 'reason': 'Robot onboarding'},
            {'pageId': 'gripper', 'title': 'Gripper fatigue', 'reason': 'Next experiment'},
        ]}}
    route.fulfill(json=result)


with sync_playwright() as p:
    engines = os.environ.get('SET_PWA_BROWSERS', 'chromium,webkit').split(',')
    for engine in engines:
        options = {}
        if engine == 'chromium' and os.environ.get('SET_BROWSER_EXECUTABLE'):
            options['executable_path'] = os.environ['SET_BROWSER_EXECUTABLE']
        browser = getattr(p, engine).launch(**options)
        for width, height in [(320, 568), (375, 667), (390, 844), (402, 874), (430, 932),
                              (844, 390), (768, 1024), (1024, 768), (1440, 900)]:
            name = f'{engine}-{width}x{height}'
            page = browser.new_page(viewport={'width': width, 'height': height}, reduced_motion='reduce')
            page.add_init_script(shim)
            page.route('**/api/**', transport)
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            evidence = {}
            try:
                page.goto(base + '/scripts/fixtures/copilot-controls.html?dashboard=1', wait_until='domcontentloaded')
                dock = page.locator('.set-copilot-command-dock')
                expect(dock).to_be_visible(timeout=60000)
                expect(page.get_by_role('heading', name='Good', exact=False)).to_be_visible()
                page.wait_for_function("document.documentElement.hasAttribute('data-set-installed')")
                evidence['coldStart'] = assert_layout(page, width, height)
                assert evidence['coldStart']['cssHeight'] == '100vh'
                assert evidence['coldStart']['innerHeight'] < height
                assert evidence['coldStart']['visualHeight'] < height
                # Unlike PR16, html/body are checked too; percentage roots can
                # retain the shorter containing block in Home Screen containers.
                assert abs(float(evidence['coldStart']['bodyHeight'].removesuffix('px')) - height) < 1

                phone = width < 768
                safe_top, safe_bottom = (62, 34) if phone else (0, 0)
                page.evaluate("""({top,bottom}) => {
                  document.documentElement.style.setProperty('--set-safe-top', `${top}px`);
                  document.documentElement.style.setProperty('--set-safe-bottom', `${bottom}px`);
                }""", {'top': safe_top, 'bottom': safe_bottom})
                evidence['safeArea'] = assert_layout(page, width, height, bottom=safe_bottom)
                page.screenshot(path=str(artifacts / f'{name}-home.png'))
                scroll = page.locator('main > [data-scroll-root]')
                scroll.evaluate('(el) => el.scrollTop = el.scrollHeight')
                evidence['scrolled'] = assert_layout(page, width, height, bottom=safe_bottom)

                if phone:
                    page.get_by_role('button', name='Open navigation', exact=True).click()
                    drawer = page.locator('[data-tour-sidebar]')
                    expect(page.get_by_role('button', name='Close navigation', exact=True)).to_be_visible()
                    assert abs(drawer.bounding_box()['height'] - height) < 1
                    assert drawer.evaluate('(el) => parseFloat(getComputedStyle(el).paddingBottom)') == safe_bottom
                    page.get_by_role('button', name='Close navigation', exact=True).click()
                    # Prove this oracle detects the exact old false green: the
                    # bounding box reaches the bottom, but the parent clips it.
                    page.evaluate("""() => {
                      document.querySelector('.app-shell').style.paddingBottom = '34px';
                      document.querySelector('.set-copilot-command-dock').style.marginBottom = '-34px';
                    }""")
                    clipped = page.evaluate(measure)
                    assert abs(clipped['dock']['bottom'] - clipped['shell']['bottom']) < 1, clipped
                    assert not clipped['painted'], 'Paint oracle failed to detect deliberately restored clipping'
                    page.evaluate("""() => {
                      document.querySelector('.app-shell').style.removeProperty('padding-bottom');
                      document.querySelector('.set-copilot-command-dock').style.removeProperty('margin-bottom');
                    }""")
                    assert_layout(page, width, height, bottom=safe_bottom)
                    # Portrait/landscape with both JS heights still stale: the
                    # CSS viewport must resize on its own, not keep old pixels.
                    page.set_viewport_size({'width': height, 'height': width})
                    page.wait_for_function('(h) => Math.abs(document.querySelector(".app-shell").getBoundingClientRect().height-h)<1', arg=width)
                    page.set_viewport_size({'width': width, 'height': height})
                    assert_layout(page, width, height, bottom=safe_bottom)
                    # A real text composer still avoids the software keyboard.
                    dock.get_by_role('button', name='Type to Copilot', exact=True).click()
                    popup = page.locator('[data-copilot-popup]')
                    expect(popup).to_be_visible()
                    editor = popup.locator('textarea').last
                    editor.fill('Keep this unsent draft')
                    page.evaluate("pwaViewport.set({height: 350, offsetTop: 20, scale: 1})")
                    page.wait_for_function('document.querySelector("[data-copilot-popup]").getBoundingClientRect().height === 350')
                    assert abs(popup.bounding_box()['y'] - 20) < 1
                    page.evaluate("pwaViewport.set({height: 175, offsetTop: 40, scale: 2})")
                    page.wait_for_timeout(50)
                    assert popup.bounding_box()['height'] == 350, 'Pinch zoom must not reflow the app'
                    page.evaluate("pwaViewport.set({height: 350, offsetTop: 20, scale: 1}); document.activeElement.blur()")
                    page.wait_for_function('(h) => Math.abs(document.querySelector("[data-copilot-popup]").getBoundingClientRect().height-h)<1', arg=height)
                    expect(editor).to_have_value('Keep this unsent draft')
                    popup.locator('[data-testid="copilot-close-button"]').click()
                    evidence['keyboardClosed'] = assert_layout(page, width, height, bottom=safe_bottom)
                    page.screenshot(path=str(artifacts / f'{name}-recovered.png'))

                # Newer display-mode media detection and the legacy iOS flag
                # use the same policy; leaving installed mode restores tabs.
                for mode in ['standalone', 'fullscreen']:
                    page.evaluate('(mode) => pwaViewport.set({mode})', mode)
                    assert_layout(page, width, height, bottom=safe_bottom)
                visible = height - 100
                page.evaluate('(height) => pwaViewport.set({mode:"browser",layout:height+50,height,offsetTop:0,scale:1})', visible)
                page.wait_for_function("!document.documentElement.hasAttribute('data-set-installed')")
                assert_layout(page, width, visible, bottom=safe_bottom, installed=False)
                page.evaluate('(height) => pwaViewport.set({height:height-150,offsetTop:25})', height)
                assert_layout(page, width, height-150, top=25, bottom=safe_bottom, installed=False)
                page.evaluate("pwaViewport.set({mode:'legacy'}); dispatchEvent(new Event('pageshow'))")
                assert_layout(page, width, height, bottom=safe_bottom)
                assert not errors, errors
                print('PASS', name, 'CSS cold start, actual paint, safe area, resize, keyboard, browser/installed isolation')
            except Exception:
                page.screenshot(path=str(artifacts / f'{name}-FAIL.png'), full_page=True)
                raise
            finally:
                (artifacts / f'{name}.json').write_text(json.dumps({'measurements': evidence, 'pageErrors': errors}, indent=2))
                page.close()
        browser.close()
