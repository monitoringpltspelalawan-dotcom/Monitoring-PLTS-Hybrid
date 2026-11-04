import express from 'express';
import { asyncHandler } from '../lib/errors.js';
import { authenticate, buildUserContext, createSession, cookieOptions, revokeSession, revokeUserSessions, SESSION_COOKIE } from '../services/authService.js';
import { requireAuth, audit, rateLimit } from '../middleware/auth.js';
import { getDb } from '../db/adapter.js';
import { hashPassword, passwordIssues, verifyPassword } from '../lib/passwords.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { config } from '../config.js';
import { nowIso } from '../lib/time.js';

const router = express.Router();

router.post(
  '/login',
  rateLimit({ windowMs: 60_000, max: 12 }),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) throw badRequest('Username and password are required');
    const user = await authenticate(String(username).trim(), String(password));
    if (!user) {
      await getDb().run(
        'INSERT INTO audit_logs (id, ts, user_id, username, action, entity, entity_id, details, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [`aud_${Date.now()}`, nowIso(), null, String(username).slice(0, 60), 'LOGIN_FAILED', 'auth', null, null, req.ip, req.headers['user-agent'] || null],
      );
      throw unauthorized('Invalid username or password');
    }
    const ctx = await buildUserContext(user);
    const session = await createSession(user, { ip: req.ip, userAgent: req.headers['user-agent'] });
    res.cookie(SESSION_COOKIE, session.token, cookieOptions());
    await audit({ ...req, user: ctx }, 'LOGIN', 'auth', user.id, { role: ctx.role });
    res.json({ user: ctx, token: session.token, expiresAt: session.expiresAt });
  }),
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeSession(req.sessionToken);
    await audit(req, 'LOGOUT', 'auth', req.user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);

router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) throw badRequest('Current and new password are required');
    const issues = passwordIssues(newPassword);
    if (issues.length) throw badRequest(`Password does not meet policy: ${issues.join(', ')}`, { issues });
    const db = getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!verifyPassword(currentPassword, user.password_salt, user.password_hash)) {
      throw badRequest('Current password is incorrect');
    }
    const { salt, hash } = hashPassword(newPassword);
    await db.run('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?', [hash, salt, nowIso(), req.user.id]);
    await revokeUserSessions(req.user.id);
    const fresh = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const ctx = await buildUserContext(fresh);
    const session = await createSession(fresh, { ip: req.ip, userAgent: req.headers['user-agent'] });
    res.cookie(SESSION_COOKIE, session.token, cookieOptions());
    await audit(req, 'CHANGE_PASSWORD', 'user', req.user.id);
    res.json({ ok: true, user: ctx, token: session.token });
  }),
);

router.get(
  '/demo-accounts',
  asyncHandler(async (req, res) => {
    if (!config.demoMode) return res.json({ accounts: [] });
    res.json({
      accounts: [
        { username: 'admin', password: config.demo.users.admin.password, role: 'Super Administrator' },
        { username: 'corpadmin', password: 'Corp@12345', role: 'Corporate Administrator' },
        { username: 'regional', password: 'Regional@12345', role: 'Regional Manager (West Java)' },
        { username: 'siteadmin', password: 'Site@12345', role: 'Site Administrator (3 sites)' },
        { username: 'operator', password: config.demo.users.operator.password, role: 'Operator (5 sites)' },
        { username: 'viewer', password: config.demo.users.viewer.password, role: 'Viewer (2 sites)' },
      ],
    });
  }),
);

export default router;
