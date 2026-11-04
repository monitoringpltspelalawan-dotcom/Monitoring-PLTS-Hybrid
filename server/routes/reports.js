import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/adapter.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../lib/errors.js';
import { requireAuth, requirePermission, audit } from '../middleware/auth.js';
import { allowedSites, parseDayRange, parsePagination, resolveSiteIds } from './helpers.js';
import { generateReport, REPORT_TYPES } from '../services/reports.js';
import { config } from '../config.js';
import { nowIso } from '../lib/time.js';
import { safeJsonParse, uid } from '../lib/util.js';

const router = express.Router();
router.use(requireAuth);

async function siteContext(req) {
  const allowed = await allowedSites(req);
  const requested = resolveSiteIds(req, req.query.siteIds || req.body?.siteIds);
  const permitted = requested.filter((id) => allowed.some((s) => s.id === id));
  return { allowed, siteIds: permitted };
}

function canReadReport(user, reportSiteIds) {
  if (user.role === 'SUPER_ADMIN' || user.role === 'CORPORATE_ADMIN') return true;
  if (!reportSiteIds.length) return true;
  return reportSiteIds.some((id) => user.siteIds.includes(id));
}

router.get(
  '/types',
  requirePermission('report:view'),
  asyncHandler(async (req, res) => {
    res.json({ types: REPORT_TYPES, formats: ['PDF', 'XLSX', 'CSV'], frequencies: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] });
  }),
);

router.get(
  '/',
  requirePermission('report:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { page, pageSize, offset } = parsePagination(req.query);
    const rows = await db.all('SELECT * FROM generated_reports ORDER BY created_at DESC LIMIT 500');
    const visible = rows
      .map((r) => ({ ...r, site_ids: safeJsonParse(r.site_ids, []) }))
      .filter((r) => canReadReport(req.user, r.site_ids));
    const items = visible.slice(offset, offset + pageSize).map((r) => ({
      ...r,
      downloadUrl: `/api/reports/${r.id}/download`,
      sizeKb: r.size_bytes ? Math.round((r.size_bytes / 1024) * 10) / 10 : 0,
    }));
    res.json({ reports: items, total: visible.length, page, pageSize });
  }),
);

router.post(
  '/generate',
  requirePermission('report:generate'),
  asyncHandler(async (req, res) => {
    const { siteIds } = await siteContext(req);
    const body = req.body || {};
    if (!body.type) throw badRequest('Report type is required');
    if (!REPORT_TYPES.some((t) => t.code === body.type)) throw badRequest('Unknown report type');
    const format = String(body.format || 'PDF').toUpperCase();
    if (!['PDF', 'XLSX', 'CSV'].includes(format)) throw badRequest('Unsupported format');
    const range = body.from && body.to ? { from: body.from, to: body.to } : parseDayRange(body, '30d');
    const record = await generateReport({
      type: body.type, format, fromDay: range.from, toDay: range.to,
      siteIds, user: req.user.username, name: body.name || undefined,
    });
    await audit(req, 'GENERATE', 'report', record.id, { type: body.type, format, from: range.from, to: range.to, siteIds });
    res.status(201).json({
      report: { ...record, site_ids: safeJsonParse(record.site_ids, []), downloadUrl: `/api/reports/${record.id}/download` },
    });
  }),
);

router.get(
  '/schedules',
  requirePermission('report:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const rows = await db.all('SELECT * FROM report_schedules ORDER BY created_at DESC');
    const schedules = rows.map((r) => {
      const siteIds = safeJsonParse(r.site_ids, []);
      return { ...r, site_ids: siteIds, recipients: safeJsonParse(r.recipients, []) };
    }).filter((r) => canReadReport(req.user, r.site_ids));
    res.json({ schedules });
  }),
);

