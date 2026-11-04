import React, { useEffect, useMemo, useState } from 'react';
import {
  Router, Plus, RefreshCw, Search, ShieldCheck, KeyRound, Trash2, Copy, FileJson,
  Activity, RadioTower, Cpu, Database, Clock3, AlertTriangle, Wifi, WifiOff, Settings2, Eye,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, KV, Modal, Notice, PageHeader, Spinner, StatCard, Tabs,
} from '../components/ui';
import { Column, DataTable } from '../components/filters';
import { useAsync } from '../lib/hooks';
import { del, get, patch, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn, dateTime, num, pct, sourceLabel, timeAgo, statusColor } from '../lib/format';
import { AXIS, GRID, PALETTE, TOOLTIP, shortTick } from '../lib/chart';

type DetailTab = 'health' | 'devices' | 'logs';

const statusOptions = ['ONLINE', 'DEGRADED', 'OFFLINE', 'MAINTENANCE'];

export default function Gateways() {
  const { has } = useAuth();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('health');
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ siteId: '', name: '', serial: '', hardware: 'Edge Gateway', firmware: 'edge-1.4.2', ipAddress: '', mqttClientId: '' });
  const [sites, setSites] = useState<any[]>([]);
  const [secret, setSecret] = useState<{ title: string; token: string; gateway?: any; warning?: string } | null>(null);
  const [config, setConfig] = useState<any>(null);

  const gateways = useAsync<any>(() => get(`/api/gateways${qs({ status, search })}`), [status, search]);
  const detail = useAsync<any>(() => selected ? get(`/api/gateways/${selected.id}`) : Promise.resolve(null), [selected?.id]);
  const health = useAsync<any>(() => selected ? get(`/api/gateways/${selected.id}/health?hours=24`) : Promise.resolve(null), [selected?.id]);

  useEffect(() => {
    get<any>('/api/sites')
      .then((d) => {
        const list = d.sites || [];
        setSites(list);
        if (!form.siteId && list.length) setForm((f: any) => ({ ...f, siteId: list[0].id }));
      })
      .catch(() => setSites([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const summary = gateways.data?.summary || { total: 0, ONLINE: 0, OFFLINE: 0, DEGRADED: 0, backlog: 0, avgLatencyMs: 0 };
  const rows = gateways.data?.gateways || [];
  const unhealthy = rows.filter((g: any) => g.status !== 'ONLINE').length;

  const healthData = useMemo(() => (health.data?.series || []).map((r: any) => ({
    ...r,
    label: shortTick(r.ts),
  })), [health.data]);

  const create = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const payload = await post<any>('/api/gateways', {
        ...form,
        siteId: form.siteId,
        serial: form.serial || undefined,
        mqttClientId: form.mqttClientId || undefined,
      });
      setCreateOpen(false);
      setForm({ siteId: sites[0]?.id || '', name: '', serial: '', hardware: 'Edge Gateway', firmware: 'edge-1.4.2', ipAddress: '', mqttClientId: '' });
      setSecret({ title: 'Gateway enrolled — store this token now', token: payload.token, gateway: payload.gateway, warning: payload.warning });
      gateways.reload();
    } catch (err: any) {
      setFormError(err?.message || 'Could not create gateway');
    } finally { setBusy(false); }
  };

  const rotate = async (gateway: any) => {
    if (!window.confirm(`Rotate the ingestion token for ${gateway.id}? Existing agent credentials stop working immediately.`)) return;
    setBusy(true);
    try {
      const payload = await post<any>(`/api/gateways/${gateway.id}/rotate-token`);
      setSecret({ title: 'New gateway token', token: payload.token, warning: payload.warning });
      gateways.reload();
      detail.reload();
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Token rotation failed' });
    } finally { setBusy(false); }
  };

  const remove = async (gateway: any) => {
    if (!window.confirm(`Delete gateway ${gateway.id}? Devices remain registered but will stop reporting.`)) return;
    setBusy(true);
    try {
      await del(`/api/gateways/${gateway.id}`);
      setSelected(null);
      gateways.reload();
      setToast({ tone: 'success', text: 'Gateway deleted.' });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not delete gateway' });
    } finally { setBusy(false); }
  };

  const setGatewayStatus = async (gateway: any, nextStatus: string) => {
    setBusy(true);
    try {
      await patch(`/api/gateways/${gateway.id}`, { status: nextStatus });
      gateways.reload();
      detail.reload();
      setToast({ tone: 'success', text: `${gateway.id} marked ${nextStatus}.` });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not update gateway' });
    } finally { setBusy(false); }
  };

  const openConfig = async (gateway: any) => {
    setBusy(true);
    try {
      const payload = await get<any>(`/api/gateways/${gateway.id}/config`);
      setConfig(payload);
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not load gateway bootstrap config' });
    } finally { setBusy(false); }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ tone: 'success', text: 'Copied to clipboard.' });
    } catch {
      setToast({ tone: 'error', text: 'Clipboard is unavailable in this browser context.' });
    }
  };

  const openDetail = (gateway: any) => {
    setSelected(gateway);
    setDetailTab('health');
  };

  const columns: Column<any>[] = [
    {
      key: 'id', label: 'Gateway',
      render: (g) => (
        <div className="cell-main">
          <strong>{g.id}</strong>
          <small>{g.serial} · {g.hardware}</small>
        </div>
      ),
    },
    { key: 'site_code', label: 'Plant', render: (g) => <div className="cell-main"><strong>{g.site_code}</strong><small>{g.site_name}</small></div> },
    { key: 'status', label: 'Status', render: (g) => <Badge status={g.status}>{g.status}</Badge> },
    { key: 'data_source', label: 'Source', render: (g) => <span className={cn('source-tag', g.data_source === 'LIVE' ? 'live' : 'demo')}>{g.data_source}</span> },
    { key: 'latency_ms', label: 'Latency', align: 'right', render: (g) => <span className={cn('mono', (g.latency_ms || 0) > 400 && 'text-warn')}>{g.latency_ms == null ? '—' : `${num(g.latency_ms, 0)} ms`}</span> },
    { key: 'buffer_backlog', label: 'Backlog', align: 'right', render: (g) => <span className={cn('mono', (g.buffer_backlog || 0) > 0 && 'text-warn')}>{num(g.buffer_backlog, 0)}</span> },
    { key: 'cpu_pct', label: 'CPU / MEM', align: 'right', render: (g) => <span className="mono">{pct(g.cpu_pct, 0)} / {pct(g.mem_pct, 0)}</span> },
    { key: 'last_seen_at', label: 'Last seen', align: 'right', render: (g) => <span className="muted">{timeAgo(g.last_seen_at)}</span> },
    {
      key: 'actions', label: '', align: 'right',
      render: (g) => (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={<Eye size={12} />} onClick={() => openDetail(g)}>Inspect</Button>
          {has('gateway:manage') && <Button size="sm" variant="ghost" icon={<KeyRound size={12} />} onClick={() => void rotate(g)}>Rotate</Button>}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Assets & connectivity"
        title="Edge gateways"
        subtitle="Outbound-only plant gateways: Modbus polling, TLS MQTT ingestion, offline buffering and fleet health."
        actions={<>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => { gateways.reload(); detail.reload(); health.reload(); }}>Refresh</Button>
          {has('gateway:manage') && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => { setFormError(null); setCreateOpen(true); }}>Enroll gateway</Button>}
        </>}
      />

      {toast && <Notice tone={toast.tone} onClose={() => setToast(null)}>{toast.text}</Notice>}

      <div className="grid stats-grid compact">
        <StatCard label="Registered gateways" value={summary.total} icon={<Router size={16} />} sub={<span>{summary.ONLINE} online · {unhealthy} need attention</span>} />
        <StatCard label="Fleet availability" value={summary.total ? num((summary.ONLINE / summary.total) * 100, 1) : '—'} unit="%" tone={summary.ONLINE === summary.total ? 'good' : 'warn'} icon={<Wifi size={16} />} sub={<span>TLS MQTT heartbeat in last 90 s</span>} />
        <StatCard label="Average latency" value={summary.avgLatencyMs} unit="ms" tone={summary.avgLatencyMs > 400 ? 'warn' : 'good'} icon={<Activity size={16} />} sub={<span>Gateway → broker round trip</span>} />
        <StatCard label="Buffered backlog" value={num(summary.backlog, 0)} tone={summary.backlog ? 'warn' : 'good'} icon={<Database size={16} />} sub={<span>Store-and-forward samples awaiting sync</span>} />
      </div>

      <div className="filter-bar">
        <label className="search grow"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search gateway ID, serial, plant code…" /></label>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Gateway status">
          <option value="">Any status</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="filter-meta"><ShieldCheck size={14} /> Outbound-only · port 502 never exposed</span>
      </div>

      {gateways.error && <ErrorState error={gateways.error} onRetry={gateways.reload} />}

      <Card title="Gateway fleet" subtitle={`${rows.length} gateways · click a row to inspect telemetry and connectivity`} noPad>
        {gateways.loading && !gateways.data ? <Spinner label="Loading gateway fleet…" /> : (
          <DataTable columns={columns} rows={rows} onRowClick={openDetail} dense />
        )}
      </Card>

      {!gateways.loading && !rows.length && <EmptyState title="No gateways in scope" message="Enroll a gateway or broaden your filter selection." icon={<Router size={22} />} />}

      <div className="mini-strip">
        <span><RadioTower size={14} /> MQTT TLS :{gateways.data?.broker?.tlsPort || 8883} · plaintext restricted to loopback</span>
        <span><ShieldCheck size={14} /> Ed25519-style opaque tokens · hashed at rest</span>
        <span><WifiOff size={14} /> Offline buffering re-syncs automatically</span>
      </div>

      <Modal open={!!selected} title={selected ? `${selected.id} · ${selected.site_code}` : 'Gateway'} onClose={() => setSelected(null)} wide
        footer={<>
          <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
          {has('gateway:manage') && selected && <>
            <Button variant="ghost" loading={busy} icon={<FileJson size={14} />} onClick={() => void openConfig(selected)}>Bootstrap config</Button>
            <Button variant="ghost" loading={busy} icon={<KeyRound size={14} />} onClick={() => void rotate(selected)}>Rotate token</Button>
            <Button variant="danger" loading={busy} icon={<Trash2 size={14} />} onClick={() => void remove(selected)}>Delete</Button>
          </>}
        </>}>
        {!detail.data ? <Spinner label="Loading gateway telemetry…" /> : (
          <>
            <div className="detail-head">
              <div>
                <div className="eyebrow">Edge gateway detail</div>
                <h3>{detail.data.gateway.name}</h3>
                <p>{detail.data.gateway.site_name} · {detail.data.gateway.site_location}</p>
              </div>
              <div className="detail-actions">
                <Badge status={detail.data.gateway.status}>{detail.data.gateway.status}</Badge>
                <span className={cn('source-tag', detail.data.gateway.data_source === 'LIVE' ? 'live' : 'demo')}>{sourceLabel(detail.data.gateway.data_source)}</span>
              </div>
            </div>

            <div className="grid stats-grid compact">
              <StatCard label="Availability (24h)" value={health.data?.availabilityPct == null ? '—' : health.data.availabilityPct} unit="%" tone="good" icon={<Wifi size={15} />} sub={<span>{health.data?.samples || 0} heartbeat samples</span>} />
              <StatCard label="Average latency" value={health.data?.avgLatencyMs ?? '—'} unit="ms" icon={<Activity size={15} />} sub={<span>Peak backlog {num(health.data?.maxBacklog, 0)}</span>} />
              <StatCard label="Buffer backlog" value={num(detail.data.gateway.buffer_backlog, 0)} tone={detail.data.gateway.buffer_backlog ? 'warn' : 'good'} icon={<Database size={15} />} sub={<span>Re-synced on reconnect</span>} />
              <StatCard label="Uptime" value={num((detail.data.gateway.uptime_sec || 0) / 3600, 1)} unit="h" icon={<Clock3 size={15} />} sub={<span>Firmware {detail.data.gateway.firmware}</span>} />
            </div>

            <div className="grid two-col">
              <KV items={[
                { label: 'Serial', value: <span className="mono">{detail.data.gateway.serial}</span> },
                { label: 'Hardware', value: detail.data.gateway.hardware },
                { label: 'MQTT client', value: <span className="mono">{detail.data.gateway.mqtt_client_id}</span> },
                { label: 'Token hint', value: <span className="mono">{detail.data.gateway.token_hint}</span> },
                { label: 'IP address', value: <span className="mono">{detail.data.gateway.ip_address || '—'}</span> },
                { label: 'Last seen', value: dateTime(detail.data.gateway.last_seen_at) },
              ]} />
              <div className="security-list">
                <div><ShieldCheck size={15} /><span><strong>TLS MQTT ingestion</strong><small>Credentials hashed at rest; token shown once.</small></span></div>
                <div><RadioTower size={15} /><span><strong>Outbound-only</strong><small>Gateway initiates every connection; no inbound 502 exposure.</small></span></div>
                <div><Database size={15} /><span><strong>Offline buffering</strong><small>Backlog syncs with duplicate and out-of-order protection.</small></span></div>
                <div><Activity size={15} /><span><strong>Read-only monitoring</strong><small>Only function codes 1–4 are polled.</small></span></div>
              </div>
            </div>

            <Tabs
              value={detailTab}
              onChange={setDetailTab}
              tabs={[
                { value: 'health', label: 'Health timeline', count: health.data?.samples },
                { value: 'devices', label: 'Devices', count: detail.data.devices?.length },
                { value: 'logs', label: 'Comms log', count: detail.data.comm?.length },
              ]}
            />

            {detailTab === 'health' && (
              <Card title="Gateway health · last 24 hours" subtitle="Latency, backlog and resource pressure">
                {health.error && <ErrorState error={health.error} onRetry={health.reload} />}
                {healthData.length ? (
                  <>
                    <div className="chart h-280">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={healthData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                          <CartesianGrid {...GRID} />
                          <XAxis dataKey="label" {...AXIS} />
                          <YAxis {...AXIS} width={54} unit=" ms" />
                          <Tooltip {...TOOLTIP} />
                          <Area type="monotone" dataKey="latencyMs" name="Latency (ms)" stroke={PALETTE.load} fill="rgba(56,189,248,0.16)" strokeWidth={2} />
                          <Line type="monotone" dataKey="backlog" name="Backlog" stroke={PALETTE.pv} strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid two-col">
                      <div className="chart h-240">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={healthData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                            <CartesianGrid {...GRID} />
                            <XAxis dataKey="label" {...AXIS} />
                            <YAxis {...AXIS} width={50} unit="%" />
                            <Tooltip {...TOOLTIP} />
                            <Area type="monotone" dataKey="cpuPct" name="CPU" stroke={PALETTE.pv} fill="rgba(245,165,36,0.12)" strokeWidth={1.8} />
                            <Area type="monotone" dataKey="memPct" name="Memory" stroke={PALETTE.bess} fill="rgba(167,139,250,0.10)" strokeWidth={1.8} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="reliability-list">
                        <div><span>Availability</span><strong>{pct(health.data?.availabilityPct, 1)}</strong></div>
                        <div><span>Max backlog</span><strong>{num(health.data?.maxBacklog, 0)}</strong></div>
                        <div><span>Heartbeat samples</span><strong>{health.data?.samples || 0}</strong></div>
                        <div><span>Last payload</span><strong>{timeAgo(detail.data.gateway.last_seen_at)}</strong></div>
                        <div><span>Clock drift protection</span><strong className="text-good">Enabled</strong></div>
                      </div>
                    </div>
                  </>
                ) : <EmptyState title="No health samples" message="Heartbeat history appears after the edge agent connects." />}
              </Card>
            )}

            {detailTab === 'devices' && (
              <Card title="Polled devices" subtitle="Read-only Modbus TCP endpoints behind this gateway" noPad>
                <DataTable
                  dense
                  columns={[
                    { key: 'name', label: 'Device', render: (d) => <div className="cell-main"><strong>{d.name}</strong><small>{d.device_type} · {d.id}</small></div> },
                    { key: 'ip_address', label: 'Endpoint', render: (d) => <span className="mono">{d.ip_address}:{d.port}</span> },
                    { key: 'unit_id', label: 'Unit ID', align: 'right', render: (d) => <span className="mono">{d.unit_id}</span> },
                    { key: 'status', label: 'Status', render: (d) => <Badge status={d.status}>{d.status}</Badge> },
                    { key: 'last_seen_at', label: 'Last seen', align: 'right', render: (d) => <span className="muted">{timeAgo(d.last_seen_at)}</span> },
                  ]}
                  rows={detail.data.devices || []}
                />
              </Card>
            )}

            {detailTab === 'logs' && (
              <Card title="Recent communications" subtitle="Outbound MQTT publishes and Modbus reads" noPad>
                <DataTable
                  dense
                  columns={[
                    { key: 'ts', label: 'Timestamp', render: (r) => <span className="mono">{dateTime(r.ts)}</span> },
                    { key: 'protocol', label: 'Protocol', render: (r) => <span className="tag">{r.protocol}</span> },
                    { key: 'direction', label: 'Direction', render: (r) => <span className="muted">{r.direction}</span> },
                    { key: 'topic', label: 'Topic / target', render: (r) => <span className="mono small">{r.topic}</span> },
                    { key: 'status', label: 'Status', render: (r) => <Badge status={r.status === 'OK' ? 'GOOD' : r.status}>{r.status}</Badge> },
                    { key: 'latency_ms', label: 'Latency', align: 'right', render: (r) => <span className="mono">{num(r.latency_ms, 0)} ms</span> },
                    { key: 'bytes', label: 'Bytes', align: 'right', render: (r) => <span className="mono">{num(r.bytes, 0)}</span> },
                  ]}
                  rows={detail.data.comm || []}
                />
              </Card>
            )}

            {has('gateway:manage') && (
              <div className="inline-actions">
                <Button size="sm" variant="ghost" loading={busy} onClick={() => void setGatewayStatus(detail.data.gateway, detail.data.gateway.status === 'MAINTENANCE' ? 'OFFLINE' : 'MAINTENANCE')}>
                  {detail.data.gateway.status === 'MAINTENANCE' ? 'Return to service' : 'Set maintenance'}
                </Button>
                <span className="field-hint">Status changes are audited. Operational data is never altered.</span>
              </div>
            )}
          </>
        )}
      </Modal>

      <Modal open={createOpen} title="Enroll an edge gateway" onClose={() => setCreateOpen(false)} wide
        footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} icon={<Router size={14} />} onClick={() => void create()}>Enroll gateway</Button></>}>
        <div className="form-grid">
          {formError && <div className="login-error span-2"><AlertTriangle size={15} /> {formError}</div>}
          <Field label="Plant" className="span-2">
            <select className="input" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name} ({s.dataSource})</option>)}
            </select>
          </Field>
          <Field label="Gateway name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Edge Gateway PLTS-XXX-01" /></Field>
          <Field label="Serial" hint="Optional; generated when blank."><input className="input" value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} placeholder="EG-0023" /></Field>
          <Field label="Hardware"><input className="input" value={form.hardware} onChange={(e) => setForm({ ...form, hardware: e.target.value })} /></Field>
          <Field label="Firmware"><input className="input" value={form.firmware} onChange={(e) => setForm({ ...form, firmware: e.target.value })} /></Field>
          <Field label="Management IP" hint="Private plant LAN address."><input className="input" value={form.ipAddress} onChange={(e) => setForm({ ...form, ipAddress: e.target.value })} placeholder="10.20.1.20" /></Field>
          <Field label="MQTT client ID" hint="Generated from the site code when blank."><input className="input" value={form.mqttClientId} onChange={(e) => setForm({ ...form, mqttClientId: e.target.value })} placeholder="gw-plts-xxx-01" /></Field>
          <p className="form-note span-2">The site becomes <strong>LIVE</strong> after enrollment. The one-time token is displayed next and must be installed on the edge agent. No inbound port is opened.</p>
        </div>
      </Modal>

      <Modal open={!!secret} title={secret?.title || 'Gateway token'} onClose={() => setSecret(null)}
        footer={<><Button variant="ghost" onClick={() => setSecret(null)}>Close</Button><Button variant="primary" icon={<Copy size={14} />} onClick={() => void copy(secret?.token || '')}>Copy token</Button></>}>
        {secret && <>
          <p className="modal-copy">{secret.warning}</p>
          <div className="secret-box" onClick={() => void copy(secret.token)}>
            <code>{secret.token}</code>
            <Copy size={15} />
          </div>
          <KV items={[
            { label: 'Gateway', value: <span className="mono">{secret.gateway?.id || 'Existing gateway'}</span> },
            { label: 'Required header', value: <span className="mono">X-Gateway-Id</span> },
            { label: 'Authorization', value: <span className="mono">Bearer &lt;token&gt;</span> },
          ]} />
          <div className="mini-strip"><span><ShieldCheck size={14} /> The token is stored only as a one-way hash.</span></div>
        </>}
      </Modal>

      <Modal open={!!config} title={config ? `Bootstrap · ${config.gateway?.id}` : 'Bootstrap config'} onClose={() => setConfig(null)} wide
        footer={<><Button variant="ghost" onClick={() => setConfig(null)}>Close</Button><Button variant="primary" icon={<Copy size={14} />} onClick={() => void copy(JSON.stringify(config, null, 2))}>Copy JSON</Button></>}>
        {config && <>
          <div className="mini-strip span-2">
            <span><ShieldCheck size={14} /> TLS required · outbound only</span>
            <span><Settings2 size={14} /> Register mappings are embedded per device</span>
            <span><AlertTriangle size={14} /> Agent token is intentionally not included</span>
          </div>
          <pre className="json-preview">{JSON.stringify(config, null, 2)}</pre>
        </>}
      </Modal>
    </div>
  );
}
