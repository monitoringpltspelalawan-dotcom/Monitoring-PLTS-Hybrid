import express from 'express';
import { getDb } from '../db/adapter.js';
import { asyncHandler, badRequest, notFound, conflict } from '../lib/errors.js';
import { requireAuth, requirePermission, audit } from '../middleware/auth.js';
import { allowedSites, parsePagination, numberField } from './helpers.js';
import { nowIso } from '../lib/time.js';
import { safeJsonParse, uid } from '../lib/util.js';

const router = express.Router();
router.use(requireAuth);

async function permittedSiteIds(req) {
  return (await allowedSites(req)).map((s) => s.id);
}

router.get(
  '/models',
  requirePermission('device:view'),
  asyncHandler(async (req, res) => {
    const rows = await getDb().all('SELECT * FROM device_models ORDER BY device_type, manufacturer, model');
    res.json({
      models: rows.map((m) => ({ ...m, register_template: safeJsonParse(m.register_template, []) })),
    });
  }),
);

router.get(
  '/bess-racks',
  requirePermission('device:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    if (!ids.length) return res.json({ racks: [] });
    const params = [...ids];
    let where = `WHERE b.site_id IN (${ids.map(() => '?').join(',')})`;
    if (req.query.siteId && ids.includes(req.query.siteId)) { where += ' AND b.site_id = ?'; params.push(req.query.siteId); }
    const racks = await db.all(
      `SELECT b.*, s.code AS site_code, s.name AS site_name FROM bess_racks b JOIN sites s ON s.id = b.site_id ${where} ORDER BY s.code, b.name`,
      params,
    );
    res.json({ racks });
  }),
);

