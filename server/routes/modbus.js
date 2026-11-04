import express from 'express';
import net from 'node:net';
import { getDb } from '../db/adapter.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { requireAuth, requirePermission, audit } from '../middleware/auth.js';
import { allowedSites, numberField, parsePagination } from './helpers.js';
import { readModbusTcp, decodeRegisterMap, READ_FUNCTIONS } from '../lib/modbus.js';
import { nowIso } from '../lib/time.js';
import { safeJsonParse, uid } from '../lib/util.js';

const router = express.Router();
router.use(requireAuth);

async function permittedSiteIds(req) {
  return (await allowedSites(req)).map((s) => s.id);
}

/** Connection tests are restricted to local/private networks; port 502 is never proxied publicly. */
function isPrivateHost(host) {
  if (!host || typeof host !== 'string') return false;
  const h = host.trim().toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  if (!net.isIP(h)) return false;
  if (h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('127.')) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (h.startsWith('169.254.')) return true;
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

router.get(
  '/registers',
  requirePermission('modbus:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    if (!ids.length) return res.json({ registers: [], total: 0 });
    const { page, pageSize, offset } = parsePagination(req.query);
    const params = [...ids];
    let where = `WHERE d.site_id IN (${ids.map(() => '?').join(',')})`;
    if (req.query.siteId && ids.includes(req.query.siteId)) { where += ' AND d.site_id = ?'; params.push(req.query.siteId); }
    if (req.query.deviceId) { where += ' AND r.device_id = ?'; params.push(req.query.deviceId); }
    if (req.query.deviceType) { where += ' AND d.device_type = ?'; params.push(req.query.deviceType); }
    if (req.query.enabled !== undefined) { where += ' AND r.enabled = ?'; params.push(req.query.enabled === 'true' ? 1 : 0); }
    if (req.query.search) {
      where += ' AND (r.parameter_id LIKE ? OR r.name LIKE ? OR d.name LIKE ? OR s.code LIKE ?)';
      const q = `%${req.query.search}%`; params.push(q, q, q, q);
    }
    const total = await db.get(`SELECT COUNT(*) AS c FROM modbus_registers r JOIN devices d ON d.id = r.device_id JOIN sites s ON s.id = d.site_id ${where}`, params);
    const registers = await db.all(
      `SELECT r.*, d.name AS device_name, d.device_type, d.ip_address, d.port, d.unit_id, s.code AS site_code, s.name AS site_name
       FROM modbus_registers r JOIN devices d ON d.id = r.device_id JOIN sites s ON s.id = d.site_id
       ${where} ORDER BY s.code, d.name, r.address LIMIT ? OFFSET ?`, [...params, pageSize, offset],
    );
    res.json({ registers, total: Number(total.c), page, pageSize });
  }),
);

router.get(
  '/templates',
  requirePermission('modbus:view'),
  asyncHandler(async (req, res) => {
    const rows = await getDb().all('SELECT * FROM device_models ORDER BY device_type, manufacturer, model');
    res.json({
      templates: rows.map((m) => {
        const registers = safeJsonParse(m.register_template, []);
        return {
          id: m.id, manufacturer: m.manufacturer, model: m.model, deviceType: m.device_type,
          protocol: m.protocol, description: m.description, registerCount: registers.length, registers,
        };
      }),
    });
  }),
);

