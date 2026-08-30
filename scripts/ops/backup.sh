#!/usr/bin/env bash
# SET backup — one command, everything: Postgres dump + the server data
# volume (uploads, captures, 3D models, VAPID keys) into one timestamped
# archive next to the repo. Run from anywhere; it finds the compose project.
#
#   ./scripts/ops/backup.sh          # → set-backup-20260829-120000.tar.gz
#   BACKUP_DIR=/mnt/nas ./scripts/ops/backup.sh
#
# Schedule it with cron: 0 3 * * *  cd /srv/set && ./scripts/ops/backup.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

OUT_DIR="${BACKUP_DIR:-.}"
TS=$(date +%Y%m%d-%H%M%S)
OUT="$OUT_DIR/set-backup-$TS.tar.gz"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 1. database
docker compose exec -T db pg_dump -U set set > "$TMP/db.sql"

# 2. server data volume (finds the volume mounted at /app/data, whatever it's named)
SERVER_ID=$(docker compose ps -aq server)
DATA_VOL=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$SERVER_ID")
[ -n "$DATA_VOL" ] || { echo "could not find the server data volume"; exit 1; }
docker run --rm -v "$DATA_VOL:/data:ro" -v "$TMP:/backup" alpine tar czf /backup/data.tar.gz -C /data .

tar czf "$OUT" -C "$TMP" db.sql data.tar.gz
echo "Backup written: $OUT ($(du -h "$OUT" | cut -f1))"
echo "Move it off this machine — scp, restic, S3, anything but here."