router.get(
  '/',
  requirePermission('device:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    if (!ids.length) return res.json({ devices: [], total: 0 });
    const { page, pageSize, offset } = parsePagination(req.query);
    const params = [...ids];
    let where = `WHERE d.site_id IN (${ids.map(() => '?').join(',')})`;
    if (req.query.siteId && ids.includes(req.query.siteId)) { where += ' AND d.site_id = ?'; params.push(req.query.siteId); }
    if (req.query.type) { where += ' AND d.device_type = ?'; params.push(req.query.type); }
    if (req.query.status) { where += ' AND d.status = ?'; params.push(String(req.query.status).toUpperCase()); }
    if (req.query.gatewayId) { where += ' AND d.gateway_id = ?'; params.push(req.query.gatewayId); }
    if (req.query.search) {
      where += ' AND (d.name LIKE ? OR d.serial LIKE ? OR d.model LIKE ? OR d.ip_address LIKE ?)';
      const q = `%${req.query.search}%`; params.push(q, q, q, q);
    }
    const total = await db.get(`SELECT COUNT(*) AS c FROM devices d ${where}`, params);
    const devices = await db.all(
      `SELECT d.*, s.code AS site_code, s.name AS site_name, g.name AS gateway_name,
        (SELECT COUNT(*) FROM modbus_registers r WHERE r.device_id = d.id) AS register_count
       FROM devices d LEFT JOIN sites s ON s.id = d.site_id LEFT JOIN gateways g ON g.id = d.gateway_id
       ${where} ORDER BY s.code, d.device_type, d.name LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const typeCounts = await db.all(
      `SELECT d.device_type, d.status, COUNT(*) AS c FROM devices d ${where} GROUP BY d.device_type, d.status`, params,
    );
    const byType = {}; const byStatus = {};
    for (const r of typeCounts) {
      byType[r.device_type] = (byType[r.device_type] || 0) + Number(r.c);
      byStatus[r.status] = (byStatus[r.status] || 0) + Number(r.c);
    }
    res.json({ devices, total: Number(total.c), page, pageSize, byType, byStatus });
  }),
);

router.post(
  '/',
  requirePermission('device:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const body = req.body || {};
    if (!body.siteId || !ids.includes(body.siteId)) throw badRequest('A valid authorized siteId is required');
    if (!body.name || !body.deviceType) throw badRequest('name and deviceType are required');
    const now = nowIso();
    const id = body.id || uid('dev');
    const gateway = await db.get('SELECT id FROM gateways WHERE site_id = ? ORDER BY created_at LIMIT 1', [body.siteId]);
    await db.run(
      `INSERT INTO devices (id, site_id, gateway_id, model_id, name, device_type, manufacturer, model, serial, ip_address, port, unit_id, firmware, status, last_seen_at, data_source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, body.siteId, body.gatewayId || gateway?.id || null, body.modelId || null, body.name, body.deviceType,
        body.manufacturer || null, body.model || null, body.serial || null, body.ipAddress || null,
        numberField(body.port, 502), numberField(body.unitId, 1), body.firmware || null, 'UNKNOWN', null,
        'LIVE', now, now],
    );
    if (body.modelId) {
      const model = await db.get('SELECT * FROM device_models WHERE id = ?', [body.modelId]);
      const template = safeJsonParse(model?.register_template, []);
      for (const r of template) {
        await db.run(
          `INSERT INTO modbus_registers (id, device_id, parameter_id, name, function_code, address, register_type, data_type, word_order, byte_order, scale, offset, unit, poll_interval_sec, writable, description, enabled, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [uid('reg'), id, r.parameter_id, r.name, r.function_code || 3, r.address || 0, r.register_type || 'HOLDING',
            r.data_type || 'UINT16', r.word_order || 'BIG', r.byte_order || 'BIG', r.scale || 1, r.offset || 0,
            r.unit || null, r.poll_interval_sec || 10, r.writable ? 1 : 0, r.description || null, 1, now, now],
        );
      }
    }
    await audit(req, 'CREATE', 'device', id, { siteId: body.siteId, name: body.name, deviceType: body.deviceType });
    res.status(201).json({ device: await db.get('SELECT * FROM devices WHERE id = ?', [id]) });
  }),
);

router.get(
  '/:id',
  requirePermission('device:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const device = await db.get(
      `SELECT d.*, s.code AS site_code, s.name AS site_name, g.name AS gateway_name FROM devices d
       LEFT JOIN sites s ON s.id = d.site_id LEFT JOIN gateways g ON g.id = d.gateway_id WHERE d.id = ?`, [req.params.id],
    );
    if (!device || !ids.includes(device.site_id)) throw notFound('Device not found');
    const registers = await db.all('SELECT * FROM modbus_registers WHERE device_id = ? ORDER BY parameter_id', [device.id]);
    const model = device.model_id ? await db.get('SELECT * FROM device_models WHERE id = ?', [device.model_id]) : null;
    const latest = await db.all(
      `SELECT parameter_id, value, unit, server_ts, quality FROM measurements WHERE device_id = ? AND server_ts >= ?
       ORDER BY server_ts DESC LIMIT 40`,
      [device.id, new Date(Date.now() - 6 * 3600_000).toISOString()],
    );
    const latestByParam = {};
    for (const m of latest) if (!latestByParam[m.parameter_id]) latestByParam[m.parameter_id] = m;
    res.json({ device, registers, model: model ? { ...model, register_template: safeJsonParse(model.register_template, []) } : null, latest: latestByParam });
  }),
);

router.patch(
  '/:id',
  requirePermission('device:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const device = await db.get('SELECT * FROM devices WHERE id = ?', [req.params.id]);
    if (!device || !ids.includes(device.site_id)) throw notFound('Device not found');
    const map = {
      name: 'name', manufacturer: 'manufacturer', model: 'model', serial: 'serial', ipAddress: 'ip_address',
      ip_address: 'ip_address', port: 'port', unitId: 'unit_id', unit_id: 'unit_id', firmware: 'firmware',
      status: 'status', gatewayId: 'gateway_id', modelId: 'model_id', deviceType: 'device_type',
    };
    const sets = []; const params = [];
    for (const [k, col] of Object.entries(map)) {
      if (req.body?.[k] === undefined) continue;
      sets.push(`${col} = ?`); params.push(req.body[k]);
    }
    if (!sets.length) throw badRequest('No supported fields supplied');
    sets.push('updated_at = ?'); params.push(nowIso(), device.id);
    await db.run(`UPDATE devices SET ${sets.join(', ')} WHERE id = ?`, params);
    await audit(req, 'UPDATE', 'device', device.id, { fields: Object.keys(req.body || {}) });
    res.json({ device: await db.get('SELECT * FROM devices WHERE id = ?', [device.id]) });
  }),
);

router.delete(
  '/:id',
  requirePermission('device:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const device = await db.get('SELECT * FROM devices WHERE id = ?', [req.params.id]);
    if (!device || !ids.includes(device.site_id)) throw notFound('Device not found');
    await db.run('DELETE FROM devices WHERE id = ?', [device.id]);
    await audit(req, 'DELETE', 'device', device.id, { name: device.name });
    res.json({ ok: true });
  }),
);

router.get(
  '/:id/registers',
  requirePermission('modbus:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const device = await db.get('SELECT * FROM devices WHERE id = ?', [req.params.id]);
    if (!device || !ids.includes(device.site_id)) throw notFound('Device not found');
    const registers = await db.all('SELECT * FROM modbus_registers WHERE device_id = ? ORDER BY address', [device.id]);
    res.json({ registers, device: { id: device.id, name: device.name, deviceType: device.device_type } });
  }),
);

router.post(
  '/:id/registers',
  requirePermission('modbus:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const device = await db.get('SELECT * FROM devices WHERE id = ?', [req.params.id]);
    if (!device || !ids.includes(device.site_id)) throw notFound('Device not found');
    const b = req.body || {};
    if (!b.parameterId || !b.name || b.address === undefined) throw badRequest('parameterId, name and address are required');
    const exists = await db.get('SELECT id FROM modbus_registers WHERE device_id = ? AND parameter_id = ?', [device.id, b.parameterId]);
    if (exists) throw conflict(`Register ${b.parameterId} already exists for this device`);
    const now = nowIso();
    const id = uid('reg');
    await db.run(
      `INSERT INTO modbus_registers (id, device_id, parameter_id, name, function_code, address, register_type, data_type, word_order, byte_order, scale, offset, unit, poll_interval_sec, writable, description, enabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, device.id, b.parameterId, b.name, numberField(b.functionCode, 3), numberField(b.address), b.registerType || 'HOLDING',
        b.dataType || 'UINT16', b.wordOrder || 'BIG', b.byteOrder || 'BIG', numberField(b.scale, 1), numberField(b.offset, 0),
        b.unit || null, numberField(b.pollIntervalSec, 10), b.writable ? 1 : 0, b.description || null, b.enabled === false ? 0 : 1, now, now],
    );
    await audit(req, 'CREATE', 'modbus_register', id, { deviceId: device.id, parameterId: b.parameterId });
    res.status(201).json({ register: await db.get('SELECT * FROM modbus_registers WHERE id = ?', [id]) });
  }),
);

router.patch(
  '/registers/:id',
  requirePermission('modbus:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const reg = await db.get('SELECT * FROM modbus_registers WHERE id = ?', [req.params.id]);
    if (!reg) throw notFound('Register not found');
    const device = await db.get('SELECT * FROM devices WHERE id = ?', [reg.device_id]);
    if (!device || !ids.includes(device.site_id)) throw notFound('Register not found');
    const map = {
      parameterId: 'parameter_id', name: 'name', functionCode: 'function_code', address: 'address',
      registerType: 'register_type', dataType: 'data_type', wordOrder: 'word_order', byteOrder: 'byte_order',
      scale: 'scale', offsetValue: 'offset', unit: 'unit', pollIntervalSec: 'poll_interval_sec',
      writable: 'writable', description: 'description', enabled: 'enabled',
    };
    const sets = []; const params = [];
    for (const [k, col] of Object.entries(map)) {
      if (req.body?.[k] === undefined) continue;
      sets.push(`${col} = ?`);
      params.push(k === 'writable' || k === 'enabled' ? (req.body[k] ? 1 : 0) : req.body[k]);
    }
    if (req.body?.offset !== undefined && req.body?.offsetValue === undefined) {
      await db.run('UPDATE modbus_registers SET offset = ? WHERE id = ?', [req.body.offset, reg.id]);
    }
    if (!sets.length) throw badRequest('No supported fields supplied');
    sets.push('updated_at = ?'); params.push(nowIso(), reg.id);
    await db.run(`UPDATE modbus_registers SET ${sets.join(', ')} WHERE id = ?`, params);
    await audit(req, 'UPDATE', 'modbus_register', reg.id, { fields: Object.keys(req.body || {}) });
    res.json({ register: await db.get('SELECT * FROM modbus_registers WHERE id = ?', [reg.id]) });
  }),
);

