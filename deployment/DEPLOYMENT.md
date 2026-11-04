# VPS Production Deployment

This repository contains deployment configuration, not a deployed service.
No domain, VPS, TLS certificate, production database, gateway connectivity, or
public application access has been verified. Do not treat the development
preview or the demo simulator as a live monitoring system.

## GitHub Pages visual demo (static only)

The `github-pages-demo/` directory is a separate, standalone dashboard
showcase. It uses synthetic sample values and does not include the application
bundle, login, API, database, MQTT, gateways, or live telemetry. The GitHub
Actions workflow publishes only that directory; it does not deploy this
full-stack application.

To publish the visual demo:

1. Create a GitHub repository. Public visibility makes the source code public;
   review it before upload and never add `.env`, database files, certificates,
   gateway tokens, or other secrets. The root `.gitignore` excludes common
   local data and secret paths.
2. Add and push the project source to the repository's `main` branch using
   GitHub Desktop or Git. Do not upload `node_modules/` or `data/`.
3. In the repository settings, open **Pages** and set the build/deployment
   source to **GitHub Actions**.
4. Push a change under `github-pages-demo/`, or manually run the
   **Publish static dashboard demo** workflow from the Actions tab.
5. After the workflow succeeds, open the Pages URL shown in the workflow
   summary (normally `https://<owner>.github.io/<repository>/`).

The result is a public static visual demo, not an online instance of CHSMS.
The production Docker/VPS instructions below are required for API, PostgreSQL,
HTTPS, MQTT/TLS, user accounts, and real gateway telemetry.

## Deployment states

- **Development preview:** local SQLite, demo data, and Vite development server.
- **GitHub Pages visual demo:** standalone static page with synthetic data only.
- **Prepared for deployment:** Docker, PostgreSQL, reverse proxy, TLS, backups,
  and production guardrails are configured in this repository.
- **Deployed application:** containers are running on the chosen VPS and health
  checks, database connectivity, TLS, domain routing, and access are verified.
- **Live production system:** deployed application plus provisioned operator
  accounts, real edge gateways, verified device mappings, monitoring/alerting,
  tested restore, security review, and operational acceptance. The repository
  alone does not establish this state.

## Included deployment topology

- Docker Compose runs the Node API/UI, PostgreSQL 17, and Caddy.
- Caddy serves the configured domain over HTTPS and proxies HTTP/WebSocket to
  the private app container.
- The app exposes only its TLS MQTT listener on TCP 8883 to gateway clients.
  MQTT authenticates each gateway against its provisioned ID/token.
- PostgreSQL has no published host port and shares only an internal Docker
  network with the app.
- The HTTP API is not published to the host. Caddy is the only public web
  entry point.
- `restart: unless-stopped`, container health checks, bounded container logs,
  and Docker daemon startup support continuous operation on a single VPS.

This is a single-node starting deployment, not a high-availability cluster.
The embedded MQTT broker and in-process rate limiter are not horizontally
scalable, and the MQTT broker does not persist its own sessions across process
restarts. Gateways must retain their disk outbox and replay after reconnect.
For multi-node production, move to a separately operated durable MQTT broker
and distributed rate limiting/session infrastructure before scaling out.

## 1. Prepare a Linux VPS

Use a supported Ubuntu LTS VPS with a static public IPv4 address, current
security updates, Docker Engine and the Docker Compose plugin, and Certbot.
Use a dedicated non-root deployment account with access to Docker. Restrict SSH
to an administrator IP/key; do not expose Docker's API socket remotely.

Clone/copy the repository to `/opt/chsms`, then:

```sh
cd /opt/chsms
cp deployment/.env.production.example .env
chmod 600 .env
```

Generate and set distinct secrets. Use URL-safe hexadecimal for the PostgreSQL
password because it is embedded in `DATABASE_URL`:

```sh
openssl rand -hex 32
openssl rand -hex 48
```

Set `POSTGRES_PASSWORD` to the first value and `SESSION_SECRET` to the second.
Set `APP_DOMAIN`, `MQTT_DOMAIN`, `ACME_EMAIL`, and `MQTT_URL` to real values.
`MQTT_URL` must be `mqtts://<MQTT_DOMAIN>:8883`. Replace all sample values;
never commit `.env` or private keys.

## 2. Connect the domain and obtain TLS

