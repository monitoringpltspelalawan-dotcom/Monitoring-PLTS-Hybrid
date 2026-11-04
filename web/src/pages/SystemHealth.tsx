import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, RefreshCw, Database, Cpu, RadioTower, Bell, HardDrive, Clock3, ShieldCheck, Wifi,
  WifiOff, Server, Gauge, Layers, CircleCheck, CircleAlert, TimerReset, Trash2, Radio, Network,
} from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, ErrorState, KV, Notice, PageHeader, ProgressBar, Spinner,
  StatCard, Tabs, Toggle,
} from '../components/ui';
import { Column, DataTable, LiveDot } from '../components/filters';
import { useAsync } from '../lib/hooks';
import { get } from '../lib/api';
import { useRealtime } from '../lib/ws';
import { cn, dateTime, num, pct, timeAgo } from '../lib/format';

type Tab = 'overview' | 'quality' | 'services';

const qualityTone = (q: string) => q === 'GOOD' ? 'GOOD' : q === 'STALE' || q === 'DEGRADED' ? 'WARNING' : 'CRITICAL';

function uptime(sec: number | undefined) {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function SystemHealth() {
  const { connected } = useRealtime();
  const [tab, setTab] = useState<Tab>('overview');
  const [auto, setAuto] = useState(true);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const health = useAsync<any>(() => get('/api/system/health'), []);
  const stats = useAsync<any>(() => get('/api/system/stats'), []);
  const info = useAsync<any>(() => get('/api/system/info'), []);
  const quality = useAsync<any>(() => get('/api/system/data-quality'), []);

  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => { health.reload(); stats.reload(); info.reload(); quality.reload(); }, 15000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const p = stats.data?.process;
  const db = stats.data?.database;
  const mqtt = stats.data?.mqtt || health.data?.mqtt || {};
  const sim = stats.data?.simulation || health.data?.simulation || {};
  const alarms = stats.data?.alarmsEngine || info.data?.alarms || {};
  const realtime = stats.data?.realtime || info.data?.realtime || {};
  const maintenance = stats.data?.maintenance || info.data?.maintenance || {};
  const counts = info.data?.counts || {};
  const features = info.data?.features || {};
  const retention = info.data?.retention || {};
  const qualityRows = quality.data?.sites || [];
  const qSummary = quality.data?.summary || { total: 0, good: 0, degraded: 0, noData: 0, bad: 0 };
  const gatewayHealth = stats.data?.gatewayHealth || [];

  const healthy = health.data?.status === 'ok';
  const avgLatency = useMemo(() => {
    if (!gatewayHealth.length) return null;
    return gatewayHealth.reduce((acc: number, g: any) => acc + Number(g.latency || 0), 0) / gatewayHealth.length;
  }, [gatewayHealth]);
  const maxBacklog = useMemo(() => gatewayHealth.reduce((m: number, g: any) => Math.max(m, Number(g.backlog || 0)), 0), [gatewayHealth]);

  const gatewayColumns: Column<any>[] = [
    { key: 'gateway_id', label: 'Gateway', render: (g) => <span className="mono">{g.gateway_id}</span> },
    { key: 'latency', label: 'Avg latency (24h)', align: 'right', render: (g) => <span className={cn('mono', Number(g.latency) > 400 && 'text-warn')}>{num(g.latency, 0)} ms</span> },
    { key: 'backlog', label: 'Peak backlog', align: 'right', render: (g) => <span className={cn('mono', Number(g.backlog) > 0 && 'text-warn')}>{num(g.backlog, 0)}</span> },
    { key: 'last_ts', label: 'Last heartbeat', align: 'right', render: (g) => <span className="muted">{timeAgo(g.last_ts)}</span> },
  ];

  const qualityColumns: Column<any>[] = [
    { key: 'code', label: 'Plant', render: (q) => <div className="cell-main"><strong>{q.code}</strong><small>{q.name}</small></div> },
    { key: 'quality', label: 'Quality', render: (q) => <Badge status={qualityTone(q.quality)}>{q.quality.replace(/_/g, ' ')}</Badge> },
    { key: 'dataSource', label: 'Source', render: (q) => <span className={cn('source-tag', q.dataSource === 'LIVE' ? 'live' : 'demo')}>{q.dataSource}</span> },
    { key: 'commStatus', label: 'Comms', render: (q) => <Badge status={q.commStatus}>{q.commStatus}</Badge> },
    { key: 'ageSec', label: 'Data age', align: 'right', render: (q) => <span className="mono">{q.ageSec == null ? '—' : q.ageSec < 120 ? `${q.ageSec}s` : `${Math.round(q.ageSec / 60)}m`}</span> },
    { key: 'samplesLast2h', label: 'Samples (2h)', align: 'right', render: (q) => <span className="mono">{num(q.samplesLast2h, 0)}</span> },
    { key: 'goodPct', label: 'Good', align: 'right', render: (q) => <span className="mono">{q.goodPct == null ? '—' : `${num(q.goodPct, 1)}%`}</span> },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="System health"
        subtitle="Runtime, database, broker, simulation and data-quality telemetry for the monitoring platform."
        actions={<>
          <Toggle checked={auto} onChange={setAuto} label={`Auto-refresh ${auto ? 'on' : 'off'}`} />
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => { health.reload(); stats.reload(); info.reload(); quality.reload(); }}>Refresh now</Button>
        </>}
      />

      {toast && <Notice tone={toast.tone} onClose={() => setToast(null)}>{toast.text}</Notice>}

      <div className="grid stats-grid compact">
        <StatCard label="Platform status" value={healthy ? 'Operational' : 'Degraded'} tone={healthy ? 'good' : 'bad'} icon={healthy ? <CircleCheck size={16} /> : <CircleAlert size={16} />} sub={<span>{health.data?.environment} · v{health.data?.version}</span>} />
        <StatCard label="Process uptime" value={uptime(p?.uptimeSec ?? health.data?.uptimeSec)} icon={<Clock3 size={16} />} sub={<span>PID {p?.pid ?? '—'} · {p?.node || '—'}</span>} />
        <StatCard label="Ingest success (1h)" value={num(stats.data?.ingest?.lastHourSuccessPct, 1)} unit="%" tone="good" icon={<RadioTower size={16} />} sub={<span>{num(stats.data?.ingest?.messagesLastHour, 0)} messages · {num(stats.data?.ingest?.failuresLastHour, 0)} failed</span>} />
        <StatCard label="Realtime clients" value={num(realtime.clients, 0)} icon={<Radio size={16} />} sub={<span>{connected ? 'This browser is connected' : 'This browser is reconnecting'}</span>} />
        <StatCard label="Active alarms" value={num(alarms.active ?? (stats.data?.alarms ? Object.values(stats.data.alarms).reduce((a: number, b: any) => a + Number(b), 0) : 0), 0)} tone={alarms.active > 0 ? 'warn' : 'good'} icon={<Bell size={16} />} sub={<span>{num(alarms.counts?.CRITICAL, 0)} critical · {num(alarms.counts?.WARNING, 0)} warning</span>} />
        <StatCard label="Gateway latency" value={avgLatency == null ? '—' : num(avgLatency, 0)} unit="ms" icon={<Network size={16} />} sub={<span>{gatewayHealth.length} reporting gateways · backlog {num(maxBacklog, 0)}</span>} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'quality', label: 'Data quality', count: qSummary.total },
          { value: 'services', label: 'Services' },
        ]}
      />

      {health.error && <ErrorState error={health.error} onRetry={health.reload} />}
      {stats.error && <ErrorState error={stats.error} onRetry={stats.reload} />}

      {tab === 'overview' && (
        <>
          {!stats.data && stats.loading ? <Spinner label="Loading runtime telemetry…" /> : (
            <>
              <div className="grid two-col">
                <Card title="Process & host" subtitle="Application server resource envelope">
                  <KV items={[
                    { label: 'Hostname', value: <span className="mono">{p?.hostname || '—'}</span> },
                    { label: 'Platform', value: <span className="mono">{p?.platform || '—'} / {p?.arch || '—'}</span> },
                    { label: 'Node.js', value: <span className="mono">{p?.node || '—'}</span> },
                    { label: 'CPU load', value: <span className="mono">{Array.isArray(p?.cpuLoad) ? p.cpuLoad.join(' · ') : '—'}</span> },
                    { label: 'RSS memory', value: `${num(p?.memoryMb?.rss, 0)} MB` },
                    { label: 'Heap used', value: `${num(p?.memoryMb?.heapUsed, 0)} / ${num(p?.memoryMb?.heapTotal, 0)} MB` },
                    { label: 'Database driver', value: <Badge color="var(--info)" dot={false}>{db?.driver || info.data?.database?.driver || '—'}</Badge> },
                    { label: 'Measurements (1h)', value: num(db?.recentMeasurements, 0) },
                  ]} />
                  <ProgressBar label="Heap utilisation" value={p?.memoryMb?.heapTotal ? (p.memoryMb.heapUsed / p.memoryMb.heapTotal) * 100 : null} />
                </Card>

                <Card title="Service status" subtitle="Core platform subsystems">
                  <div className="service-list">
                    <div><span className={cn('dot', healthy ? 'good' : 'bad')} /><strong>API server</strong><small>{healthy ? 'Responding' : 'Degraded'}</small><Badge status={healthy ? 'GOOD' : 'WARNING'}>{healthy ? 'UP' : 'DEGRADED'}</Badge></div>
                    <div><span className={cn('dot', mqtt.running ? 'good' : 'bad')} /><strong>MQTT broker</strong><small>TLS :{mqtt.tlsPort || 8883} · {mqtt.clients || 0} clients</small><Badge status={mqtt.running ? 'GOOD' : 'OFFLINE'}>{mqtt.running ? 'UP' : 'DOWN'}</Badge></div>
                    <div><span className={cn('dot', sim.running ? 'good' : 'muted')} /><strong>Simulation engine</strong><small>{sim.sites || 0} demo sites · {sim.tickMs || 3000} ms tick</small><Badge status={sim.running ? 'GOOD' : 'UNKNOWN'}>{sim.running ? 'RUNNING' : 'IDLE'}</Badge></div>
                    <div><span className={cn('dot', alarms.running ? 'good' : 'bad')} /><strong>Alarm engine</strong><small>{alarms.rules || 0} rules · last scan {timeAgo(alarms.lastScan)}</small><Badge status={alarms.running ? 'GOOD' : 'OFFLINE'}>{alarms.running ? 'UP' : 'DOWN'}</Badge></div>
                    <div><span className={cn('dot', connected ? 'good' : 'bad')} /><strong>Realtime hub</strong><small>{realtime.clients || 0} clients on {realtime.path || '/ws'}</small><Badge status={connected ? 'GOOD' : 'WARNING'}>{connected ? 'LINKED' : 'RETRYING'}</Badge></div>
                  </div>
                </Card>
              </div>

              <Card title="Gateway health · last 24 hours" subtitle="Average latency and peak store-and-forward backlog per gateway" noPad>
                {gatewayHealth.length ? <DataTable columns={gatewayColumns} rows={gatewayHealth} dense /> : <EmptyState title="No gateway heartbeats" message="Enroll a gateway or start the demo agent." icon={<RadioTower size={22} />} />}
              </Card>

              <div className="grid three-col">
                <Card title="Data inventory" subtitle="Persisted platform records">
                  <div className="metric-list">
                    {Object.entries(counts).map(([k, v]) => <div key={k}><span>{k.replace(/_/g, ' ')}</span><strong className="mono">{num(v as number, 0)}</strong></div>)}
                  </div>
                </Card>
                <Card title="Retention policy" subtitle="Automated maintenance windows">
                  <div className="metric-list">
                    <div><span>Measurements</span><strong>{retention.measurementsDays || '—'} days</strong></div>
                    <div><span>Ingest messages</span><strong>{retention.ingestMessagesDays || '—'} days</strong></div>
                    <div><span>Audit logs</span><strong>{retention.auditDays || '—'} days</strong></div>
                    <div><span>Last cleanup</span><strong>{maintenance.lastCleanup ? timeAgo(maintenance.lastCleanup) : '—'}</strong></div>
                    <div><span>Last stale check</span><strong>{maintenance.lastStaleCheck ? timeAgo(maintenance.lastStaleCheck) : '—'}</strong></div>
                  </div>
                </Card>
                <Card title="Enabled capabilities" subtitle="Deployment feature flags">
                  <div className="permission-chips">
                    {Object.entries(features).flatMap(([k, v]) => Array.isArray(v)
                      ? v.map((x) => <span className="perm-chip" key={`${k}-${x}`}>{String(x)}</span>)
                      : v === true ? [<span className="perm-chip" key={k}>{k.replace(/([A-Z])/g, ' $1').trim()}</span>] : [])}
                  </div>
                </Card>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'quality' && (
        <>
          <div className="grid stats-grid compact">
            <StatCard label="Healthy plants" value={qSummary.good} tone="good" icon={<Wifi size={16} />} sub={<span>{qSummary.total} plants in scope</span>} />
            <StatCard label="Degraded / stale" value={qSummary.degraded} tone={qSummary.degraded ? 'warn' : 'good'} icon={<CircleAlert size={16} />} sub={<span>Behind expected freshness</span>} />
            <StatCard label="No data" value={qSummary.noData} tone={qSummary.noData ? 'bad' : 'good'} icon={<WifiOff size={16} />} sub={<span>No samples in last 2 hours</span>} />
            <StatCard label="Bad quality" value={qSummary.bad} tone={qSummary.bad ? 'bad' : 'good'} icon={<ShieldCheck size={16} />} sub={<span>Below 90% good samples</span>} />
          </div>
          {quality.error && <ErrorState error={quality.error} onRetry={quality.reload} />}
          <Card title="Per-site data quality" subtitle="Freshness and GOOD-sample ratio over the last two hours" noPad>
            {quality.loading && !quality.data ? <Spinner label="Assessing data quality…" /> : (
              <DataTable columns={qualityColumns} rows={qualityRows} dense />
            )}
          </Card>
          <div className="mini-strip">
            <span><Gauge size={14} /> Measured every 60 s by the API</span>
            <span><TimerReset size={14} /> Stale threshold: 10 minutes without a sample</span>
            <span><Layers size={14} /> DEMO and LIVE data sources are evaluated independently</span>
          </div>
        </>
      )}

      {tab === 'services' && (
        <>
          <div className="grid two-col">
            <Card title="MQTT broker" subtitle="Aedes TLS ingestion endpoint">
              <KV items={[
                { label: 'Broker state', value: <Badge status={mqtt.running ? 'GOOD' : 'OFFLINE'}>{mqtt.running ? 'RUNNING' : 'STOPPED'}</Badge> },
                { label: 'TLS port', value: <span className="mono">{mqtt.tlsPort || 8883}</span> },
                { label: 'Loopback plaintext', value: <span className="mono">{mqtt.plainPort ? `:${mqtt.plainPort}` : 'disabled'}</span> },
                { label: 'Connected clients', value: num(mqtt.clients, 0) },
                { label: 'Engine', value: <span className="mono">{mqtt.version || '—'}</span> },
              ]} />
              <p className="field-hint">Public clients must use TLS. Plaintext MQTT is bound to loopback for local agent testing only.</p>
            </Card>
            <Card title="Simulation & alarm engine" subtitle="Background workloads">
              <KV items={[
                { label: 'Simulation', value: <Badge status={sim.running ? 'GOOD' : 'UNKNOWN'}>{sim.running ? 'RUNNING' : 'IDLE'}</Badge> },
                { label: 'Demo sites', value: num(sim.sites, 0) },
                { label: 'Tick interval', value: `${num(sim.tickMs, 0)} ms` },
                { label: 'Ticks processed', value: num(sim.ticks, 0) },
                { label: 'Alarm rules', value: num(alarms.rules, 0) },
                { label: 'Alarm scans', value: num(alarms.scans, 0) },
                { label: 'Last alarm scan', value: alarms.lastScan ? dateTime(alarms.lastScan) : '—' },
              ]} />
            </Card>
          </div>

          <div className="grid two-col">
            <Card title="Repository maintenance" subtitle="Automated retention and stale-data enforcement">
              <div className="metric-list">
                {Object.entries(maintenance.cleanupStats || {}).map(([k, v]) => (
                  <div key={k}><span>{k.replace(/_/g, ' ')} purged</span><strong className="mono">{num(v as number, 0)}</strong></div>
                ))}
                <div><span>Last cleanup run</span><strong>{maintenance.lastCleanup ? dateTime(maintenance.lastCleanup) : '—'}</strong></div>
                <div><span>Last stale check</span><strong>{maintenance.lastStaleCheck ? dateTime(maintenance.lastStaleCheck) : '—'}</strong></div>
              </div>
            </Card>
            <Card title="Ingestion pipeline" subtitle="Last hour rolling window">
              <div className="metric-list">
                <div><span>Accepted messages</span><strong className="mono">{num(stats.data?.ingest?.messagesLastHour, 0)}</strong></div>
                <div><span>Rejected / duplicate</span><strong className="mono">{num(stats.data?.ingest?.failuresLastHour, 0)}</strong></div>
                <div><span>Success rate</span><strong className={cn('mono', (stats.data?.ingest?.lastHourSuccessPct || 100) < 99 && 'text-warn')}>{pct(stats.data?.ingest?.lastHourSuccessPct, 1)}</strong></div>
                <div><span>Realtime clients</span><strong className="mono">{num(realtime.clients, 0)}</strong></div>
                <div><span>Last refreshed</span><strong>{stats.data?.timestamp ? timeAgo(stats.data.timestamp) : '—'}</strong></div>
              </div>
              <ProgressBar label="Ingest success" value={stats.data?.ingest?.lastHourSuccessPct ?? 100} />
            </Card>
          </div>

          <div className="mini-strip">
            <span><Server size={14} /> Host {p?.hostname || '—'} · {p?.platform || '—'}</span>
            <span><HardDrive size={14} /> {db?.driver || '—'} repository · {num(counts.measurements, 0)} measurement rows</span>
            <span><Cpu size={14} /> {num(p?.memoryMb?.rss, 0)} MB RSS</span>
          </div>
        </>
      )}
    </div>
  );
}
