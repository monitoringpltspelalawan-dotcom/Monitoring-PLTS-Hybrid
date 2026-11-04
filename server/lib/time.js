/** Time helpers. All persistence is UTC ISO-8601; display uses site timezone. */

export const nowIso = () => new Date().toISOString();

export function toIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function partsInTz(date, timeZone = 'Asia/Jakarta') {
  const d = date instanceof Date ? date : new Date(date);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  // Intl can return hour '24' for midnight in some environments
  const hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
  };
}

export const localDateKey = (date, tz) => {
  const p = partsInTz(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

export const localHourKey = (date, tz) => {
  const p = partsInTz(date, tz);
  return `${localDateKey(date, tz)}T${String(p.hour).padStart(2, '0')}:00`;
};

/** Local decimal hour (e.g. 13.75) used by the solar model. */
export const localHourDecimal = (date, tz) => {
  const p = partsInTz(date, tz);
  return p.hour + p.minute / 60 + p.second / 3600;
};

/** UTC instant of a local wall-clock day start (used for range filters). */
export function localDayStartUtc(dayKey, tz = 'Asia/Jakarta') {
  // Determine offset at that time by iterating (DST-safe enough for fixed-offset zones).
  const [y, m, d] = dayKey.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const p = partsInTz(new Date(guess), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const target = Date.UTC(y, m - 1, d, 0, 0, 0);
    const diff = target - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}

export function dayKeyOffset(dayKey, offsetDays) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}

export function monthKey(dayKey) {
  return dayKey.slice(0, 7);
}

export function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

export function daysAgoIso(days) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

export function formatInTz(iso, tz, opts = {}) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'Asia/Jakarta',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...opts,
  }).format(new Date(iso));
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function enumerateDays(fromKey, toKey) {
  const out = [];
  let cur = fromKey;
  let guard = 0;
  while (cur <= toKey && guard < 4000) {
    out.push(cur);
    cur = dayKeyOffset(cur, 1);
    guard += 1;
  }
  return out;
}
