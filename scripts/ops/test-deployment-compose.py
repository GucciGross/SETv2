"""Render the real Compose configuration without starting services or printing secrets."""
import json
import os
import subprocess

env = {**os.environ, "APP_URL": "https://set.example", "WEB_ORIGIN": "https://set.example",
       "JWT_SECRET": "test-only-secret-that-is-at-least-32-characters", "POSTGRES_PASSWORD": "test-only-db-password",
       "SMTP_HOST": "smtp.example", "REGISTRATION_OPEN": "0", "STRIPE_SECRET_KEY": "test-only-stripe",
       "LLM_BASE_URL": "https://upstream.example/v1", "LLM_API_KEY": "test-only-upstream"}
for edition in ("private", "hosted", "cloud"):
    args = ["docker", "compose", "-f", "docker-compose.yml"]
    if edition != "private":
        args += ["-f", f"docker-compose.{edition}.yml"]
    if edition == "cloud":
        args += ["--profile", "cloud"]
    result = subprocess.run(args + ["config", "--format", "json"], env=env, check=True, capture_output=True, text=True)
    config = json.loads(result.stdout)
    server = config["services"]["server"]
    values = server["environment"]
    assert values["SET_DEPLOYMENT_MODE"] == ("cloud" if edition == "cloud" else "self-hosted")
    assert str(values["SET_CODEX_OAUTH_ENABLED"]) == ("0" if edition == "cloud" else "1")
    assert server["build"]["target"] == ("runtime" if edition == "cloud" else "codex-self-hosted")
    if edition != "private":
        assert values["SET_EXPOSURE"] == "public"
        assert values["APP_URL"] == values["WEB_ORIGIN"] == "https://set.example"
        assert values["SMTP_HOST"] == "smtp.example"
        assert str(values["REGISTRATION_OPEN"]) == "0"
        assert values["STRIPE_SECRET_KEY"] == "test-only-stripe"
        assert str(values["SEED_DEMO"]) == "0"
    if edition == "cloud":
        assert not values["LLM_API_KEY"] and not values["LLM_BASE_URL"]
        assert config["services"]["gateway"]["environment"]["GATEWAY_UPSTREAM_KEY"] == "test-only-upstream"
    print(f"PASS: {edition} edition/exposure/provider contract")
