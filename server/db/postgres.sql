-- PostgreSQL production schema. Apply with: psql $DATABASE_URL -f server/db/postgres.sql
-- TimescaleDB optional: SELECT create_hypertable('measurements','server_ts', chunk_time_interval => INTERVAL '7 days');

CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT,
  permissions JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT, full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id), region_id TEXT REFERENCES regions(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE', timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  last_login_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS user_sites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL, PRIMARY KEY (user_id, site_id)
);
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  region_id TEXT REFERENCES regions(id), location TEXT, address TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta', pv_capacity_kwp REAL NOT NULL DEFAULT 0,
  inverter_capacity_kw REAL NOT NULL DEFAULT 0, bess_capacity_kwh REAL NOT NULL DEFAULT 0,
  bess_power_kw REAL NOT NULL DEFAULT 0, inverter_count INTEGER NOT NULL DEFAULT 0,
  battery_rack_count INTEGER NOT NULL DEFAULT 0, meter_count INTEGER NOT NULL DEFAULT 0,
  grid_connection_type TEXT, grid_provider TEXT DEFAULT 'PLN', grid_voltage_kv REAL, grid_capacity_kva REAL,
  generator_count INTEGER NOT NULL DEFAULT 0, generator_capacity_kw REAL DEFAULT 0, commissioning_date DATE,
  status TEXT NOT NULL DEFAULT 'ONLINE', comm_status TEXT NOT NULL DEFAULT 'ONLINE', last_seen_at TIMESTAMPTZ,
  data_source TEXT NOT NULL DEFAULT 'DEMO', sim_profile JSONB, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sites_region ON sites(region_id);
