import { getDb } from '../db/adapter.js';
import { tokenHash, randomToken, uid } from '../lib/util.js';
import { verifyPassword } from '../lib/passwords.js';
import { rolePermissions } from '../lib/permissions.js';
import { config } from '../config.js';
import { nowIso } from '../lib/time.js';

export const SESSION_COOKIE = 'chsms_session';
const ALL_SITE_ROLES = new Set(['SUPER_ADMIN', 'CORPORATE_ADMIN']);

export async function authenticate(username, password) {
  const db = getDb();
  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || user.status !== 'ACTIVE') return null;
  if (!verifyPassword(password, user.password_salt, user.password_hash)) return null;
  return user;
}

export async function buildUserContext(userRow) {
  const db = getDb();
  const role = await db.get('SELECT * FROM roles WHERE id = ?', [userRow.role_id]);
  if (!role) return null;
  const permissions = rolePermissions(role.code, role.permissions);
  let sites = [];
  if (ALL_SITE_ROLES.has(role.code)) {
    sites = await db.all('SELECT id, code, name, region_id FROM sites');
  } else if (role.code === 'REGIONAL_MANAGER') {
    sites = userRow.region_id
      ? await db.all('SELECT id, code, name, region_id FROM sites WHERE region_id = ?', [userRow.region_id])
      : [];
  } else {
    sites = await db.all(
      `SELECT s.id, s.code, s.name, s.region_id FROM sites s
       JOIN user_sites us ON us.site_id = s.id WHERE us.user_id = ?`,
      [userRow.id],
    );
  }
  return {
    id: userRow.id,
    username: userRow.username,
    fullName: userRow.full_name,
    email: userRow.email,
    role: role.code,
    roleName: role.name,
    permissions,
    regionId: userRow.region_id,
    timezone: userRow.timezone,
    siteIds: sites.map((s) => s.id),
    sites,
    scopedAllSites: ALL_SITE_ROLES.has(role.code) || role.code === 'REGIONAL_MANAGER',
  };
}

export async function createSession(user, reqInfo = {}) {
  const db = getDb();
  const token = randomToken(32);
  const id = uid('ses');
  const ttlH = config.sessionTtlHours;
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlH * 3600_000).toISOString();
  await db.run(
    'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?)',
    [id, user.id, tokenHash(token), createdAt, expiresAt, reqInfo.ip || null, reqInfo.userAgent || null],
  );
  await db.run('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', [createdAt, createdAt, user.id]);
  return { token, id, expiresAt };
}

export async function resolveToken(token) {
  if (!token) return null;
  const db = getDb();
  const session = await db.get(
    `SELECT s.*, u.id AS uid FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked = 0 AND s.expires_at > ?`,
    [tokenHash(token), nowIso()],
  );
  if (!session) return null;
  const userRow = await db.get('SELECT * FROM users WHERE id = ?', [session.user_id]);
  if (!userRow || userRow.status !== 'ACTIVE') return null;
  const ctx = await buildUserContext(userRow);
  if (!ctx) return null;
  return { ...ctx, sessionId: session.id };
}

export async function revokeSession(token) {
  const db = getDb();
  await db.run('UPDATE sessions SET revoked = 1 WHERE token_hash = ?', [tokenHash(token)]);
}

export async function revokeUserSessions(userId) {
  const db = getDb();
  await db.run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', [userId]);
}

export function tokenFromRequest(req) {
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (cookieToken) return cookieToken;
  const header = req.headers?.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production' && config.tls.enabled,
    maxAge: config.sessionTtlHours * 3600_000,
    path: '/',
  };
}
