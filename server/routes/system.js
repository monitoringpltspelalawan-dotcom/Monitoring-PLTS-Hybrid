import express from 'express';
import os from 'node:os';
import { getDb } from '../db/adapter.js';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { getBrokerStatus } from '../mqtt/broker.js';
import { simulatorStats } from '../services/simulator.js';
import { alarmEngineStats } from '../services/alarmEngine.js';
import { realtimeStats } from '../services/realtime.js';
import { maintenanceStats } from '../services/maintenance.js';
import { config } from '../config.js';
import { nowIso, hoursAgoIso } from '../lib/time.js';

const router = express.Router();

router.get(
  '/health',
  asyncHandler(async (req, res) => {
    let database = { ok: false };
    try {
      const db = getDb();
      const row = await db.get('SELECT 1 AS ok');
      database = { ok: row?.ok === 1, driver: db.driver };
    } catch (err) {
      database = { ok: false, error: err.message };
    }
    const mqtt = getBrokerStatus();
    const sim = simulatorStats();
    const healthy = database.ok && (!config.mqtt.embedded || mqtt.running);
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      app: config.appName,
      version: config.version,
      environment: config.env,
      uptimeSec: Math.round(process.uptime()),
      timestamp: nowIso(),
      database: database.ok ? database : { ok: false },
      mqtt: { running: mqtt.running, clients: mqtt.clients || 0 },
      simulation: { running: sim.running, sites: sim.sites },
      readOnly: true,
    });
  }),
);

router.use(requireAuth);

router.get(
  '/info',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const counts = {};
    for (const table of ['sites', 'devices', 'gateways', 'modbus_registers', 'measurements', 'alarms', 'events', 'users', 'generated_reports']) {
      const row = await db.get(`SELECT COUNT(*) AS c FROM ${table}`);
      counts[table] = Number(row.c);
    }
    res.json({
      app: config.appName,
      version: config.version,
      environment: config.env,
      database: { driver: db.driver, production: db.driver === 'postgres' },
      simulation: simulatorStats(),
      mqtt: getBrokerStatus(),
      realtime: realtimeStats(),
      alarms: alarmEngineStats(),
      maintenance: maintenanceStats(),
      retention: config.retention,
      counts,
      features: {
        readOnlyMonitoring: true, demoMode: config.demoMode, multiSite: true,
        rbac: true, auditTrail: true, mqttTls: true, modbusTemplates: true,
        reports: ['PDF', 'XLSX', 'CSV'], schedules: true, websocket: true,
      },
    });
  }),
);

router.get(
  '/stats',
  requirePermission('site:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const mem = process.memoryUsage();
    const recentMeasurements = await db.get('SELECT COUNT(*) AS c FROM measurements WHERE server_ts >= ?', [hoursAgoIso(1)]);
    const ingest = await db.get('SELECT COUNT(*) AS c FROM ingest_messages WHERE received_at >= ?', [hoursAgoIso(1)]);
    const ingestErrors = await db.get('SELECT COUNT(*) AS c FROM ingest_messages WHERE received_at >= ? AND status != ?', [hoursAgoIso(1), 'ACCEPTED']);
    const gatewayRows = await db.all('SELECT status, COUNT(*) AS c FROM gateways GROUP BY status');
    const alarmRows = await db.all("SELECT severity, COUNT(*) AS c FROM alarms WHERE status != 'RESOLVED' GROUP BY severity");
    const health = await db.all(
      `SELECT gateway_id, AVG(latency_ms) AS latency, MAX(backlog) AS backlog, MAX(ts) AS last_ts
       FROM gateway_health WHERE ts >= ? GROUP BY gateway_id`, [hoursAgoIso(24)],
    );
    res.json({
      process: {
        pid: process.pid, uptimeSec: Math.round(process.uptime()), node: process.version,
        platform: process.platform, arch: process.arch,
        memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576), heapTotal: Math.round(mem.heapTotal / 1048576) },
        cpuLoad: os.loadavg().map((n) => Math.round(n * 100) / 100),
        hostname: os.hostname(),
      },
      database: { driver: db.driver, recentMeasurements: Number(recentMeasurements.c) },
      ingest: {
        messagesLastHour: Number(ingest.c), failuresLastHour: Number(ingestErrors.c),
        lastHourSuccessPct: Number(ingest.c) ? Math.round((1 - Number(ingestErrors.c) / Number(ingest.c)) * 1000) / 10 : 100,
      },
      gateways: Object.fromEntries(gatewayRows.map((r) => [r.status, Number(r.c)])),
      alarms: Object.fromEntries(alarmRows.map((r) => [r.severity, Number(r.c)])),
      gatewayHealth: health,
      mqtt: getBrokerStatus(),
      simulation: simulatorStats(),
      realtime: realtimeStats(),
      alarmsEngine: alarmEngineStats(),
      maintenance: maintenanceStats(),
      timestamp: nowIso(),
    });
  }),
);

router.get(
  '/data-quality',
  requirePermission('site:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const allowedSites = req.user.role === 'SUPER_ADMIN' || req.user.role === 'CORPORATE_ADMIN'
      ? await db.all('SELECT id, code, name, last_seen_at, comm_status, data_source, status FROM sites ORDER BY code')
      : req.user.siteIds.length
        ? await db.all(`SELECT id, code, name, last_seen_at, comm_status, data_source, status FROM sites WHERE id IN (${req.user.siteIds.map(() => '?').join(',')}) ORDER BY code`, req.user.siteIds)
        : [];
    const ids = allowedSites.map((s) => s.id);
    const measurementRows = ids.length
      ? await db.all(
          `SELECT site_id, COUNT(*) AS samples, MAX(server_ts) AS last_ts,
                  SUM(CASE WHEN quality = 'GOOD' THEN 1 ELSE 0 END) AS good
           FROM measurements WHERE site_id IN (${ids.map(() => '?').join(',')}) AND server_ts >= ? GROUP BY site_id`,
          [...ids, hoursAgoIso(2)],
        )
      : [];
    const map = new Map(measurementRows.map((r) => [r.site_id, r]));
    const now = Date.now();
    const quality = allowedSites.map((s) => {
      const m = map.get(s.id);
      const ageSec = s.last_seen_at ? Math.round((now - new Date(s.last_seen_at).getTime()) / 1000) : null;
      const goodPct = m && Number(m.samples) ? Math.round((Number(m.good) / Number(m.samples)) * 1000) / 10 : null;
      return {
        siteId: s.id, code: s.code, name: s.name, dataSource: s.data_source, status: s.status,
        commStatus: s.comm_status, lastSeenAt: s.last_seen_at, ageSec,
        samplesLast2h: m ? Number(m.samples) : 0, goodPct,
        quality: !m ? 'NO_DATA' : ageSec > 600 ? 'STALE' : goodPct >= 98 ? 'GOOD' : goodPct >= 90 ? 'DEGRADED' : 'BAD',
      };
    });
    res.json({
      sites: quality,
      summary: {
        total: quality.length,
        good: quality.filter((q) => q.quality === 'GOOD').length,
        degraded: quality.filter((q) => q.quality === 'DEGRADED' || q.quality === 'STALE').length,
        noData: quality.filter((q) => q.quality === 'NO_DATA').length,
        bad: quality.filter((q) => q.quality === 'BAD').length,
      },
    });
  }),
);

export default router;
