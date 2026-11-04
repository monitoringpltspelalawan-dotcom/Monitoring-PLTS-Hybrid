import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { initDb, closeDb, getDb } from './db/adapter.js';
import { seedDatabase } from './db/seed.js';
import { startSimulator, getSimulator } from './services/simulator.js';
import { startAlarmEngine, stopAlarmEngine } from './services/alarmEngine.js';
import { initRealtime } from './services/realtime.js';
import { startMqttBroker, stopMqttBroker } from './mqtt/broker.js';
import { startReportScheduler, stopReportScheduler } from './services/reports.js';
import { startMaintenance } from './services/maintenance.js';

import authRoutes from './routes/auth.js';
import siteRoutes from './routes/sites.js';
import analyticsRoutes from './routes/analytics.js';
import alarmRoutes from './routes/alarms.js';
import deviceRoutes from './routes/devices.js';
import gatewayRoutes from './routes/gateways.js';
import modbusRoutes from './routes/modbus.js';
import reportRoutes from './routes/reports.js';
import userRoutes from './routes/users.js';
import settingsRoutes from './routes/settings.js';
import systemRoutes from './routes/system.js';
import ingestRoutes from './routes/ingest.js';

const app = express();
app.disable('x-powered-by');
if (config.env === 'production') app.set('trust proxy', 1);

function logJson(level, event, fields = {}) {
  const write = console[level] || console.log;
  write(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }));
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (config.env === 'production' && config.tls.enabled) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

if (config.cors.origin) {
  app.use((req, res, next) => {
    const allowed = config.cors.origin.split(',').map((s) => s.trim());
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Gateway-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });
}

app.use(compression());
app.use(cookieParser());
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path === '/api/system/health') return;
    const ms = Date.now() - started;
    if (config.env === 'production' || ms > 1500 || res.statusCode >= 500) {
      logJson(res.statusCode >= 500 ? 'error' : 'log', 'http.request', {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: ms,
      });
    }
  });
  next();
});

app.get('/api', (req, res) => {
  res.json({
    name: config.appName,
    version: config.version,
    readOnlyMonitoring: true,
    authentication: 'Session cookie or Bearer token via /api/auth/login',
    modules: [
      'auth', 'sites', 'analytics', 'alarms', 'devices', 'gateways', 'modbus',
      'reports', 'users', 'settings', 'system', 'ingest',
    ],
    docs: '/api/system/health',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/ingest', ingestRoutes);
app.use('/api/sites', siteRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/alarms', alarmRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/gateways', gatewayRoutes);
app.use('/api/modbus', modbusRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No API route for ${req.method} ${req.originalUrl}` } });
});

// Built SPA (Vite dev server handles this during development)
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist, {
    index: false,
    maxAge: config.env === 'production' ? '1d' : 0,
    setHeaders: (res, filePath) => {
      if (/\.(js|css|woff2?|png|svg|jpg|webp)$/.test(filePath)) {
        res.setHeader('Cache-Control', config.env === 'production' ? 'public, max-age=31536000, immutable' : 'no-cache');
      }
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/ws') return next();
    return res.sendFile(path.join(config.webDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>CHSMS</title>
      <style>body{background:#07111c;color:#dbe7f3;font-family:system-ui,Segoe UI,sans-serif;padding:40px;line-height:1.6}
      code{background:#0f2233;padding:2px 6px;border-radius:4px;color:#f5a524}a{color:#38bdf8}</style></head><body>
      <h1>Centralized Hybrid Solar Monitoring System</h1>
      <p>The API is running. The web UI has not been built yet.</p>
      <p>Start the Vite dev server with <code>npm run dev</code> or build with <code>npm run build</code>.</p>
      <p>API index: <a href="/api">/api</a> · Health: <a href="/api/system/health">/api/system/health</a></p>
      </body></html>`);
  });
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const code = err.code || (status === 500 ? 'INTERNAL_ERROR' : 'ERROR');
  if (status >= 500) {
    logJson('error', 'http.error', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status,
      message: err.message,
      stack: config.env === 'production' ? err.stack : undefined,
    });
  }
  return res.status(status).json({
    error: {
      code,
      message: status >= 500 && config.env === 'production' ? 'Internal server error' : err.message,
      details: err.details,
    },
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
  });
});

let server;
let shuttingDown = false;

async function start() {
  console.log(`\n=== ${config.appName} v${config.version} ===`);
  const db = await initDb();
  console.log(`[db] ${db.driver} ready${config.databaseUrl ? ' (DATABASE_URL)' : ` (${config.dbFile})`}`);

  if (config.seedOnStart) {
    const result = await seedDatabase({ silent: false });
    if (!result.seeded) console.log(`[seed] ${result.sites} sites present`);
  }

  server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  console.log(`[http] listening on http://${config.host}:${config.port}`);

  initRealtime(server);

  if (config.mqtt.embedded) {
    if (config.env === 'production') await startMqttBroker();
    else {
      try {
        await startMqttBroker();
      } catch (err) {
        console.error('[mqtt] broker failed to start:', err.message);
      }
    }
  }

  if (config.demoMode) {
    await startSimulator(db);
    const sim = getSimulator();
    if (sim) console.log(`[sim] demo simulation active for ${sim.sites.size} sites (DEMO DATA)`);
  }

  await startAlarmEngine(db);
  startReportScheduler();
  startMaintenance();

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[shutdown] received ${signal}`);
    try {
      stopReportScheduler();
      await stopAlarmEngine();
      getSimulator()?.stop();
      await stopMqttBroker();
      await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
      await closeDb();
    } catch (err) {
      console.error('[shutdown] error', err.message);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logJson('error', 'process.unhandled_rejection', {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    logJson('error', 'process.uncaught_exception', { message: err.message, stack: err.stack });
    process.exit(1);
  });

  console.log(`[ready] ${new Date().toISOString()} — read-only monitoring platform`);
}

start().catch((err) => {
  console.error('[fatal] failed to start', err);
  process.exit(1);
});