router.get(
  '/test-log',
  requirePermission('modbus:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const { page, pageSize, offset } = parsePagination(req.query);
    const params = [...ids];
    let where = `WHERE c.protocol LIKE 'MODBUS%' AND c.site_id IN (${ids.map(() => '?').join(',')})`;
    if (req.query.siteId && ids.includes(req.query.siteId)) { where += ' AND c.site_id = ?'; params.push(req.query.siteId); }
    const total = await db.get(`SELECT COUNT(*) AS c FROM comm_logs c ${where}`, params);
    const logs = await db.all(
      `SELECT c.*, s.code AS site_code, s.name AS site_name FROM comm_logs c LEFT JOIN sites s ON s.id = c.site_id
       ${where} ORDER BY c.ts DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset],
    );
    res.json({ logs, total: Number(total.c), page, pageSize });
  }),
);

router.post(
  '/test-connection',
  requirePermission('modbus:test'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ids = await permittedSiteIds(req);
    const body = req.body || {};
    let host = body.host ? String(body.host).trim() : '';
    let port = numberField(body.port, 502);
    let unitId = numberField(body.unitId, 1);
    let functionCode = numberField(body.functionCode, 3);
    let address = numberField(body.address, 0);
    let count = numberField(body.count, 2);
    let siteId = body.siteId || null;
    let device = null;

    if (body.deviceId) {
      device = await db.get(
        `SELECT d.*, s.code AS site_code FROM devices d JOIN sites s ON s.id = d.site_id WHERE d.id = ?`, [body.deviceId],
      );
      if (!device || !ids.includes(device.site_id)) throw notFound('Device not found');
      host = host || device.ip_address;
      port = numberField(body.port, device.port || 502);
      unitId = numberField(body.unitId, device.unit_id || 1);
      siteId = device.site_id;
      if (!body.functionCode && !body.address) {
        const reg = await db.get('SELECT * FROM modbus_registers WHERE device_id = ? AND enabled = 1 ORDER BY address LIMIT 1', [device.id]);
        if (reg) { functionCode = reg.function_code; address = reg.address; count = 2; }
      }
    }
    if (!host) throw badRequest('host or deviceId is required');
    if (!isPrivateHost(host)) throw badRequest('Connection tests are restricted to private/local network addresses');
    if (!READ_FUNCTIONS[functionCode]) throw badRequest('Only read-only function codes 1-4 are supported');
    if (port < 1 || port > 65535) throw badRequest('Invalid TCP port');
    if (count < 1 || count > 125) throw badRequest('Register count must be between 1 and 125');

    const result = await readModbusTcp({ host, port, unitId, functionCode, address, count, timeoutMs: numberField(body.timeoutMs, 3000) });
    let decoded = null;
    if (result.ok && body.decode) {
      const regs = Array.isArray(body.registers) ? body.registers : [];
      decoded = decodeRegisterMap(Buffer.from(result.response.dataHex, 'hex'), regs);
    }
    const status = result.ok ? 'OK' : result.reachable ? 'ERROR' : 'UNREACHABLE';
    await db.run(
      `INSERT INTO comm_logs (id, ts, gateway_id, site_id, direction, protocol, topic, status, bytes, latency_ms, error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [uid('cl'), nowIso(), body.gatewayId || device?.gateway_id || null, siteId,
        'OUTBOUND', 'MODBUS/TCP', `tcp://${host}:${port} unit=${unitId} fc=${functionCode} addr=${address}`,
        status, result.response?.bytes || 0, result.latencyMs || 0, result.error || null],
    );
    await audit(req, 'TEST_CONNECTION', 'modbus', device?.id || null, { host, port, unitId, functionCode, address, status });
    res.json({
      ...result,
      status,
      target: { host, port, unitId, functionCode, address, count, functionName: READ_FUNCTIONS[functionCode] },
      decoded,
      hint: result.reachable
        ? 'TCP endpoint reachable. Verify unit ID, register addresses and byte/word order.'
        : 'Device not reachable from the application server. In production the edge gateway performs polling inside the plant network; direct Modbus exposure is not required.',
    });
  }),
);

router.post(
  '/decode',
  requirePermission('modbus:view'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (!body.hex) throw badRequest('hex payload required');
    const buffer = Buffer.from(String(body.hex).replace(/[^0-9a-f]/gi, ''), 'hex');
    const registers = Array.isArray(body.registers) ? body.registers : [];
    if (!registers.length) throw badRequest('registers array required');
    res.json({ decoded: decodeRegisterMap(buffer, registers), bytes: buffer.length });
  }),
);

export default router;
