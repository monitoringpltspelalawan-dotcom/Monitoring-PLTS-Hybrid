import express from 'express';
import { getDb } from '../db/adapter.js';
import { asyncHandler, badRequest, notFound, conflict } from '../lib/errors.js';
import { requireAuth, requirePermission, audit } from '../middleware/auth.js';
import { allowedSites, numberField, parsePagination } from './helpers.js';
import { gatewayBootstrap } from '../mqtt/broker.js';
import { invalidateGatewayCache } from '../services/ingest.js';
import { nowIso } from '../lib/time.js';
import { randomToken, tokenHash, uid } from '../lib/util.js';
import { config } from '../config.js';

const router = express.Router();
router.use(requireAuth);

async function permittedSiteIds(req) {
  return (await allowedSites(req)).map((s) => s.id);
}

router.get(
  '/',
  requirePermission('gateway:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    if (!ids.length) return res.json({ gateways: [], total: 0 });
    const params = [...ids];
    let where = `WHERE g.site_id IN (${ids.map(() => '?').join(',')})`;
    if (req.query.siteId && ids.includes(req.query.siteId)) { where += ' AND g.site_id = ?'; params.push(req.query.siteId); }
    if (req.query.status) { where += ' AND g.status = ?'; params.push(String(req.query.status).toUpperCase()); }
    if (req.query.search) {
      where += ' AND (g.name LIKE ? OR g.serial LIKE ? OR g.id LIKE ? OR s.code LIKE ?)';
      const q = `%${req.query.search}%`; params.push(q, q, q, q);
    }
    const gateways = await db.all(
      `SELECT g.id, g.site_id, g.name, g.serial, g.hardware, g.firmware, g.ip_address, g.status, g.last_seen_at,
              g.mqtt_client_id, g.token_hint, g.cert_fingerprint, g.buffer_backlog, g.latency_ms, g.cpu_pct,
              g.mem_pct, g.uptime_sec, g.version, g.data_source, g.created_at, g.updated_at,
              s.code AS site_code, s.name AS site_name, s.location AS site_location, r.name AS region_name
       FROM gateways g JOIN sites s ON s.id = g.site_id LEFT JOIN regions r ON r.id = s.region_id
       ${where} ORDER BY s.code`, params,
    );
    const summary = { total: gateways.length, ONLINE: 0, OFFLINE: 0, DEGRADED: 0, backlog: 0, avgLatencyMs: 0 };
    let latencySum = 0;
    for (const g of gateways) {
      summary[g.status] = (summary[g.status] || 0) + 1;
      summary.backlog += g.buffer_backlog || 0;
      latencySum += g.latency_ms || 0;
    }
    summary.avgLatencyMs = gateways.length ? Math.round(latencySum / gateways.length) : 0;
    res.json({
      gateways, total: gateways.length, summary,
      broker: {
        tlsPort: config.mqtt.tlsPort, plainPort: config.mqtt.port,
        tlsRequired: true, outboundOnly: true, readOnly: true,
      },
    });
  }),
);

router.get(
  '/:id',
  requirePermission('gateway:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const gateway = await db.get(
      `SELECT g.id, g.site_id, g.name, g.serial, g.hardware, g.firmware, g.ip_address, g.status, g.last_seen_at,
              g.mqtt_client_id, g.token_hint, g.cert_fingerprint, g.buffer_backlog, g.latency_ms, g.cpu_pct,
              g.mem_pct, g.uptime_sec, g.version, g.data_source, g.created_at, g.updated_at,
              s.code AS site_code, s.name AS site_name, s.location AS site_location
       FROM gateways g JOIN sites s ON s.id = g.site_id WHERE g.id = ?`, [req.params.id],
    );
    if (!gateway || !ids.includes(gateway.site_id)) throw notFound('Gateway not found');
    const devices = await db.all('SELECT id, name, device_type, status, ip_address, port, unit_id, last_seen_at FROM devices WHERE gateway_id = ? ORDER BY name', [gateway.id]);
    const health = await db.all('SELECT * FROM gateway_health WHERE gateway_id = ? ORDER BY ts DESC LIMIT 48', [gateway.id]);
    const comm = await db.all('SELECT * FROM comm_logs WHERE gateway_id = ? ORDER BY ts DESC LIMIT 30', [gateway.id]);
    res.json({ gateway, devices, health: health.reverse(), comm });
  }),
);

router.get(
  '/:id/health',
  requirePermission('gateway:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const gateway = await db.get('SELECT * FROM gateways WHERE id = ?', [req.params.id]);
    if (!gateway || !ids.includes(gateway.site_id)) throw notFound('Gateway not found');
    const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
    const rows = await db.all('SELECT * FROM gateway_health WHERE gateway_id = ? AND ts >= ? ORDER BY ts', [gateway.id, new Date(Date.now() - hours * 3600_000).toISOString()]);
    const online = rows.filter((r) => r.online).length;
    const latency = rows.map((r) => r.latency_ms).filter((v) => v != null);
    res.json({
      gatewayId: gateway.id, hours, samples: rows.length,
      availabilityPct: rows.length ? Math.round((online / rows.length) * 1000) / 10 : null,
      avgLatencyMs: latency.length ? Math.round(latency.reduce((a, b) => a + b, 0) / latency.length) : null,
      maxBacklog: rows.length ? Math.max(...rows.map((r) => r.backlog || 0)) : 0,
      series: rows.map((r) => ({ ts: r.ts, online: Boolean(r.online), latencyMs: r.latency_ms, backlog: r.backlog, cpuPct: r.cpu_pct, memPct: r.mem_pct })),
    });
  }),
);