CREATE TABLE IF NOT EXISTS gateways (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE, name TEXT NOT NULL,
  serial TEXT UNIQUE, hardware TEXT, firmware TEXT, ip_address TEXT, status TEXT NOT NULL DEFAULT 'OFFLINE',
  last_seen_at TIMESTAMPTZ, mqtt_client_id TEXT, token_hash TEXT, token_hint TEXT, cert_fingerprint TEXT,
  buffer_backlog INTEGER DEFAULT 0, latency_ms REAL DEFAULT 0, cpu_pct REAL DEFAULT 0, mem_pct REAL DEFAULT 0,
  uptime_sec BIGINT DEFAULT 0, version TEXT, data_source TEXT NOT NULL DEFAULT 'DEMO',
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS device_models (
  id TEXT PRIMARY KEY, manufacturer TEXT NOT NULL, model TEXT NOT NULL, device_type TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'MODBUS_TCP', description TEXT, register_template JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  gateway_id TEXT REFERENCES gateways(id) ON DELETE SET NULL, model_id TEXT REFERENCES device_models(id),
  name TEXT NOT NULL, device_type TEXT NOT NULL, manufacturer TEXT, model TEXT, serial TEXT,
  ip_address TEXT, port INTEGER DEFAULT 502, unit_id INTEGER DEFAULT 1, firmware TEXT,
  status TEXT NOT NULL DEFAULT 'UNKNOWN', last_seen_at TIMESTAMPTZ, data_source TEXT NOT NULL DEFAULT 'DEMO',
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_site ON devices(site_id);
CREATE TABLE IF NOT EXISTS bess_racks (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, device_id TEXT, name TEXT NOT NULL,
  capacity_kwh REAL NOT NULL DEFAULT 0, module_count INTEGER DEFAULT 0, status TEXT DEFAULT 'ONLINE',
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS modbus_registers (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  parameter_id TEXT NOT NULL, name TEXT NOT NULL, function_code INTEGER NOT NULL DEFAULT 3,
  address INTEGER NOT NULL, register_type TEXT NOT NULL DEFAULT 'HOLDING', data_type TEXT NOT NULL DEFAULT 'UINT16',
  word_order TEXT NOT NULL DEFAULT 'BIG', byte_order TEXT NOT NULL DEFAULT 'BIG', scale REAL NOT NULL DEFAULT 1,
  offset REAL NOT NULL DEFAULT 0, unit TEXT, poll_interval_sec INTEGER NOT NULL DEFAULT 10,
  writable BOOLEAN NOT NULL DEFAULT false, description TEXT, enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, UNIQUE (device_id, parameter_id)
);
CREATE TABLE IF NOT EXISTS measurements (
  id BIGSERIAL, site_id TEXT NOT NULL, gateway_id TEXT, device_id TEXT, parameter_id TEXT NOT NULL,
  value DOUBLE PRECISION, unit TEXT, device_ts TIMESTAMPTZ NOT NULL, server_ts TIMESTAMPTZ NOT NULL,
  quality TEXT NOT NULL DEFAULT 'GOOD', seq BIGINT, data_source TEXT NOT NULL DEFAULT 'DEMO',
  PRIMARY KEY (id, server_ts)
) PARTITION BY RANGE (server_ts);
-- Bootstrap partitions (the maintenance job creates future months automatically).
DO $$ DECLARE start_date date := date_trunc('month', now())::date - interval '2 months';
BEGIN
  FOR i IN 0..4 LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS measurements_%s PARTITION OF measurements FOR VALUES FROM (%L) TO (%L)',
      to_char(start_date + (i || ' months')::interval, 'YYYY_MM'),
      start_date + (i || ' months')::interval,
      start_date + ((i + 1) || ' months')::interval);
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS idx_meas_site_param_ts ON measurements(site_id, parameter_id, server_ts DESC);
CREATE INDEX IF NOT EXISTS idx_meas_device_ts ON measurements(device_id, server_ts DESC);
CREATE INDEX IF NOT EXISTS idx_meas_ts ON measurements USING BRIN(server_ts);
CREATE TABLE IF NOT EXISTS energy_hourly (
  site_id TEXT NOT NULL, hour TIMESTAMPTZ NOT NULL, pv_kwh REAL NOT NULL DEFAULT 0, charge_kwh REAL NOT NULL DEFAULT 0,
  discharge_kwh REAL NOT NULL DEFAULT 0, load_kwh REAL NOT NULL DEFAULT 0, import_kwh REAL NOT NULL DEFAULT 0,
  export_kwh REAL NOT NULL DEFAULT 0, generator_kwh REAL NOT NULL DEFAULT 0, peak_load_kw REAL NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ, PRIMARY KEY (site_id, hour)
);
CREATE TABLE IF NOT EXISTS site_energy_daily (
  site_id TEXT NOT NULL, day DATE NOT NULL, pv_kwh REAL NOT NULL DEFAULT 0, charge_kwh REAL NOT NULL DEFAULT 0,
  discharge_kwh REAL NOT NULL DEFAULT 0, load_kwh REAL NOT NULL DEFAULT 0, import_kwh REAL NOT NULL DEFAULT 0,
  export_kwh REAL NOT NULL DEFAULT 0, generator_kwh REAL NOT NULL DEFAULT 0, peak_load_kw REAL NOT NULL DEFAULT 0,
  peak_pv_kw REAL NOT NULL DEFAULT 0, performance_ratio REAL, availability_pct REAL, updated_at TIMESTAMPTZ,
  PRIMARY KEY (site_id, day)
);
CREATE TABLE IF NOT EXISTS alarms (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, site_id TEXT NOT NULL, device_id TEXT, severity TEXT NOT NULL,
  category TEXT, title TEXT NOT NULL, message TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', value REAL, threshold REAL,
  triggered_at TIMESTAMPTZ NOT NULL, last_seen_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ, acknowledged_by TEXT,
  resolved_at TIMESTAMPTZ, resolved_by TEXT, resolution_note TEXT, data_source TEXT NOT NULL DEFAULT 'DEMO'
);
CREATE INDEX IF NOT EXISTS idx_alarms_status ON alarms(status, severity);
CREATE TABLE IF NOT EXISTS alarm_rules (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, parameter_id TEXT NOT NULL, name TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'WARNING', operator TEXT NOT NULL DEFAULT '>', threshold REAL NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0, category TEXT, enabled BOOLEAN NOT NULL DEFAULT true, site_id TEXT,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, site_id TEXT, device_id TEXT, type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFO', message TEXT NOT NULL, user_id TEXT, data_source TEXT NOT NULL DEFAULT 'DEMO'
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
CREATE TABLE IF NOT EXISTS gateway_health (
  id TEXT PRIMARY KEY, gateway_id TEXT NOT NULL, site_id TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL,
  online BOOLEAN NOT NULL DEFAULT true, latency_ms REAL, backlog INTEGER, cpu_pct REAL, mem_pct REAL,
  uptime_sec BIGINT, firmware TEXT
);
CREATE INDEX IF NOT EXISTS idx_health_gw_ts ON gateway_health(gateway_id, ts DESC);
CREATE TABLE IF NOT EXISTS comm_logs (
  id TEXT PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, gateway_id TEXT, site_id TEXT, direction TEXT, protocol TEXT,
  topic TEXT, status TEXT, bytes INTEGER, latency_ms REAL, error TEXT
);
CREATE INDEX IF NOT EXISTS idx_comm_ts ON comm_logs(ts DESC);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, user_id TEXT, username TEXT, action TEXT NOT NULL,
  entity TEXT, entity_id TEXT, details TEXT, ip TEXT, user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts DESC);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  ip TEXT, user_agent TEXT, revoked BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS tariffs (
  id TEXT PRIMARY KEY, site_id TEXT, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'ENERGY',
  rate REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'IDR', effective_from DATE, created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS site_configs (site_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, updated_at TIMESTAMPTZ, PRIMARY KEY (site_id, key));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS ingest_messages (
  id TEXT PRIMARY KEY, gateway_id TEXT NOT NULL, seq BIGINT, received_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACCEPTED', rows INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ingest_received ON ingest_messages(received_at DESC);
CREATE TABLE IF NOT EXISTS report_schedules (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, report_type TEXT NOT NULL, format TEXT NOT NULL DEFAULT 'PDF',
  frequency TEXT NOT NULL DEFAULT 'MONTHLY', site_ids TEXT, recipients TEXT, enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ, next_run_at TIMESTAMPTZ, created_by TEXT, created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS generated_reports (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, report_type TEXT NOT NULL, format TEXT NOT NULL,
  period_start TIMESTAMPTZ, period_end TIMESTAMPTZ, site_ids TEXT, file_path TEXT, size_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'READY', created_by TEXT, created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, alarm_id TEXT, channel TEXT NOT NULL, target TEXT, status TEXT NOT NULL DEFAULT 'QUEUED',
  message TEXT, created_at TIMESTAMPTZ NOT NULL, sent_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS site_live_state (site_id TEXT PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL);
