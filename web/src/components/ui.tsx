import React from 'react';
import { X, Search, ChevronLeft, ChevronRight, Inbox, AlertTriangle, Loader2 } from 'lucide-react';
import { cn, statusColor } from '../lib/format';

export function Card({ title, subtitle, actions, children, className, noPad, id }: {
  title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode;
  children: React.ReactNode; className?: string; noPad?: boolean; id?: string;
}) {
  return (
    <section className={cn('card', className)} id={id}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={cn('card-body', noPad && 'no-pad')}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, unit, sub, icon, color, tone }: {
  label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode;
  icon?: React.ReactNode; color?: string; tone?: 'good' | 'warn' | 'bad' | 'info' | 'pv' | 'bess';
}) {
  return (
    <div className={cn('stat', tone && `stat-${tone}`)} style={color ? { '--stat-color': color } as React.CSSProperties : undefined}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Badge({ children, status, color, dot = true, className }: {
  children: React.ReactNode; status?: string; color?: string; dot?: boolean; className?: string;
}) {
  const c = color || (status ? statusColor(status) : 'var(--muted)');
  return (
    <span className={cn('badge', className)} style={{ '--badge-color': c } as React.CSSProperties}>
      {dot && <i className="badge-dot" />}
      {children}
    </span>
  );
}

export function Button({ children, variant = 'default', size = 'md', icon, loading, className, ...props }: {
  children?: React.ReactNode; variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'success'; size?: 'sm' | 'md';
  icon?: React.ReactNode; loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cn('btn', `btn-${variant}`, `btn-${size}`, className)} disabled={loading || props.disabled} {...props}>
      {loading ? <Loader2 size={14} className="spin" /> : icon}
      {children}
    </button>
  );
}

export function PageHeader({ title, subtitle, eyebrow, actions }: {
  title: string; subtitle?: React.ReactNode; eyebrow?: string; actions?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div className={cn('tabs', className)} role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={cn('tab', value === t.value && 'active')} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="state"><Loader2 className="spin" size={22} /><span>{label}</span></div>;
}

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="state state-error">
      <AlertTriangle size={22} />
      <span>{error}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function EmptyState({ title = 'No records', message, icon }: { title?: string; message?: string; icon?: React.ReactNode }) {
  return (
    <div className="state state-empty">
      {icon || <Inbox size={22} />}
      <strong>{title}</strong>
      {message && <span>{message}</span>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cn('modal', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="search">
      <Search size={14} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('field', className)}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Select({ value, onChange, options, className, disabled }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; className?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select className={cn('input', className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-knob" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Pagination({ page, pageSize, total, onChange }: {
  page: number; pageSize: number; total: number; onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div>
        <button className="icon-btn" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous"><ChevronLeft size={15} /></button>
        <span className="page-num">{page} / {pages}</span>
        <button className="icon-btn" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next"><ChevronRight size={15} /></button>
      </div>
    </div>
  );
}

export function ProgressBar({ value, max = 100, color, label }: { value: number | null; max?: number; color?: string; label?: string }) {
  const pctValue = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="progress-wrap">
      {label && <div className="progress-label"><span>{label}</span><span>{value == null ? '—' : `${Math.round(pctValue)}%`}</span></div>}
      <div className="progress"><span style={{ width: `${pctValue}%`, background: color || 'var(--accent)' }} /></div>
    </div>
  );
}

export function Notice({ children, tone = 'info', onClose }: { children: React.ReactNode; tone?: 'info' | 'warn' | 'error' | 'success'; onClose?: () => void }) {
  return (
    <div className={cn('notice', `notice-${tone}`)}>
      <div>{children}</div>
      {onClose && <button className="icon-btn" onClick={onClose} aria-label="Dismiss"><X size={14} /></button>}
    </div>
  );
}

export function KV({ items }: { items: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <dl className="kv">
      {items.map((it) => (
        <div key={it.label}><dt>{it.label}</dt><dd>{it.value ?? '—'}</dd></div>
      ))}
    </dl>
  );
}
