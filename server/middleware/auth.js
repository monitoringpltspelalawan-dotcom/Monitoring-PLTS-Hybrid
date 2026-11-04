import { getDb } from '../db/adapter.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { tokenFromRequest, resolveToken } from '../services/authService.js';
import { uid } from '../lib/util.js';
import { nowIso } from '../lib/time.js';

export async function requireAuth(req, res, next) {
  try {
    const token = tokenFromRequest(req);
    const user = await resolveToken(token);
    if (!user) throw unauthorized('Session expired or invalid');
    req.user = user;
    req.sessionToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

export const requirePermission = (permission) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!req.user.permissions.includes(permission)) {
    return next(forbidden(`Permission required: ${permission}`));
  }
  return next();
};

export function canAccessSite(user, siteId) {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN' || user.role === 'CORPORATE_ADMIN') return true;
  return user.siteIds.includes(siteId);
}

export function assertSiteAccess(req, siteId) {
  if (!canAccessSite(req.user, siteId)) throw forbidden('You do not have access to this site');
}

/** Returns a SQL fragment (site filter) and params for the current user. */
export function siteScope(user) {
  if (user.role === 'SUPER_ADMIN' || user.role === 'CORPORATE_ADMIN') {
    return { sql: '', params: [], all: true };
  }
  if (!user.siteIds.length) return { sql: ' AND 1 = 0', params: [], all: false };
  return { sql: ` AND site_id IN (${user.siteIds.map(() => '?').join(',')})`, params: user.siteIds, all: false };
}

export async function audit(req, action, entity, entityId = null, details = null) {
  try {
    const db = getDb();
    await db.run(
      'INSERT INTO audit_logs (id, ts, user_id, username, action, entity, entity_id, details, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        uid('aud'), nowIso(), req.user?.id || null, req.user?.username || 'system', action, entity, entityId,
        details ? JSON.stringify(details) : null, req.ip || null, req.headers?.['user-agent'] || null,
      ],
    );
  } catch (err) {
    console.error('[audit] failed', err.message);
  }
}

/** Simple in-memory rate limiter (per key). */
export function rateLimit({ windowMs = 60_000, max = 60, keyFn = (req) => req.ip } = {}) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of hits) if (entry.start < cutoff) hits.delete(key);
  }, windowMs).unref?.();
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    if (entry.count > max) return next(Object.assign(new Error('Too many requests'), { status: 429, code: 'RATE_LIMITED' }));
    return next();
  };
}
