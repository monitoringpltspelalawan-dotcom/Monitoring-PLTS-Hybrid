import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import worldData from 'world-atlas/countries-110m.json';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Sun, Gauge, BatteryCharging, PlugZap, Fuel, Leaf, Wallet, ArrowUpRight, Activity, Radio,
  MapPin, FileText, Settings, ChartNoAxesCombined,
} from 'lucide-react';
import { Card, StatCard, PageHeader, Badge, Button, Spinner, ErrorState, EmptyState, Notice } from '../components/ui';
import { EnergyFlow } from '../components/EnergyFlow';
import { SiteSelector, DataTable, Column } from '../components/filters';
import { useAsync, useSites } from '../lib/hooks';
import { get, qs } from '../lib/api';
import { useRealtime } from '../lib/ws';
import { energy, money, num, pct, power, dateTime, statusColor, cn, timeAgo } from '../lib/format';
import { AXIS, GRID, LEGEND, PALETTE, TOOLTIP, shortTick } from '../lib/chart';

interface OverviewData {
  portfolio: any;
  sites: any[];
  trends: any[];
  alarmCounts: { CRITICAL: number; WARNING: number; INFO: number; total: number };
  regions: Array<{ id: string; code: string; name: string }>;
  statusCounts: Record<string, number>;
  dataSources?: { demo: number; live: number };
  demoMode?: boolean;
  generatedAt: string;
}

const MAP_W = 940;
const MAP_H = 520;

