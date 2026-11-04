export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export function num(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(Number(value));
}

export function int(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value));
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${num(value, digits)}%`;
}

export function money(value: number | null | undefined, compact = true): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  if (compact) {
    const abs = Math.abs(Number(value));
    if (abs >= 1_000_000_000) return `Rp ${num(Number(value) / 1_000_000_000, 2)} B`;
    if (abs >= 1_000_000) return `Rp ${num(Number(value) / 1_000_000, 1)} M`;
    if (abs >= 1_000) return `Rp ${num(Number(value) / 1_000, 1)} K`;
  }
  return `Rp ${int(value)}`;
}

export function energy(kwh: number | null | undefined): string {
  if (kwh === null || kwh === undefined || Number.isNaN(Number(kwh))) return '—';
  const value = Number(kwh);
  if (Math.abs(value) >= 1_000_000) return `${num(value / 1_000_000, 2)} GWh`;
  if (Math.abs(value) >= 1_000) return `${num(value / 1_000, 2)} MWh`;
  return `${num(value, 1)} kWh`;
}

export function power(kw: number | null | undefined): string {
  if (kw === null || kw === undefined || Number.isNaN(Number(kw))) return '—';
  const value = Number(kw);
  if (Math.abs(value) >= 1_000_000) return `${num(value / 1_000_000, 2)} GW`;
  if (Math.abs(value) >= 1_000) return `${num(value / 1_000, 2)} MW`;
  return `${num(value, 1)} kW`;
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function dateShort(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return 'never';
  const ms = Date.now() - new Date(value).getTime();
  if (Number.isNaN(ms)) return '—';
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

export const severityColor: Record<string, string> = {
  CRITICAL: 'var(--critical)', WARNING: 'var(--warning)', INFO: 'var(--info)',
};

export const statusColor = (status: string | null | undefined) => {
  const s = String(status || '').toUpperCase();
  if (['ONLINE', 'GOOD', 'NORMAL', 'RUNNING', 'ACTIVE', 'OK', 'READY'].includes(s)) return 'var(--good)';
  if (['WARNING', 'DEGRADED', 'ACKNOWLEDGED', 'STANDBY', 'IDLE', 'MAINTENANCE', 'UNKNOWN'].includes(s)) return 'var(--warning)';
  if (['CRITICAL', 'OFFLINE', 'FAULT', 'BAD', 'UNREACHABLE', 'FAILED', 'SUSPENDED'].includes(s)) return 'var(--critical)';
  return 'var(--muted)';
};

export const sourceLabel = (source: string | null | undefined) => (String(source).toUpperCase() === 'LIVE' ? 'LIVE DATA' : 'DEMO DATA');
