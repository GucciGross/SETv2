#!/usr/bin/env bash
# SET restore — puts back exactly what backup.sh saved.
#
#   ./scripts/ops/restore.sh set-backup-20260829-120000.tar.gz
#
# Overwrites the database AND the server data volume of this install.
set -euo pipefail
ARCHIVE=${1:?usage: ./scripts/ops/restore.sh set-backup-<timestamp>.tar.gz}
cd "$(dirname "$0")/../.."
[ -f "$ARCHIVE" ] || { echo "No such archive: $ARCHIVE"; exit 1; }

echo "This will OVERWRITE the database and data of the SET install in $(pwd)."
read -rp "Type 'restore' to continue: " confirm
[ "$confirm" = "restore" ] || { echo "aborted"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
tar xzf "$ARCHIVE" -C "$TMP"

SERVER_ID=$(docker compose ps -aq server)
DATA_VOL=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$SERVER_ID")
[ -n "$DATA_VOL" ] || { echo "could not find the server data volume"; exit 1; }

docker compose stop server

# database: drop + recreate + load (pg_terminate first so DROP doesn't block)
docker compose exec -T db psql -U set -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='set' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS set;" \
  -c "CREATE DATABASE set;"
docker compose exec -T db psql -U set -d set < "$TMP/db.sql"

# data volume: replace contents
docker run --rm -v "$DATA_VOL:/data" -v "$TMP:/backup" alpine sh -c \
  'find /data -mindepth 1 -delete && tar xzf /backup/data.tar.gz -C /data'

docker compose start server
sleep 3
docker compose ps server
echo "Restore complete — open the app and spot-check a page and a notebook."
