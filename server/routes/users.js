import express from 'express';
import { getDb } from '../db/adapter.js';
import { asyncHandler, badRequest, notFound, conflict, forbidden } from '../lib/errors.js';
import { requireAuth, requirePermission, audit } from '../middleware/auth.js';
import { allowedSites, parsePagination } from './helpers.js';
import { hashPassword, passwordIssues } from '../lib/passwords.js';
import { revokeUserSessions } from '../services/authService.js';
import { nowIso, daysAgoIso } from '../lib/time.js';
import { safeJsonParse, uid } from '../lib/util.js';

const router = express.Router();
router.use(requireAuth);

const ASSIGNABLE = ['SUPER_ADMIN', 'CORPORATE_ADMIN', 'REGIONAL_MANAGER', 'SITE_ADMIN', 'OPERATOR', 'VIEWER'];

async function roleRow(code) {
  const role = await getDb().get('SELECT * FROM roles WHERE code = ?', [code]);
  if (!role) throw badRequest(`Unknown role ${code}`);
  return role;
}

async function saveUserSites(userId, siteIds) {
  const db = getDb();
  await db.run('DELETE FROM user_sites WHERE user_id = ?', [userId]);
  if (!Array.isArray(siteIds) || !siteIds.length) return;
  const sites = await db.all(`SELECT id FROM sites WHERE id IN (${siteIds.map(() => '?').join(',')})`, siteIds);
  for (const s of sites) {
    await db.run('INSERT INTO user_sites (user_id, site_id) VALUES (?,?) ON CONFLICT DO NOTHING', [userId, s.id]);
  }
}

router.get(
  '/roles',
  requirePermission('user:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const roles = await db.all('SELECT * FROM roles ORDER BY name');
    const counts = await db.all('SELECT role_id, COUNT(*) AS c FROM users GROUP BY role_id');
    const countMap = new Map(counts.map((c) => [c.role_id, Number(c.c)]));
    res.json({
      roles: roles.map((r) => ({ ...r, permissions: safeJsonParse(r.permissions, []), userCount: countMap.get(r.id) || 0 })),
    });
  }),
);

router.get(
  '/',
  requirePermission('user:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { page, pageSize, offset } = parsePagination(req.query);
    const params = [];
    let where = 'WHERE 1 = 1';
    if (req.query.role) { where += ' AND r.code = ?'; params.push(String(req.query.role).toUpperCase()); }
    if (req.query.status) { where += ' AND u.status = ?'; params.push(String(req.query.status).toUpperCase()); }
    if (req.query.search) {
      where += ' AND (u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)';
      const q = `%${req.query.search}%`; params.push(q, q, q);
    }
    const total = await db.get(`SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id = u.role_id ${where}`, params);
    const users = await db.all(
      `SELECT u.id, u.username, u.email, u.full_name, u.status, u.timezone, u.last_login_at, u.created_at,
              r.code AS role, r.name AS role_name, rg.code AS region_code, rg.name AS region_name
       FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN regions rg ON rg.id = u.region_id
       ${where} ORDER BY u.username LIMIT ? OFFSET ?`, [...params, pageSize, offset],
    );
    const siteRows = await db.all('SELECT us.user_id, s.id, s.code, s.name FROM user_sites us JOIN sites s ON s.id = us.site_id');
    const byUser = new Map();
    for (const s of siteRows) {
      const arr = byUser.get(s.user_id) || [];
      arr.push({ id: s.id, code: s.code, name: s.name });
      byUser.set(s.user_id, arr);
    }
    res.json({
      users: users.map((u) => ({ ...u, sites: byUser.get(u.id) || [] })),
      total: Number(total.c), page, pageSize,
      regions: await db.all('SELECT id, code, name FROM regions ORDER BY name'),
    });
  }),
);

