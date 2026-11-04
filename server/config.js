import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createSecureContext } from 'node:tls';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const bool = (v, d = false) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v)));
const isProduction = (process.env.NODE_ENV || 'development') === 'production';

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  appName: 'Centralized Hybrid Solar Monitoring System',
  version: '1.0.0',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  webDist: path.resolve(ROOT, 'web', 'dist'),
  // 'sqlite' by default (zero-dependency local runtime); set DATABASE_URL for PostgreSQL
  databaseUrl: process.env.DATABASE_URL || '',
  dbFile: process.env.DB_FILE || '', // resolved after dataDir
  demoMode: bool(process.env.DEMO_MODE, !isProduction),
  seedOnStart: bool(process.env.SEED_ON_START, !isProduction),
  simulationIntervalMs: Number(process.env.SIM_INTERVAL_MS || 3000),
  measurementIntervalSec: Number(process.env.MEASUREMENT_INTERVAL_SEC || 60),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
  mqtt: {
    embedded: bool(process.env.MQTT_EMBEDDED, true),
    port: Number(process.env.MQTT_PORT || 1883),
    tlsPort: Number(process.env.MQTT_TLS_PORT || 8883),
    wsPort: Number(process.env.MQTT_WS_PORT || 8083),
    host: process.env.MQTT_HOST || '127.0.0.1',
    url: process.env.MQTT_URL || '',
  },
  tls: {
    enabled: bool(process.env.TLS_ENABLED, false),
    cert: process.env.TLS_CERT || '',
    key: process.env.TLS_KEY || '',
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '',
  },
  ingest: {
    tokenTtlHours: Number(process.env.GATEWAY_TOKEN_TTL_HOURS || 24 * 365),
    maxBatch: Number(process.env.INGEST_MAX_BATCH || 2000),
    rateLimitPerMin: Number(process.env.INGEST_RATE_LIMIT || 6000),
  },
  retention: {
    measurementsDays: Number(process.env.RETENTION_MEASUREMENT_DAYS || 30),
    ingestMessagesDays: Number(process.env.RETENTION_INGEST_DAYS || 7),
    auditDays: Number(process.env.RETENTION_AUDIT_DAYS || 365),
  },
  demo: {
    users: {
      admin: { username: 'admin', password: process.env.DEMO_ADMIN_PASSWORD || 'Admin@12345' },
      operator: { username: 'operator', password: process.env.DEMO_OPERATOR_PASSWORD || 'Operator@123' },
      viewer: { username: 'viewer', password: process.env.DEMO_VIEWER_PASSWORD || 'Viewer@12345' },
    },
  },
};

config.dbFile = process.env.DB_FILE || path.join(config.dataDir, 'chsms.db');
config.secretFile = path.join(config.dataDir, '.session-secret');
config.reportDir = path.join(config.dataDir, 'reports');
config.certDir = path.join(config.dataDir, 'certs');

function validateProductionConfig() {
  const missing = [];
  if (!config.databaseUrl.startsWith('postgres://') && !config.databaseUrl.startsWith('postgresql://')) missing.push('DATABASE_URL must use PostgreSQL');
  else {
    try {
      const databaseUrl = new URL(config.databaseUrl);
      if (!databaseUrl.password || databaseUrl.password.length < 32 || /replace|example/i.test(databaseUrl.password)) {
        missing.push('DATABASE_URL must contain a non-placeholder PostgreSQL password of at least 32 characters');
      }
    } catch {
      missing.push('DATABASE_URL must be a valid PostgreSQL connection URL');
    }
  }
  if (config.demoMode) missing.push('DEMO_MODE must be false');
  if (config.seedOnStart) missing.push('SEED_ON_START must be false');
  if (!bool(process.env.TLS_ENABLED, false)) missing.push('TLS_ENABLED must be true behind the HTTPS reverse proxy');
  if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET, 'utf8') < 32 || /replace|example/i.test(process.env.SESSION_SECRET)) {
    missing.push('SESSION_SECRET must be a non-placeholder value containing at least 32 bytes of cryptographically random data');
  }
  if (!config.mqtt.embedded) missing.push('MQTT_EMBEDDED must be true for database-backed gateway authentication');
  if (!config.mqtt.url || !config.mqtt.url.startsWith('mqtts://')) missing.push('MQTT_URL must be a public mqtts:// URL');
  if (!config.tls.cert || !fs.existsSync(config.tls.cert)) missing.push('TLS_CERT must point to an existing MQTT TLS certificate');
  if (!config.tls.key || !fs.existsSync(config.tls.key)) missing.push('TLS_KEY must point to an existing MQTT TLS private key');
  if (config.mqtt.url) {
    try {
      const mqttUrl = new URL(config.mqtt.url);
      if (mqttUrl.protocol !== 'mqtts:' || ['localhost', '127.0.0.1', '::1'].includes(mqttUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase())) {
        missing.push('MQTT_URL must use mqtts:// and a non-loopback public hostname');
      }
    } catch {
      missing.push('MQTT_URL must be a valid absolute mqtts:// URL');
    }
  }
  if (config.tls.cert && config.tls.key && fs.existsSync(config.tls.cert) && fs.existsSync(config.tls.key)) {
    try {
      createSecureContext({ cert: fs.readFileSync(config.tls.cert), key: fs.readFileSync(config.tls.key), minVersion: 'TLSv1.2' });
    } catch {
      missing.push('TLS_CERT and TLS_KEY must be readable and form a valid matching TLS key pair');
    }
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) missing.push('PORT must be a valid TCP port');
  if (missing.length) {
    throw new Error(`Invalid production configuration:\n- ${missing.join('\n- ')}`);
  }
}

if (isProduction) validateProductionConfig();

for (const dir of [config.dataDir, config.reportDir, config.certDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (isProduction) throw new Error('SESSION_SECRET is required in production');
  try {
    return fs.readFileSync(config.secretFile, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(config.secretFile, s, { mode: 0o600 });
    return s;
  }
}
config.sessionSecret = loadSecret();

export const isPostgres = Boolean(config.databaseUrl);
