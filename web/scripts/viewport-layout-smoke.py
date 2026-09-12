"""Real shell/dashboard in Chromium and WebKit; synthetic OS metrics, not an iOS simulator."""
import json
import os
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('SET_WEB_TEST_BASE', 'http://127.0.0.1:5173')
assert urlparse(BASE).hostname in {'localhost', '127.0.0.1'}
OUT = Path('/tmp/viewport-layout'); OUT.mkdir(parents=True, exist_ok=True)
WEB = Path(__file__).resolve().parents[1]

class MetaTags(HTMLParser):
    def __init__(self, text):
        super().__init__(); self.tags = {}; self.feed(text)
    def handle_starttag(self, tag, attrs):
        if tag == 'meta':
            attrs = dict(attrs); self.tags[attrs.get('name')] = attrs.get('content')

production = MetaTags((WEB / 'index.html').read_text()).tags
fixture = MetaTags((WEB / 'scripts/fixtures/copilot-controls.html').read_text()).tags
for name in ['viewport', 'apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style']:
    assert fixture[name] == production[name], f'Fixture diverges from production: {name}'

SHIM = """(() => {
  const originalInner = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const visual = new EventTarget();
  Object.assign(visual, { height: innerHeight, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
  window.setTestViewport = (inner, height, top = 0, scale = 1) => {
    if (inner === null) Object.defineProperty(window, 'innerHeight', originalInner);
    else Object.defineProperty(window, 'innerHeight', { configurable: true, value: inner });
    Object.assign(visual, { height, offsetTop: top, scale });
    visual.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize'));
  };
})();"""

GEOMETRY = """() => {
  const shell = document.querySelector('.app-shell'), main = shell.querySelector('main');
  const dock = shell.querySelector('.set-copilot-command-dock');
  const sr = shell.getBoundingClientRect(), dr = dock.getBoundingClientRect();
  const nav = dock.querySelector('nav');
  const mobile = getComputedStyle(nav).display !== 'none';
  return {
    shell: sr.toJSON(), main: main.getBoundingClientRect().toJSON(), dock: dr.toJSON(), mobile,
    source: document.documentElement.dataset.setViewport,
    safeBottom: parseFloat(getComputedStyle(dock).paddingBottom),
    shellBottomPadding: parseFloat(getComputedStyle(shell).paddingBottom),
    bottomPainted: [.25, .5, .75].every(p => dock.contains(document.elementFromPoint(sr.left + sr.width*p, sr.bottom-1))),
    targets: mobile ? [...nav.querySelectorAll('a')].map(a => {
      const r = a.getBoundingClientRect();
      return { rect:r.toJSON(), hit:a.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)) };
    }) : [],
    rootX: scrollX, rootY: scrollY,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}"""

def verify(page, height, top=0, safe=0):
    page.wait_for_function("""([h,t]) => {
      const r = document.querySelector('.app-shell').getBoundingClientRect();
      return Math.abs(r.height-h)<1 && Math.abs(r.top-t)<1;
    }""", arg=[height, top])
    data = page.evaluate(GEOMETRY)
    assert abs(data['shell']['bottom'] - (height + top)) < 1, data
    assert data['overflow'] <= 1 and data['rootX'] == 0 and data['rootY'] == 0, data
    if data['mobile']:
        assert data['shellBottomPadding'] == 0, 'Shell and dock must not both own the bottom inset'
        assert abs(data['dock']['bottom'] - data['shell']['bottom']) < 1, data
        assert abs(data['main']['bottom'] - data['shell']['bottom']) < 1, data
        assert data['bottomPainted'], 'Dock geometry reaches bottom, but an ancestor clips its paint'
        assert abs(data['safeBottom'] - safe) < 1, data
        for target in data['targets']:
            assert target['hit'], 'Navigation target is clipped/covered'
            assert target['rect']['height'] >= 44 and target['rect']['width'] >= 44, target
            assert target['rect']['bottom'] <= data['shell']['bottom'] - safe + 1, target
    return data

