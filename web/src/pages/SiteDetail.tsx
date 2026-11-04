import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Area, AreaChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from 'recharts';
import {
  ArrowLeft, Sun, BatteryCharging, Gauge, PlugZap, Fuel, BellRing, Cpu, Router, Download,
  CheckCheck, CheckCircle2, MapPin, Activity, AlertTriangle, Settings2, Clock,
} from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, KV, Modal, Notice, PageHeader, ProgressBar, Spinner, StatCard, Tabs } from '../components/ui';
import { Column, DataTable, RangePicker, RangeValue } from '../components/filters';
import { EnergyFlow, FlowNodes } from '../components/EnergyFlow';
import { useAsync } from '../lib/hooks';
import { get, post, qs } from '../lib/api';
import { useRealtime, useSiteLive } from '../lib/ws';
import { useAuth } from '../lib/auth';
import { cn, dateShort, dateTime, energy, money, num, pct, power, sourceLabel, statusColor, timeAgo } from '../lib/format';
import { AXIS, GRID, PALETTE, TOOLTIP, shortTick } from '../lib/chart';

type Tab = 'overview' | 'live' | 'energy' | 'devices' | 'bess' | 'alarms' | 'gateway';

export default function SiteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { has } = useAuth();
  const { connected } = useRealtime();
  const wsLive = useSiteLive(id);
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<RangeValue>({ range: '7d' });
  const [rangeKey, setRangeKey] = useState('7d');
  const [resolveTarget, setResolveTarget] = useState<any>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const detail = useAsync<any>(() => get(`/api/sites/${id}`), [id]);
  const history = useAsync<any>(() => get(`/api/sites/${id}/history${qs({ range: rangeKey, hours: 48 })}`), [id, rangeKey]);

  useEffect(() => {
    if (range.from || range.to) {
      if (range.from && range.to) {
        const days = Math.max(1, Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400_000) + 1);
        setRangeKey(days > 90 ? '365d' : days > 30 ? '90d' : days > 7 ? '30d' : '7d');
      }
    } else setRangeKey(range.range);
  }, [range]);

  const site = detail.data?.site;
  const live = wsLive || detail.data?.live;
  const flow = live?.flow || {};
  const gridKw = Number(flow.gridKw) || 0;
  const batteryKw = Number(flow.batteryKw) || 0;

  const nodes: FlowNodes = useMemo(() => ({
    pv: { kw: live?.pv?.powerKw ?? null, status: live?.pv?.powerKw == null ? 'NO_DATA' : live.pv.powerKw > 0 ? 'PRODUCING' : 'IDLE', capacityKwp: site?.pv_capacity_kwp, utilPct: site?.pv_capacity_kwp ? ((live?.pv?.powerKw || 0) / site.pv_capacity_kwp) * 100 : null },
    grid: {
      kw: live?.flow?.gridKw == null ? null : Math.abs(gridKw),
      direction: gridKw > 0.01 ? 'IMPORT' : gridKw < -0.01 ? 'EXPORT' : 'IDLE',
      status: live?.grid?.available === false ? 'UNAVAILABLE' : live?.grid?.available == null ? 'NO_DATA' : 'AVAILABLE',
      frequencyHz: live?.grid?.frequencyHz,
      importKw: live?.grid?.importKw,
      exportKw: live?.grid?.exportKw,
    },
    bess: { kw: live?.flow?.batteryKw == null ? null : Math.abs(batteryKw), direction: batteryKw > 0.01 ? 'DISCHARGING' : batteryKw < -0.01 ? 'CHARGING' : 'IDLE', status: live?.bess?.bmsStatus, socPct: live?.bess?.socPct, sohPct: live?.bess?.sohPct, temperatureC: live?.bess?.temperatureC, capacityKwh: site?.bess_capacity_kwh },
    generator: { kw: live?.flow?.generatorKw ?? null, status: !live?.generator?.present ? 'NOT_INSTALLED' : live?.generator?.running ? 'RUNNING' : 'STANDBY', fuelLevelPct: live?.generator?.fuelLevelPct, capacityKw: site?.generator_capacity_kw },
    load: { kw: live?.flow?.loadKw ?? null, status: live?.load?.powerKw == null ? 'NO_DATA' : 'SUPPLIED', powerFactor: live?.load?.powerFactor },
  }), [live, site, gridKw, batteryKw]);

  const energyRows = history.data?.energy?.series || [];
  const telemetryRows = history.data?.telemetry || [];

  const ack = async (alarm: any) => {
    setBusy(true);
    try {
      await post(`/api/alarms/${alarm.id}/acknowledge`, { note: 'Acknowledged from site detail' });
      setToast(`Alarm ${alarm.code} acknowledged.`);
      detail.reload();
    } catch (e: any) {
      setToast(e?.message || 'Acknowledgement failed');
    } finally { setBusy(false); }
  };

  const resolve = async () => {
    if (!resolveTarget) return;
    setBusy(true);
    try {
      await post(`/api/alarms/${resolveTarget.id}/resolve`, { note: note || 'Resolved from site detail' });
      setToast(`Alarm ${resolveTarget.code} resolved.`);
      setResolveTarget(null);
      setNote('');
      detail.reload();
    } catch (e: any) {
      setToast(e?.message || 'Resolve failed');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (detail.error) return <div className="page"><ErrorState error={detail.error} onRetry={detail.reload} /><Button onClick={() => navigate('/sites')} icon={<ArrowLeft size={14} />}>Back to sites</Button></div>;
  if (detail.loading && !detail.data) return <div className="page"><Spinner label="Loading plant record…" /></div>;
  if (!site) return <div className="page"><EmptyState title="Site not available" message="The site may have been removed or is outside your authorization scope." /></div>;

  const deviceColumns: Column<any>[] = [
    { key: 'name', label: 'Device', render: (d) => <div className="cell-main"><strong>{d.name}</strong><small>{d.manufacturer} {d.model}</small></div> },
    { key: 'device_type', label: 'Type', render: (d) => <span className="tag">{d.device_type}</span> },
    { key: 'serial', label: 'Serial', render: (d) => <span className="mono muted">{d.serial || '—'}</span> },
    { key: 'ip_address', label: 'Endpoint', render: (d) => <span className="mono">{d.ip_address || '—'}:{d.port || 502} · unit {d.unit_id || 1}</span> },
    { key: 'status', label: 'Status', render: (d) => <Badge status={d.status}>{d.status}</Badge> },
    { key: 'last_seen_at', label: 'Last seen', align: 'right', render: (d) => <span className="muted">{timeAgo(d.last_seen_at)}</span> },
  ];

  const alarmColumns: Column<any>[] = [
    { key: 'severity', label: 'Severity', render: (a) => <Badge status={a.severity}>{a.severity}</Badge> },
    { key: 'title', label: 'Alarm', render: (a) => <div className="cell-main"><strong>{a.title}</strong><small>{a.code} · {a.category}</small></div> },
    { key: 'value', label: 'Value', align: 'right', render: (a) => <span className="mono">{a.value ?? '—'}{a.threshold != null ? ` / ${a.threshold}` : ''}</span> },
    { key: 'status', label: 'Status', render: (a) => <Badge status={a.status}>{a.status}</Badge> },
    { key: 'triggered_at', label: 'Triggered', align: 'right', render: (a) => <span className="muted">{dateTime(a.triggered_at)}</span> },
    {
      key: 'actions', label: '', align: 'right',
      render: (a) => a.status !== 'RESOLVED' ? (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          {a.status === 'ACTIVE' && has('alarm:ack') && <Button size="sm" variant="ghost" loading={busy} onClick={() => void ack(a)} icon={<CheckCheck size={12} />}>Ack</Button>}
          {has('alarm:resolve') && <Button size="sm" variant="ghost" onClick={() => { setResolveTarget(a); setNote(''); }} icon={<CheckCircle2 size={12} />}>Resolve</Button>}
        </span>
      ) : <span className="muted">Closed</span>,
    },
  ];

  return (
    <div className="page">
      <div className="detail-head">
        <button className="back-link" onClick={() => navigate('/sites')}><ArrowLeft size={14} /> All sites</button>
        <PageHeader
          eyebrow={`${site.region_name || 'Unassigned region'} · ${site.code}`}
          title={site.name}
          subtitle={<span className="detail-sub"><MapPin size={13} /> {site.location || site.address || 'Location not recorded'} · commissioned {dateShort(site.commissioning_date)} · {num(site.pv_capacity_kwp, 0)} kWp PV / {num(site.bess_capacity_kwh, 0)} kWh BESS</span>}
          actions={<>
            <Badge status={site.status}>{site.status}</Badge>
            <span className={cn('source-tag', site.data_source === 'LIVE' ? 'live' : 'demo')}>{sourceLabel(site.data_source)}</span>
            <Badge color={connected ? 'var(--good)' : 'var(--warning)'} dot>{connected ? 'LIVE LINK' : 'CACHE'}</Badge>
          </>}
        />
      </div>

      {toast && <Notice tone={toast.includes('failed') ? 'error' : 'success'} onClose={() => setToast(null)}>{toast}</Notice>}
      {live?.stale && <Notice tone="warn">Telemetry is stale (last update {timeAgo(live?.ts)}). Values shown are the last known state; no simulated values are substituted.</Notice>}

      <div className="grid stats-grid compact">
        <StatCard label="PV power" value={num(live?.pv?.powerKw, 1)} unit="kW" tone="pv" icon={<Sun size={16} />} sub={<span>{pct(site.pv_capacity_kwp ? ((live?.pv?.powerKw || 0) / site.pv_capacity_kwp) * 100 : null, 1)} of {num(site.pv_capacity_kwp, 0)} kWp</span>} />
        <StatCard label="PV today" value={energy(live?.energy?.pvTodayKwh ?? detail.data?.energy?.pv_kwh)} tone="pv" icon={<Activity size={16} />} sub={<span>{pct(live?.pv?.performanceRatio, 1)} performance</span>} />
        <StatCard label="Plant load" value={num(live?.load?.powerKw, 1)} unit="kW" icon={<Gauge size={16} />} sub={<span>PF {num(live?.load?.powerFactor, 2)}</span>} />
        <StatCard label="Grid" value={num(Math.abs(gridKw), 1)} unit="kW" icon={<PlugZap size={16} />} sub={<span>{gridKw > 0 ? 'importing' : gridKw < 0 ? 'exporting' : 'idle'} · {num(live?.grid?.frequencyHz, 2)} Hz</span>} />
        <StatCard label="BESS SOC" value={num(live?.bess?.socPct, 1)} unit="%" tone="bess" icon={<BatteryCharging size={16} />} sub={<span>{batteryKw > 0 ? 'discharging' : batteryKw < 0 ? 'charging' : 'idle'} · SOH {pct(live?.bess?.sohPct, 1)}</span>} />
        <StatCard label="Generator" value={num(live?.generator?.powerKw, 1)} unit="kW" icon={<Fuel size={16} />} sub={<span>{live?.generator?.present ? (live.generator.running ? 'running' : 'standby') : 'not installed'} · fuel {pct(live?.generator?.fuelLevelPct, 0)}</span>} />
        <StatCard label="Open alarms" value={detail.data?.alarmCounts?.total || 0} tone={(detail.data?.alarmCounts?.CRITICAL || 0) > 0 ? 'bad' : 'good'} icon={<BellRing size={16} />} sub={<span>{detail.data?.alarmCounts?.CRITICAL || 0} critical · {detail.data?.alarmCounts?.WARNING || 0} warning</span>} />
        <StatCard label="Savings today" value={money((live?.energy?.pvTodayKwh || 0) * (detail.data?.tariffs?.[0]?.rate || 1444.7))} icon={<Settings2 size={16} />} sub={<span>{num((live?.energy?.pvTodayKwh || 0) * 0.87, 0)} kg CO₂ avoided</span>} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'live', label: 'Live systems' },
          { value: 'energy', label: 'Energy history' },
          { value: 'devices', label: 'Devices', count: detail.data?.devices?.length },
          { value: 'bess', label: 'BESS racks', count: detail.data?.bessRacks?.length },
          { value: 'alarms', label: 'Alarms', count: detail.data?.alarmCounts?.total },
          { value: 'gateway', label: 'Gateway' },
        ]}
      />

      {tab === 'overview' && (
        <>
          <div className="grid two-col-wide">
            <Card title="Live single-line energy flow" subtitle={`Source-aware flows · last telemetry ${live ? timeAgo(live.ts) : 'unavailable'}`} actions={<Badge status={live?.quality}>{live?.quality || 'NO DATA'}</Badge>}>
              {live ? <EnergyFlow nodes={nodes} ts={live.ts} stale={live.stale} /> : <EmptyState title="No live snapshot" message="Waiting for the first gateway telemetry batch." />}
            </Card>
            <div className="stack">
              <Card title="Plant data" subtitle="Asset registry and commercial parameters">
                <KV items={[
                  { label: 'Site code', value: site.code },
                  { label: 'Region', value: site.region_name || '—' },
                  { label: 'Timezone', value: site.timezone },
                  { label: 'PV / inverter', value: `${num(site.pv_capacity_kwp, 0)} kWp / ${num(site.inverter_capacity_kw, 0)} kW` },
                  { label: 'BESS', value: `${num(site.bess_capacity_kwh, 0)} kWh / ${num(site.bess_power_kw, 0)} kW` },
                  { label: 'Grid connection', value: `${site.grid_provider || 'PLN'} · ${site.grid_connection_type || '—'} · ${num(site.grid_capacity_kva, 0)} kVA` },
                  { label: 'Generator', value: site.generator_count ? `${site.generator_count} × ${num(site.generator_capacity_kw, 0)} kW` : 'Not installed' },
                  { label: 'Tariff', value: detail.data?.tariffs?.[0] ? `${money(detail.data.tariffs[0].rate, false)} / kWh` : '—' },
                  { label: 'PR target', value: pct(Number(detail.data?.config?.pr_target || 0.82) * 100, 0) },
                  { label: 'Data source', value: sourceLabel(site.data_source) },
                  { label: 'Last seen', value: timeAgo(live?.lastSeenAt || site.last_seen_at) },
                ]} />
              </Card>
              <Card title="Today's energy" subtitle="Accumulated since local midnight">
                <div className="energy-grid">
                  <div><Sun size={14} /><span>PV</span><strong>{energy(live?.energy?.pvTodayKwh)}</strong></div>
                  <div><Gauge size={14} /><span>Load</span><strong>{energy(live?.energy?.loadTodayKwh)}</strong></div>
                  <div><PlugZap size={14} /><span>Import</span><strong>{energy(live?.energy?.importTodayKwh)}</strong></div>
                  <div><PlugZap size={14} /><span>Export</span><strong>{energy(live?.energy?.exportTodayKwh)}</strong></div>
                  <div><BatteryCharging size={14} /><span>Charge</span><strong>{energy(live?.energy?.chargeTodayKwh)}</strong></div>
                  <div><BatteryCharging size={14} /><span>Discharge</span><strong>{energy(live?.energy?.dischargeTodayKwh)}</strong></div>
                  <div><Fuel size={14} /><span>Generator</span><strong>{energy(live?.energy?.generatorTodayKwh)}</strong></div>
                  <div><Activity size={14} /><span>Peak load</span><strong>{power(live?.energy?.peakLoadKw)}</strong></div>
                </div>
              </Card>
            </div>
          </div>

          <div className="grid two-col">
            <Card title="Recent alarms" subtitle="Latest events for this site" actions={<Button size="sm" variant="ghost" onClick={() => setTab('alarms')}>View all</Button>} noPad>
              <DataTable columns={alarmColumns.slice(0, 5)} rows={(detail.data?.recentAlarms || []).slice(0, 6)} dense />
            </Card>
            <Card title="Device fleet" subtitle={`${detail.data?.devices?.length || 0} registered assets`} actions={<Button size="sm" variant="ghost" onClick={() => setTab('devices')}>Open devices</Button>} noPad>
              <DataTable
                columns={[
                  { key: 'name', label: 'Device', render: (d) => <div className="cell-main"><strong>{d.name}</strong><small>{d.device_type}</small></div> },
                  { key: 'status', label: 'Status', render: (d) => <Badge status={d.status}>{d.status}</Badge> },
                  { key: 'ip_address', label: 'Endpoint', render: (d) => <span className="mono muted">{d.ip_address}:{d.port}</span> },
                ]}
                rows={(detail.data?.devices || []).slice(0, 8)} dense
              />
            </Card>
          </div>
        </>
      )}

      {tab === 'live' && (
        <div className="stack">
          <Card title="Inverter telemetry" subtitle="Per-unit AC/DC measurements and thermal state">
            {(live?.pv?.inverters || []).length ? (
              <div className="table-wrap">
                <table className="data-table dense">
                  <thead><tr><th>Inverter</th><th>Status</th><th>Power</th><th>DC V / A</th><th>AC V</th><th>PF</th><th>Temp</th><th>Efficiency</th><th>MPPT 1 / 2</th><th>Fault</th></tr></thead>
                  <tbody>
                    {(live.pv.inverters || []).map((inv: any) => (
                      <tr key={inv.id}>
                        <td><div className="cell-main"><strong>{inv.name}</strong><small>{inv.manufacturer} {inv.model}</small></div></td>
                        <td><Badge status={inv.status}>{inv.status}</Badge></td>
                        <td className="mono">{power(inv.powerKw)}</td>
                        <td className="mono">{num(inv.dcVoltageV, 0)} V / {num(inv.dcCurrentA, 0)} A</td>
                        <td className="mono">{num(inv.acVoltageV, 0)} V</td>
                        <td className="mono">{num(inv.powerFactor, 3)}</td>
                        <td className={cn('mono', inv.temperatureC > 65 && 'text-warn')}>{num(inv.temperatureC, 1)} °C</td>
                        <td className="mono">{pct(inv.efficiencyPct, 1)}</td>
                        <td className="mono">{num(inv.mppt1Kw, 0)} / {num(inv.mppt2Kw, 0)} kW</td>
                        <td className="mono">{inv.faultCode ? <span className="text-bad">{inv.faultCode}</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No inverter data" message="Inverter measurements will appear when the gateway is online." />}
          </Card>

          <div className="grid two-col">
            <Card title="Grid & load" subtitle="Power quality at the point of common coupling">
              <KV items={[
                { label: 'Grid available', value: live?.grid?.available == null ? '—' : live.grid.available ? 'YES' : 'NO' },
                { label: 'Voltage L1/L2/L3', value: `${num(live?.grid?.voltageL1V, 1)} / ${num(live?.grid?.voltageL2V, 1)} / ${num(live?.grid?.voltageL3V, 1)} V` },
                { label: 'Frequency', value: `${num(live?.grid?.frequencyHz, 2)} Hz` },
                { label: 'Import / export', value: `${power(live?.grid?.importKw)} / ${power(live?.grid?.exportKw)}` },
                { label: 'Power factor', value: num(live?.grid?.powerFactor, 3) },
                { label: 'Load', value: power(live?.load?.powerKw) },
                { label: 'Load requested', value: power(live?.load?.requestedKw) },
                { label: 'Peak demand', value: power(live?.load?.peakDemandKw) },
              ]} />
            </Card>
            <Card title="Generator & battery" subtitle="Backup plant and BESS state">
              <KV items={[
                { label: 'Generator present', value: live?.generator?.present ? 'YES' : 'NO' },
                { label: 'Generator status', value: live?.generator?.status || '—' },
                { label: 'Output', value: power(live?.generator?.powerKw) },
                { label: 'Fuel level', value: pct(live?.generator?.fuelLevelPct, 0) },
                { label: 'Run hours', value: num(live?.generator?.runHours, 1) },
                { label: 'BESS SOC / SOH', value: `${pct(live?.bess?.socPct, 1)} / ${pct(live?.bess?.sohPct, 1)}` },
                { label: 'BESS power', value: `${power(live?.bess?.powerKw)} (${power(live?.bess?.chargePowerKw)} charge / ${power(live?.bess?.dischargePowerKw)} discharge)` },
                { label: 'Battery temperature', value: `${num(live?.bess?.temperatureC, 1)} °C` },
                { label: 'BMS status', value: live?.bess?.bmsStatus || '—' },
              ]} />
            </Card>
          </div>
        </div>
      )}

      {tab === 'energy' && (
        <div className="stack">
          <div className="filter-bar">
            <RangePicker value={range} onChange={setRange} ranges={['7d', '30d', '90d', '365d']} />
            <span className="filter-meta"><Clock size={14} /> Resolution: {history.data?.energy?.resolution || '—'}</span>
            <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => {
              const rows = energyRows;
              const csv = `\uFEFFts,pv_kwh,load_kwh,charge_kwh,discharge_kwh,import_kwh,export_kwh,generator_kwh\n${rows.map((r: any) => [r.ts, r.pvKwh, r.loadKwh, r.chargeKwh, r.dischargeKwh, r.importKwh, r.exportKwh, r.generatorKwh].join(',')).join('\n')}`;
              const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
              const a = document.createElement('a'); a.href = url; a.download = `${site.code}-energy-${rangeKey}.csv`; a.click(); URL.revokeObjectURL(url);
            }}>Export CSV</Button>
          </div>

          {history.error && <ErrorState error={history.error} onRetry={history.reload} />}
          <div className="grid stats-grid compact">
            <StatCard label="PV energy" value={energy(history.data?.energy?.totals?.pvKwh)} tone="pv" />
            <StatCard label="Load energy" value={energy(history.data?.energy?.totals?.loadKwh)} />
            <StatCard label="Grid import" value={energy(history.data?.energy?.totals?.importKwh)} />
            <StatCard label="Grid export" value={energy(history.data?.energy?.totals?.exportKwh)} />
            <StatCard label="BESS charge" value={energy(history.data?.energy?.totals?.chargeKwh)} tone="bess" />
            <StatCard label="BESS discharge" value={energy(history.data?.energy?.totals?.dischargeKwh)} tone="bess" />
            <StatCard label="Generator" value={energy(history.data?.energy?.totals?.generatorKwh)} />
            <StatCard label="Days recorded" value={history.data?.energy?.totals?.days ?? 0} />
          </div>

          <Card title="Energy balance" subtitle={`${history.data?.energy?.resolution === 'hourly' ? 'Hourly' : 'Daily'} PV, load, grid and storage flows`}>
            <div className="chart h-320">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={energyRows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sdPv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={PALETTE.pv} stopOpacity={0.35} /><stop offset="100%" stopColor={PALETTE.pv} stopOpacity={0.02} /></linearGradient>
                  </defs>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="ts" {...AXIS} tickFormatter={shortTick} />
                  <YAxis {...AXIS} unit=" kWh" width={64} />
                  <Tooltip {...TOOLTIP} labelFormatter={(v: any) => String(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="pvKwh" name="PV" stroke={PALETTE.pv} fill="url(#sdPv)" strokeWidth={1.8} />
                  <Area type="monotone" dataKey="loadKwh" name="Load" stroke={PALETTE.load} fill="transparent" strokeWidth={1.5} />
                  <Line type="monotone" dataKey="importKwh" name="Import" stroke={PALETTE.gridImport} strokeWidth={1.2} dot={false} />
                  <Line type="monotone" dataKey="exportKwh" name="Export" stroke={PALETTE.gridExport} strokeWidth={1.2} dot={false} />
                  <Line type="monotone" dataKey="dischargeKwh" name="BESS discharge" stroke={PALETTE.discharge} strokeWidth={1.2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Telemetry (48 h)" subtitle="Down-sampled raw measurements from the site gateway">
            {telemetryRows.length ? (
              <div className="chart h-300">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={telemetryRows} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="ts" {...AXIS} tickFormatter={shortTick} />
                    <YAxis {...AXIS} width={64} />
                    <Tooltip {...TOOLTIP} labelFormatter={(v: any) => new Date(v).toLocaleString()} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="pvPowerKw" name="PV kW" stroke={PALETTE.pv} dot={false} strokeWidth={1.6} />
                    <Line type="monotone" dataKey="loadPowerKw" name="Load kW" stroke={PALETTE.load} dot={false} strokeWidth={1.6} />
                    <Line type="monotone" dataKey="gridPowerKw" name="Grid kW" stroke={PALETTE.gridImport} dot={false} strokeWidth={1.2} />
                    <Line type="monotone" dataKey="batteryPowerKw" name="Battery kW" stroke={PALETTE.bess} dot={false} strokeWidth={1.2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyState title="No raw telemetry" message="Only persisted gateway samples appear here; demo telemetry is stored every 60 seconds." />}
          </Card>
        </div>
      )}

      {tab === 'devices' && (
        <Card title="Registered devices" subtitle="Modbus TCP assets bound to this site's edge gateway" noPad>
          <DataTable columns={deviceColumns} rows={detail.data?.devices || []} dense />
        </Card>
      )}

      {tab === 'bess' && (
        <div className="stack">
          <div className="grid stats-grid compact">
            <StatCard label="BESS capacity" value={num(site.bess_capacity_kwh, 0)} unit="kWh" tone="bess" />
            <StatCard label="Power rating" value={num(site.bess_power_kw, 0)} unit="kW" tone="bess" />
            <StatCard label="State of charge" value={num(live?.bess?.socPct, 1)} unit="%" tone="bess" />
            <StatCard label="State of health" value={num(live?.bess?.sohPct, 1)} unit="%" />
            <StatCard label="Battery temperature" value={num(live?.bess?.temperatureC, 1)} unit="°C" />
            <StatCard label="Racks" value={detail.data?.bessRacks?.length || 0} />
          </div>
          <Card title="Rack-level battery telemetry" subtitle="SOC, SOH, voltage, current and thermal status per rack" noPad>
            <div className="table-wrap">
              <table className="data-table dense">
                <thead><tr><th>Rack</th><th>Capacity</th><th>SOC</th><th>SOH</th><th>Voltage</th><th>Current</th><th>Temp</th><th>Modules</th><th>Status</th></tr></thead>
                <tbody>
                  {(detail.data?.bessRacks || []).map((rack: any) => {
                    const liveRack = (live?.bess?.racks || []).find((r: any) => r.id === rack.id) || {};
                    return (
                      <tr key={rack.id}>
                        <td><strong>{rack.name}</strong></td>
                        <td className="mono">{num(rack.capacity_kwh, 0)} kWh</td>
                        <td className="mono"><ProgressBar value={liveRack.socPct ?? null} color={(liveRack.socPct || 0) < 25 ? 'var(--warning)' : 'var(--bess)'} /><span>{pct(liveRack.socPct, 1)}</span></td>
                        <td className="mono">{pct(liveRack.sohPct, 1)}</td>
                        <td className="mono">{num(liveRack.voltageV, 2)} V</td>
                        <td className="mono">{num(liveRack.currentA, 1)} A</td>
                        <td className={cn('mono', liveRack.temperatureC > 45 && 'text-warn')}>{num(liveRack.temperatureC, 1)} °C</td>
                        <td className="mono">{rack.module_count}</td>
                        <td><Badge status={liveRack.status || rack.status}>{liveRack.status || rack.status}</Badge></td>
                      </tr>
                    );
                  })}
                  {!(detail.data?.bessRacks || []).length && <tr><td colSpan={9} className="table-empty">No battery racks registered</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'alarms' && (
        <Card title="Alarm history" subtitle="Acknowledgement and resolution actions are permission-controlled and audit-logged" noPad>
          <DataTable columns={alarmColumns} rows={detail.data?.recentAlarms || []} dense />
        </Card>
      )}

      {tab === 'gateway' && (
        <div className="grid two-col">
          <Card title="Edge gateway" subtitle="Outbound-only secure collector" actions={<Button size="sm" variant="ghost" icon={<Router size={14} />} onClick={() => navigate('/gateways')}>All gateways</Button>}>
            {detail.data?.gateway ? (
              <KV items={[
                { label: 'Gateway ID', value: detail.data.gateway.id },
                { label: 'Name', value: detail.data.gateway.name },
                { label: 'Serial', value: detail.data.gateway.serial },
                { label: 'Hardware / firmware', value: `${detail.data.gateway.hardware} / ${detail.data.gateway.firmware}` },
                { label: 'Status', value: <Badge status={detail.data.gateway.status}>{detail.data.gateway.status}</Badge> },
                { label: 'Last seen', value: timeAgo(detail.data.gateway.last_seen_at) },
                { label: 'Buffer backlog', value: `${num(detail.data.gateway.buffer_backlog, 0)} records` },
                { label: 'Latency', value: `${num(detail.data.gateway.latency_ms, 0)} ms` },
                { label: 'CPU / memory', value: `${num(detail.data.gateway.cpu_pct, 1)}% / ${num(detail.data.gateway.mem_pct, 1)}%` },
                { label: 'Uptime', value: `${num((detail.data.gateway.uptime_sec || 0) / 3600, 1)} h` },
                { label: 'Data source', value: sourceLabel(detail.data.gateway.data_source) },
              ]} />
            ) : <EmptyState title="No gateway" message="This site has no edge gateway registered." />}
          </Card>
          <Card title="Security posture" subtitle="Read-only, outbound-only architecture">
            <div className="security-list">
              <div><CheckCircle2 size={15} /><span>MQTT over TLS (8883) with per-gateway credentials</span></div>
              <div><CheckCircle2 size={15} /><span>HTTPS ingest fallback with bearer token</span></div>
              <div><CheckCircle2 size={15} /><span>Modbus TCP polling stays inside the plant network — port 502 is never exposed</span></div>
              <div><CheckCircle2 size={15} /><span>Offline store-and-forward with backlog reconciliation</span></div>
              <div><CheckCircle2 size={15} /><span>No remote equipment control or writeable register path</span></div>
            </div>
            {detail.data?.config && Object.keys(detail.data.config).length > 0 && (
              <div className="site-config">
                <h4>Site configuration</h4>
                <KV items={Object.entries(detail.data.config).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: String(v) }))} />
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal open={Boolean(resolveTarget)} title={`Resolve alarm ${resolveTarget?.code || ''}`} onClose={() => setResolveTarget(null)}
        footer={<><Button variant="ghost" onClick={() => setResolveTarget(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void resolve()}>Resolve alarm</Button></>}>
        <p className="modal-copy">{resolveTarget?.title}</p>
        <label className="field">
          <span className="field-label">Resolution note</span>
          <textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe verification and corrective action…" />
        </label>
        <p className="form-note"><AlertTriangle size={13} /> Resolution is recorded against your user in the audit trail.</p>
      </Modal>
    </div>
  );
}