router.post(
  '/',
  requirePermission('user:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const b = req.body || {};
    if (!b.username || !b.fullName || !b.role || !b.password) throw badRequest('username, fullName, role and password are required');
    const issues = passwordIssues(b.password);
    if (issues.length) throw badRequest(`Password does not meet policy: ${issues.join(', ')}`, { issues });
    if (b.role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') throw forbidden('Only a Super Administrator can create another Super Administrator');
    if (!ASSIGNABLE.includes(b.role)) throw badRequest('Invalid role');
    const exists = await db.get('SELECT id FROM users WHERE username = ?', [String(b.username).trim().toLowerCase()]);
    if (exists) throw conflict('Username already exists');
    const role = await roleRow(b.role);
    const { salt, hash } = hashPassword(b.password);
    const id = uid('usr');
    const now = nowIso();
    await db.run(
      `INSERT INTO users (id, username, email, full_name, password_hash, password_salt, role_id, region_id, status, timezone, last_login_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, String(b.username).trim().toLowerCase(), b.email || null, b.fullName, hash, salt, role.id,
        b.role === 'REGIONAL_MANAGER' ? b.regionId || null : null, 'ACTIVE', b.timezone || 'Asia/Jakarta', null, now, now],
    );
    if (b.role !== 'REGIONAL_MANAGER' && Array.isArray(b.siteIds)) await saveUserSites(id, b.siteIds);
    await audit(req, 'CREATE', 'user', id, { username: b.username, role: b.role, siteIds: b.siteIds || [] });
    res.status(201).json({ user: await db.get('SELECT id, username, full_name, email, status, created_at FROM users WHERE id = ?', [id]) });
  }),
);

router.patch(
  '/:id',
  requirePermission('user:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = await db.get(
      'SELECT u.*, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [req.params.id],
    );
    if (!user) throw notFound('User not found');
    if (user.role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') throw forbidden('Only a Super Administrator can modify this account');
    const b = req.body || {};
    const sets = []; const params = [];
    const simple = { fullName: 'full_name', email: 'email', status: 'status', timezone: 'timezone' };
    for (const [k, col] of Object.entries(simple)) {
      if (b[k] === undefined) continue;
      sets.push(`${col} = ?`); params.push(b[k]);
    }
    if (b.status !== undefined && !['ACTIVE', 'SUSPENDED', 'LOCKED'].includes(b.status)) throw badRequest('Invalid user status');
    if (b.role !== undefined) {
      if (b.role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') throw forbidden('Only a Super Administrator can assign this role');
      if (!ASSIGNABLE.includes(b.role)) throw badRequest('Invalid role');
      const role = await roleRow(b.role);
      sets.push('role_id = ?'); params.push(role.id);
      if (b.role !== 'REGIONAL_MANAGER') { sets.push('region_id = ?'); params.push(null); }
    }
    if (b.regionId !== undefined) { sets.push('region_id = ?'); params.push(b.regionId || null); }
    if (!sets.length && !Array.isArray(b.siteIds)) throw badRequest('No supported fields supplied');
    if (sets.length) {
      sets.push('updated_at = ?'); params.push(nowIso(), user.id);
      await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    if (Array.isArray(b.siteIds)) await saveUserSites(user.id, b.siteIds);
    if (b.status && b.status !== 'ACTIVE') await revokeUserSessions(user.id);
    await audit(req, 'UPDATE', 'user', user.id, { fields: Object.keys(b) });
    res.json({ user: await db.get('SELECT id, username, full_name, email, status, updated_at FROM users WHERE id = ?', [user.id]) });
  }),
);

router.post(
  '/:id/reset-password',
  requirePermission('user:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) throw notFound('User not found');
    if (!req.body?.newPassword) throw badRequest('newPassword is required');
    const issues = passwordIssues(req.body.newPassword);
    if (issues.length) throw badRequest(`Password does not meet policy: ${issues.join(', ')}`, { issues });
    const { salt, hash } = hashPassword(req.body.newPassword);
    await db.run('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?', [hash, salt, nowIso(), user.id]);
    await revokeUserSessions(user.id);
    await audit(req, 'RESET_PASSWORD', 'user', user.id, {});
    res.json({ ok: true, warning: 'All active sessions for this user have been revoked.' });
  }),
);

router.delete(
  '/:id',
  requirePermission('user:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) throw notFound('User not found');
    if (user.id === req.user.id) throw badRequest('You cannot delete your own account');
    if (user.username === 'admin') throw badRequest('The bootstrap administrator cannot be deleted');
    await db.run('DELETE FROM users WHERE id = ?', [user.id]);
    await audit(req, 'DELETE', 'user', user.id, { username: user.username });
    res.json({ ok: true });
  }),
);

router.get(
  '/audit/log',
  requirePermission('audit:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { page, pageSize, offset } = parsePagination(req.query);
    const params = [];
    let where = 'WHERE 1 = 1';
    if (req.query.action) { where += ' AND action = ?'; params.push(String(req.query.action).toUpperCase()); }
    if (req.query.entity) { where += ' AND entity = ?'; params.push(req.query.entity); }
    if (req.query.username) { where += ' AND username LIKE ?'; params.push(`%${req.query.username}%`); }
    if (req.query.search) {
      where += ' AND (action LIKE ? OR entity LIKE ? OR details LIKE ? OR username LIKE ?)';
      const q = `%${req.query.search}%`; params.push(q, q, q, q);
    }
    const range = req.query.from || req.query.to ? req.query : { from: daysAgoIso(30).slice(0, 10), to: nowIso().slice(0, 10) };
    where += ' AND ts >= ? AND ts <= ?';
    params.push(`${range.from}T00:00:00.000Z`, `${range.to}T23:59:59.999Z`);
    const total = await db.get(`SELECT COUNT(*) AS c FROM audit_logs ${where}`, params);
    const logs = await db.all(`SELECT * FROM audit_logs ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    const summary = await db.all(`SELECT action, COUNT(*) AS c FROM audit_logs ${where} GROUP BY action ORDER BY c DESC`, params);
    res.json({
      logs: logs.map((l) => ({ ...l, details: safeJsonParse(l.details, l.details) })),
      total: Number(total.c), page, pageSize, summary,
    });
  }),
);

router.get(
  '/sessions/active',
  requirePermission('user:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rows = await db.all(
      `SELECT s.id, s.user_id, u.username, u.full_name, s.created_at, s.expires_at, s.ip, s.user_agent
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.revoked = 0 AND s.expires_at > ? ORDER BY s.created_at DESC LIMIT 100`,
      [nowIso()],
    );
    res.json({ sessions: rows });
  }),
);

export default router;
