import { getDb } from '../db/adapter.js';
import { dayKeyOffset, localDateKey } from '../lib/time.js';

export async function allowedSites(req) {
  const db = getDb();
  const user = req.user;
  if (!user) return [];
  if (user.role === 'SUPER_ADMIN' || user.role === 'CORPORATE_ADMIN') {
    return db.all(
      `SELECT s.*, r.name AS region_name, r.code AS region_code FROM sites s
       LEFT JOIN regions r ON r.id = s.region_id ORDER BY s.code`,
    );
  }
  if (!user.siteIds.length) return [];
  return db.all(
    `SELECT s.*, r.name AS region_name, r.code AS region_code FROM sites s
     LEFT JOIN regions r ON r.id = s.region_id
     WHERE s.id IN (${user.siteIds.map(() => '?').join(',')}) ORDER BY s.code`,
    user.siteIds,
  );
}

export function filterSiteRows(sites, { region, status, search, dataSource } = {}) {
  let out = sites;
  if (region) {
    out = out.filter((s) => s.region_id === region || s.region_code === region || s.region_name === region);
  }
  if (status) {
    const statuses = String(status).toUpperCase().split(',');
    out = out.filter((s) => statuses.includes(String(s.status).toUpperCase()));
  }
  if (dataSource) {
    out = out.filter((s) => String(s.data_source).toUpperCase() === String(dataSource).toUpperCase());
  }
  if (search) {
    const q = String(search).toLowerCase();
    out = out.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || (s.location || '').toLowerCase().includes(q));
  }
  return out;
}

export function parseDayRange(query = {}, defaultRange = '30d') {
  const ranges = { '24h': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
  const fallbackDays = ranges[query.range] || ranges[defaultRange] || 30;
  const today = localDateKey(new Date(), 'Asia/Jakarta');
  const to = query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? query.to : today;
  const from = query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : dayKeyOffset(to, -(fallbackDays - 1));
  return { from, to };
}

export function resolveSiteIds(req, requested) {
  let ids = Array.isArray(requested)
    ? requested
    : requested
      ? String(requested).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  if (!ids.length) return req.user.siteIds;
  if (req.user.role === 'SUPER_ADMIN' || req.user.role === 'CORPORATE_ADMIN') return ids;
  return ids.filter((id) => req.user.siteIds.includes(id));
}

export function parsePagination(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function requireBodyFields(body, fields) {
  const missing = fields.filter((f) => body?.[f] === undefined || body?.[f] === null || body?.[f] === '');
  if (missing.length) {
    const err = new Error(`Missing required field(s): ${missing.join(', ')}`);
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = { missing };
    throw err;
  }
}

export function numberField(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function siteStatusCounts(sites) {
  return sites.reduce(
    (acc, s) => {
      acc.total += 1;
      const key = String(s.status || 'UNKNOWN').toUpperCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    { total: 0, ONLINE: 0, OFFLINE: 0, WARNING: 0, CRITICAL: 0, MAINTENANCE: 0 },
  );
}
