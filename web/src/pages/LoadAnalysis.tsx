import React, { useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Gauge, Sun, PlugZap, TrendingUp, Activity, Percent, ArrowUpRight, BatteryCharging } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard } from '../components/ui';
import { Column, DataTable, RangePicker, RangeValue, SiteSelector } from '../components/filters';
import { useAsync, useSites } from '../lib/hooks';
import { get, qs } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import { cn, energy, num, pct, power } from '../lib/format';
import { AXIS, GRID, LEGEND, PALETTE, TOOLTIP, shortTick } from '../lib/chart';

export default function LoadAnalysis() {
  const navigate = useNavigate();
  const sitesState = useSites();
  const [selected, setSelected] = useState<string[]>([]);
  const [range, setRange] = useState<RangeValue>({ range: '30d' });

  const params = {
    siteIds: selected.join(','),
    ...(range.from && range.to ? { from: range.from, to: range.to } : { range: range.range }),
  };
  const data = useAsync<any>(() => get(`/api/analytics/load${qs(params)}`), [selected.join(','), range.range, range.from, range.to]);

  const totals = data.data?.totals;
  const hourly = data.data?.hourlyProfile || [];
  const daily = data.data?.daily || [];
  const sites = data.data?.sites || [];

  const chartDaily = useMemo(() => daily.map((d: any) => ({ ...d, label: shortTick(d.day) })), [daily]);

  const columns: Column<any>[] = [
    { key: 'code', label: 'Site', render: (r) => <div className="cell-main"><strong>{r.code}</strong><small>{r.name}{r.location ? ` · ${r.location}` : ''}</small></div> },
    { key: 'capacityKwp', label: 'PV kWp', align: 'right', render: (r) => <span className="mono">{num(r.capacityKwp, 0)}</span> },
    { key: 'liveLoadKw', label: 'Load now', align: 'right', render: (r) => <span className="mono">{power(r.liveLoadKw)}</span> },
    { key: 'livePvKw', label: 'PV now', align: 'right', render: (r) => <span className="mono">{power(r.livePvKw)}</span> },
    {
      key: 'coverage', label: 'Solar coverage', align: 'right',
      render: (r) => {
        const value = r.liveLoadKw ? ((r.livePvKw || 0) / r.liveLoadKw) * 100 : null;
        return <span className={cn('mono', value == null ? '' : value >= 80 ? 'text-good' : value < 30 ? 'text-warn' : '')}>{pct(value, 0)}</span>;
      },
    },
    {
      key: 'open', label: '', align: 'right',
      render: (r) => <span className="row-actions"><button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); navigate(`/sites/${r.siteId}`); }}>Open <ArrowUpRight size={12} /></button></span>,
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Demand intelligence"
        title="Load analysis"
        subtitle="Plant consumption, hourly demand shape, peak contribution and solar coverage across the portfolio."
        actions={<Badge color="var(--accent)" dot>{sites.length} SITES IN SCOPE</Badge>}
      />

      <div className="filter-bar">
        <SiteSelector sites={sitesState.data?.sites || []} selected={selected} onChange={setSelected} />
        <RangePicker value={range} onChange={setRange} ranges={['7d', '30d', '90d', '365d']} />
        <span className="filter-meta"><Activity size={14} /> Hourly profile from persisted energy records</span>
      </div>

      {data.error && <ErrorState error={data.error} onRetry={data.reload} />}
      {data.loading && !data.data && <Spinner label="Computing demand profile…" />}

      {totals && (
        <>
          <div className="grid stats-grid">
            <StatCard label="Energy consumed" value={num(totals.loadMwh, 1)} unit="MWh" icon={<Gauge size={17} />} sub={<span>Across {daily.length} recorded days</span>} />
            <StatCard label="Peak demand" value={num(totals.peakLoadMw, 2)} unit="MW" tone="warn" icon={<TrendingUp size={17} />} sub={<span>Highest interval in period</span>} />
            <StatCard label="Load factor" value={num(totals.loadFactorPct, 1)} unit="%" icon={<Percent size={17} />} sub={<span>Average ÷ peak consumption</span>} />
            <StatCard label="Solar supplied" value={num(totals.pvMwh, 1)} unit="MWh" tone="pv" icon={<Sun size={17} />} sub={<span>{pct(totals.solarCoveragePct, 0)} of live load right now</span>} />
            <StatCard label="Grid import" value={num(totals.gridImportMwh, 1)} unit="MWh" icon={<PlugZap size={17} />} sub={<span>Utility energy consumed in period</span>} />
            <StatCard label="Live load" value={num(totals.liveLoadMw, 2)} unit="MW" icon={<Activity size={17} />} sub={<span>{num(totals.livePvMw, 2)} MW PV generating now</span>} />
          </div>

          <div className="grid two-col">
            <Card title="Average hourly demand shape" subtitle="Aggregated load, solar and grid import by hour of day">
              {hourly.length ? (
                <div className="chart h-300">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={hourly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="hour" {...AXIS} interval={1} />
                      <YAxis {...AXIS} unit=" kWh" width={64} />
                      <Tooltip {...TOOLTIP} />
                      <Legend {...LEGEND} />
                      <Bar dataKey="loadKwh" name="Load" fill={PALETTE.load} fillOpacity={0.72} radius={[2, 2, 0, 0]} />
                      <Bar dataKey="pvKwh" name="PV" fill={PALETTE.pv} fillOpacity={0.85} radius={[2, 2, 0, 0]} />
                      <Line type="monotone" dataKey="importKwh" name="Grid import" stroke={PALETTE.gridImport} strokeWidth={1.8} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyState title="No hourly profile" message="Hourly records cover the previous 30 days." />}
            </Card>

            <Card title="Daily consumption trend" subtitle="Load and solar generation per day">
              {chartDaily.length ? (
                <div className="chart h-300">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartDaily} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <defs>
                        <linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={PALETTE.load} stopOpacity={0.36} />
                          <stop offset="100%" stopColor={PALETTE.load} stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="loadPv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={PALETTE.pv} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={PALETTE.pv} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="label" {...AXIS} />
                      <YAxis {...AXIS} unit=" MWh" width={64} />
                      <Tooltip {...TOOLTIP} />
                      <Legend {...LEGEND} />
                      <Area type="monotone" dataKey="loadMwh" name="Load" stroke={PALETTE.load} fill="url(#loadGrad)" strokeWidth={1.8} />
                      <Area type="monotone" dataKey="pvMwh" name="PV" stroke={PALETTE.pv} fill="url(#loadPv)" strokeWidth={1.6} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyState title="No daily records" />}
            </Card>
          </div>

          <div className="grid two-col-wide">
            <Card title="Site demand profile" subtitle="Live load, solar coverage and authorized assets" noPad>
              <DataTable columns={columns} rows={sites} dense />
            </Card>

            <div className="stack">
              <Card title="Load composition" subtitle="Utility versus solar share in the period">
                <div className="composition-list">
                  <div>
                    <i style={{ background: PALETTE.pv }} />
                    <span>Solar generation</span>
                    <strong>{energy(totals.pvMwh * 1000)}</strong>
                    <em>{pct((totals.pvMwh / Math.max(0.01, totals.loadMwh)) * 100, 0)} of load</em>
                  </div>
                  <div>
                    <i style={{ background: PALETTE.gridImport }} />
                    <span>Grid import</span>
                    <strong>{energy(totals.gridImportMwh * 1000)}</strong>
                    <em>{pct((totals.gridImportMwh / Math.max(0.01, totals.loadMwh)) * 100, 0)} of load</em>
                  </div>
                  <div>
                    <i style={{ background: PALETTE.discharge }} />
                    <span>BESS contribution</span>
                    <strong>Live</strong>
                    <em>{num(totals.livePvMw, 2)} MW PV online</em>
                  </div>
                </div>
              </Card>

              <Card title="Demand insights" subtitle="Automatic observations from the selected period">
                <div className="insight-list">
                  <div className={cn(totals.loadFactorPct >= 60 ? 'good' : 'warn')}>
                    <Percent size={15} />
                    <div>
                      <strong>Load factor {pct(totals.loadFactorPct, 1)}</strong>
                      <span>{totals.loadFactorPct >= 60 ? 'Relatively flat demand supports stable generation planning.' : 'Peaky demand increases grid import during high-load hours.'}</span>
                    </div>
                  </div>
                  <div className={cn(totals.solarCoveragePct >= 60 ? 'good' : 'warn')}>
                    <Sun size={15} />
                    <div>
                      <strong>Live solar coverage {pct(totals.solarCoveragePct, 0)}</strong>
                      <span>{totals.solarCoveragePct >= 60 ? 'Solar is carrying the majority of current load.' : 'Storage and grid supply are covering most of the current load.'}</span>
                    </div>
                  </div>
                  <div>
                    <BatteryCharging size={15} />
                    <div>
                      <strong>Peak demand {num(totals.peakLoadMw, 2)} MW</strong>
                      <span>Use the site drill-down to inspect the interval-level load curve.</span>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
