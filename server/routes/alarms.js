import express from 'express';
import { getDb } from '../db/adapter.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { requireAuth, requirePermission, audit } from '../middleware/auth.js';
import { allowedSites, parseDayRange, parsePagination } from './helpers.js';
import { nowIso, daysAgoIso } from '../lib/time.js';
import { uid, safeJsonParse } from '../lib/util.js';

const router = express.Router();
router.use(requireAuth);

const SEVERITIES = ['CRITICAL', 'WARNING', 'INFO'];
const STATUSES = ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'];

async function scopedSiteIds(req) {
  const sites = await allowedSites(req);
  return sites.map((s) => s.id);
}

function siteClause(ids, column = 'a.site_id') {
  if (!ids.length) return { sql: ' AND 1 = 0', params: [] };
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

router.get(
  '/',
  requirePermission('alarm:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await scopedSiteIds(req);
    const { page, pageSize, offset } = parsePagination(req.query);
    const params = [];
    let where = 'WHERE 1 = 1';
    const scope = siteClause(ids);
    where += scope.sql; params.push(...scope.params);
    if (req.query.severity) {
      const list = String(req.query.severity).toUpperCase().split(',').filter((s) => SEVERITIES.includes(s));
      if (list.length) { where += ` AND a.severity IN (${list.map(() => '?').join(',')})`; params.push(...list); }
    }
    if (req.query.status) {
      const list = String(req.query.status).toUpperCase().split(',').filter((s) => STATUSES.includes(s));
      if (list.length) {
        if (list.includes('OPEN')) where += " AND a.status != 'RESOLVED'";
        else { where += ` AND a.status IN (${list.map(() => '?').join(',')})`; params.push(...list); }
      }
    } else if (req.query.open === 'true') {
      where += " AND a.status != 'RESOLVED'";
    }
    if (req.query.siteId) {
      const requested = String(req.query.siteId).split(',');
      const permitted = requested.filter((id) => ids.includes(id));
      if (!permitted.length) throw notFound('Site not found');
      where += ` AND a.site_id IN (${permitted.map(() => '?').join(',')})`;
      params.push(...permitted);
    }
    if (req.query.category) { where += ' AND a.category = ?'; params.push(req.query.category); }
    if (req.query.code) { where += ' AND a.code = ?'; params.push(req.query.code); }
    if (req.query.search) {
      where += ' AND (a.title LIKE ? OR a.message LIKE ? OR a.code LIKE ?)';
      const q = `%${req.query.search}%`; params.push(q, q, q);
    }
    if (req.query.from) { where += ' AND a.triggered_at >= ?'; params.push(`${req.query.from}T00:00:00.000Z`); }
    if (req.query.to) { where += ' AND a.triggered_at <= ?'; params.push(`${req.query.to}T23:59:59.999Z`); }
    if (req.query.dataSource) { where += ' AND a.data_source = ?'; params.push(String(req.query.dataSource).toUpperCase()); }

    const totalRow = await db.get(`SELECT COUNT(*) AS c FROM alarms a ${where}`, params);
    const rows = await db.all(
      `SELECT a.*, s.code AS site_code, s.name AS site_name, d.name AS device_name
       FROM alarms a LEFT JOIN sites s ON s.id = a.site_id LEFT JOIN devices d ON d.id = a.device_id
       ${where} ORDER BY
         CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
         CASE a.status WHEN 'ACTIVE' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END,
         a.triggered_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const summary = await db.all(
      `SELECT a.severity, a.status, COUNT(*) AS c FROM alarms a ${where} GROUP BY a.severity, a.status`,
      params,
    );
    const counts = { CRITICAL: 0, WARNING: 0, INFO: 0, total: Number(totalRow.c), byStatus: { ACTIVE: 0, ACKNOWLEDGED: 0, RESOLVED: 0 } };
    for (const r of summary) {
      counts[r.severity] = (counts[r.severity] || 0) + Number(r.c);
      counts.byStatus[r.status] = (counts.byStatus[r.status] || 0) + Number(r.c);
    }
    res.json({ alarms: rows, total: Number(totalRow.c), page, pageSize, counts });
  }),
);

router.get(
  '/stats',
  requirePermission('alarm:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await scopedSiteIds(req);
    const scope = siteClause(ids);
    const rows = await db.all(
      `SELECT severity, status, category, COUNT(*) AS c FROM alarms a WHERE 1 = 1 ${scope.sql} GROUP BY severity, status, category`,
      scope.params,
    );
    const counts = { CRITICAL: 0, WARNING: 0, INFO: 0, total: 0, byStatus: { ACTIVE: 0, ACKNOWLEDGED: 0, RESOLVED: 0 }, byCategory: {} };
    for (const r of rows) {
      counts[r.severity] = (counts[r.severity] || 0) + Number(r.c);
      counts.byStatus[r.status] = (counts.byStatus[r.status] || 0) + Number(r.c);
      counts.byCategory[r.category || 'GENERAL'] = (counts.byCategory[r.category || 'GENERAL'] || 0) + Number(r.c);
      counts.total += Number(r.c);
    }
    const last24 = await db.get(
      `SELECT COUNT(*) AS c FROM alarms a WHERE a.triggered_at >= ? ${scope.sql}`,
      [daysAgoIso(1), ...scope.params],
    );
    const active = await db.get(
      `SELECT COUNT(*) AS c FROM alarms a WHERE a.status != 'RESOLVED' ${scope.sql}`,
      scope.params,
    );
    const sites = await db.all(
      `SELECT a.site_id, s.code, s.name, COUNT(*) AS c, SUM(CASE WHEN a.severity = 'CRITICAL' THEN 1 ELSE 0 END) AS critical
       FROM alarms a JOIN sites s ON s.id = a.site_id WHERE a.status != 'RESOLVED' ${scope.sql}
       GROUP BY a.site_id, s.code, s.name ORDER BY c DESC LIMIT 10`,
      scope.params,
    );
    res.json({ counts, last24h: Number(last24.c), active: Number(active.c), bySite: sites });
  }),
);

router.get(
  '/events',
  requirePermission('alarm:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await scopedSiteIds(req);
    const { page, pageSize, offset } = parsePagination(req.query);
    const params = [];
    let where = 'WHERE 1 = 1';
    if (ids.length) { where += ` AND e.site_id IN (${ids.map(() => '?').join(',')})`; params.push(...ids); }
    if (req.query.siteId && ids.includes(req.query.siteId)) { where += ' AND e.site_id = ?'; params.push(req.query.siteId); }
    if (req.query.type) { where += ' AND e.type = ?'; params.push(req.query.type); }
    if (req.query.severity) { where += ' AND e.severity = ?'; params.push(String(req.query.severity).toUpperCase()); }
    if (req.query.search) { where += ' AND e.message LIKE ?'; params.push(`%${req.query.search}%`); }
    const range = parseDayRange(req.query, '30d');
    where += ' AND e.ts >= ? AND e.ts <= ?';
    params.push(`${range.from}T00:00:00.000Z`, `${range.to}T23:59:59.999Z`);
    const total = await db.get(`SELECT COUNT(*) AS c FROM events e ${where}`, params);
    const events = await db.all(
      `SELECT e.*, s.code AS site_code, s.name AS site_name FROM events e LEFT JOIN sites s ON s.id = e.site_id
       ${where} ORDER BY e.ts DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset],
    );
    res.json({ events, total: Number(total.c), page, pageSize, range });
  }),
);

