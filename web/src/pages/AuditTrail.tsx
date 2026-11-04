import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollText, RefreshCw, Search, ShieldCheck, UserCog, Activity, Filter, Eye, CalendarRange, Database,
} from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, ErrorState, KV, Modal, Notice, PageHeader, Pagination, Spinner, StatCard,
} from '../components/ui';
import { Column, DataTable } from '../components/filters';
import { useAsync, useDebounced } from '../lib/hooks';
import { get, qs } from '../lib/api';
import { cn, dateTime, timeAgo } from '../lib/format';

const ACTIONS = [
  'LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'ROTATE_TOKEN', 'APPLY_TEMPLATE', 'TEST_CONNECTION',
  'ACKNOWLEDGE', 'RESOLVE', 'BULK_ACKNOWLEDGE', 'GENERATE', 'RUN', 'RESET_PASSWORD', 'CHANGE_PASSWORD',
  'UPDATE_CONFIG',
];
const ENTITIES = [
  'auth', 'user', 'site', 'device', 'gateway', 'modbus', 'modbus_register', 'alarm', 'alarm_rule',
  'report', 'report_schedule', 'settings', 'tariff', 'region',
];

const actionTone = (action: string) => {
  if (action.includes('DELETE') || action === 'ROTATE_TOKEN' || action === 'RESET_PASSWORD') return 'var(--critical)';
  if (action.includes('CREATE') || action === 'GENERATE' || action === 'RUN') return 'var(--good)';
  if (action.includes('UPDATE') || action.includes('ACKNOWLEDGE') || action.includes('RESOLVE')) return 'var(--warning)';
  if (action === 'LOGIN' || action === 'LOGOUT') return 'var(--info)';
  return 'var(--muted)';
};

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

