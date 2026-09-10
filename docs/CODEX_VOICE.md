# Personal Codex subscription voice (experimental)

SET's microphone can use the signed-in user's Codex-managed realtime voice
session for both hearing and speaking. It does not convert subscription OAuth
tokens into API keys, call the metered OpenAI Realtime API directly, copy the
operator's credentials, or silently switch a failed voice session to another
provider. The existing personal device-code login remains the only sign-in.

## Enable on self-hosted SET

The existing personal Codex setup in [CODEX_SELF_HOSTED.md](CODEX_SELF_HOSTED.md)
still applies. Add the optional voice override:

```sh
docker compose -f docker-compose.yml -f docker-compose.codex.yml -f docker-compose.codex-voice.yml up -d --build
```

Native deployments must explicitly set all three server-owned flags:

```dotenv
SET_DEPLOYMENT_MODE=self-hosted
SET_CODEX_OAUTH_ENABLED=1
SET_CODEX_VOICE_ENABLED=1
```

Keep the existing official CLI pin, `@openai/codex@0.154.0`. Do not mount an
operator's Codex home. Use HTTPS or localhost. In Settings, connect the user's
ChatGPT account and select **Use Codex for my Copilot**. Press the microphone and
allow microphone access. The same rocker ends the live conversation; its mute
control mutes incoming spoken replies, not microphone capture. Text mode, closing
the popup, tab hiding, user/workspace changes and unmount stop the microphone,
playback and session. No permission is requested on page load.

Cloud, missing flags and unknown deployment modes deny every new voice route.
The voice override alone cannot enable subscription access in cloud mode.
Without voice opt-in/selection, the existing transcription/browser dictation
behavior remains unchanged. Once a selected subscription attempt starts, errors
remain visible and no transcription/API/browser-voice fallback is attempted.

## Model identity, access and billing

This integration implements the requested GPT Voice experience through **Codex's
experimental app-server realtime interface**. It deliberately does not invent or
hard-code a `gpt-voice-1` model identifier. Codex/account-side routing chooses the
available voice model. The announcement's exact model name and its entitlement
for third-party app-server clients have not been verified by a live account test.
Do not market this as verified GPT Voice one access until that check passes.

A subscription is not an unlimited voice entitlement. Plan eligibility, rollout,
workspace policy and voice allowances still apply, and delegated Copilot work
uses the user's Codex allowance. No API key is required by this transport, and no
paid API fallback is implemented. Separate SET tools that already use their own
configured providers retain their existing behavior and potential costs.

## Execution and approval boundary

Browser audio uses WebRTC. SET exchanges bounded SDP through authenticated HTTP;
tokens are never in URLs. No Codex credentials, native thread IDs or arbitrary RPC
interface reach the browser. Signaling/task polling requires both the original
user's SET bearer token and current workspace membership. Session lookup binds
user, workspace and opaque session ID.

The voice-side native thread exposes only `set_copilot`. That tool delegates to
the existing visible `set_guide` conversation through `askAgent`, not a second
SET action engine. Normal CopilotKit screen context, frontend tools, SET server
permissions, approval cards, tool results and chat history remain in that path.
The audio side is instructed to delegate substantive questions and actions;
this instruction is not a guarantee that a model can never speak an incorrect
acknowledgment. Review the chat as the authoritative record of executed actions.

Only a completed chat result is returned to the voice model for speech. Failed,
empty, rejected or cancelled runs are not fabricated as success. The browser
cannot grant extra tool permissions through a voice result. Audio and text use
separate native thread IDs in the same per-user official CLI process, with
multiplexed request handlers and no second credential-file writer.

One voice session per user, eight total personal CLI processes, 32 handoffs per
session, 12,000-character task/results, 64,000-character SDP, a 128-event window,
a 45-second abandoned-client timeout and a ten-minute absolute session limit
bound resources. Task IDs are handled once; result delivery failure stops voice
instead of repeating actions. Closing voice attempts to abort its owned chat run
and interrupts the native voice turn; actions already completed are not undone.

## Validation and release gate

`cd server && npm test` includes transport, lifecycle and chat-handoff tests with
synthetic RPC/WebRTC/network services. The adapter/client modules can be checked
without a live account. Tests cover strict deployment gates, pending result IDs,
protocol ordering, text/voice isolation, native-tool denial, cancellation during
permission/signaling, timeout cleanup, original-token deletion, muted playback,
chat routing, failed results and duplicate prevention. These are not live voice
quality or entitlement tests.

Run the normal server typecheck/tests and web build. The existing browser control
smoke suite must remain green. `node server/scripts/codex-voice-smoke.mjs` checks
cloud/disabled route denial without a subscriber account. Before enabling the
feature outside development, check a real eligible account: device-code login,
SDP exchange, audible input/output, a tool-producing voice request, in-chat
approval/rejection, frontend-tool continuation, interruptions, quota exhaustion,
logout and physical iOS/Android playback/permission behavior. This integration
should remain opt-in and the PR draft until those release checks are reviewed.

## Primary references checked on September 10, 2026

- https://developers.openai.com/codex/app-server/
- https://learn.chatgpt.com/docs/features/voice
- https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/realtime.rs
- https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/common.rs

The pinned protocol defines `thread/realtime/start`, `thread/realtime/sdp`,
`thread/realtime/stop` and transcript notifications as experimental. Do not replace
these with guessed endpoints or forward subscription tokens to an API host.
