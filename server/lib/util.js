import crypto from 'node:crypto';

export const round = (n, digits = 2) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  const f = 10 ** digits;
  return Math.round(Number(n) * f) / f;
};

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);

export const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);

export function roundObj(obj, digits = 2) {
  if (Array.isArray(obj)) return obj.map((v) => roundObj(v, digits));
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, roundObj(v, digits)]));
  }
  return typeof obj === 'number' ? round(obj, digits) : obj;
}

/** Deterministic PRNG (mulberry32) so demo history is reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const uid = (prefix = 'id') => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;

export const shortId = (prefix) => `${prefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

export const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

export const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Small exponential moving average helper for live values. */
export function ema(prev, next, alpha = 0.3) {
  return prev === null || prev === undefined ? next : prev + alpha * (next - prev);
}

export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.ceil((p / 100) * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[idx];
}

export function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function paginate(items, page = 1, pageSize = 50) {
  const p = Math.max(1, Number(page) || 1);
  const size = clamp(Number(pageSize) || 50, 1, 500);
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, pageSize: size };
}
