#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/chsms}"
cd "$APP_DIR"
compose=(docker compose -f deployment/compose.yaml)

"${compose[@]}" stop caddy
restart_proxy() {
  "${compose[@]}" up -d caddy
}
trap restart_proxy EXIT

certbot renew "$@" --quiet --deploy-hook "$APP_DIR/deployment/certbot-deploy-hook.sh"
