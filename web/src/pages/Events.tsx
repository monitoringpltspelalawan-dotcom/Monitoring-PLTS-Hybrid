import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Search, ClipboardList, AlertTriangle, Info, ShieldCheck, Filter } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorState, KV, Modal, PageHeader, Pagination, Spinner, StatCard } from '../components/ui';
import { Column, DataTable, RangePicker, RangeValue } from '../components/filters';
import { useAsync, useDebounced, useSites } from '../lib/hooks';
import { get, qs } from '../lib/api';
import { dateTime, timeAgo, statusColor } from '../lib/format';

export default function Events() {
  const navigate = useNavigate();
  const sitesState = useSites();
  const [siteId, setSiteId] = useState('');
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [range, setRange] = useState<RangeValue>({ range: '30d' });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [detail, setDetail] = useState<any>(null);

  const params = {
    siteId, type, severity, search: debounced, page, pageSize,
    ...(range.from && range.to ? { from: range.from, to: range.to } : { range: range.range }),
  };
  const data = useAsync<any>(() => get(`/api/alarms/events${qs(params)}`), [siteId, type, severity, debounced, range.range, range.from, range.to, page]);
  useEffect(() => { setPage(1); }, [siteId, type, severity, debounced, range.range, range.from, range.to]);

  const events = data.data?.events || [];
  const siteCount = new Set(events.map((e: any) => e.site_id).filter(Boolean)).size;
  const critical = events.filter((e: any) => e.severity === 'CRITICAL').length;
  const warning = events.filter((e: any) => e.severity === 'WARNING').length;
  const types: string[] = [...new Set<string>(events.map((e: any) => String(e.type)))] .sort();

  const columns: Column<any>[] = [
    { key: 'ts', label: 'Time', render: (e) => <span className="mono">{dateTime(e.ts)}</span> },
    { key: 'severity', label: 'Severity', render: (e) => <Badge status={e.severity}>{e.severity}</Badge> },
    { key: 'type', label: 'Type', render: (e) => <span className="tag">{e.type}</span> },
    { key: 'message', label: 'Event', render: (e) => <span className="event-message">{e.message}</span> },
    {
      key: 'site', label: 'Site',
      render: (e) => e.site_code ? <div className="cell-main"><strong>{e.site_code}</strong><small>{e.site_name || ''}</small></div> : <span className="muted">Platform</span>,
    },
    { key: 'data_source', label: 'Source', render: (e) => <span className={`source-tag ${e.data_source === 'LIVE' ? 'live' : 'demo'}`}>{e.data_source || 'DEMO'}</span> },
    { key: 'age', label: 'Age', align: 'right', render: (e) => <span className="muted">{timeAgo(e.ts)}</span> },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations timeline"
        title="Event register"
        subtitle="Chronological operational, configuration, communication and alarm events across the estate."
        actions={<Badge color="var(--accent)" dot>{data.data?.total ?? 0} EVENTS</Badge>}
      />

      <div className="grid stats-grid compact">
        <StatCard label="Matching events" value={data.data?.total ?? 0} icon={<ClipboardList size={16} />} sub={<span>Within the selected period</span>} />
        <StatCard label="Critical in view" value={critical} tone={critical ? 'bad' : 'good'} icon={<AlertTriangle size={16} />} sub={<span>Current page only</span>} />
        <StatCard label="Warnings in view" value={warning} tone={warning ? 'warn' : 'good'} icon={<Info size={16} />} sub={<span>Current page only</span>} />
        <StatCard label="Sites represented" value={siteCount} icon={<Activity size={16} />} sub={<span>On the current page</span>} />
      </div>

      <div className="filter-bar">
        <label className="search grow"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search event message…" /></label>
        <select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site">
          <option value="">All authorized sites</option>
          {(sitesState.data?.sites || []).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
        </select>
        <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          <option value="">All severities</option>
          {['CRITICAL', 'WARNING', 'INFO'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Event type">
          <option value="">All event types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <RangePicker value={range} onChange={setRange} ranges={['7d', '30d', '90d', '365d']} />
      </div>

      {data.error && <ErrorState error={data.error} onRetry={data.reload} />}

      <Card
        title="Event history"
        subtitle="Newest first · click a row for the full record"
        actions={<span className="filter-meta"><Filter size={13} /> {siteId ? 'site-filtered' : 'portfolio-wide'}</span>}
        noPad
      >
        {data.loading && !data.data ? <Spinner label="Loading event register…" /> : (
          <>
            <DataTable columns={columns} rows={events} onRowClick={(e) => setDetail(e)} dense />
            <Pagination page={page} pageSize={pageSize} total={data.data?.total || 0} onChange={setPage} />
          </>
        )}
      </Card>

      {!data.loading && !events.length && (
        <EmptyState title="No events match" message="Widen the date range or clear the site, severity and type filters." icon={<ClipboardList size={22} />} />
      )}

      <div className="mini-strip">
        <span><ShieldCheck size={14} /> Events are immutable operational records</span>
        <span><Activity size={14} /> Alarm actions also appear in the audit trail</span>
        <span className="muted">Retention follows platform policy</span>
      </div>

      <Modal open={Boolean(detail)} title="Event detail" onClose={() => setDetail(null)}
        footer={<><span className="form-note"><ShieldCheck size={13} /> Read-only record</span></>}>
        {detail && (
          <div className="stack">
            <div className="alarm-detail-head">
              <Badge status={detail.severity}>{detail.severity}</Badge>
              <span className="tag">{detail.type}</span>
              <span className={`source-tag ${detail.data_source === 'LIVE' ? 'live' : 'demo'}`}>{detail.data_source || 'DEMO'}</span>
            </div>
            <p className="modal-copy">{detail.message}</p>
            <KV items={[
              { label: 'Timestamp', value: dateTime(detail.ts) },
              { label: 'Event ID', value: <span className="mono">{detail.id}</span> },
              { label: 'Site', value: detail.site_code ? `${detail.site_code} · ${detail.site_name}` : 'Platform-wide' },
              { label: 'Device', value: detail.device_id || '—' },
              { label: 'Actor', value: detail.user_id || 'System' },
              { label: 'Age', value: timeAgo(detail.ts) },
            ]} />
            {detail.site_id && <div className="row-actions"><button className="btn btn-sm btn-ghost" onClick={() => { setDetail(null); navigate(`/sites/${detail.site_id}`); }}>Open site</button></div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
