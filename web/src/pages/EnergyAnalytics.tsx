import React, { useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Download, Leaf, Sun, Gauge, PlugZap, Wallet, TrendingUp, BatteryCharging, Percent } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard, Tabs } from '../components/ui';
import { Column, DataTable, RangePicker, RangeValue, SiteSelector } from '../components/filters';
import { useAsync, useSites } from '../lib/hooks';
import { download, get, qs } from '../lib/api';
import { cn, energy, money, num, pct } from '../lib/format';
import { AXIS, GRID, LEGEND, PALETTE, TOOLTIP, shortTick } from '../lib/chart';

type Tab = 'balance' | 'savings' | 'comparison';

export default function EnergyAnalytics() {
  const sitesState = useSites();
  const [selected, setSelected] = useState<string[]>([]);
  const [range, setRange] = useState<RangeValue>({ range: '30d' });
  const [granularity, setGranularity] = useState('daily');
  const [tab, setTab] = useState<Tab>('balance');

  const params = {
    siteIds: selected.join(','),
    granularity,
    ...(range.from && range.to ? { from: range.from, to: range.to } : { range: range.range }),
  };

  const data = useAsync<any>(() => get(`/api/analytics${qs(params)}`), [selected.join(','), range.range, range.from, range.to, granularity]);
  const savings = useAsync<any>(() => get(`/api/analytics/savings${qs({ siteIds: selected.join(','), ...(range.from && range.to ? { from: range.from, to: range.to } : { range: range.range }) })}`), [selected.join(','), range.range, range.from, range.to, tab]);
  const perf = useAsync<any>(() => get(`/api/analytics/performance${qs({ siteIds: selected.join(','), range: range.range || '30d' })}`), [selected.join(','), range.range, tab]);

  const s = data.data?.summary;
  const series = data.data?.series || [];
  const rows = data.data?.comparison || [];
  const savingsRows = savings.data?.bySite || [];

  const chartData = useMemo(() => series.map((r: any) => ({
    ...r,
    label: shortTick(r.period || r.day || ''),
  })), [series]);

  const comparisonColumns: Column<any>[] = [
    { key: 'code', label: 'Site', render: (r) => <div className="cell-main"><strong>{r.code}</strong><small>{r.name}</small></div> },
    { key: 'pvCapacityKwp', label: 'kWp', align: 'right', render: (r) => <span className="mono">{num(r.pvCapacityKwp, 0)}</span> },
    { key: 'pvMwh', label: 'PV MWh', align: 'right', render: (r) => <span className="mono">{num(r.pvMwh, 1)}</span> },
    { key: 'loadMwh', label: 'Load MWh', align: 'right', render: (r) => <span className="mono">{num(r.loadMwh, 1)}</span> },
    { key: 'importMwh', label: 'Import', align: 'right', render: (r) => <span className="mono">{num(r.importMwh, 1)}</span> },
    { key: 'exportMwh', label: 'Export', align: 'right', render: (r) => <span className="mono">{num(r.exportMwh, 1)}</span> },
    { key: 'specificYield', label: 'kWh/kWp', align: 'right', render: (r) => <span className="mono">{num(r.specificYield, 1)}</span> },
    { key: 'performanceRatio', label: 'PR', align: 'right', render: (r) => <span className={cn('mono', r.performanceRatio >= 0.82 ? 'text-good' : r.performanceRatio < 0.72 ? 'text-bad' : 'text-warn')}>{num(r.performanceRatio, 3)}</span> },
    { key: 'selfConsumptionPct', label: 'Self-use', align: 'right', render: (r) => <span className="mono">{pct(r.selfConsumptionPct, 1)}</span> },
    { key: 'savingsIdr', label: 'Savings', align: 'right', render: (r) => <span className="mono">{money(r.savingsIdr)}</span> },
    { key: 'dataSource', label: 'Source', render: (r) => <span className={cn('source-tag', r.dataSource === 'LIVE' ? 'live' : 'demo')}>{r.dataSource}</span> },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Energy intelligence"
        title="Energy analytics"
        subtitle="Daily, weekly, monthly, quarterly and annual energy balance across the hybrid portfolio."
        actions={<>
          <Badge color="var(--accent)" dot>{granularity.toUpperCase()}</Badge>
          <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => download(`/api/analytics/export${qs(params)}`)}>Export CSV</Button>
        </>}
      />

      <div className="filter-bar">
        <SiteSelector sites={sitesState.data?.sites || []} selected={selected} onChange={setSelected} />
        <RangePicker value={range} onChange={setRange} ranges={['7d', '30d', '90d', '365d']} />
        <select className="input" value={granularity} onChange={(e) => setGranularity(e.target.value)} aria-label="Granularity">
          {['daily', 'weekly', 'monthly', 'quarterly', 'annual'].map((g) => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}
        </select>
        <span className="filter-meta">{data.data?.siteCount ?? 0} sites · {s ? `${s.days} recorded days` : '—'}</span>
      </div>

      {(data.error || sitesState.error) && <ErrorState error={data.error || sitesState.error || ''} onRetry={data.reload} />}
      {data.loading && !data.data && <Spinner label="Aggregating energy records…" />}
      {!data.loading && !data.data?.summary && <EmptyState title="No authorized data" message="Select at least one site in your authorization scope." />}

      {s && (
        <>
          <div className="grid stats-grid">
            <StatCard label="PV generation" value={num(s.pvMwh, 1)} unit="MWh" tone="pv" icon={<Sun size={17} />} sub={<span>{num(s.specificYieldKwhPerKwp, 1)} kWh/kWp · PR {num(s.performanceRatio, 3)}</span>} />
            <StatCard label="Plant load" value={num(s.loadMwh, 1)} unit="MWh" icon={<Gauge size={17} />} sub={<span>Peak {num(s.peakLoadMw, 2)} MW</span>} />
            <StatCard label="Grid import" value={num(s.importMwh, 1)} unit="MWh" icon={<PlugZap size={17} />} sub={<span>Export {num(s.exportMwh, 1)} MWh</span>} />
            <StatCard label="Renewable share" value={num(s.renewableSharePct, 1)} unit="%" tone="good" icon={<Leaf size={17} />} sub={<span>{num(s.co2AvoidedKg / 1000, 1)} t CO₂ avoided</span>} />
            <StatCard label="Self-consumption" value={num(s.selfConsumptionPct, 1)} unit="%" icon={<Percent size={17} />} sub={<span>{num(s.capacityUtilisationPct, 1)}% capacity utilisation</span>} />
            <StatCard label="BESS throughput" value={num(s.dischargeMwh, 1)} unit="MWh" tone="bess" icon={<BatteryCharging size={17} />} sub={<span>{num(s.chargeMwh, 1)} MWh charged · {num(s.bessCycles, 2)} cycles</span>} />
            <StatCard label="Generator" value={num(s.generatorMwh, 1)} unit="MWh" icon={<TrendingUp size={17} />} sub={<span>Backup generation in period</span>} />
            <StatCard label="Energy savings" value={money(s.savingsIdr)} icon={<Wallet size={17} />} sub={<span>Export revenue {money(s.exportRevenueIdr)} · tariff {money(s.tariffIdrPerKwh, false)}/kWh</span>} />
          </div>

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'balance', label: 'Energy balance' },
              { value: 'savings', label: 'Savings & CO₂' },
              { value: 'comparison', label: 'Site comparison', count: rows.length },
            ]}
          />

          {tab === 'balance' && (
            <>
              <Card title="Energy balance by period" subtitle={`${granularity} totals across ${data.data?.siteCount} sites`}>
                {chartData.length ? (
                  <div className="chart h-330">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                        <CartesianGrid {...GRID} />
                        <XAxis dataKey="label" {...AXIS} />
                        <YAxis {...AXIS} unit=" MWh" width={64} />
                        <Tooltip {...TOOLTIP} />
                        <Legend {...LEGEND} />
                        <Bar dataKey="pvMwh" name="PV" stackId="e" fill={PALETTE.pv} radius={[0, 0, 0, 0]} />
                        <Bar dataKey="importMwh" name="Grid import" stackId="e" fill={PALETTE.gridImport} />
                        <Bar dataKey="generatorMwh" name="Generator" stackId="e" fill={PALETTE.generator} />
                        <Bar dataKey="dischargeMwh" name="BESS discharge" stackId="e" fill={PALETTE.discharge} radius={[3, 3, 0, 0]} />
                        <Line type="monotone" dataKey="loadMwh" name="Load" stroke={PALETTE.load} strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyState title="No series data" message="No daily energy records exist for the selected range." />}
              </Card>

              <div className="grid two-col">
                <Card title="Generation vs consumption" subtitle="PV and load trend">
                  <div className="chart h-260">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                        <CartesianGrid {...GRID} />
                        <XAxis dataKey="label" {...AXIS} />
                        <YAxis {...AXIS} width={60} unit=" MWh" />
                        <Tooltip {...TOOLTIP} />
                        <Line type="monotone" dataKey="pvMwh" name="PV" stroke={PALETTE.pv} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="loadMwh" name="Load" stroke={PALETTE.load} strokeWidth={1.6} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card title="Monthly roll-up" subtitle="Aggregated by calendar month">
                  <div className="chart h-260">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.data?.monthly || []} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                        <CartesianGrid {...GRID} />
                        <XAxis dataKey="month" {...AXIS} />
                        <YAxis {...AXIS} unit=" MWh" width={60} />
                        <Tooltip {...TOOLTIP} />
                        <Legend {...LEGEND} />
                        <Bar dataKey="pvMwh" name="PV" fill={PALETTE.pv} radius={[2, 2, 0, 0]} />
                        <Bar dataKey="importMwh" name="Import" fill={PALETTE.gridImport} radius={[2, 2, 0, 0]} />
                        <Bar dataKey="exportMwh" name="Export" fill={PALETTE.gridExport} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>
            </>
          )}

          {tab === 'savings' && (
            <>
              {savings.error && <ErrorState error={savings.error} onRetry={savings.reload} />}
              <div className="grid stats-grid compact">
                <StatCard label="PV savings" value={money(savings.data?.summary?.savingsIdr)} icon={<Wallet size={16} />} sub={<span>Displaced grid energy</span>} />
                <StatCard label="Export revenue" value={money(savings.data?.summary?.exportRevenueIdr)} icon={<PlugZap size={16} />} sub={<span>At 65% of energy tariff</span>} />
                <StatCard label="Total benefit" value={money(savings.data?.summary?.totalBenefitIdr)} tone="good" icon={<TrendingUp size={16} />} sub={<span>PV savings + export revenue</span>} />
                <StatCard label="CO₂ avoided" value={num(savings.data?.summary?.co2AvoidedTonnes, 1)} unit="t" tone="good" icon={<Leaf size={16} />} sub={<span>Emission factor {num(savings.data?.summary?.emissionFactorKgPerKwh, 2)} kg/kWh</span>} />
                <StatCard label="Equivalent trees" value={num(savings.data?.summary?.equivalentTrees, 0)} icon={<Leaf size={16} />} sub={<span>21.7 kg CO₂ per tree-year</span>} />
                <StatCard label="Avoided car km" value={num(savings.data?.summary?.equivalentCarsKm, 0)} icon={<TrendingUp size={16} />} sub={<span>0.12 kg CO₂ per km</span>} />
              </div>
              <div className="grid two-col">
                <Card title="Monthly savings and CO₂" subtitle="Financial and environmental benefit of solar generation">
                  <div className="chart h-280">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={savings.data?.monthly || []} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
                        <CartesianGrid {...GRID} />
                        <XAxis dataKey="month" {...AXIS} />
                        <YAxis {...AXIS} width={74} tickFormatter={(v: any) => `${num(v / 1_000_000, 0)}M`} />
                        <Tooltip {...TOOLTIP} formatter={(v: any, name: any) => name === 'Savings' ? money(Number(v)) : num(v, 0)} />
                        <Legend {...LEGEND} />
                        <Bar dataKey="savingsIdr" name="Savings" fill={PALETTE.pv} radius={[2, 2, 0, 0]} />
                        <Bar dataKey="exportRevenueIdr" name="Export revenue" fill={PALETTE.gridExport} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card title="Savings by site" subtitle="Ranked contribution to portfolio benefit" noPad>
                  <DataTable
                    dense
                    columns={[
                      { key: 'code', label: 'Site', render: (r) => <div className="cell-main"><strong>{r.code}</strong><small>{r.name}</small></div> },
                      { key: 'pvMwh', label: 'PV MWh', align: 'right', render: (r) => <span className="mono">{num(r.pvMwh, 1)}</span> },
                      { key: 'savingsIdr', label: 'Savings', align: 'right', render: (r) => <span className="mono">{money(r.savingsIdr)}</span> },
                      { key: 'co2AvoidedKg', label: 'CO₂ kg', align: 'right', render: (r) => <span className="mono">{num(r.co2AvoidedKg, 0)}</span> },
                    ]}
                    rows={savingsRows}
                  />
                </Card>
              </div>
            </>
          )}

          {tab === 'comparison' && (
            <>
              {perf.data && (
                <div className="grid two-col">
                  <Card title="Best performing sites" subtitle="Highest specific yield in period">
                    <div className="rank-list">
                      {(perf.data.bestPerformers || []).map((r: any, i: number) => (
                        <div key={r.siteId} className="rank-row">
                          <span className="rank-num">{i + 1}</span>
                          <div><strong>{r.code}</strong><small>{r.name}</small></div>
                          <span className="mono">{num(r.specificYield, 1)} kWh/kWp</span>
                          <Badge status={r.performanceBand}>{r.performanceBand?.replace('_', ' ')}</Badge>
                        </div>
                      ))}
                    </div>
                  </Card>
                  <Card title="Sites needing attention" subtitle="Lowest specific yield in period">
                    <div className="rank-list">
                      {(perf.data.worstPerformers || []).map((r: any, i: number) => (
                        <div key={r.siteId} className="rank-row">
                          <span className="rank-num warn">{i + 1}</span>
                          <div><strong>{r.code}</strong><small>{r.name}</small></div>
                          <span className="mono">{num(r.specificYield, 1)} kWh/kWp</span>
                          <Badge status={r.performanceBand}>{r.performanceBand?.replace('_', ' ')}</Badge>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              )}
              <Card title="Site comparison" subtitle="Click through from the Sites module for a full plant deep-dive" noPad>
                <DataTable columns={comparisonColumns} rows={rows} dense />
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
