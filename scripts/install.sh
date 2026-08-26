#!/usr/bin/env bash
# SET interactive installer — pick what runs on your system.
#   curl -fsSL …/install.sh | bash        (interactive)
#   ./install.sh --profile research --port 8080   (non-interactive)
set -euo pipefail

cd "$(dirname "$0")/.."
BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
say() { echo "${CYAN}▸${RESET} $*"; }

flag_profile=""; flag_port=""
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) flag_profile="$2"; shift 2 ;;
    --port) flag_port="$2"; shift 2 ;;
    *) echo "unknown arg: $1 (use --profile <name> --port <n>)"; exit 2 ;;
  esac
done

say "checking prerequisites"
command -v docker >/dev/null || { echo "docker is required — https://docs.docker.com/get-docker/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 is required"; exit 1; }
docker info >/dev/null 2>&1 || { echo "docker daemon isn't running"; exit 1; }
echo "  docker + compose ${GREEN}ok${RESET}"

# ---- interactive answers (skipped when flags given) ----------------------
ask() { # ask <prompt> <default>
  if [ -n "$2" ] && [ -t 0 ]; then
    read -r -p "$1 [$2]: " v && echo "${v:-$2}"
  else echo "$2"; fi
}
askyn() { # askyn <prompt> <default y/n>
  local d="$2" v
  if [ -n "$flag_profile" ] || [ ! -t 0 ]; then
    case " $flag_profile " in *" $3 "*) echo "y";; *) echo "$d";; esac; return
  fi
  read -r -p "$1 (y/n) [$d]: " v && echo "${v:-$d}" | grep -qi '^y'
}

PORT="${flag_port:-$(ask 'SET port' 8080)}"
say "choose services — everything self-hosted, nothing phones home"

RESEARCH=$(askyn '  Deep research stack? (SearXNG search + real Chrome renderer + CrewAI worker; +~1.5 GB RAM)' y research && echo y || echo n)
CHANNELS=$(askyn '  Slack channel listener?' n channels && echo y || echo n)
OLLAMA=$(askyn '  Local Ollama LLM? (large download on first use)' n ollama && echo y || echo n)

PROFILES=()
[ "$RESEARCH" = "y" ] && PROFILES+=(research)
[ "$CHANNELS" = "y" ] && PROFILES+=(channels)
[ "$OLLAMA" = "y" ] && PROFILES+=(ollama)
PROFILE_ARG=""
[ ${#PROFILES[@]} -gt 0 ] && PROFILE_ARG="--profile ${PROFILES[*]}"

# ---- .env ---------------------------------------------------------------
if [ -f .env ] && [ "${FORCE_ENV:-0}" != "1" ]; then
  say "keeping existing .env"
else
  say "writing .env"
  PG_PASS=$(head -c24 /dev/urandom | base64 | tr -d '/+=' | head -c28)
  JWT=$(head -c32 /dev/urandom | base64 | tr -d '/+=' | head -c40)
  cat > .env <<EOF
# written by scripts/install.sh $(date -I)
SET_PORT=$PORT
POSTGRES_PASSWORD=$PG_PASS
JWT_SECRET=$JWT
COMPOSE_PROFILES=${PROFILES[*]}
# bootstrap LLM (optional — any OpenAI-compatible endpoint; or configure per-workspace in Settings → AI Providers)
# LLM_BASE_URL=
# LLM_API_KEY=
# LLM_CHAT_MODEL=
EOF
  chmod 600 .env
fi

# ---- up ------------------------------------------------------------------
say "building + starting (first build takes a few minutes)"
# shellcheck disable=SC2086
docker compose $PROFILE_ARG up -d --build

echo
say "${BOLD}SET is up${RESET}"
echo "  ${BOLD}http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT}${RESET}  (or http://localhost:${PORT})"
[ "$RESEARCH" = "y" ] && echo "  ${DIM}deep research: enabled — Settings → Deep Research to pick models${RESET}"
[ "$RESEARCH" = "y" ] && echo "  ${DIM}teaching companion: Settings → Companion for setup${RESET}"
echo "  ${DIM}data lives in docker volumes (db_data, server_data)${RESET}"
