#!/usr/bin/env bash
# SET backup: Postgres dump + uploaded files. Run from the repo root or on the host:
#   ./scripts/backup.sh [output-dir]
set -euo pipefail
OUT="${1:-set-backup-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"
docker compose exec -T db pg_dump -U set set | gzip > "$OUT/db.sql.gz"
docker compose cp server:/app/data "$OUT/data" 2>/dev/null || cp -r server/data "$OUT/data" 2>/dev/null || true
echo "Backup written to $OUT (db.sql.gz + data/)"
echo "Restore: gunzip -c db.sql.gz | docker compose exec -T db psql -U set set   and copy data/ back."