export default function Overview() {
  const navigate = useNavigate();
  const sitesState = useSites();
  const { portfolio: livePortfolio, connected, alarmFeed } = useRealtime();
  const [region, setRegion] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const mapGeo = useMemo(() => {
    const topo: any = worldData;
    const countries: any = feature(topo, topo.objects.countries);
    const projection = geoMercator().center([121, -4]).scale(1250).translate([MAP_W / 2, MAP_H / 2]);
    return { countries, projection, path: geoPath(projection) };
  }, []);

  const overview = useAsync<OverviewData>(
    () => get(`/api/sites/overview${qs({ region, status, search, dataSource })}`),
    [region, status, search, dataSource],
  );

  React.useEffect(() => {
    get<{ alarms: any[] }>('/api/alarms?status=ACTIVE&pageSize=6')
      .then((d) => setRecent(d.alarms || []))
      .catch(() => setRecent([]));
  }, []);

  const p = overview.data?.portfolio;
  const live = livePortfolio;
  const sites = useMemo(() => {
    const rows = overview.data?.sites || [];
    return selected.length ? rows.filter((s) => selected.includes(s.id)) : rows;
  }, [overview.data, selected]);
  const mapSites = useMemo(() => sites.filter((s) =>
    s.latitude != null && s.longitude != null &&
    Number.isFinite(Number(s.latitude)) && Number.isFinite(Number(s.longitude))),
  [sites]);
  const siteStatusCounts = useMemo(() => sites.reduce((counts: Record<string, number>, site) => {
    counts[site.status] = (counts[site.status] || 0) + 1;
    return counts;
  }, {}), [sites]);

  const trend = useMemo(() => (overview.data?.trends || []).map((t) => ({
    ...t,
    pvMwh: +(t.pvKwh / 1000).toFixed(2),
    loadMwh: +(t.loadKwh / 1000).toFixed(2),
    label: shortTick(t.day),
  })), [overview.data]);

  const topSites = useMemo(() => [...sites].sort((a, b) => (b.pvTodayKwh || 0) - (a.pvTodayKwh || 0)).slice(0, 8).map((s) => ({
    ...s, label: s.code.replace('PLTS-', ''), pvMwh: +((s.pvTodayKwh || 0) / 1000).toFixed(2),
  })), [sites]);

  const mix = p ? [
    { name: 'Solar PV', value: Math.max(0, p.pvTodayMwh || 0), color: PALETTE.pv },
    { name: 'Grid import', value: Math.max(0, p.importTodayMwh || 0), color: PALETTE.gridImport },
    { name: 'Generator', value: Math.max(0, p.generatorTodayMwh || 0), color: PALETTE.generator },
    { name: 'BESS discharge', value: Math.max(0, p.dischargeTodayMwh || 0), color: PALETTE.discharge },
  ].filter((x) => x.value > 0) : [];

  const alarmRows = useMemo(() => {
    const fromSocket = alarmFeed.slice(0, 4).map((a) => ({ ...a, site_code: a.siteCode || a.site_code }));
    const seen = new Set(fromSocket.map((a) => a.id));
    return [...fromSocket, ...recent.filter((a) => !seen.has(a.id))].slice(0, 6);
  }, [alarmFeed, recent]);

  const columns: Column<any>[] = [
    {
      key: 'code', label: 'Site',
      render: (s) => (
        <div className="cell-main">
          <strong>{s.code}</strong>
          <small>{s.name}</small>
        </div>
      ),
    },
    {
      key: 'status', label: 'Status',
      render: (s) => <Badge status={s.status}>{s.status}</Badge>,
    },
    {
      key: 'dataSource', label: 'Source',
      render: (s) => <span className={cn('source-tag', s.dataSource === 'LIVE' ? 'live' : 'demo')}>{s.dataSource}</span>,
    },
    { key: 'pvPowerKw', label: 'PV now', align: 'right', render: (s) => <span className="mono">{power(s.pvPowerKw)}</span> },
    { key: 'loadPowerKw', label: 'Load now', align: 'right', render: (s) => <span className="mono">{power(s.loadPowerKw)}</span> },
    {
      key: 'socPct', label: 'SOC', align: 'right',
      render: (s) => (
        <span className="soc-inline">
          <i style={{ width: `${Math.max(0, Math.min(100, s.socPct || 0))}%`, background: (s.socPct || 0) < 25 ? 'var(--warning)' : 'var(--bess)' }} />
          <em className="mono">{pct(s.socPct, 0)}</em>
        </span>
      ),
    },
    {
      key: 'pvTodayKwh', label: 'PV today', align: 'right',
      render: (s) => <span className="mono">{energy(s.pvTodayKwh)}</span>,
    },
    {
      key: 'alarmCount', label: 'Alarms', align: 'right',
      render: (s) => s.alarmCount ? <span className="alarm-count">{s.alarmCount}</span> : <span className="muted">—</span>,
    },
    {
      key: 'lastSeenAt', label: 'Last seen', align: 'right',
      render: (s) => <span className="muted">{timeAgo(s.lastSeenAt)}</span>,
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Portfolio command centre"
        title="Hybrid solar overview"
        subtitle={p ? `${p.siteCount} sites · ${num(p.pvCapacityMwp, 2)} MWp PV · ${num(p.bessCapacityMwh, 2)} MWh BESS · ${import.meta.env.VITE_STATIC_DEMO === 'true' ? 'synthetic demo stream' : connected ? 'live stream connected' : 'stream reconnecting'}` : 'Aggregating portfolio telemetry…'}
        actions={
          <>
            <Badge color="var(--good)" dot>READ-ONLY MONITORING</Badge>
            <Button variant="primary" size="sm" icon={<ArrowUpRight size={14} />} onClick={() => navigate('/sites')}>Open site explorer</Button>
          </>
        }
      />

      {overview.data?.dataSources && overview.data.dataSources.demo > 0 && (
        <Notice tone="warn">
          <strong>DEMO DATA</strong> — {overview.data.dataSources.demo} simulated sites are active. Live gateway ingests are labelled <strong>LIVE</strong> and remain isolated from simulation. Last portfolio calculation {dateTime(overview.data.generatedAt)}.
        </Notice>
      )}

      <div className="filter-bar">
        <SiteSelector sites={sitesState.data?.sites || []} selected={selected} onChange={setSelected} />
        <select className="input" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
          <option value="">All regions</option>
          {(overview.data?.regions || []).map((r) => <option key={r.id} value={r.code}>{r.name}</option>)}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {['ONLINE', 'WARNING', 'CRITICAL', 'MAINTENANCE', 'OFFLINE'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={dataSource} onChange={(e) => setDataSource(e.target.value)} aria-label="Data source">
          <option value="">All sources</option>
          <option value="DEMO">Demo data</option>
          <option value="LIVE">Live data</option>
        </select>
        <input className="input grow" placeholder="Search site code, name or location…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button variant="ghost" size="sm" onClick={overview.reload} icon={<Activity size={14} />}>Refresh</Button>
      </div>

      {overview.error && <ErrorState error={overview.error} onRetry={overview.reload} />}
      {overview.loading && !overview.data && <Spinner label="Loading portfolio telemetry…" />}

      {p && (
        <>
          <div className="grid stats-grid overview-kpis">
            <StatCard label="Total PV power" value={num(live?.pvPowerMw ?? p.pvPowerMw, 2)} unit="MW" tone="pv" icon={<Sun size={17} />}
              sub={<span>{num(p.pvCapacityMwp, 2)} MWp installed</span>} />
            <StatCard label="PV energy today" value={num(p.pvTodayMwh, 1)} unit="MWh" tone="pv" icon={<Leaf size={17} />}
              sub={<span>{energy(p.pvTodayMwh * 1000)} generated today</span>} />
            <StatCard label="Avg. battery SOC" value={num(live?.avgSocPct ?? p.avgSocPct, 1)} unit="%" tone="bess" icon={<BatteryCharging size={17} />}
              sub={<span>{num(p.bessCapacityMwh, 2)} MWh capacity</span>} />
            <StatCard label="Total load" value={num(live?.loadPowerMw ?? p.loadPowerMw, 2)} unit="MW" icon={<Gauge size={17} />}
              sub={<span>{num(p.loadTodayMwh, 1)} MWh served today</span>} />
            <StatCard label="PLN power" value={num(live?.gridImportMw ?? p.gridImportMw, 2)} unit="MW" icon={<PlugZap size={17} />}
              sub={<span>{num(live?.gridExportMw ?? p.gridExportMw, 2)} MW export</span>} />
            <StatCard label="Generator" value={num(live?.generatorPowerMw ?? p.generatorPowerMw, 2)} unit="MW" icon={<Fuel size={17} />}
              sub={<span>{sites.filter((s) => s.generatorRunning).length} generators running</span>} />
          </div>

          <div className="overview-primary-grid">
            <Card
              title={<><PlugZap size={15} /> Energy flow</>}
              subtitle="Aggregated portfolio power · read-only monitoring"
              actions={<span className={cn('live-chip', connected ? 'on' : 'off')}><i /> {connected ? 'REALTIME' : 'LAST KNOWN'}</span>}
              className="overview-flow-card"
            >
              <EnergyFlow
                compact
                ts={live?.ts || overview.data.generatedAt}
                stale={!connected}
                nodes={{
                  pv: {
                    kw: Number(live?.pvPowerMw ?? p.pvPowerMw) * 1000,
                    capacityKwp: Number(p.pvCapacityMwp) * 1000,
                    utilPct: (Number(p.pvPowerMw) / Math.max(0.01, Number(p.pvCapacityMwp))) * 100,
                    status: connected ? 'ONLINE' : 'STALE',
                  },
                  grid: {
                    kw: (Number(live?.gridImportMw ?? p.gridImportMw) - Number(live?.gridExportMw ?? p.gridExportMw)) * 1000,
                    importKw: Number(live?.gridImportMw ?? p.gridImportMw) * 1000,
                    exportKw: Number(live?.gridExportMw ?? p.gridExportMw) * 1000,
                    status: connected ? 'ONLINE' : 'STALE',
                  },
                  bess: {
                    kw: (Number(live?.dischargePowerMw ?? p.dischargePowerMw) - Number(live?.chargePowerMw ?? p.chargePowerMw)) * 1000,
                    socPct: live?.avgSocPct ?? p.avgSocPct,
                    capacityKwh: Number(p.bessCapacityMwh) * 1000,
                    status: connected ? 'ONLINE' : 'STALE',
                  },
                  generator: {
                    kw: Number(live?.generatorPowerMw ?? p.generatorPowerMw) * 1000,
                    status: connected ? 'ONLINE' : 'STALE',
                  },
                  load: {
                    kw: Number(live?.loadPowerMw ?? p.loadPowerMw) * 1000,
                    status: connected ? 'ONLINE' : 'STALE',
                  },
                }}
              />
            </Card>

            <Card
              title="Site overview"
              subtitle={`${mapSites.length} mapped sites · select a marker to open its details`}
              actions={<Button size="sm" variant="ghost" onClick={() => navigate('/map')}>View map <ArrowUpRight size={13} /></Button>}
              className="overview-map-card"
              noPad
            >
              <div className="overview-map-shell">
                <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="overview-map" role="img" aria-label="Portfolio site locations across Indonesia">
                  <defs>
                    <radialGradient id="overviewMapGlow" cx="50%" cy="50%" r="60%">
                      <stop offset="0%" stopColor="var(--map-glow)" stopOpacity="var(--map-glow-opacity)" />
                      <stop offset="100%" stopColor="#050b12" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  <rect width={MAP_W} height={MAP_H} fill="var(--map-surface)" />
                  <ellipse cx={MAP_W * 0.56} cy={MAP_H * 0.55} rx={320} ry={220} fill="url(#overviewMapGlow)" />
                  <g className="map-countries">
                    {mapGeo.countries.features.map((f: any, i: number) => (
                      <path key={f.id || i} d={mapGeo.path(f) || ''} />
                    ))}
                  </g>
                  <g className="map-graticule">
                    {[-10, -5, 0, 5, 10].map((lat) => {
                      const p1 = mapGeo.projection([95, lat]);
                      const p2 = mapGeo.projection([141, lat]);
                      return p1 && p2 ? <line key={lat} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} /> : null;
                    })}
                    {[100, 110, 120, 130, 140].map((lon) => {
                      const p1 = mapGeo.projection([lon, -12]);
                      const p2 = mapGeo.projection([lon, 8]);
                      return p1 && p2 ? <line key={lon} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} /> : null;
                    })}
                  </g>
                  {mapSites.map((site) => {
                    const point = mapGeo.projection([Number(site.longitude), Number(site.latitude)]);
                    if (!point || !point.every(Number.isFinite)) return null;
                    const [x, y] = point;
                    const color = statusColor(site.status);
                    const radius = 5 + Math.sqrt(Math.max(40, Number(site.pvCapacityKwp) || 0)) / 8;
                    return (
                      <g
                        key={site.id}
                        className="overview-map-marker"
                        transform={`translate(${x},${y})`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${site.code}, status ${site.status}`}
                        onClick={() => navigate(`/sites/${site.id}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/sites/${site.id}`); }}
                      >
                        {site.status !== 'OFFLINE' && <circle r={radius + 8} fill={color} opacity={0.15} />}
                        <circle r={radius + 2.5} fill="none" stroke={color} strokeWidth={1} opacity={0.5} />
                        <circle r={radius} fill={color} fillOpacity={0.92} stroke="#07111c" strokeWidth={1.4} />
                        <title>{site.code} · {site.name} · {site.status}</title>
                      </g>
                    );
                  })}
                  <text x={MAP_W - 18} y={MAP_H - 20} textAnchor="end" className="map-credit">Coordinates from site registry · offline vector map</text>
                </svg>
                {!mapSites.length && <div className="overview-map-empty"><MapPin size={20} /> No mapped sites in this selection</div>}
                <div className="overview-map-status" aria-label="Site status counts">
                  {[
                    ['ONLINE', 'var(--good)'],
                    ['WARNING', 'var(--warning)'],
                    ['OFFLINE', 'var(--critical)'],
                  ].map(([label, color]) => (
                    <span key={label}><i style={{ background: color }} />{label}<strong>{siteStatusCounts[label] || 0}</strong></span>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <div className="overview-detail-grid">
            <Card title="Battery SOC" subtitle="Portfolio average charge level" className="overview-battery-card">
              <div className="overview-battery">
                <div className="soc-gauge" style={{ '--soc-angle': `${Math.max(0, Math.min(100, Number(live?.avgSocPct ?? p.avgSocPct) || 0)) * 3.6}deg` } as React.CSSProperties}>
                  <div><strong>{num(live?.avgSocPct ?? p.avgSocPct, 1)}%</strong><span>Average SOC</span></div>
                </div>
                <div className="battery-metrics">
                  <div><span><i className="metric-dot charge" />Battery charge</span><strong>{power(live?.chargePowerMw ?? p.chargePowerMw)}</strong></div>
                  <div><span><i className="metric-dot discharge" />Battery discharge</span><strong>{power(live?.dischargePowerMw ?? p.dischargePowerMw)}</strong></div>
                  <div><span><i className="metric-dot bess" />Installed capacity</span><strong>{num(p.bessCapacityMwh, 2)} MWh</strong></div>
                </div>
              </div>
            </Card>

            <Card
              title="PV generation trend"
              subtitle="Daily energy · last 14 days"
              actions={<span className="overview-range-chip">14D</span>}
              className="overview-trend-card"
            >
              <div className="chart overview-trend-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 8, right: 6, left: -22, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ovPv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PALETTE.pv} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={PALETTE.pv} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="ovLoad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PALETTE.load} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={PALETTE.load} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="label" {...AXIS} />
                    <YAxis {...AXIS} width={44} />
                    <Tooltip {...TOOLTIP} formatter={(v: any) => `${num(v, 1)} MWh`} />
                    <Area type="monotone" dataKey="pvMwh" name="PV energy" stroke={PALETTE.pv} fill="url(#ovPv)" strokeWidth={2} />
                    <Area type="monotone" dataKey="loadMwh" name="Load" stroke={PALETTE.load} fill="url(#ovLoad)" strokeWidth={1.6} />
                    <Legend {...LEGEND} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="System status" subtitle="Site availability and stream health" className="overview-status-card">
              <div className="overview-system-status">
                <div className="system-stream-state">
                  <span className={cn('system-state-dot', connected ? 'good' : 'warning')} />
                  <span>Realtime stream</span>
                  <strong className={connected ? 'text-good' : 'text-warning'}>{connected ? 'Connected' : 'Reconnecting'}</strong>
                </div>
                {[
                  ['Online sites', p.onlineSites, 'var(--good)'],
                  ['Warning sites', p.warningSites, 'var(--warning)'],
                  ['Critical sites', p.criticalSites, 'var(--critical)'],
                  ['Offline sites', p.offlineSites, 'var(--muted)'],
                ].map(([label, count, color]) => (
                  <div className="system-status-row" key={label as string}>
                    <span><i style={{ background: color as string }} />{label}</span>
                    <strong>{num(count, 0)}<small> / {num(p.siteCount, 0)}</small></strong>
                  </div>
                ))}
                <div className="operation-progress">
                  <div><span>Portfolio online</span><strong>{pct((Number(p.onlineSites) / Math.max(1, Number(p.siteCount))) * 100, 0)}</strong></div>
                  <i><b style={{ width: `${Math.min(100, Math.max(0, (Number(p.onlineSites) / Math.max(1, Number(p.siteCount))) * 100))}%` }} /></i>
                </div>
              </div>
            </Card>

            <Card
              title="Active alarms"
              subtitle={`${num(p.openAlarms, 0)} open across selected sites`}
              actions={<Button size="sm" variant="ghost" onClick={() => navigate('/alarms')}>View all <ArrowUpRight size={13} /></Button>}
              className="overview-alarms-card"
            >
              {alarmRows.length ? (
                <div className="overview-alarm-list">
                  {alarmRows.slice(0, 4).map((a) => (
                    <button key={a.id || `${a.code}-${a.triggered_at}`} className="overview-alarm-row" onClick={() => navigate('/alarms')}>
                      <i style={{ background: statusColor(a.severity) }} />
                      <span className="alarm-severity">{a.severity}</span>
                      <span className="alarm-description"><strong>{a.title || a.code}</strong><small>{a.site_code || a.siteCode || 'Portfolio'}</small></span>
                      <time>{timeAgo(a.triggered_at || a.ts)}</time>
                    </button>
                  ))}
                </div>
              ) : <EmptyState title="No active alarms" message="All clear across the current filter scope." />}
            </Card>
          </div>

          <div className="overview-bottom-grid">
            <Card title="Top sites performance" subtitle="Ranked by PV energy generated today" className="overview-top-sites">
              {topSites.length ? (
                <div className="overview-site-rank-list">
                  {topSites.slice(0, 4).map((site, index) => {
                    const maxYield = Math.max(1, ...topSites.map((row) => row.pvTodayKwh || 0));
                    return (
                      <button key={site.id} className="overview-site-rank" onClick={() => navigate(`/sites/${site.id}`)}>
                        <span className="rank-number">{index + 1}</span>
                        <span className="rank-site"><strong>{site.code}</strong><small>{site.name}</small></span>
                        <i><b style={{ width: `${Math.max(4, ((site.pvTodayKwh || 0) / maxYield) * 100)}%` }} /></i>
                        <strong className="rank-value">{num(site.pvMwh, 2)} MWh</strong>
                      </button>
                    );
                  })}
                </div>
              ) : <EmptyState title="No generation yet" message="Waiting for the current day's energy roll-up." />}
            </Card>

            <Card title="Energy contribution" subtitle="Today's recorded supply mix" className="overview-mix-card">
              {mix.length ? (
                <div className="overview-mix">
                  <div className="overview-mix-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={mix} dataKey="value" nameKey="name" innerRadius={43} outerRadius={62} paddingAngle={2} stroke="none">
                          {mix.map((item) => <Cell key={item.name} fill={item.color} />)}
                        </Pie>
                        <Tooltip {...TOOLTIP} formatter={(v: any) => `${num(v, 1)} MWh`} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="overview-mix-center"><strong>{num(p.renewableSharePct, 0)}%</strong><span>Renewable</span></div>
                  </div>
                  <div className="overview-mix-legend">
                    {mix.map((item) => (
                      <div key={item.name}><i style={{ background: item.color }} /><span>{item.name}</span><strong>{pct((item.value / Math.max(0.01, mix.reduce((a, b) => a + b.value, 0))) * 100, 0)}</strong></div>
                    ))}
                  </div>
                </div>
              ) : <EmptyState title="No energy data" message="No supply has been recorded for today." />}
            </Card>

            <Card title="Quick access" subtitle="Common monitoring tools" className="overview-quick-card">
              <div className="overview-quick-links">
                <button onClick={() => navigate('/energy')}><ChartNoAxesCombined size={17} /><span>Energy analytics</span></button>
                <button onClick={() => navigate('/reports')}><FileText size={17} /><span>Reports</span></button>
                <button onClick={() => navigate('/map')}><MapPin size={17} /><span>Site map</span></button>
                <button onClick={() => navigate('/settings')}><Settings size={17} /><span>Settings</span></button>
              </div>
            </Card>

            <Card title="Sustainability impact" subtitle="Measured portfolio contribution today" className="overview-impact-card">
              <div className="impact-grid">
                <div className="impact-tile impact-energy"><span>CO₂ avoided</span><strong>{num(p.co2AvoidedTodayKg, 0)} <small>kg</small></strong><i><Leaf size={14} /> Lower emissions</i></div>
                <div className="impact-tile impact-renewable"><span>Renewable share</span><strong>{num(p.renewableSharePct, 1)}<small>%</small></strong><i><Sun size={14} /> Solar contribution</i></div>
                <div className="impact-tile impact-savings"><span>Cost savings</span><strong>{money(p.savingsTodayIdr)}</strong><i><Wallet size={14} /> Estimated today</i></div>
              </div>
            </Card>
          </div>

          <Card
            title="Site performance"
            subtitle={`${sites.length} sites in scope · select a row for the plant view`}
            actions={<Button size="sm" variant="ghost" onClick={() => navigate('/sites')}>All sites <ArrowUpRight size={13} /></Button>}
            noPad
            className="overview-site-table"
          >
            <DataTable columns={columns} rows={sites} onRowClick={(s) => navigate(`/sites/${s.id}`)} dense />
          </Card>

          <div className="mini-strip">
            <span><Radio size={14} /> {connected ? 'WebSocket telemetry active' : 'Telemetry stream retrying'}</span>
            <span><Sun size={14} /> {num(p.pvYearMwh, 1)} MWh PV this year</span>
            <span><Leaf size={14} /> {num(p.co2AvoidedYearKg / 1000, 1)} t CO₂ avoided this year</span>
            <span><Wallet size={14} /> {money(p.savingsYearIdr)} annualised savings</span>
            <span><Activity size={14} /> {p.onlineSites} online · {p.offlineSites} offline · {p.maintenanceSites} maintenance</span>
          </div>
        </>
      )}
    </div>
  );
}
