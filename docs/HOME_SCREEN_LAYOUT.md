# Home Screen layout

## Failure after PR 16

The physical-device report distinguishes normal browser tabs (usable) from
Home Screen launches (a large band below the dock). Screenshots were taken
after deploying PR 16. Do not assume a merge or a passing desktop size test
proves what an installed iOS container paints.

Two application mechanisms are addressed here:

1. PR 16 still wrote `innerHeight` as a fixed pixel height in installed mode.
   That cannot help when both JavaScript viewport readings are short. Installed
   idle geometry now stays a live `100vh` CSS length, and the document roots
   use viewport height instead of a percentage-height containing block. Browser
   tabs keep their visual viewport policy; active text editing still uses the
   visible height and pan. No device name or physical `screen.height` is used.
2. The phone shell reserved the bottom inset while the footer had an equal
   negative bottom margin. Its rectangle reached the shell edge but the main
   column's `overflow: hidden` clipped its paint. The footer now owns that
   padding inside normal flex flow. The shell only reserves top/side insets on
   phones. Desktop/tablet retains its shell bottom inset and floating dock.

In a local geometry reproduction using the original CSS and viewport module,
with a 402 x 874 CSS viewport, innerHeight 812, visual height 778 and simulated
62/34 top/bottom insets, the old shell ended at 812 and main clipped at 778:
a 96px band. The corrected shell, main and footer end at 874 and hit testing
finds the footer at the bottom. These are synthetic inputs, not measurements
collected from the user's device.

## Sources and interpretation

- [WebKit: Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
  describes `viewport-fit=cover` and protecting controls with safe-area insets.
- [WebKit: Safari 15.4 viewport units](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)
  explains small, large and dynamic viewport sizes. The stable length here is
  installed-mode-only: a browser tab with retractable controls is different.
- [WebKit 218983](https://bugs.webkit.org/show_bug.cgi?id=218983) documents
  standalone VisualViewport problems after keyboard/orientation transitions.
- [OpenChamber's direct reproduction](https://github.com/openchamber/openchamber/issues/2287)
  reports the percentage-height roots / black-translucent / cover combination.
  It is a related application report, not proof of this device's OS internals.
- [WebKit 301994](https://bugs.webkit.org/show_bug.cgi?id=301994) has reports of
  system-owned strips in installed apps. Some reports say viewport units exceed
  the drawable native surface. This application patch cannot promise to paint
  over a region the OS refuses to expose; physical iOS validation still matters.

## Regression tests

`web/scripts/pwa-viewport-smoke.py` runs the actual AppShell and DashboardView
with synthetic workspace/API data in both Playwright Chromium and WebKit.
It tests phones, landscape, tablets and desktop, legacy `navigator.standalone`
and display-mode detection, two simultaneously short JavaScript measurements,
CSS resize recovery, keyboard/blur/zoom, drawer size and unchanged browser-tab
geometry. The existing voice/account/setup suites remain enabled.

Safe-area tests override the same CSS variables production uses; they do not
inject a replacement layout. Verify all three of the following:

- The shell, main and mobile dock reach the expected viewport edge.
- `elementFromPoint` near that edge resolves to the dock, accounting for clipping.
- The navigation touch targets remain above the bottom safe area and at least
  44 CSS pixels tall, while the content scroll region ends above the footer.

The suite temporarily restores the old negative-margin/clipping structure and
requires the paint check to fail even though the bounding-box check passes.
Screenshots and geometry JSON are uploaded under `copilot-controls-browser` /
`pwa-viewport`. Playwright WebKit on Linux is not the iOS Home Screen container.

## Deployment and physical acceptance

After merging, rebuild the self-hosted web image with the usual deployment
command and fully close/reopen SET from its existing Home Screen icon. No
manifest/start URL or account-storage changes are included; reinstalling SET
or clearing user data is not a required migration.

Check a cold launch, portrait/landscape, dashboard scrolling, opening/closing
navigation, and typing/dismissing the keyboard. The footer should paint to the
bottom with controls above the home indicator. Check the same URL in a browser
tab: its real browser toolbar must remain outside SET. Codex, voice transport,
credentials and server configuration are intentionally unchanged.
