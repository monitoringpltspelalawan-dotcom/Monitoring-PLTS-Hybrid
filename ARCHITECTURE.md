# System Architecture — Centralized Hybrid Solar Monitoring System (CHSMS)

## 1. Problem framing

The platform must aggregate telemetry from **20+ geographically distributed hybrid PV plants (> 1 MWp portfolio)**, expose real-time and historical SCADA views, alarms, analytics and reports, and stay open for a **100+ site** rollout.

Two planes are strictly separated:

| Plane | Runs at | Talks to | Protocol |
|---|---|---|---|
| **Edge plane** | Industrial PC / mini-PC on the private plant LAN | Inverters, BESS, BMS, meters, generator controllers | Modbus TCP (port 502/1502) **inside the LAN only** |
| **Cloud plane** | Central server | Edge gateways, browsers | MQTT 8883/TLS + WSS + HTTPS 443 |

The gateway always initiates **outbound** connections. No inbound NAT rule, port-forward or public Modbus exposure is required at any site.

```
          PRIVATE SITE LAN (no inbound access)                    PUBLIC / CLOUD
 ┌──────────────────────────────────────────┐        ┌──────────────────────────────────────┐
 │ Inverter ─┐                              │        │  MQTT broker (TLS, per-gateway creds) │
 │ BESS/BMS ─┼─ Modbus TCP ─► Edge Gateway ──┼──TLS──►│            │                          │
 │ Meters ───┤   :502                │       │  MQTT  │            ▼                          │
 │ Genset ───┘                       │       │        │  Ingestion workers ──► PostgreSQL     │
 │                          local buffer     │        │            │             │            │
 │                          (SQLite/disk)    │        │            ▼             ▼            │
 └──────────────────────────────────────────┘        │   Aggregation     Alarm engine        │
                                                     │            │             │            │
                                                     │            ▼             ▼            │
                                                     │      REST API ◄──── WebSocket hub      │
                                                     │            │                          │
                                                     │            ▼                          │
                                                     │      React SCADA SPA (browser)        │
                                                     └──────────────────────────────────────┘
```

## 2. Component inventory

### 2.1 Edge Gateway (`/gateway`)
* **Acquisition** — configurable read-only Modbus TCP poller (`gateway/agent.js`) for holding/input registers and coils/discrete inputs; int16/uint16/int32/uint32/float32/float64, word & byte order, per-register scaling and offset, timeouts, retries, and per-register polling schedule. Device targets are restricted to private, loopback, and link-local IP ranges.
* **Normalisation** — raw → engineering unit, quality flag (`GOOD`, `UNCERTAIN`, `BAD`, `STALE`), device timestamp (UTC), monotonic sequence number.
* **Resilience** — atomic disk-backed JSON outbox, store-and-forward, transport reconnect, ordered backlog replay, and heartbeat health reporting.
* **Transport** — MQTT 3.1.1 over TLS (`rejectUnauthorized`, CA pinning, per-gateway token), QoS 1, `clean=false` + persistent session; HTTPS fallback for restricted networks.
* **Config** — pulled from `/api/gateway/bootstrap` (signed token) every N minutes; cached on disk so it survives cloud outages.
* **Safety** — read-only. No write path exists for inverter/BESS/genset control in v1.

### 2.2 Cloud ingestion
* **MQTT broker** — embedded Aedes broker for local/edge testing, TLS listener on 8883, username/password + gateway token auth topic ACL (`plts/{siteId}/{gatewayId}/...`), or external EMQX/Mosquitto in production.
* **Ingest pipeline** — validate schema → authenticate gateway/site → de-duplicate (`gateway_id + seq`) → reject/discard stale out-of-order rows → persist raw measurement → update live state → feed alarm engine → broadcast over WebSocket. Asynchronous, batched inserts.
* **HTTPS ingest** — identical pipeline for networks where MQTT is blocked.

### 2.3 API (`/server`)
* Node.js ESM + Express, modular services.
* **Database adapter** — one SQL dialect surface; SQLite (`node:sqlite`) for zero-dependency local operation, PostgreSQL (`pg`) for production. Time-series schema is written for Postgres partitioning (monthly `measurements` partitions, BRIN/time indexes, retention jobs) and mirrored in SQLite for the MVP.
* **Auth** — scrypt password hashing, opaque session tokens stored hashed, httpOnly cookie, RBAC middleware with 6 roles and per-site scoping, rate limiting, audit logging.
* **Real-time** — WebSocket hub; clients subscribe to portfolio and site channels; snapshot on connect then deltas.
* **Simulation** — deterministic seeded generator producing 20 sites, device-level physics (solar geometry, clouds, SOC, load profile, genset dispatch, grid faults) and full history backfill. Every simulated row is tagged `data_source = 'DEMO'`; real rows are `'LIVE'`. The UI never mixes them without a label.
* **Alarm engine** — threshold rules evaluated on live state, with debounce, severity, lifecycle (ACTIVE → ACK → RESOLVED) and notification outbox.
* **Reporting** — CSV, XLSX (`exceljs`), PDF (`pdfkit`), scheduled generation into `storage/reports`.

