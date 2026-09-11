# LerSent001/orb in SET voice mode

Upstream: https://github.com/LerSent001/orb
Revision: `047c58cc93587c21dac12183fc0fb1e4101c8e1a`
License: MIT, copyright (c) 2026 LerSent001. See `LICENSE`.

The renderer, WGSL effect, shader adapter, presets, transitions, uniforms, particle
constant and fallback poster are byte-for-byte upstream. The editor, its UI and
its dependencies are not imported. SET's React/voice adapter lives outside this
directory under `components/copilot/`. Do not silently replace this renderer with
a CSS orb, an iframe, or a remotely hosted runtime.

From `web/`, run `node scripts/sync-orb.mjs` for offline integrity verification.
An intentional maintainer refresh uses `node scripts/sync-orb.mjs --write` after
reviewing the revision and expected Git blob hashes in that script. All files
are fetched and verified before writes; no upstream code is executed by the
importer. Normal install/build/runtime requires no upstream download.

The same license is copied to `public/third-party/lersent-orb-LICENSE.txt` for
production bundles. The verifier checks this copy against the canonical notice.
