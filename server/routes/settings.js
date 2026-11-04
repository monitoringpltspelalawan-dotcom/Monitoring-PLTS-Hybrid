import express from 'express';
import { getDb } from '../db/adapter.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { requireAuth, requirePermission, audit } from '../middleware/auth.js';
import { nowIso } from '../lib/time.js';
import { uid } from '../lib/util.js';
import { config } from '../config.js';

const router = express.Router();
router.use(requireAuth);

const SECRET_KEYS = new Set(['smtp_password', 'mqtt_password', 'gateway_token', 'api_secret']);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rows = await db.all('SELECT key, value, updated_at FROM settings ORDER BY key');
    const settings = Object.fromEntries(rows.filter((r) => !SECRET_KEYS.has(r.key)).map((r) => [r.key, r.value]));
    const regions = await db.all('SELECT * FROM regions ORDER BY name');
    const tariffs = await db.all('SELECT * FROM tariffs ORDER BY site_id, name');
    res.json({
      settings,
      rows: rows.filter((r) => !SECRET_KEYS.has(r.key)),
      regions,
      tariffs,
      platform: {
        name: config.appName, version: config.version, environment: config.env,
        readOnlyMonitoring: true, demoMode: config.demoMode,
        retention: config.retention,
      },
    });
  }),
);

router.put(
  '/',
  requirePermission('settings:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const body = req.body || {};
    if (!body || typeof body !== 'object') throw badRequest('Settings object required');
    const now = nowIso();
    const updated = [];
    for (const [key, value] of Object.entries(body)) {
      if (SECRET_KEYS.has(key)) continue;
      if (typeof value === 'object') throw badRequest(`Setting ${key} must be a scalar value`);
      await db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, String(value), now],
      );
      updated.push(key);
    }
    await audit(req, 'UPDATE', 'settings', null, { keys: updated });
    const rows = await db.all('SELECT key, value, updated_at FROM settings ORDER BY key');
    res.json({ ok: true, updated, settings: Object.fromEntries(rows.filter((r) => !SECRET_KEYS.has(r.key)).map((r) => [r.key, r.value])) });
  }),
);

router.get(
  '/tariffs',
  asyncHandler(async (req, res) => {
    const tariffs = await getDb().all(
      `SELECT t.*, s.code AS site_code, s.name AS site_name FROM tariffs t LEFT JOIN sites s ON s.id = t.site_id ORDER BY t.site_id, t.name`,
    );
    res.json({ tariffs });
  }),
);

router.post(
  '/tariffs',
  requirePermission('settings:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.name || b.rate === undefined) throw badRequest('name and rate are required');
    const id = uid('tar');
    await db.run(
      'INSERT INTO tariffs (id, site_id, name, type, rate, currency, effective_from, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, b.siteId || null, b.name, b.type || 'ENERGY', Number(b.rate), b.currency || 'IDR', b.effectiveFrom || nowIso().slice(0, 10), nowIso()],
    );
    await audit(req, 'CREATE', 'tariff', id, { name: b.name, rate: b.rate });
    res.status(201).json({ tariff: await db.get('SELECT * FROM tariffs WHERE id = ?', [id]) });
  }),
);

router.patch(
  '/tariffs/:id',
  requirePermission('settings:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const tariff = await db.get('SELECT * FROM tariffs WHERE id = ?', [req.params.id]);
    if (!tariff) throw notFound('Tariff not found');
    const map = { name: 'name', rate: 'rate', currency: 'currency', type: 'type', effectiveFrom: 'effective_from', siteId: 'site_id' };
    const sets = []; const params = [];
    for (const [k, col] of Object.entries(map)) {
      if (req.body?.[k] === undefined) continue;
      sets.push(`${col} = ?`); params.push(req.body[k]);
    }
    if (!sets.length) throw badRequest('No supported fields supplied');
    await db.run(`UPDATE tariffs SET ${sets.join(', ')} WHERE id = ?`, [...params, tariff.id]);
    await audit(req, 'UPDATE', 'tariff', tariff.id, { fields: Object.keys(req.body || {}) });
    res.json({ tariff: await db.get('SELECT * FROM tariffs WHERE id = ?', [tariff.id]) });
  }),
);

router.delete(
  '/tariffs/:id',
  requirePermission('settings:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const tariff = await db.get('SELECT * FROM tariffs WHERE id = ?', [req.params.id]);
    if (!tariff) throw notFound('Tariff not found');
    await db.run('DELETE FROM tariffs WHERE id = ?', [tariff.id]);
    await audit(req, 'DELETE', 'tariff', tariff.id, { name: tariff.name });
    res.json({ ok: true });
  }),
);

router.get(
  '/regions',
  asyncHandler(async (req, res) => {
    const regions = await getDb().all(
      `SELECT r.*, (SELECT COUNT(*) FROM sites s WHERE s.region_id = r.id) AS site_count FROM regions r ORDER BY r.name`,
    );
    res.json({ regions });
  }),
);

router.post(
  '/regions',
  requirePermission('settings:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.code || !b.name) throw badRequest('code and name are required');
    const id = uid('reg');
    await db.run('INSERT INTO regions (id, code, name, timezone, created_at) VALUES (?,?,?,?,?)', [
      id, String(b.code).toUpperCase(), b.name, b.timezone || 'Asia/Jakarta', nowIso(),
    ]);
    await audit(req, 'CREATE', 'region', id, { code: b.code });
    res.status(201).json({ region: await db.get('SELECT * FROM regions WHERE id = ?', [id]) });
  }),
);

router.patch(
  '/regions/:id',
  requirePermission('settings:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const region = await db.get('SELECT * FROM regions WHERE id = ?', [req.params.id]);
    if (!region) throw notFound('Region not found');
    const sets = []; const params = [];
    for (const [k, col] of Object.entries({ name: 'name', timezone: 'timezone' })) {
      if (req.body?.[k] === undefined) continue;
      sets.push(`${col} = ?`); params.push(req.body[k]);
    }
    if (!sets.length) throw badRequest('No supported fields supplied');
    await db.run(`UPDATE regions SET ${sets.join(', ')} WHERE id = ?`, [...params, region.id]);
    await audit(req, 'UPDATE', 'region', region.id, { fields: Object.keys(req.body || {}) });
    res.json({ region: await db.get('SELECT * FROM regions WHERE id = ?', [region.id]) });
  }),
);

export default router;
