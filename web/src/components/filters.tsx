import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Calendar, Building2 } from 'lucide-react';
import { cn } from '../lib/format';

export interface SiteOption { id: string; code: string; name: string; regionName?: string | null; status?: string }

export function SiteSelector({ sites, selected, onChange, label = 'Sites', single, allowAll = true, className }: {
  sites: SiteOption[]; selected: string[]; onChange: (ids: string[]) => void;
  label?: string; single?: boolean; allowAll?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = sites.filter((s) => `${s.code} ${s.name} ${s.regionName || ''}`.toLowerCase().includes(query.toLowerCase()));
  const allSelected = selected.length === 0 || selected.length === sites.length;
  const text = allSelected ? `All sites (${sites.length})` : selected.length === 1
    ? sites.find((s) => s.id === selected[0])?.code || '1 site'
    : `${selected.length} sites`;

  const toggle = (id: string) => {
    if (single) { onChange([id]); setOpen(false); return; }
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next.length === sites.length ? [] : next);
  };

  return (
    <div className={cn('site-select', className)} ref={ref}>
      <button className="input site-select-btn" onClick={() => setOpen((v) => !v)} type="button">
        <Building2 size={14} />
        <span>{text}</span>
        <ChevronDown size={14} className="ml-auto" />
      </button>
      {open && (
        <div className="dropdown">
          <div className="dropdown-head">
            <input className="input" autoFocus placeholder={`Search ${label.toLowerCase()}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {allowAll && !single && (
            <button className="dropdown-item" onClick={() => onChange([])}>
              <span className={cn('check', allSelected && 'checked')}>{allSelected && <Check size={11} />}</span>
              <strong>All authorized sites</strong>
            </button>
          )}
          <div className="dropdown-list">
            {filtered.map((s) => {
              const checked = selected.includes(s.id) || (allowAll && selected.length === 0);
              return (
                <button key={s.id} className="dropdown-item" onClick={() => toggle(s.id)}>
                  <span className={cn('check', checked && 'checked')}>{checked && <Check size={11} />}</span>
                  <span className="site-opt">
                    <strong>{s.code}</strong>
                    <small>{s.name}{s.regionName ? ` · ${s.regionName}` : ''}</small>
                  </span>
                </button>
              );
            })}
            {!filtered.length && <div className="dropdown-empty">No matching sites</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export type RangeValue = { range: string; from?: string; to?: string };

export function RangePicker({ value, onChange, ranges = ['24h', '7d', '30d', '90d', '365d'], showCustom = true }: {
  value: RangeValue; onChange: (v: RangeValue) => void; ranges?: string[]; showCustom?: boolean;
}) {
  const [custom, setCustom] = useState(Boolean(value.from));
  return (
    <div className="range-picker">
      <div className="segmented">
        {ranges.map((r) => (
          <button key={r} className={cn(value.range === r && !value.from && 'active')} onClick={() => { setCustom(false); onChange({ range: r }); }}>
            {r.toUpperCase()}
          </button>
        ))}
      </div>
      {showCustom && (
        <button className={cn('btn btn-sm btn-ghost', custom && 'active')} onClick={() => setCustom((v) => !v)} title="Custom date range">
          <Calendar size={14} /> Custom
        </button>
      )}
      {custom && (
        <div className="custom-range">
          <input type="date" className="input" value={value.from || ''} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span>→</span>
          <input type="date" className="input" value={value.to || ''} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </div>
      )}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

export function DataTable<T extends Record<string, any>>({ columns, rows, onRowClick, footer, dense }: {
  columns: Column<T>[]; rows: T[]; onRowClick?: (row: T) => void; footer?: React.ReactNode; dense?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className={cn('data-table', dense && 'dense')}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.className} style={{ textAlign: c.align || 'left' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || row.siteId || row.code || i} onClick={onRowClick ? () => onRowClick(row) : undefined} className={onRowClick ? 'clickable' : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.className} style={{ textAlign: c.align || 'left' }}>
                  {c.render ? c.render(row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={columns.length} className="table-empty">No records</td></tr>}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

export function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span className={cn('live-dot', connected && 'on')} title={connected ? 'Realtime connected' : 'Realtime disconnected'}>
      <i /> {connected ? 'LIVE' : 'OFFLINE'}
    </span>
  );
}
