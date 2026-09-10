# Codex sign-in for self-hosted SET

SET can optionally expose Codex sign-in in self-hosted deployments. The hosted WandGx/SET cloud deployment must keep this disabled.

## Deployment gate

Enable both variables only for a self-hosted installation:

```env
SET_DEPLOYMENT_MODE=self-hosted
SET_CODEX_OAUTH_ENABLED=1
```

The UI must not treat these flags as the security boundary. Server routes must enforce both conditions.

## Integration model

Use the official Codex app-server integration and its managed ChatGPT sign-in flow. Do not embed copied OAuth client credentials in SET, and do not turn a user's ChatGPT/Codex session into a generic OpenAI API key.

The intended ownership model is one Codex session per SET user. Workspace membership and existing SET approval gates continue to control what the Copilot may do inside SET.

## Hosted deployment

The hosted product must run with either `SET_DEPLOYMENT_MODE=cloud` or `SET_CODEX_OAUTH_ENABLED=0`. Codex sign-in endpoints should return disabled/forbidden responses in that configuration.
