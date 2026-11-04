import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BellRing, AlertTriangle, CheckCheck, CheckCircle2, Search, SlidersHorizontal, Plus, Trash2, ShieldCheck, Activity, Bell,
} from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, KV, Modal, Notice, PageHeader, Pagination, Spinner, StatCard, Tabs,
} from '../components/ui';
import { Column, DataTable } from '../components/filters';
import { useAsync, useDebounced, useSites } from '../lib/hooks';
import { del, get, patch, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRealtime } from '../lib/ws';
import { cn, dateTime, num, statusColor, timeAgo } from '../lib/format';

type Tab = 'active' | 'all' | 'rules';

const EMPTY_RULE = {
  code: '', name: '', parameterId: '', severity: 'WARNING', operator: '>', threshold: 0,
  durationSec: 0, category: 'GENERAL', enabled: true, siteId: '',
};

export default function Alarms() {
  const navigate = useNavigate();
  const { has, user } = useAuth();
  const { alarmFeed } = useRealtime();
  const sitesState = useSites();
  const [tab, setTab] = useState<Tab>('active');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [siteId, setSiteId] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);

  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const [ruleOpen, setRuleOpen] = useState(false);
  const [editRule, setEditRule] = useState<any>(null);
  const [ruleForm, setRuleForm] = useState<any>(EMPTY_RULE);
  const [ruleError, setRuleError] = useState<string | null>(null);

  const stats = useAsync<any>(() => get('/api/alarms/stats'), []);
  const data = useAsync<any>(() => get(`/api/alarms${qs({
    severity, status: tab === 'active' ? (status || 'OPEN') : status, siteId, category, search: debounced, page, pageSize,
  })}`), [severity, status, siteId, category, debounced, page, tab]);
  const rules = useAsync<any>(() => get('/api/alarms/rules'), []);

  useEffect(() => { setPage(1); }, [severity, status, siteId, category, debounced, tab]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (alarmFeed.length && tab === 'active') data.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alarmFeed.length]);

  const openDetail = async (alarm: any) => {
    setDetail({ alarm, notifications: [] });
    setDetailLoading(true);
    try {
      const payload = await get<any>(`/api/alarms/${alarm.id}`);
      setDetail(payload);
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not load alarm detail' });
    } finally { setDetailLoading(false); }
  };

  const refreshAll = () => { data.reload(); stats.reload(); };

  const ack = async (alarm: any) => {
    setBusy(true);
    try {
      await post(`/api/alarms/${alarm.id}/acknowledge`, { note: 'Acknowledged from alarm centre' });
      setToast({ tone: 'success', text: `Alarm ${alarm.code} acknowledged.` });
      setDetail(null);
      refreshAll();
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Acknowledgement failed' });
    } finally { setBusy(false); }
  };

  const resolve = async () => {
    if (!detail?.alarm) return;
    setBusy(true);
    try {
      await post(`/api/alarms/${detail.alarm.id}/resolve`, { note: note || 'Resolved from alarm centre' });
      setToast({ tone: 'success', text: `Alarm ${detail.alarm.code} resolved.` });
      setResolveOpen(false);
      setDetail(null);
      setNote('');
      refreshAll();
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Resolution failed' });
    } finally { setBusy(false); }
  };

  const openRule = (rule?: any) => {
    setEditRule(rule || null);
    setRuleError(null);
    setRuleForm(rule ? {
      code: rule.code, name: rule.name, parameterId: rule.parameter_id, severity: rule.severity,
      operator: rule.operator, threshold: rule.threshold, durationSec: rule.duration_sec,
      category: rule.category || 'GENERAL', enabled: Boolean(rule.enabled), siteId: rule.site_id || '',
    } : { ...EMPTY_RULE });
    setRuleOpen(true);
  };

  const saveRule = async () => {
    setBusy(true);
    setRuleError(null);
    try {
      if (editRule) {
        await patch(`/api/alarms/rules/${editRule.id}`, {
          name: ruleForm.name, severity: ruleForm.severity, operator: ruleForm.operator,
          threshold: Number(ruleForm.threshold), durationSec: Number(ruleForm.durationSec),
          category: ruleForm.category, enabled: ruleForm.enabled, siteId: ruleForm.siteId || null,
          parameterId: ruleForm.parameterId,
        });
      } else {
        await post('/api/alarms/rules', {
          ...ruleForm, threshold: Number(ruleForm.threshold), durationSec: Number(ruleForm.durationSec),
          siteId: ruleForm.siteId || null,
        });
      }
      setRuleOpen(false);
      rules.reload();
      setToast({ tone: 'success', text: editRule ? 'Alarm rule updated.' : 'Alarm rule created.' });
    } catch (err: any) {
      setRuleError(err?.message || 'Could not save rule');
    } finally { setBusy(false); }
  };

  const toggleRule = async (rule: any) => {
    try {
      await patch(`/api/alarms/rules/${rule.id}`, { enabled: !rule.enabled });
      rules.reload();
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not change rule state' });
    }
  };

  const deleteRule = async (rule: any) => {
    if (!window.confirm(`Delete alarm rule ${rule.code}?`)) return;
    try {
      await del(`/api/alarms/rules/${rule.id}`);
      rules.reload();
      setToast({ tone: 'success', text: `Rule ${rule.code} deleted.` });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not delete rule' });
    }
  };

  const alarmColumns: Column<any>[] = [
    { key: 'severity', label: 'Severity', render: (a) => <Badge status={a.severity}>{a.severity}</Badge> },
    {
      key: 'title', label: 'Alarm',
      render: (a) => <div className="cell-main"><strong>{a.title}</strong><small>{a.code} · {a.category || 'GENERAL'}{a.device_name ? ` · ${a.device_name}` : ''}</small></div>,
    },
    {
      key: 'site', label: 'Site',
      render: (a) => <div className="cell-main"><strong>{a.site_code || '—'}</strong><small>{a.site_name || ''}</small></div>,
    },
    {
      key: 'value', label: 'Value / threshold', align: 'right',
      render: (a) => <span className="mono">{a.value == null ? '—' : num(a.value, 2)}{a.threshold != null ? ` / ${num(a.threshold, 2)}` : ''}</span>,
    },
    { key: 'status', label: 'Status', render: (a) => <Badge status={a.status}>{a.status}</Badge> },
    { key: 'triggered_at', label: 'Triggered', align: 'right', render: (a) => <span className="muted">{timeAgo(a.triggered_at)}</span> },
    {
      key: 'actions', label: '', align: 'right',
      render: (a) => (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => void openDetail(a)}>Details</Button>
          {a.status === 'ACTIVE' && has('alarm:ack') && <Button size="sm" variant="ghost" icon={<CheckCheck size={12} />} onClick={() => void ack(a)}>Ack</Button>}
          {a.status !== 'RESOLVED' && has('alarm:resolve') && (
            <Button size="sm" variant="ghost" icon={<CheckCircle2 size={12} />} onClick={() => { setDetail({ alarm: a, notifications: [] }); setNote(''); setResolveOpen(true); }}>Resolve</Button>
          )}
        </span>
      ),
    },
  ];

  const ruleColumns: Column<any>[] = [
    { key: 'code', label: 'Rule', render: (r) => <div className="cell-main"><strong>{r.code}</strong><small>{r.name}</small></div> },
    { key: 'parameter_id', label: 'Parameter', render: (r) => <span className="mono muted">{r.parameter_id}</span> },
    { key: 'condition', label: 'Condition', render: (r) => <span className="mono">{r.parameter_id} {r.operator} {num(r.threshold, 2)}</span> },
    { key: 'duration_sec', label: 'Duration', align: 'right', render: (r) => <span className="mono">{r.duration_sec ? `${r.duration_sec}s` : 'Instant'}</span> },
    { key: 'severity', label: 'Severity', render: (r) => <Badge status={r.severity}>{r.severity}</Badge> },
    { key: 'category', label: 'Category', render: (r) => <span className="tag">{r.category || 'GENERAL'}</span> },
    { key: 'site_id', label: 'Scope', render: (r) => <span className="muted">{r.site_id ? 'Site-specific' : 'Portfolio'}</span> },
    {
      key: 'enabled', label: 'Enabled', align: 'center',
      render: (r) => <button className={cn('switch', r.enabled && 'on')} onClick={() => void toggleRule(r)} aria-label="Toggle rule"><span /></button>,
    },
    {
      key: 'actions', label: '', align: 'right',
      render: (r) => (
        <span className="row-actions">
          {has('alarm:rules') && <Button size="sm" variant="ghost" onClick={() => openRule(r)}>Edit</Button>}
          {has('alarm:rules') && <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => void deleteRule(r)}>Delete</Button>}
        </span>
      ),
    },
  ];

  const counts = data.data?.counts || stats.data?.counts || {};
  const tabs = [
    { value: 'active' as Tab, label: 'Open alarms', count: stats.data?.active ?? counts.total },
    { value: 'all' as Tab, label: 'All alarms', count: counts.total },
    { value: 'rules' as Tab, label: 'Threshold rules', count: rules.data?.rules?.length },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations centre"
        title="Alarm management"
        subtitle="Triage critical events, acknowledge conditions and maintain the threshold rule catalogue."
        actions={<>
          {has('alarm:rules') && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => openRule()}>New rule</Button>}
          <Badge color="var(--good)" dot><ShieldCheck size={11} /> AUDIT LOGGED</Badge>
        </>}
      />

      {toast && <Notice tone={toast.tone} onClose={() => setToast(null)}>{toast.text}</Notice>}

      <div className="grid stats-grid compact">
        <StatCard label="Active alarms" value={stats.data?.active ?? 0} tone={stats.data?.active ? 'warn' : 'good'} icon={<BellRing size={16} />} sub={<span>Unresolved across authorized sites</span>} />
        <StatCard label="Critical" value={stats.data?.counts?.CRITICAL ?? 0} tone="bad" icon={<AlertTriangle size={16} />} sub={<span>Immediate operator attention</span>} />
        <StatCard label="Warning" value={stats.data?.counts?.WARNING ?? 0} tone="warn" icon={<Bell size={16} />} sub={<span>Degraded but operational</span>} />
        <StatCard label="Acknowledged" value={stats.data?.counts?.byStatus?.ACKNOWLEDGED ?? 0} icon={<CheckCheck size={16} />} sub={<span>Owned by an operator</span>} />
        <StatCard label="Resolved" value={stats.data?.counts?.byStatus?.RESOLVED ?? 0} tone="good" icon={<CheckCircle2 size={16} />} sub={<span>Closed with resolution note</span>} />
        <StatCard label="Last 24 hours" value={stats.data?.last24h ?? 0} icon={<Activity size={16} />} sub={<span>New alarm records</span>} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={tabs} />

      {tab !== 'rules' ? (
        <>
          <div className="filter-bar">
            <label className="search grow"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search alarm title, code or message…" /></label>
            <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
              <option value="">All severities</option>
              {['CRITICAL', 'WARNING', 'INFO'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">{tab === 'active' ? 'Open (default)' : 'Any status'}</option>
              <option value="ACTIVE">Active</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="RESOLVED">Resolved</option>
            </select>
            <select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site">
              <option value="">All authorized sites</option>
              {(sitesState.data?.sites || []).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
            </select>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {[...new Set(Object.keys(stats.data?.counts?.byCategory || {}))].sort().map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {data.error && <ErrorState error={data.error} onRetry={data.reload} />}
          {data.loading && !data.data ? <Spinner label="Loading alarms…" /> : (
            <Card title={tab === 'active' ? 'Open alarm queue' : 'Alarm register'} subtitle={`${data.data?.total ?? 0} matching records`} noPad>
              <DataTable columns={alarmColumns} rows={data.data?.alarms || []} onRowClick={(a) => void openDetail(a)} dense />
              <Pagination page={page} pageSize={pageSize} total={data.data?.total || 0} onChange={setPage} />
            </Card>
          )}
        </>
      ) : (
        <>
          {rules.error && <ErrorState error={rules.error} onRetry={rules.reload} />}
          <Card
            title="Threshold rule catalogue"
            subtitle="Rules evaluate live telemetry; they never write to field equipment"
            actions={<Badge color="var(--accent)" dot>{rules.data?.rules?.length || 0} RULES</Badge>}
            noPad
          >
            {rules.loading && !rules.data ? <Spinner label="Loading rules…" /> : (
              <DataTable columns={ruleColumns} rows={rules.data?.rules || []} dense />
            )}
          </Card>
        </>
      )}

      <Modal open={Boolean(detail)} title={detail?.alarm ? `${detail.alarm.code} · ${detail.alarm.title}` : 'Alarm detail'} onClose={() => setDetail(null)} wide
        footer={detail?.alarm && (
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            {detail.alarm.status === 'ACTIVE' && has('alarm:ack') && <Button variant="default" loading={busy} icon={<CheckCheck size={14} />} onClick={() => void ack(detail.alarm)}>Acknowledge</Button>}
            {detail.alarm.status !== 'RESOLVED' && has('alarm:resolve') && (
              <Button variant="primary" icon={<CheckCircle2 size={14} />} onClick={() => { setNote(''); setResolveOpen(true); }}>Resolve alarm</Button>
            )}
          </>
        )}>
        {detailLoading && <Spinner label="Loading alarm detail…" />}
        {detail?.alarm && (
          <div className="stack">
            <div className="alarm-detail-head">
              <Badge status={detail.alarm.severity}>{detail.alarm.severity}</Badge>
              <Badge status={detail.alarm.status}>{detail.alarm.status}</Badge>
              <span className={cn('source-tag', detail.alarm.data_source === 'LIVE' ? 'live' : 'demo')}>{detail.alarm.data_source}</span>
            </div>
            <KV items={[
              { label: 'Site', value: `${detail.alarm.site_code || '—'} · ${detail.alarm.site_name || ''}` },
              { label: 'Device', value: detail.alarm.device_name || '—' },
              { label: 'Category', value: detail.alarm.category || 'GENERAL' },
              { label: 'Value / threshold', value: `${detail.alarm.value == null ? '—' : num(detail.alarm.value, 2)} / ${detail.alarm.threshold == null ? '—' : num(detail.alarm.threshold, 2)}` },
              { label: 'Triggered', value: dateTime(detail.alarm.triggered_at) },
              { label: 'Last seen', value: dateTime(detail.alarm.last_seen_at) },
              { label: 'Acknowledged', value: detail.alarm.acknowledged_at ? `${dateTime(detail.alarm.acknowledged_at)} · ${detail.alarm.acknowledged_by || ''}` : '—' },
              { label: 'Resolved', value: detail.alarm.resolved_at ? `${dateTime(detail.alarm.resolved_at)} · ${detail.alarm.resolved_by || ''}` : '—' },
              { label: 'Resolution note', value: detail.alarm.resolution_note || '—' },
            ]} />
            <div className="alarm-message"><strong>Message</strong><p>{detail.alarm.message || 'No additional diagnostic message.'}</p></div>
            <div>
              <h4 className="sub-head">Notification trail</h4>
              {(detail.notifications || []).length ? (
                <div className="timeline">
                  {detail.notifications.map((n: any) => (
                    <div key={n.id} className="timeline-row">
                      <i style={{ background: statusColor(n.status === 'SENT' ? 'GOOD' : 'WARNING') }} />
                      <div><strong>{n.channel} → {n.target || 'operations'}</strong><small>{dateTime(n.created_at)} · {n.status}</small></div>
                    </div>
                  ))}
                </div>
              ) : <p className="muted">No notification records for this alarm.</p>}
            </div>
            <div className="row-actions">
              <Button size="sm" variant="ghost" onClick={() => navigate(`/sites/${detail.alarm.site_id}`)}>Open site detail</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={resolveOpen} title={`Resolve alarm ${detail?.alarm?.code || ''}`} onClose={() => setResolveOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setResolveOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void resolve()}>Resolve alarm</Button></>}>
        <p className="modal-copy">{detail?.alarm?.title}</p>
        <Field label="Resolution note" hint="Record the verification and corrective action taken.">
          <textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Inspected string 4, replaced failed fuse, inverter returned to MPPT." />
        </Field>
        <p className="form-note"><AlertTriangle size={13} /> The resolution is attributed to {user?.fullName} and written to the audit trail.</p>
      </Modal>

      <Modal open={ruleOpen} title={editRule ? `Edit rule ${editRule.code}` : 'Create threshold rule'} onClose={() => setRuleOpen(false)} wide
        footer={<><Button variant="ghost" onClick={() => setRuleOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void saveRule()}>{editRule ? 'Save changes' : 'Create rule'}</Button></>}>
        <div className="form-grid">
          {ruleError && <div className="login-error span-2"><AlertTriangle size={15} /> {ruleError}</div>}
          <Field label="Rule code"><input className="input" value={ruleForm.code} disabled={Boolean(editRule)} onChange={(e) => setRuleForm({ ...ruleForm, code: e.target.value.toUpperCase() })} placeholder="BESS_TEMP_HIGH" /></Field>
          <Field label="Rule name"><input className="input" value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="Battery temperature high" /></Field>
          <Field label="Parameter ID"><input className="input" value={ruleForm.parameterId} onChange={(e) => setRuleForm({ ...ruleForm, parameterId: e.target.value })} placeholder="battery_temp_c" /></Field>
          <Field label="Category"><input className="input" value={ruleForm.category} onChange={(e) => setRuleForm({ ...ruleForm, category: e.target.value })} placeholder="BESS" /></Field>
          <Field label="Severity">
            <select className="input" value={ruleForm.severity} onChange={(e) => setRuleForm({ ...ruleForm, severity: e.target.value })}>
              {['CRITICAL', 'WARNING', 'INFO'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Operator">
            <select className="input" value={ruleForm.operator} onChange={(e) => setRuleForm({ ...ruleForm, operator: e.target.value })}>
              {['>', '>=', '<', '<='].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Threshold"><input className="input" type="number" step="0.01" value={ruleForm.threshold} onChange={(e) => setRuleForm({ ...ruleForm, threshold: e.target.value })} /></Field>
          <Field label="Duration (seconds)" hint="Condition must persist for this long; 0 triggers immediately."><input className="input" type="number" min="0" value={ruleForm.durationSec} onChange={(e) => setRuleForm({ ...ruleForm, durationSec: e.target.value })} /></Field>
          <Field label="Site scope">
            <select className="input" value={ruleForm.siteId} onChange={(e) => setRuleForm({ ...ruleForm, siteId: e.target.value })}>
              <option value="">Portfolio-wide</option>
              {(sitesState.data?.sites || []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          </Field>
          <Field label="State">
            <select className="input" value={ruleForm.enabled ? 'true' : 'false'} onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.value === 'true' })}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </Field>
          <p className="form-note span-2"><SlidersHorizontal size={13} /> Threshold rules evaluate incoming telemetry only. There is no write path to controllers, relays or inverters.</p>
        </div>
      </Modal>
    </div>
  );
}