export default function AuditTrail() {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [detail, setDetail] = useState<any>(null);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const audit = useAsync<any>(() => get(`/api/users/audit/log${qs({ search: debounced, action, entity, from, to, page, pageSize })}`), [debounced, action, entity, from, to, page]);

  useEffect(() => { setPage(1); }, [debounced, action, entity, from, to]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const rows = audit.data?.logs || [];
  const total = audit.data?.total || 0;
  const summary = audit.data?.summary || [];
  const topAction = summary[0];

  const uniqueUsers = useMemo(() => new Set(rows.map((r: any) => r.username).filter(Boolean)).size, [rows]);
  const uniqueEntities = useMemo(() => new Set(rows.map((r: any) => r.entity).filter(Boolean)).size, [rows]);

  const resetFilters = () => { setSearch(''); setAction(''); setEntity(''); setFrom(daysAgo(30)); setTo(new Date().toISOString().slice(0, 10)); };

  const columns: Column<any>[] = [
    { key: 'ts', label: 'Timestamp', render: (r) => <div className="cell-main"><strong className="mono small">{dateTime(r.ts)}</strong><small>{timeAgo(r.ts)}</small></div> },
    { key: 'username', label: 'Actor', render: (r) => <div className="cell-main"><strong>{r.username || 'system'}</strong><small>{r.ip || 'internal'}</small></div> },
    { key: 'action', label: 'Action', render: (r) => <span className="badge" style={{ '--badge-color': actionTone(r.action) } as React.CSSProperties}><i className="badge-dot" />{r.action}</span> },
    { key: 'entity', label: 'Entity', render: (r) => <div className="cell-main"><strong>{r.entity || '—'}</strong><small className="mono">{r.entity_id || '—'}</small></div> },
    {
      key: 'details', label: 'Detail',
      render: (r) => <span className="mono small muted detail-clip">{r.details && typeof r.details === 'object' ? JSON.stringify(r.details) : String(r.details || '—')}</span>,
    },
    {
      key: 'inspect', label: '', align: 'right',
      render: (r) => <Button size="sm" variant="ghost" icon={<Eye size={12} />} onClick={() => setDetail(r)}>View</Button>,
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Audit trail"
        subtitle="Immutable record of authentication, configuration, alarm and reporting activity across the platform."
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => audit.reload()}>Refresh</Button>}
      />

      {toast && <Notice tone={toast.tone} onClose={() => setToast(null)}>{toast.text}</Notice>}

      <div className="grid stats-grid compact">
        <StatCard label="Audit entries" value={total} icon={<ScrollText size={16} />} sub={<span>{from} → {to}</span>} />
        <StatCard label="Distinct actors" value={uniqueUsers} icon={<UserCog size={16} />} sub={<span>On the current page</span>} />
        <StatCard label="Entity classes" value={uniqueEntities} icon={<Database size={16} />} sub={<span>{summary.length} action types observed</span>} />
        <StatCard label="Most frequent" value={topAction ? topAction.action : '—'} tone="info" icon={<Activity size={16} />} sub={<span>{topAction ? `${topAction.c} events` : 'No events in range'}</span>} />
      </div>

      <div className="filter-bar wrap">
        <label className="search grow"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search action, entity, user or detail…" /></label>
        <select className="input" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action filter">
          <option value="">All actions</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="input" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Entity filter">
          <option value="">All entities</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{e.replace(/_/g, ' ')}</option>)}
        </select>
        <label className="date-field"><CalendarRange size={14} /><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <span className="muted">→</span>
        <label className="date-field"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <Button size="sm" variant="ghost" icon={<Filter size={12} />} onClick={resetFilters}>Reset</Button>
      </div>

      {summary.length > 0 && (
        <div className="action-summary">
          <span className="section-label">Action breakdown</span>
          <div className="summary-chips">
            {summary.map((s: any) => (
              <button key={s.action} className={cn('summary-chip', action === s.action && 'active')} onClick={() => setAction(action === s.action ? '' : s.action)}>
                <i style={{ background: actionTone(s.action) }} />
                {s.action.replace(/_/g, ' ')}
                <strong>{s.c}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      {audit.error && <ErrorState error={audit.error} onRetry={audit.reload} />}

      <Card title="Audit events" subtitle="Newest first · entries are append-only" noPad>
        {audit.loading && !audit.data ? <Spinner label="Loading audit trail…" /> : (
          <DataTable columns={columns} rows={rows} onRowClick={(r) => setDetail(r)} dense />
        )}
        <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
      </Card>

      {!audit.loading && !rows.length && (
        <EmptyState title="No audit events in range" message="Broaden the date range or clear the activity filters." icon={<ScrollText size={22} />} />
      )}

      <div className="mini-strip">
        <span><ShieldCheck size={14} /> Audit entries are retained for 365 days by the maintenance job</span>
        <span><ScrollText size={14} /> Authentication, configuration, alarm and report actions are captured</span>
        <span><Database size={14} /> Read-only records · no editing or deletion through the API</span>
      </div>

      <Modal open={!!detail} title="Audit event" onClose={() => setDetail(null)} wide
        footer={<Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>}>
        {detail && <>
          <div className="detail-head">
            <div>
              <div className="eyebrow">{detail.entity || 'platform'}</div>
              <h3>{detail.action}</h3>
              <p>{detail.username || 'system'} · {dateTime(detail.ts)}</p>
            </div>
            <Badge color={actionTone(detail.action)}>{detail.action}</Badge>
          </div>
          <KV items={[
            { label: 'Entry ID', value: <span className="mono">{detail.id}</span> },
            { label: 'Actor', value: detail.username || 'system' },
            { label: 'User ID', value: <span className="mono">{detail.user_id || '—'}</span> },
            { label: 'Entity', value: detail.entity || '—' },
            { label: 'Entity ID', value: <span className="mono">{detail.entity_id || '—'}</span> },
            { label: 'Source IP', value: <span className="mono">{detail.ip || '—'}</span> },
          ]} />
          <div className="section-label">Detail payload</div>
          <pre className="json-preview">{JSON.stringify(detail.details ?? {}, null, 2)}</pre>
          <div className="section-label">User agent</div>
          <p className="mono small muted">{detail.user_agent || '—'}</p>
        </>}
      </Modal>
    </div>
  );
}