router.get(
  '/:id/config',
  requirePermission('gateway:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const gateway = await db.get('SELECT * FROM gateways WHERE id = ?', [req.params.id]);
    if (!gateway || !ids.includes(gateway.site_id)) throw notFound('Gateway not found');
    const bootstrap = await gatewayBootstrap(gateway);
    res.json({
      ...bootstrap,
      tokenHint: gateway.token_hint,
      security: {
        outboundOnly: true, tlsRequired: true, plaintextLoopbackOnly: true,
        modbusPortExposedPublicly: false, readOnlyMonitoring: true,
      },
    });
  }),
);

router.get(
  '/:id/comm-logs',
  requirePermission('gateway:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const gateway = await db.get('SELECT * FROM gateways WHERE id = ?', [req.params.id]);
    if (!gateway || !ids.includes(gateway.site_id)) throw notFound('Gateway not found');
    const { pageSize, offset, page } = parsePagination(req.query);
    const total = await db.get('SELECT COUNT(*) AS c FROM comm_logs WHERE gateway_id = ?', [gateway.id]);
    const logs = await db.all('SELECT * FROM comm_logs WHERE gateway_id = ? ORDER BY ts DESC LIMIT ? OFFSET ?', [gateway.id, pageSize, offset]);
    res.json({ logs, total: Number(total.c), page, pageSize });
  }),
);

router.post(
  '/',
  requirePermission('gateway:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const body = req.body || {};
    if (!body.siteId || !ids.includes(body.siteId)) throw badRequest('A valid authorized siteId is required');
    if (!body.name) throw badRequest('Gateway name is required');
    const site = await db.get('SELECT * FROM sites WHERE id = ?', [body.siteId]);
    if (!site) throw notFound('Site not found');
    const existing = await db.get('SELECT id FROM gateways WHERE site_id = ?', [site.id]);
    if (existing) throw conflict('A gateway already exists for this site');
    const id = body.id || `GW-${site.code}-${String(Date.now()).slice(-4)}`;
    const token = randomToken(24);
    const now = nowIso();
    await db.run(
      `INSERT INTO gateways (id, site_id, name, serial, hardware, firmware, ip_address, status, last_seen_at, mqtt_client_id, token_hash, token_hint, buffer_backlog, latency_ms, cpu_pct, mem_pct, uptime_sec, version, data_source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, site.id, body.name, body.serial || `EG-${Date.now()}`, body.hardware || 'Edge Gateway', body.firmware || 'edge-1.4.2',
        body.ipAddress || null, 'OFFLINE', null, body.mqttClientId || `gw-${site.code.toLowerCase()}`, tokenHash(token),
        `${token.slice(0, 8)}…${token.slice(-4)}`, 0, 0, 0, 0, 0, '1.4.2', 'LIVE', now, now],
    );
    await db.run('UPDATE sites SET data_source = ?, updated_at = ? WHERE id = ?', ['LIVE', now, site.id]);
    invalidateGatewayCache(id);
    await audit(req, 'CREATE', 'gateway', id, { siteId: site.id, name: body.name });
    res.status(201).json({
      gateway: await db.get('SELECT id, site_id, name, serial, status, token_hint, created_at FROM gateways WHERE id = ?', [id]),
      token,
      warning: 'Store this token securely. It is shown only once and is required by the edge agent.',
    });
  }),
);

router.patch(
  '/:id',
  requirePermission('gateway:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const gateway = await db.get('SELECT * FROM gateways WHERE id = ?', [req.params.id]);
    if (!gateway || !ids.includes(gateway.site_id)) throw notFound('Gateway not found');
    const map = { name: 'name', serial: 'serial', hardware: 'hardware', firmware: 'firmware', ipAddress: 'ip_address', mqttClientId: 'mqtt_client_id', status: 'status' };
    const sets = []; const params = [];
    for (const [k, col] of Object.entries(map)) {
      if (req.body?.[k] === undefined) continue;
      sets.push(`${col} = ?`); params.push(req.body[k]);
    }
    if (!sets.length) throw badRequest('No supported fields supplied');
    sets.push('updated_at = ?'); params.push(nowIso(), gateway.id);
    await db.run(`UPDATE gateways SET ${sets.join(', ')} WHERE id = ?`, params);
    invalidateGatewayCache(gateway.id);
    await audit(req, 'UPDATE', 'gateway', gateway.id, { fields: Object.keys(req.body || {}) });
    res.json({ gateway: await db.get('SELECT * FROM gateways WHERE id = ?', [gateway.id]) });
  }),
);

router.post(
  '/:id/rotate-token',
  requirePermission('gateway:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const gateway = await db.get('SELECT * FROM gateways WHERE id = ?', [req.params.id]);
    if (!gateway || !ids.includes(gateway.site_id)) throw notFound('Gateway not found');
    const token = randomToken(24);
    await db.run('UPDATE gateways SET token_hash = ?, token_hint = ?, updated_at = ? WHERE id = ?', [
      tokenHash(token), `${token.slice(0, 8)}…${token.slice(-4)}`, nowIso(), gateway.id,
    ]);
    invalidateGatewayCache(gateway.id);
    await audit(req, 'ROTATE_TOKEN', 'gateway', gateway.id, {});
    res.json({ token, tokenHint: `${token.slice(0, 8)}…${token.slice(-4)}`, warning: 'Existing agent credentials stop working immediately.' });
  }),
);

router.delete(
  '/:id',
  requirePermission('gateway:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const gateway = await db.get('SELECT * FROM gateways WHERE id = ?', [req.params.id]);
    if (!gateway || !ids.includes(gateway.site_id)) throw notFound('Gateway not found');
    await db.run('DELETE FROM gateways WHERE id = ?', [gateway.id]);
    invalidateGatewayCache(gateway.id);
    await audit(req, 'DELETE', 'gateway', gateway.id, { name: gateway.name });
    res.json({ ok: true });
  }),
);

export default router;