At the DNS provider, create:

- `A` record `<APP_DOMAIN>` to the VPS IPv4 address.
- `A` record `<MQTT_DOMAIN>` to the VPS IPv4 address.
- `AAAA` records only if IPv6 is configured and firewall-tested on the VPS.

Wait for DNS propagation and verify both hostnames resolve to the VPS. Ensure
TCP 80 is reachable before requesting the initial certificate. With no
deployment containers listening yet, issue one certificate covering both
names:

```sh
sudo certbot certonly --standalone \
  --email operations@example.com --agree-tos --no-eff-email \
  -d monitoring.example.com -d mqtt.example.com
```

Replace the example domain/email with the `.env` values. Copy the certificate
to the configured deployment paths (the app container runs as UID/GID 1000):

```sh
sudo install -d -o root -g 1000 -m 0750 /opt/chsms/certs
sudo install -o root -g root -m 0644 \
  /etc/letsencrypt/live/monitoring.example.com/fullchain.pem \
  /opt/chsms/certs/fullchain.pem
sudo install -o root -g 1000 -m 0640 \
  /etc/letsencrypt/live/monitoring.example.com/privkey.pem \
  /opt/chsms/certs/privkey.pem
```

Set `TLS_CERT_HOST` and `TLS_KEY_HOST` in `.env` to these files. Make the
deployment hooks executable, install the provided systemd timer, then test
renewal with `sudo certbot renew --dry-run`:

```sh
sudo chmod 750 /opt/chsms/deployment/certbot-{renew,deploy-hook}.sh
sudo cp /opt/chsms/deployment/certbot-renew.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now certbot-renew.timer
sudo APP_DIR=/opt/chsms /opt/chsms/deployment/certbot-renew.sh --dry-run
```

The timer briefly stops Caddy so Certbot's standalone HTTP challenge can bind
port 80. The deploy hook copies renewed certificate material with restricted
key permissions and recreates app/Caddy so both reload the new certificate.
The timer restarts Caddy even when no certificate was renewed.

## 3. Start the production stack

From the project directory:

```sh
docker compose -f deployment/compose.yaml config --quiet
docker compose -f deployment/compose.yaml build
docker compose -f deployment/compose.yaml up -d
docker compose -f deployment/compose.yaml ps
docker compose -f deployment/compose.yaml logs --tail=100 app db caddy
```

Production configuration is intentionally strict: the app refuses to start
without PostgreSQL, a strong session secret, demo mode disabled, automatic
seeding disabled, HTTPS-cookie configuration, an `mqtts://` URL, and readable
MQTT certificate/key files. It does not generate a self-signed certificate in
production. TLS certificate SANs must cover both domains.

Check application readiness and TLS from an external network:

```sh
curl --fail https://monitoring.example.com/api/system/health
openssl s_client -connect mqtt.example.com:8883 -servername mqtt.example.com
```

Health must return HTTP 200 with `status: "ok"`, PostgreSQL `ok: true`, and
MQTT `running: true`. Also sign in over HTTPS, verify the browser WebSocket
connection, and confirm the expected domain/certificate. A successful health
check is necessary but does not prove real plant telemetry or production
acceptance.

## 4. Create the first administrator

Automatic demo seeding is disabled. Create a production administrator using
interactive hidden password input:

```sh
docker compose -f deployment/compose.yaml exec -it app \
  node server/db/create-admin.js --username platform-admin --email admin@example.com
```

Use a unique strong password and store it in the organization's password
manager. Create further operator accounts and scope permissions/site access
through User Management. Do **not** run `npm run seed` or `npm run seed:reset`
against production; those commands populate/reset demo and simulated data.

## 5. Firewall and network security

Allow inbound only:

- TCP 22 from approved administrator IPs, preferably key-only SSH.
- TCP 80 and 443 for web/ACME challenge.
- TCP 8883 for authenticated TLS MQTT gateways.

Do not expose TCP 8080, 1883, 5432, Modbus TCP 502/1502, or Docker's API.
PostgreSQL and the app HTTP API have no host-published ports in Compose.
Restrict egress according to OS updates, DNS, NTP, certificate renewal, and
required gateway/server communication. Enforce device ACLs at each plant so
the gateway can reach only configured private-LAN device IPs/ports. Gateways
initiate outbound TLS connections; never port-forward Modbus from the public
internet.