### 2.4 Frontend (`/web`)
* React 18 + TypeScript + Vite, custom industrial dark design system, 18 functional navigation modules.
* Charts via Recharts; geographic map via `d3-geo` + TopoJSON (offline, no tile dependency); animated single-line energy-flow SVG that follows measured power direction.
* Data access through a typed API client; WebSocket hook for live values with graceful polling fallback.

## 3. Data model (core)

```
regions ─┬─< sites ─┬─< gateways ─┬─< devices ─┬─< modbus_registers
         │          │             │            └─< measurements (site,gateway,device,param,ts)
         │          │             └─< gateway_health / comm_logs
         │          ├─< site_energy_daily / energy_hourly
         │          ├─< alarms / events / alarm_rules
         │          └─< site_configs / tariffs
users ──< sessions / audit_logs / user_sites >── sites
roles ──< users
report_schedules ──< generated_reports
```

Key measurement row: `site_id, gateway_id, device_id, parameter_id, value, unit, device_ts, server_ts, quality, seq, data_source`.
Indexes: `(site_id, parameter_id, server_ts)`, `(device_id, server_ts)`, `(server_ts)` for retention. In PostgreSQL `measurements` is `PARTITION BY RANGE (server_ts)` with monthly partitions and a retention/rollup job into `energy_hourly` / `site_energy_daily`.

All timestamps are UTC ISO-8601; each site carries an IANA timezone used for display and day-boundary aggregation.

## 4. Security model

* TLS everywhere (HTTPS/WSS, MQTT 8883). HSTS, CSP, frame-deny, no-sniff.
* Unique gateway credentials (token + optional client certificate fingerprint pinning). Gateway tokens are hashed at rest and shown once.
* RBAC: `SUPER_ADMIN`, `CORPORATE_ADMIN`, `REGIONAL_MANAGER`, `SITE_ADMIN`, `OPERATOR`, `VIEWER`; permission matrix + per-user site grants; regional managers auto-scoped to their region.
* Rate limiting on auth + ingest, input validation on every route, parameterised SQL, audit trail of mutations and alarm actions.
* Industrial devices are never addressed from the cloud; only gateway-originated outbound flows.
* Read-only v1: no write/control endpoints for plant equipment.

## 5. Scalability path

| Concern | MVP (now) | 100+ sites |
|---|---|---|
| Ingestion | in-process MQTT + batched inserts | EMQX cluster + Kafka/NATS, stateless ingest workers |
| Storage | SQLite / single Postgres | Postgres + TimescaleDB or partitioned tables, S3 cold archive |
| Real-time | in-process WS hub | Redis pub/sub + WS fan-out pods |
| Aggregation | 60 s scheduler | materialised views + incremental rollups |
| API | single node | stateless containers behind load balancer |
| Gateway | 1 agent / site | fleet config service, signed config bundles, OTA updates |
| Retention | 30 d raw / 13 mo daily | 90 d raw, 13 mo hourly, 10 y daily, configurable |

Simulation is a separate data source and can be switched off per site without touching live pipelines.

## 6. Phased delivery mapped to this repository

| Phase | Delivered artifact |
|---|---|
| 1 UI | `web/` complete SCADA SPA, all 18 modules |
| 2 DB/API | `server/db/`, `server/routes/`, RBAC |
| 3 Simulation | `server/services/simulator.js` (20 sites, backfill, faults) |
| 4 Flow/analytics | `EnergyFlow` page, analytics engine + history charts |
| 5 Edge/Modbus | `gateway/agent.js`, `gateway/virtual-device.js`, `gateway/configs/`, `gateway/README.md` |
| 6 Secure MQTT | embedded TLS broker, MQTT ingest, gateway credentials |
| 7 Register config | Modbus UI, templates, connection tester |
| 8 Alarms/reports/RBAC | alarms, reports, users, audit |
| Gateway tests | `tests/` covers Modbus frames, private-target/read-only validation, polling and disk-outbox recovery |
| 9-10 Pilot/rollout | `DEPLOYMENT.md`, hardened config, docs |
