#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/chsms}"
CERT_DIR="${CERT_DIR:-/opt/chsms/certs}"
LINEAGE="${RENEWED_LINEAGE:?Run only as a Certbot deploy hook}"

install -d -m 0750 "$CERT_DIR"
install -m 0644 "$LINEAGE/fullchain.pem" "$CERT_DIR/fullchain.pem.new"
install -m 0640 "$LINEAGE/privkey.pem" "$CERT_DIR/privkey.pem.new"
chown root:1000 "$CERT_DIR/privkey.pem.new"
chown root:root "$CERT_DIR/fullchain.pem.new"
mv -f -- "$CERT_DIR/fullchain.pem.new" "$CERT_DIR/fullchain.pem"
mv -f -- "$CERT_DIR/privkey.pem.new" "$CERT_DIR/privkey.pem"

cd "$APP_DIR"
docker compose -f deployment/compose.yaml up -d --force-recreate app caddy
