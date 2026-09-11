# Copilot voice presentation

## User behavior

Tap Voice in the workspace dock or chat header: the existing chat box becomes
a liquid-glass Orb from `LerSent001/orb`, not a transcript with a visualization
on top. The text composer, messages and welcome starters are not mounted in
voice mode. Brief state/error labels and required approval controls remain.
Tap Text to stop capture/playback and restore the same agent conversation and
unsent draft. New chat retains its existing reset semantics (ends voice and
starts a fresh text thread). Closing or hiding the page cancels microphone/audio.

## Boundaries

`GuideFab` uses the public CopilotChat children slot and disables only the
welcome branch while voice is selected. CopilotPopup, CopilotChat and the shared
`set_guide` agent are never keyed/remounted by modality. Frontend tool handlers,
screen context, authenticated task handoffs and server permission checks are
unchanged. Voice approvals reuse the same workspace/thread-scoped state and
`ApprovalCard` decision handler. Historical receipts and tool results remain
available by switching to Text. Stopping work calls the existing CopilotKit
stop/abort path; it never grants approval.

`VoiceOrb` lazy-loads the pinned renderer/WGSL only in visible, animated voice
mode. State profiles use the upstream glass preset. Measured levels from existing
input/output streams drive deformation; Web Audio only analyzes these streams
and never opens another microphone, records them, connects mic to speakers or
stops their tracks. SpeechSynthesis start/end events represent spoken browser
replies. Silent native output is not labelled as speaking.

The upstream poster is a static orb fallback for unsupported/failed WebGPU,
reduced motion and hidden tabs. It is not an alternate voice backend. Animation
frames and GPU devices are disposed on modality change, close, unmount, reduced
motion and page hiding; late dynamic imports cannot resurrect a renderer.

All original native voice selection, self-hosted gating and no-silent-fallback
rules remain. This does not enable Codex voice in cloud or prove live subscriber
entitlement. Test a real eligible account/device separately for audible WebRTC
input/output, permission prompts, interruptions and backgrounding.

## Validation

From `web/`:

```sh
node scripts/sync-orb.mjs
npm test
npm run build
# Start Vite on loopback, then in another terminal:
python3 scripts/copilot-controls-smoke.py
python3 scripts/copilot-approval-smoke.py
python3 scripts/voice-orb-smoke.py
```

The controls fixture exercises the real shell with synthetic audio/agent services:
closed-dock Voice, empty/history text exclusion, draft/thread restoration,
permission denial and delayed cancellation, mute, microphone cleanup, narrow
phones and desktop. Approval fixtures exercise approve/deny/stop inside voice.
The shader smoke uses real WebGPU via SwiftShader (not a fake renderer), in
StrictMode, checks shader compilation/drawing, reduced-motion/unsupported
fallback, and balances created/destroyed devices. CI uploads the screenshots.
`SET_BROWSER_EXECUTABLE` may select an installed Chromium for local tests.

Upstream revision, license and integrity procedure: `web/src/vendor/lersent-orb/README.SET.md`.
