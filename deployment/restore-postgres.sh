#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/chsms}"
BACKUP_FILE="${1:-}"

if [[ "${RESTORE_CONFIRM:-}" != "YES" ]]; then
  echo "Refusing restore. Set RESTORE_CONFIRM=YES after verifying the target database and backup." >&2
  exit 2
fi
if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" || ! -s "$BACKUP_FILE" ]]; then
  echo "Usage: RESTORE_CONFIRM=YES $0 /absolute/path/to/chsms-backup.dump" >&2
  exit 2
fi
if [[ "$BACKUP_FILE" != /* ]]; then
  echo "Provide an absolute path to the exact backup file." >&2
  exit 2
fi
CHECKSUM_FILE="$BACKUP_FILE.sha256"
if [[ ! -f "$CHECKSUM_FILE" ]]; then
  echo "Backup checksum file is missing: $CHECKSUM_FILE" >&2
  exit 2
fi
(cd "$(dirname "$BACKUP_FILE")" && sha256sum --check --status "$(basename "$CHECKSUM_FILE")")

cd "$APP_DIR"
docker compose -f deployment/compose.yaml exec -T db pg_restore --list - < "$BACKUP_FILE" >/dev/null
docker compose -f deployment/compose.yaml stop app
if ! docker compose -f deployment/compose.yaml exec -T db \
  pg_restore --clean --if-exists --no-owner --exit-on-error --single-transaction \
  -U chsms -d chsms < "$BACKUP_FILE"; then
  echo "Restore failed. The application remains stopped; inspect PostgreSQL before restarting." >&2
  exit 1
fi
docker compose -f deployment/compose.yaml start app
echo "Restore completed. Verify /api/system/health and application data before resuming operations."
