# Privileged actions in both editions

Workspace ownership is not platform administration. Manual billing grants now
require a server-owned `SET_PLATFORM_ADMIN_IDS` comma-separated UUID allowlist,
as well as ownership of the destination workspace. Empty means grants are denied
in both editions. Stripe purchases are unaffected. Do not put this setting in
workspace settings or expose it in the browser. Operators needing this support
lever must explicitly pass it to the server container through their private
Compose override; adding it only to `.env` does not forward it automatically.

Public self-hosting (`SET_EXPOSURE=public`) and managed cloud both deny the current
in-process `node:vm` JavaScript runner. The check is inside `runJs`, so coding,
terminal and other callers cannot bypass it. Coding files, the editor and normal
read-only terminal commands stay available. Terminal `new` and both execution
routes require editor access. The existing private/trusted self-hosted runner
is retained, but it is not safe for untrusted code. Do not expose a private-mode
installation to untrusted users. Use the public self-hosted overlay from the
separate deployment PR without changing the product edition or Codex workflow.

This is a containment fix, not a claim that an isolated execution service has
been implemented. Re-enabling execution for public users requires a separately
isolated runner with no API secrets, bounded resources, restricted egress and
termination guarantees. This PR does not change Codex, its sandbox policy,
companion pairing, the voice orb, or the chat conversation.
