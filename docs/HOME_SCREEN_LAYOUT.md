# Home Screen viewport layout

## What changed after PR 16

PR 16 still froze installed-app height to a pixel snapshot of `innerHeight`.
It also inherited a separate, reproducible paint/clipping defect: the shell
reserved the bottom safe area, the dock extended into it with a negative
margin, and `main` clipped that extension with `overflow: hidden`.
A bounding-box assertion passed even though the last 34px was not painted.

The workspace now has one sizing contract:

- Native CSS `100dvh` (`100vh` fallback) sizes `html`, `body`, `#root` and the
  shell in installed mode at rest. Neither `innerHeight` nor `screen.height`
  is used to freeze this CSS height. Leaving the workspace releases the root
  scroll lock, so landing, login and shared pages keep normal document flow.
- A browser tab or an active editor can temporarily use VisualViewport height
  and top for browser chrome / keyboard avoidance. Blur in installed mode
  removes that override, rather than substituting another cached pixel height.
- The mobile dock owns bottom safe-area padding **inside its normal flow**.
  The shell reserves no second bottom inset. Main's clipping rectangle now
  includes the whole dock. Top/left/right insets still protect the shell.
- The workspace scroller cannot horizontally pan the entire page; wide content
  should provide its own nested horizontal scroller.

No device model detection, extra toolbar-sized padding, screen-height forcing,
negative margin workaround, auth changes or manifest identity changes.

## Evidence and limits

`web/scripts/viewport-layout-smoke.py` exercises the real AppShell, dock and CSS
in Chromium and WebKit. External APIs/audio are test doubles. It checks phone,
tablet and desktop widths, browser versus installed mode, stale *both* JS
height readings, keyboard/zoom/blur, rotation, hit-tested navigation, and three
bottom-edge hit-test points. The existing voice/account/browser suites remain.
The fixture's viewport and iOS meta tags must match the production document.

The tests inject safe-area environment values through the production CSS
variables. They do not override shell padding or set a fake shell height to
make the result pass. Screenshots and numerical geometry are uploaded in
`viewport-layout-browser`; WebKit on Linux is not an iOS Home Screen container.
A physical Home Screen launch still needs verification after redeployment.

## Physical-device checks

After merging, update and rebuild the self-hosted installation. Fully quit SET
and relaunch from its existing Home Screen icon. Check portrait, landscape,
opening/closing the keyboard, switching apps and returning, and ordinary
browser mode. The bottom surface must reach the available web viewport, while
Home/Notebooks/Tasks remain above the home indicator. Scroll through content;
only the middle workspace area should scroll.

For measurements on the actual phone, append `?viewport-debug=1` (or
`&viewport-debug=1` if a query already exists) to the current signed-in SET URL,
then reload. Expand **Screen layout diagnostics** and tap **Refresh
measurements**. `layoutVersion` must be `home-screen-css-v1`; idle installed
mode must report `heightSource: standalone-css`.

The opt-in panel reports only display/viewport dimensions, safe padding,
shell/main/dock rectangles, root scroll offsets, and bottom hit-test results.
The report contains no account, URL, document or credential data and is not
sent to a server. Remove the query and reload to hide it.

A mismatch between physical screen dimensions and the web viewport is **not**
proof that all missing pixels are available to the DOM. If the dock is painted
at the CSS viewport's bottom but a band remains outside it, retain the measured
report rather than adding hard-coded pixels or claiming that a simulated test
has proved the native-container problem fixed.

## Platform references

- WebKit: [Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
  documents viewport-fit=cover and selective safe-area padding.
- WebKit: [Safari 15.4 viewport units](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)
  defines dynamic viewport sizing.
- [WebKit 218983](https://bugs.webkit.org/show_bug.cgi?id=218983)
  reports stale VisualViewport in installed iOS apps.
- [WebKit 301994](https://bugs.webkit.org/show_bug.cgi?id=301994)
  records a separate native Home Screen fullscreen regression. It is not proof
  that the user's remaining band has that exact cause.
- [OpenChamber report 2287](https://github.com/openchamber/openchamber/issues/2287)
  identifies a similar percentage-height root issue. This is corroborating
  investigation, not independent proof of SET's physical-device behavior.