router.post(
  '/schedules',
  requirePermission('report:schedule'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { siteIds } = await siteContext(req);
    const b = req.body || {};
    if (!b.name || !b.reportType || !b.frequency) throw badRequest('name, reportType and frequency are required');
    if (!REPORT_TYPES.some((t) => t.code === b.reportType)) throw badRequest('Unknown report type');
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(String(b.frequency).toUpperCase())) throw badRequest('Invalid frequency');
    const id = uid('sch');
    const now = nowIso();
    const next = new Date(Date.now() + 60_000).toISOString();
    await db.run(
      `INSERT INTO report_schedules (id, name, report_type, format, frequency, site_ids, recipients, enabled, last_run_at, next_run_at, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, b.name, b.reportType, String(b.format || 'PDF').toUpperCase(), String(b.frequency).toUpperCase(),
        JSON.stringify(siteIds), JSON.stringify(Array.isArray(b.recipients) ? b.recipients : []), b.enabled === false ? 0 : 1,
        null, next, req.user.username, now],
    );
    await audit(req, 'CREATE', 'report_schedule', id, { reportType: b.reportType, frequency: b.frequency });
    res.status(201).json({ schedule: await db.get('SELECT * FROM report_schedules WHERE id = ?', [id]) });
  }),
);

router.patch(
  '/schedules/:id',
  requirePermission('report:schedule'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const schedule = await db.get('SELECT * FROM report_schedules WHERE id = ?', [req.params.id]);
    if (!schedule) throw notFound('Schedule not found');
    if (!canReadReport(req.user, safeJsonParse(schedule.site_ids, []))) throw forbidden('Not authorized for this schedule');
    const map = { name: 'name', reportType: 'report_type', format: 'format', frequency: 'frequency', enabled: 'enabled', recipients: 'recipients', siteIds: 'site_ids' };
    const sets = []; const params = [];
    for (const [k, col] of Object.entries(map)) {
      if (req.body?.[k] === undefined) continue;
      sets.push(`${col} = ?`);
      const v = req.body[k];
      params.push(k === 'enabled' ? (v ? 1 : 0) : k === 'recipients' || k === 'siteIds' ? JSON.stringify(v) : v);
    }
    if (!sets.length) throw badRequest('No supported fields supplied');
    await db.run(`UPDATE report_schedules SET ${sets.join(', ')} WHERE id = ?`, [...params, schedule.id]);
    await audit(req, 'UPDATE', 'report_schedule', schedule.id, { fields: Object.keys(req.body || {}) });
    res.json({ schedule: await db.get('SELECT * FROM report_schedules WHERE id = ?', [schedule.id]) });
  }),
);

router.delete(
  '/schedules/:id',
  requirePermission('report:schedule'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const schedule = await db.get('SELECT * FROM report_schedules WHERE id = ?', [req.params.id]);
    if (!schedule) throw notFound('Schedule not found');
    if (!canReadReport(req.user, safeJsonParse(schedule.site_ids, []))) throw forbidden('Not authorized for this schedule');
    await db.run('DELETE FROM report_schedules WHERE id = ?', [schedule.id]);
    await audit(req, 'DELETE', 'report_schedule', schedule.id, { name: schedule.name });
    res.json({ ok: true });
  }),
);

router.post(
  '/schedules/:id/run',
  requirePermission('report:generate'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const schedule = await db.get('SELECT * FROM report_schedules WHERE id = ?', [req.params.id]);
    if (!schedule) throw notFound('Schedule not found');
    const scheduleSites = safeJsonParse(schedule.site_ids, []);
    if (scheduleSites.length && !scheduleSites.every((id) => req.user.siteIds.includes(id)) && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'CORPORATE_ADMIN') {
      throw forbidden('Not authorized for this schedule');
    }
    const range = parseDayRange({}, schedule.frequency === 'DAILY' ? '24h' : schedule.frequency === 'WEEKLY' ? '7d' : '30d');
    const record = await generateReport({
      type: schedule.report_type, format: schedule.format, fromDay: range.from, toDay: range.to,
      siteIds: scheduleSites, user: req.user.username, name: schedule.name,
    });
    await db.run('UPDATE report_schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?', [
      nowIso(), new Date(Date.now() + 30 * 86400_000).toISOString(), schedule.id,
    ]);
    await audit(req, 'RUN', 'report_schedule', schedule.id, { reportId: record.id });
    res.json({ ok: true, report: { ...record, downloadUrl: `/api/reports/${record.id}/download` } });
  }),
);

router.get(
  '/:id/download',
  requirePermission('report:view'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const report = await db.get('SELECT * FROM generated_reports WHERE id = ?', [req.params.id]);
    if (!report) throw notFound('Report not found');
    if (!canReadReport(req.user, safeJsonParse(report.site_ids, []))) throw forbidden('Not authorized for this report');
    const resolved = path.resolve(report.file_path);
    if (!resolved.startsWith(path.resolve(config.reportDir))) throw forbidden('Invalid report path');
    if (!fs.existsSync(resolved)) throw notFound('Report file has been removed');
    const ext = path.extname(resolved).toLowerCase();
    const mime = ext === '.pdf' ? 'application/pdf' : ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${report.name.replace(/[^a-z0-9_-]/gi, '_')}-${report.id}${ext}"`);
    fs.createReadStream(resolved).pipe(res);
  }),
);

router.delete(
  '/:id',
  requirePermission('report:generate'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const report = await db.get('SELECT * FROM generated_reports WHERE id = ?', [req.params.id]);
    if (!report) throw notFound('Report not found');
    if (!canReadReport(req.user, safeJsonParse(report.site_ids, []))) throw forbidden('Not authorized for this report');
    try { if (fs.existsSync(report.file_path)) fs.unlinkSync(report.file_path); } catch { /* ignore */ }
    await db.run('DELETE FROM generated_reports WHERE id = ?', [report.id]);
    await audit(req, 'DELETE', 'report', report.id, { name: report.name });
    res.json({ ok: true });
  }),
);

export default router;