router.delete(
  '/registers/:id',
  requirePermission('modbus:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const reg = await db.get('SELECT * FROM modbus_registers WHERE id = ?', [req.params.id]);
    if (!reg) throw notFound('Register not found');
    const device = await db.get('SELECT * FROM devices WHERE id = ?', [reg.device_id]);
    if (!device || !ids.includes(device.site_id)) throw notFound('Register not found');
    await db.run('DELETE FROM modbus_registers WHERE id = ?', [reg.id]);
    await audit(req, 'DELETE', 'modbus_register', reg.id, { parameterId: reg.parameter_id });
    res.json({ ok: true });
  }),
);

router.post(
  '/:id/registers/apply-template',
  requirePermission('modbus:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const device = await db.get('SELECT * FROM devices WHERE id = ?', [req.params.id]);
    if (!device || !ids.includes(device.site_id)) throw notFound('Device not found');
    const modelId = req.body?.modelId || device.model_id;
    const model = await db.get('SELECT * FROM device_models WHERE id = ?', [modelId]);
    if (!model) throw notFound('Device model not found');
    const template = safeJsonParse(model.register_template, []);
    const replace = req.body?.replace === true;
    if (replace) await db.run('DELETE FROM modbus_registers WHERE device_id = ?', [device.id]);
    const now = nowIso();
    let added = 0;
    for (const r of template) {
      const exists = await db.get('SELECT id FROM modbus_registers WHERE device_id = ? AND parameter_id = ?', [device.id, r.parameter_id]);
      if (exists) continue;
      await db.run(
        `INSERT INTO modbus_registers (id, device_id, parameter_id, name, function_code, address, register_type, data_type, word_order, byte_order, scale, offset, unit, poll_interval_sec, writable, description, enabled, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uid('reg'), device.id, r.parameter_id, r.name, r.function_code || 3, r.address || 0, r.register_type || 'HOLDING',
          r.data_type || 'UINT16', r.word_order || 'BIG', r.byte_order || 'BIG', r.scale || 1, r.offset || 0,
          r.unit || null, r.poll_interval_sec || 10, r.writable ? 1 : 0, r.description || null, 1, now, now],
      );
      added += 1;
    }
    await db.run('UPDATE devices SET model_id = ?, updated_at = ? WHERE id = ?', [model.id, now, device.id]);
    await audit(req, 'APPLY_TEMPLATE', 'device', device.id, { modelId: model.id, added, replace });
    res.json({ ok: true, added, registerCount: Number((await db.get('SELECT COUNT(*) AS c FROM modbus_registers WHERE device_id = ?', [device.id])).c) });
  }),
);

export default router;