with sync_playwright() as p:
    for engine in ['chromium', 'webkit']:
        opts = {'executable_path': os.environ['SET_BROWSER_EXECUTABLE']} if engine == 'chromium' and os.environ.get('SET_BROWSER_EXECUTABLE') else {}
        browser = getattr(p, engine).launch(**opts)
        for installed in [False, True]:
            for width, height in [(320,568), (390,844), (402,874), (430,932), (820,1180), (1440,900)]:
                name = f'{engine}-{"home-screen" if installed else "browser"}-{width}'
                context = browser.new_context(viewport={'width':width,'height':height}, reduced_motion='reduce', has_touch=width<768)
                page = context.new_page(); errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                # Keep dependent setup in ONE script: init-script ordering is unspecified.
                cold_start = f"setTestViewport({height-62},{height-96});" if installed else ""
                page.add_init_script(SHIM + f"\nObject.defineProperty(navigator,'standalone',{{configurable:true,value:{str(installed).lower()}}});" + cold_start)
                def transport(route):
                    path = urlparse(route.request.url).path
                    if path.endswith('/voice/capabilities'):
                        route.fulfill(json={'serverTranscription':True})
                    elif path.endswith('/terminal/exec'):
                        route.fulfill(json={'output':'pages: 37 notebooks: 15 databases: 3'})
                    elif path.endswith('/brief'):
                        route.fulfill(json={'brief':{'reviews':{'dueNow':0},'decaying':[],'builds':[],'next':[]}})
                    else:
                        route.fulfill(json={'tasks':[],'paths':[],'activities':[],'checklist':[],'settings':{},'pages':[],'notebooks':[],'databases':[],'subjects':[],'notifications':[],'providers':[],'presets':[],'members':[],'available':False})
                page.route('**/api/**', transport)
                try:
                    page.goto(BASE + '/scripts/fixtures/copilot-controls.html?dashboard=1', wait_until='domcontentloaded')
                    expect(page.locator('.set-copilot-command-dock')).to_be_visible(timeout=60000)
                    expect(page.get_by_role('heading', name='Good', exact=False)).to_be_visible()
                    expect(page.get_by_text('37', exact=True)).to_be_visible()
                    page.wait_for_function("document.documentElement.hasAttribute('data-set-viewport')")
                    safe = 34 if width < 768 else 0
                    page.evaluate("([top,bottom]) => {document.documentElement.style.setProperty('--set-safe-top',top+'px');document.documentElement.style.setProperty('--set-safe-bottom',bottom+'px')}", [62 if width<768 else 0, safe])
                    result = verify(page, height, safe=safe)
                    assert result['source'] == ('standalone-css' if installed else 'visual')
                    if installed:
                        # Cold start: both JavaScript readings were short before mount.
                        assert page.evaluate('innerHeight') == height - 62
                        assert page.evaluate('visualViewport.height') == height - 96
                        # WebKit rounds viewport units to fractional CSS pixels.
                        body_height = page.evaluate('parseFloat(getComputedStyle(document.body).height)')
                        assert abs(body_height - height) < 1, {'bodyHeight': body_height, 'viewportHeight': height}
                    scroll = page.locator('main > [data-scroll-root]')
                    scroll.evaluate('el => el.scrollTop = el.scrollHeight')
                    verify(page, height, safe=safe)
                    scroll.evaluate('el => el.scrollTop = 0')
                    if width < 768:
                        # Negative control: the old bounding-box assertion passes
                        # even when main clips the dock's negative-margin extension.
                        page.evaluate("""() => {
                          document.querySelector('.app-shell').style.paddingBottom = '34px';
                          document.querySelector('.set-copilot-command-dock').style.marginBottom = '-34px';
                        }""")
                        clipped = page.evaluate(GEOMETRY)
                        assert abs(clipped['dock']['bottom'] - clipped['shell']['bottom']) < 1, clipped
                        assert not clipped['bottomPainted'], 'Hit-test must reject deliberately restored clipping'
                        page.evaluate("""() => {
                          document.querySelector('.app-shell').style.removeProperty('padding-bottom');
                          document.querySelector('.set-copilot-command-dock').style.removeProperty('margin-bottom');
                        }""")
                        verify(page, height, safe=safe)

                    # Both JS heights stuck short: PR 16 still freezes the shell to innerHeight.
                    page.evaluate('h => setTestViewport(h-100,h-100)', height)
                    expected = height if installed else height-100
                    verify(page, expected, safe=safe)
                    page.screenshot(path=str(OUT / f'{name}.png'))
                    # Keyboard shrink/pan: editor focus must retain the real visible region.
                    page.evaluate("""() => {
                      const input=document.createElement('textarea'); input.id='layout-editor';
                      document.querySelector('[data-scroll-root]').prepend(input); input.focus();
                      setTestViewport(500,300,20);
                    }""")
                    verify(page, 300, top=20, safe=safe)
                    page.evaluate('setTestViewport(500,150,40,2)')
                    page.wait_for_timeout(50)
                    verify(page, 300, top=20, safe=safe)
                    page.evaluate('setTestViewport(500,300,20,1);document.activeElement.blur()')
                    verify(page, height if installed else 300, top=0 if installed else 20, safe=safe)
                    # Restore browser viewport, then rotate without updating either stale JS height.
                    page.evaluate('h => setTestViewport(null,h)', height)
                    if installed and width < 768:
                        page.set_viewport_size({'width':667,'height':375})
                        page.evaluate("document.documentElement.style.setProperty('--set-safe-top','0px');document.documentElement.style.setProperty('--set-safe-bottom','21px');document.documentElement.style.setProperty('--set-safe-left','34px');document.documentElement.style.setProperty('--set-safe-right','34px','')")
                        verify(page,375,safe=21)
                        page.screenshot(path=str(OUT / f'{name}-landscape.png'))
                    # The workspace scroller cannot pan the entire UI sideways.
                    scroll = page.locator('[data-scroll-root]')
                    scroll.evaluate("e => { const w=document.createElement('div'); w.style.cssText='width:1600px;height:20px'; e.append(w); }")
                    scroll.hover(); page.mouse.wheel(500,0); page.wait_for_timeout(50)
                    assert scroll.evaluate('e => e.scrollLeft') == 0
                    assert not errors, errors
                    (OUT / f'{name}.json').write_text(json.dumps(page.evaluate(GEOMETRY),indent=2))
                    print('PASS', name, 'CSS/native sizing, paint hit-test, safe touch targets, keyboard, zoom, rotation, no page pan')
                except Exception:
                    page.screenshot(path=str(OUT / f'{name}-failure.png'))
                    (OUT / f'{name}-failure.json').write_text(json.dumps({'errors':errors, 'geometry':page.evaluate(GEOMETRY)},indent=2))
                    raise
                finally: context.close()
        browser.close()
