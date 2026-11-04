#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/chsms}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( RETENTION_DAYS < 1 )); then
  echo "RETENTION_DAYS must be a positive integer" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
if ! flock -n 9; then
  echo "Another PostgreSQL backup is already running" >&2
  exit 1
fi
tmp="$BACKUP_DIR/.chsms-$STAMP.dump.tmp"
final="$BACKUP_DIR/chsms-$STAMP.dump"
trap 'rm -f -- "$tmp"' EXIT

cd "$APP_DIR"
docker compose -f deployment/compose.yaml exec -T db \
  sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$tmp"
test -s "$tmp"
docker compose -f deployment/compose.yaml exec -T db pg_restore --list - < "$tmp" >/dev/null
chmod 600 "$tmp"
mv -- "$tmp" "$final"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$final")" > "$(basename "$final").sha256")
chmod 600 "$final.sha256"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'chsms-*.dump' -mtime "+$RETENTION_DAYS" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'chsms-*.dump.sha256' -mtime "+$RETENTION_DAYS" -print -delete
echo "Verified PostgreSQL backup created: $final"