router.get(
  '/rules',
  requirePermission('alarm:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rules = await db.all('SELECT * FROM alarm_rules ORDER BY category, code');
    res.json({ rules });
  }),
);

router.post(
  '/rules',
  requirePermission('alarm:rules'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const body = req.body || {};
    if (!body.code || !body.name || !body.parameterId || body.threshold === undefined) {
      throw badRequest('code, name, parameterId and threshold are required');
    }
    if (!['>', '>=', '<', '<='].includes(body.operator || '>')) throw badRequest('Invalid operator');
    const now = nowIso();
    const id = uid('rule');
    const code = String(body.code).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    await db.run(
      `INSERT INTO alarm_rules (id, code, parameter_id, name, severity, operator, threshold, duration_sec, category, enabled, site_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, code, body.parameterId, body.name, body.severity || 'WARNING', body.operator || '>', Number(body.threshold),
        Number(body.durationSec || 0), body.category || 'GENERAL', body.enabled === false ? 0 : 1, body.siteId || null, now, now],
    );
    await audit(req, 'CREATE', 'alarm_rule', id, { code });
    const { reloadAlarmRules } = await import('../services/alarmEngine.js');
    await reloadAlarmRules();
    res.status(201).json({ rule: await db.get('SELECT * FROM alarm_rules WHERE id = ?', [id]) });
  }),
);

router.patch(
  '/rules/:id',
  requirePermission('alarm:rules'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rule = await db.get('SELECT * FROM alarm_rules WHERE id = ?', [req.params.id]);
    if (!rule) throw notFound('Alarm rule not found');
    const map = {
      name: 'name', severity: 'severity', operator: 'operator', threshold: 'threshold',
      durationSec: 'duration_sec', duration_sec: 'duration_sec', category: 'category',
      enabled: 'enabled', siteId: 'site_id', site_id: 'site_id', parameterId: 'parameter_id',
    };
    const sets = []; const params = [];
    for (const [k, col] of Object.entries(map)) {
      if (req.body?.[k] === undefined) continue;
      sets.push(`${col} = ?`);
      params.push(k === 'enabled' ? (req.body[k] ? 1 : 0) : req.body[k]);
    }
    if (!sets.length) throw badRequest('No supported fields supplied');
    sets.push('updated_at = ?'); params.push(nowIso(), rule.id);
    await db.run(`UPDATE alarm_rules SET ${sets.join(', ')} WHERE id = ?`, params);
    await audit(req, 'UPDATE', 'alarm_rule', rule.id, { fields: Object.keys(req.body || {}) });
    const { reloadAlarmRules } = await import('../services/alarmEngine.js');
    await reloadAlarmRules();
    res.json({ rule: await db.get('SELECT * FROM alarm_rules WHERE id = ?', [rule.id]) });
  }),
);

router.delete(
  '/rules/:id',
  requirePermission('alarm:rules'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rule = await db.get('SELECT * FROM alarm_rules WHERE id = ?', [req.params.id]);
    if (!rule) throw notFound('Alarm rule not found');
    await db.run('DELETE FROM alarm_rules WHERE id = ?', [rule.id]);
    await audit(req, 'DELETE', 'alarm_rule', rule.id, { code: rule.code });
    const { reloadAlarmRules } = await import('../services/alarmEngine.js');
    await reloadAlarmRules();
    res.json({ ok: true });
  }),
);

router.get(
  '/:id',
  requirePermission('alarm:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await scopedSiteIds(req);
    const alarm = await db.get(
      `SELECT a.*, s.code AS site_code, s.name AS site_name, d.name AS device_name
       FROM alarms a LEFT JOIN sites s ON s.id = a.site_id LEFT JOIN devices d ON d.id = a.device_id WHERE a.id = ?`,
      [req.params.id],
    );
    if (!alarm || !ids.includes(alarm.site_id)) throw notFound('Alarm not found');
    const notifications = await db.all('SELECT * FROM notifications WHERE alarm_id = ? ORDER BY created_at DESC', [alarm.id]);
    res.json({ alarm, notifications });
  }),
);

router.post(
  '/:id/acknowledge',
  requirePermission('alarm:ack'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await scopedSiteIds(req);
    const alarm = await db.get('SELECT * FROM alarms WHERE id = ?', [req.params.id]);
    if (!alarm || !ids.includes(alarm.site_id)) throw notFound('Alarm not found');
    if (alarm.status === 'RESOLVED') throw badRequest('Resolved alarms cannot be acknowledged');
    const now = nowIso();
    await db.run(
      "UPDATE alarms SET status = 'ACKNOWLEDGED', acknowledged_at = ?, acknowledged_by = ? WHERE id = ?",
      [now, req.user.username, alarm.id],
    );
    await db.run(
      'INSERT INTO events (id, ts, site_id, device_id, type, severity, message, user_id, data_source) VALUES (?,?,?,?,?,?,?,?,?)',
      [uid('evt'), now, alarm.site_id, alarm.device_id, 'ALARM_ACKNOWLEDGED', 'INFO', `Acknowledged by ${req.user.username}: ${alarm.title}`, req.user.id, alarm.data_source],
    );
    await audit(req, 'ACKNOWLEDGE', 'alarm', alarm.id, { code: alarm.code, note: req.body?.note || null });
    const { broadcast } = await import('../services/realtime.js');
    broadcast({ type: 'alarm_updated', alarmId: alarm.id, status: 'ACKNOWLEDGED', by: req.user.username, ts: now });
    res.json({ ok: true, alarm: await db.get('SELECT * FROM alarms WHERE id = ?', [alarm.id]) });
  }),
);

router.post(
  '/:id/resolve',
  requirePermission('alarm:resolve'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await scopedSiteIds(req);
    const alarm = await db.get('SELECT * FROM alarms WHERE id = ?', [req.params.id]);
    if (!alarm || !ids.includes(alarm.site_id)) throw notFound('Alarm not found');
    const note = String(req.body?.note || 'Resolved by operator.').slice(0, 1000);
    const now = nowIso();
    await db.run(
      "UPDATE alarms SET status = 'RESOLVED', resolved_at = ?, resolved_by = ?, resolution_note = ?, acknowledged_at = COALESCE(acknowledged_at, ?), acknowledged_by = COALESCE(acknowledged_by, ?) WHERE id = ?",
      [now, req.user.username, note, now, req.user.username, alarm.id],
    );
    await db.run(
      'INSERT INTO events (id, ts, site_id, device_id, type, severity, message, user_id, data_source) VALUES (?,?,?,?,?,?,?,?,?)',
      [uid('evt'), now, alarm.site_id, alarm.device_id, 'ALARM_RESOLVED', 'INFO', `Resolved by ${req.user.username}: ${alarm.title}`, req.user.id, alarm.data_source],
    );
    await audit(req, 'RESOLVE', 'alarm', alarm.id, { code: alarm.code, note });
    await broadcastResolved(alarm, now);
    res.json({ ok: true, alarm: await db.get('SELECT * FROM alarms WHERE id = ?', [alarm.id]) });
  }),
);

async function broadcastResolved(alarm, ts) {
  const { broadcast } = await import('../services/realtime.js');
  broadcast({ type: 'alarm_resolved', alarmId: alarm.id, siteId: alarm.site_id, ts });
}

router.post(
  '/bulk/acknowledge',
  requirePermission('alarm:ack'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await scopedSiteIds(req);
    const alarmIds = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
    if (!alarmIds.length) throw badRequest('ids array required');
    const now = nowIso();
    let updated = 0;
    for (const id of alarmIds) {
      const alarm = await db.get('SELECT * FROM alarms WHERE id = ?', [id]);
      if (!alarm || !ids.includes(alarm.site_id) || alarm.status === 'RESOLVED') continue;
      await db.run("UPDATE alarms SET status = 'ACKNOWLEDGED', acknowledged_at = COALESCE(acknowledged_at, ?), acknowledged_by = COALESCE(acknowledged_by, ?) WHERE id = ?", [now, req.user.username, id]);
      updated += 1;
    }
    await audit(req, 'BULK_ACKNOWLEDGE', 'alarm', null, { requested: alarmIds.length, updated });
    res.json({ ok: true, updated });
  }),
);

export default router;
