import React, { useEffect, useState } from 'react';
import {
  FileText, Download, Plus, Trash2, CalendarClock, Play, RefreshCw, FileSpreadsheet, FileType2, Clock, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Modal, Notice, PageHeader, Spinner, StatCard, Tabs,
} from '../components/ui';
import { Column, DataTable, RangePicker, RangeValue, SiteSelector } from '../components/filters';
import { useAsync, useSites } from '../lib/hooks';
import { del, download, get, patch, post, qs } from '../lib/api';
import { dateShort, dateTime, num, timeAgo } from '../lib/format';

type Tab = 'generated' | 'schedules';

const fmtIcon = (format: string) => format === 'XLSX' ? <FileSpreadsheet size={15} /> : format === 'CSV' ? <FileType2 size={15} /> : <FileText size={15} />;

export default function Reports() {
  const sitesState = useSites();
  const [tab, setTab] = useState<Tab>('generated');
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [genOpen, setGenOpen] = useState(false);
  const [genForm, setGenForm] = useState<any>({ type: 'PORTFOLIO_PERFORMANCE', format: 'PDF', name: '', range: '30d' });
  const [genSites, setGenSites] = useState<string[]>([]);
  const [genError, setGenError] = useState<string | null>(null);

  const [schOpen, setSchOpen] = useState(false);
  const [schForm, setSchForm] = useState<any>({ name: '', reportType: 'PORTFOLIO_PERFORMANCE', format: 'PDF', frequency: 'MONTHLY', recipients: '' });
  const [schSites, setSchSites] = useState<string[]>([]);
  const [schError, setSchError] = useState<string | null>(null);

  const types = useAsync<any>(() => get('/api/reports/types'), []);
  const reports = useAsync<any>(() => get('/api/reports?pageSize=50'), []);
  const schedules = useAsync<any>(() => get('/api/reports/schedules'), []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const reportTypes = types.data?.types || [];

  const generate = async () => {
    setBusy(true);
    setGenError(null);
    try {
      await post('/api/reports/generate', {
        type: genForm.type,
        format: genForm.format,
        name: genForm.name || undefined,
        siteIds: genSites,
        range: genForm.range,
      });
      setGenOpen(false);
      setGenForm({ type: 'PORTFOLIO_PERFORMANCE', format: 'PDF', name: '', range: '30d' });
      setGenSites([]);
      reports.reload();
      setToast({ tone: 'success', text: 'Report generated and available for download.' });
    } catch (err: any) {
      setGenError(err?.message || 'Report generation failed');
    } finally { setBusy(false); }
  };

  const removeReport = async (report: any) => {
    if (!window.confirm(`Delete report “${report.name}”?`)) return;
    try {
      await del(`/api/reports/${report.id}`);
      reports.reload();
      setToast({ tone: 'success', text: 'Report deleted.' });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not delete report' });
    }
  };

  const createSchedule = async () => {
    setBusy(true);
    setSchError(null);
    try {
      await post('/api/reports/schedules', {
        name: schForm.name,
        reportType: schForm.reportType,
        format: schForm.format,
        frequency: schForm.frequency,
        recipients: String(schForm.recipients).split(',').map((r: string) => r.trim()).filter(Boolean),
        siteIds: schSites,
      });
      setSchOpen(false);
      setSchForm({ name: '', reportType: 'PORTFOLIO_PERFORMANCE', format: 'PDF', frequency: 'MONTHLY', recipients: '' });
      setSchSites([]);
      schedules.reload();
      setToast({ tone: 'success', text: 'Report schedule created.' });
    } catch (err: any) {
      setSchError(err?.message || 'Could not create schedule');
    } finally { setBusy(false); }
  };

  const runSchedule = async (schedule: any) => {
    setBusy(true);
    try {
      const payload = await post<any>(`/api/reports/schedules/${schedule.id}/run`);
      schedules.reload();
      reports.reload();
      setToast({ tone: 'success', text: `Schedule executed: ${payload.report?.name || schedule.name}` });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not run schedule' });
    } finally { setBusy(false); }
  };

  const toggleSchedule = async (schedule: any) => {
    try {
      await patch(`/api/reports/schedules/${schedule.id}`, { enabled: !schedule.enabled });
      schedules.reload();
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not update schedule' });
    }
  };

  const removeSchedule = async (schedule: any) => {
    if (!window.confirm(`Delete schedule “${schedule.name}”?`)) return;
    try {
      await del(`/api/reports/schedules/${schedule.id}`);
      schedules.reload();
      setToast({ tone: 'success', text: 'Schedule deleted.' });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not delete schedule' });
    }
  };

  const reportColumns: Column<any>[] = [
    { key: 'name', label: 'Report', render: (r) => <div className="cell-main"><strong>{r.name}</strong><small>{r.report_type?.replace(/_/g, ' ')} · {dateShort(r.period_start)} – {dateShort(r.period_end)}</small></div> },
    { key: 'format', label: 'Format', render: (r) => <span className="badge" style={{ '--badge-color': 'var(--accent)' } as React.CSSProperties}>{fmtIcon(r.format)} {r.format}</span> },
    { key: 'site_ids', label: 'Sites', align: 'right', render: (r) => <span className="mono">{(r.site_ids || []).length || 'All'}</span> },
    { key: 'size_kb', label: 'Size', align: 'right', render: (r) => <span className="mono">{r.size_kb ? `${num(r.size_kb, 1)} KB` : '—'}</span> },
    { key: 'created_by', label: 'Generated by', render: (r) => <span className="muted">{r.created_by || 'System'}</span> },
    { key: 'created_at', label: 'Created', align: 'right', render: (r) => <span className="muted">{timeAgo(r.created_at)}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge status={r.status === 'READY' ? 'GOOD' : r.status}>{r.status}</Badge> },
    {
      key: 'actions', label: '', align: 'right',
      render: (r) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" icon={<Download size={12} />} onClick={() => download(r.downloadUrl)}>Download</Button>
          <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => void removeReport(r)}>Delete</Button>
        </span>
      ),
    },
  ];

  const scheduleColumns: Column<any>[] = [
    { key: 'name', label: 'Schedule', render: (s) => <div className="cell-main"><strong>{s.name}</strong><small>{s.report_type?.replace(/_/g, ' ')} · {s.frequency}</small></div> },
    { key: 'format', label: 'Format', render: (s) => <span className="tag">{s.format}</span> },
    { key: 'site_ids', label: 'Scope', render: (s) => <span className="muted">{(s.site_ids || []).length ? `${s.site_ids.length} sites` : 'All authorized'}</span> },
    { key: 'recipients', label: 'Recipients', render: (s) => <span className="muted">{(s.recipients || []).join(', ') || '—'}</span> },
    { key: 'last_run_at', label: 'Last run', align: 'right', render: (s) => <span className="muted">{s.last_run_at ? timeAgo(s.last_run_at) : 'Never'}</span> },
    { key: 'next_run_at', label: 'Next run', align: 'right', render: (s) => <span className="mono">{s.enabled ? dateTime(s.next_run_at) : 'Paused'}</span> },
    {
      key: 'enabled', label: 'Enabled', align: 'center',
      render: (s) => <button className={`switch ${s.enabled ? 'on' : ''}`} onClick={() => void toggleSchedule(s)} aria-label="Toggle schedule"><span /></button>,
    },
    {
      key: 'actions', label: '', align: 'right',
      render: (s) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" loading={busy} icon={<Play size={12} />} onClick={() => void runSchedule(s)}>Run now</Button>
          <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => void removeSchedule(s)}>Delete</Button>
        </span>
      ),
    },
  ];

  const ready = (reports.data?.reports || []).filter((r: any) => r.status === 'READY').length;
  const enabledSchedules = (schedules.data?.schedules || []).filter((s: any) => s.enabled).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Reporting & compliance"
        title="Reports"
        subtitle="Generate board-ready PDF, Excel and CSV deliverables, or schedule recurring portfolio packs."
        actions={<>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => { reports.reload(); schedules.reload(); }}>Refresh</Button>
          <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => { setTab('generated'); setGenOpen(true); }}>Generate report</Button>
        </>}
      />

      {toast && <Notice tone={toast.tone} onClose={() => setToast(null)}>{toast.text}</Notice>}

      <div className="grid stats-grid compact">
        <StatCard label="Generated reports" value={reports.data?.total ?? 0} icon={<FileText size={16} />} sub={<span>{ready} ready for download</span>} />
        <StatCard label="Formats available" value="3" icon={<FileSpreadsheet size={16} />} sub={<span>PDF · XLSX · CSV</span>} />
        <StatCard label="Active schedules" value={enabledSchedules} icon={<CalendarClock size={16} />} sub={<span>{(schedules.data?.schedules || []).length} configured</span>} />
        <StatCard label="Report templates" value={reportTypes.length} icon={<CheckCircle2 size={16} />} sub={<span>Site, portfolio, BESS, gateway & alarm packs</span>} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'generated', label: 'Generated reports', count: reports.data?.total },
          { value: 'schedules', label: 'Schedules', count: schedules.data?.schedules?.length },
        ]}
      />

      {tab === 'generated' && (
        <>
          {reports.error && <ErrorState error={reports.error} onRetry={reports.reload} />}
          <Card title="Report library" subtitle="Sorted by generation time · download links are permission-checked" noPad>
            {reports.loading && !reports.data ? <Spinner label="Loading report library…" /> : (
              <DataTable columns={reportColumns} rows={reports.data?.reports || []} dense />
            )}
          </Card>
          {!reports.loading && !(reports.data?.reports || []).length && (
            <EmptyState title="No reports yet" message="Generate your first PDF, Excel or CSV pack from the button above." icon={<FileText size={22} />} />
          )}
        </>
      )}

      {tab === 'schedules' && (
        <>
          {schedules.error && <ErrorState error={schedules.error} onRetry={schedules.reload} />}
          <Card
            title="Recurring report schedules"
            subtitle="Schedules are executed by the server-side report engine"
            actions={<Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setSchOpen(true)}>New schedule</Button>}
            noPad
          >
            {schedules.loading && !schedules.data ? <Spinner label="Loading schedules…" /> : (
              <DataTable columns={scheduleColumns} rows={schedules.data?.schedules || []} dense />
            )}
          </Card>
          <div className="mini-strip">
            <span><Clock size={14} /> Daily, weekly, monthly, quarterly and annual frequencies</span>
            <span><AlertTriangle size={14} /> Mail delivery is queued as a notification; configure SMTP in Settings for live delivery</span>
          </div>
        </>
      )}

      <Modal open={genOpen} title="Generate a report" onClose={() => setGenOpen(false)} wide
        footer={<><Button variant="ghost" onClick={() => setGenOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void generate()} icon={<FileText size={14} />}>Generate</Button></>}>
        <div className="form-grid">
          {genError && <div className="login-error span-2"><AlertTriangle size={15} /> {genError}</div>}
          <Field label="Report template" className="span-2">
            <select className="input" value={genForm.type} onChange={(e) => setGenForm({ ...genForm, type: e.target.value })}>
              {reportTypes.map((t: any) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </select>
          </Field>
          <p className="form-note span-2">{reportTypes.find((t: any) => t.code === genForm.type)?.description}</p>
          <Field label="Format">
            <select className="input" value={genForm.format} onChange={(e) => setGenForm({ ...genForm, format: e.target.value })}>
              {['PDF', 'XLSX', 'CSV'].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Period">
            <select className="input" value={genForm.range} onChange={(e) => setGenForm({ ...genForm, range: e.target.value })}>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="365d">Last 365 days</option>
            </select>
          </Field>
          <Field label="Custom name (optional)" className="span-2">
            <input className="input" value={genForm.name} onChange={(e) => setGenForm({ ...genForm, name: e.target.value })} placeholder="Board pack — Q3 portfolio performance" />
          </Field>
          <div className="span-2">
            <span className="field-label">Sites in scope</span>
            <SiteSelector sites={sitesState.data?.sites || []} selected={genSites} onChange={setGenSites} />
            <p className="field-hint">Leave all sites selected to report on every authorized plant.</p>
          </div>
        </div>
      </Modal>

      <Modal open={schOpen} title="Create report schedule" onClose={() => setSchOpen(false)} wide
        footer={<><Button variant="ghost" onClick={() => setSchOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void createSchedule()} icon={<CalendarClock size={14} />}>Create schedule</Button></>}>
        <div className="form-grid">
          {schError && <div className="login-error span-2"><AlertTriangle size={15} /> {schError}</div>}
          <Field label="Schedule name" className="span-2"><input className="input" value={schForm.name} onChange={(e) => setSchForm({ ...schForm, name: e.target.value })} placeholder="Monthly portfolio performance" /></Field>
          <Field label="Report template">
            <select className="input" value={schForm.reportType} onChange={(e) => setSchForm({ ...schForm, reportType: e.target.value })}>
              {reportTypes.map((t: any) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Format">
            <select className="input" value={schForm.format} onChange={(e) => setSchForm({ ...schForm, format: e.target.value })}>
              {['PDF', 'XLSX', 'CSV'].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Frequency">
            <select className="input" value={schForm.frequency} onChange={(e) => setSchForm({ ...schForm, frequency: e.target.value })}>
              {['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Recipients" hint="Comma-separated email addresses; queued as notifications.">
            <input className="input" value={schForm.recipients} onChange={(e) => setSchForm({ ...schForm, recipients: e.target.value })} placeholder="ops@company.co.id, board@company.co.id" />
          </Field>
          <div className="span-2">
            <span className="field-label">Sites in scope</span>
            <SiteSelector sites={sitesState.data?.sites || []} selected={schSites} onChange={setSchSites} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