Example UFW policy (substitute the actual administrator IP before applying):

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <ADMIN_PUBLIC_IP>/32 to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8883/tcp
sudo ufw enable
sudo ufw status verbose
```

Apply equivalent controls in the VPS provider security group. Do not lock out
SSH: test the administrator-IP rule in a second session first.

## 6. PostgreSQL backup and recovery

The database uses a named Docker volume. It is not a backup. Create and
validate encrypted off-host backups on a schedule:

```sh
sudo APP_DIR=/opt/chsms BACKUP_DIR=/var/backups/chsms \
  /opt/chsms/deployment/backup-postgres.sh
```

The script uses PostgreSQL custom format, checks that the archive can be
listed, writes a SHA-256 sidecar, restricts local permissions, and prunes only
matching backup files older than `RETENTION_DAYS` in the specified backup
directory. Encrypt and copy backups to a separate account/provider/location;
do not treat a checksum as encryption. Configure alerting on backup job
failure and disk space.

Install the provided daily systemd timer:

```sh
sudo chmod 750 /opt/chsms/deployment/backup-postgres.sh
sudo install -d -o root -g root -m 0700 /var/backups/chsms
sudo cp /opt/chsms/deployment/backup-postgres.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now backup-postgres.timer
sudo systemctl start backup-postgres.service
sudo systemctl status backup-postgres.service
```

Restore is destructive to the target database and stops the application. Use
only after verifying the exact backup and target:

```sh
RESTORE_CONFIRM=YES APP_DIR=/opt/chsms \
  /opt/chsms/deployment/restore-postgres.sh \
  /var/backups/chsms/chsms-YYYYMMDDTHHMMSSZ.dump
```

The restore script refuses relative paths and requires an explicit
confirmation variable. Test restoration regularly on a separate staging
instance, then verify records and application health.

## 7. Continuous operation and monitoring

Docker's `unless-stopped` restart policy plus Docker Engine's system service
keeps containers running after a reboot or process failure. Configure the VPS
provider's host monitoring and alerting for disk, memory, CPU, service health,
certificate expiry, backup completion, and `/api/system/health`. Review
structured HTTP/error JSON logs with `docker compose logs`; Docker log files
are size-limited and rotated. Forward logs to a protected external log/alert
service for retention and paging. The project does not currently integrate a
third-party APM/error-monitoring provider.

Deploy updates during a maintenance window: back up, review release changes,
build, run tests, recreate containers, verify health and login, and retain a
known-good image/backup for rollback. Protect `.env`, Docker socket access,
backups, TLS private key, and gateway tokens. Rotate gateway tokens and TLS
certificates using a documented change process.

## 8. Production deployment checklist

- [ ] VPS patched, SSH key-only and administrator-IP restricted.
- [ ] Both DNS names resolve to the correct VPS; DNS/IPv6 behavior verified.
- [ ] `.env` contains unique strong secrets, mode 0600, and is not in source control.
- [ ] TLS certificate covers app and MQTT names; key readable only by required service identity.
- [ ] Compose validation/build passes; containers restart and health checks pass.
- [ ] PostgreSQL reports healthy, has no published port, and backup/restore test passes.
- [ ] HTTPS login, secure session cookie, SPA routes, and WSS/WebSocket verified externally.
- [ ] MQTT TLS certificate/hostname and gateway authentication tested from a remote edge network.
- [ ] MQTT 1883 and Modbus 502 are not exposed publicly; only approved ports are open.
- [ ] DEMO_MODE and SEED_ON_START are false; no demo credentials are used.
- [ ] First admin provisioned; role/site access reviewed; initial password stored securely.
- [ ] At least two independent gateway identities provisioned and tested with approved devices or isolated virtual devices.
- [ ] Register mappings verified against manufacturer documentation; read-only operation confirmed.
- [ ] Gateway outbox recovery, duplicate handling, reconnect, alarm paths, and data-source labels tested.
- [ ] Log forwarding, error/health alerting, certificate renewal, backup scheduling, disk monitoring, and on-call ownership configured.
- [ ] Security review, disaster recovery exercise, operational acceptance, and rollback plan completed.

Until every applicable check is verified in the target environment, report the
system as **prepared for deployment**, not online, live, or production-ready.
