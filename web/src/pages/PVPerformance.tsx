import React, { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis, Legend,
} from 'recharts';
import { Sun, Target, TrendingDown, TrendingUp, Gauge, Percent, Download, Zap } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard } from '../components/ui';
import { Column, DataTable, RangePicker, RangeValue, SiteSelector } from '../components/filters';
import { useAsync, useSites } from '../lib/hooks';
import { download, get, qs } from '../lib/api';
import { cn, num, pct } from '../lib/format';
import { AXIS, GRID, LEGEND, PALETTE, SERIES, TOOLTIP, shortTick } from '../lib/chart';

export default function PVPerformance() {
  const sitesState = useSites();
  const [selected, setSelected] = useState<string[]>([]);
  const [range, setRange] = useState<RangeValue>({ range: '30d' });
  const params = { siteIds: selected.join(','), ...(range.from && range.to ? { from: range.from, to: range.to } : { range: range.range }) };
  const data = useAsync<any>(() => get(`/api/analytics/performance${qs(params)}`), [selected.join(','), range.range, range.from, range.to]);

  const s = data.data?.summary;
  const sites = data.data?.sites || [];
  const best = data.data?.bestPerformers || [];
  const worst = data.data?.worstPerformers || [];

  const scatter = useMemo(() => sites.map((r: any) => ({ ...r, x: r.specificYield, y: r.performanceRatio * 100, z: r.pvCapacityKwp })), [sites]);

  const columns: Column<any>[] = [
    { key: 'code', label: 'Site', render: (r) => <div className="cell-main"><strong>{r.code}</strong><small>{r.name}</small></div> },
    { key: 'pvCapacityKwp', label: 'kWp', align: 'right', render: (r) => <span className="mono">{num(r.pvCapacityKwp, 0)}</span> },
    { key: 'pvMwh', label: 'PV MWh', align: 'right', render: (r) => <span className="mono">{num(r.pvMwh, 1)}</span> },
    { key: 'specificYield', label: 'kWh/kWp', align: 'right', render: (r) => <span className="mono">{num(r.specificYield, 1)}</span> },
    { key: 'performanceRatio', label: 'PR', align: 'right', render: (r) => <span className={cn('mono', r.performanceRatio >= 0.82 ? 'text-good' : r.performanceRatio >= 0.72 ? 'text-warn' : 'text-bad')}>{num(r.performanceRatio, 3)}</span> },
    { key: 'capacityFactorPct', label: 'Capacity factor', align: 'right', render: (r) => <span className="mono">{pct(r.capacityFactorPct, 1)}</span> },
    { key: 'selfConsumptionPct', label: 'Self-consumption', align: 'right', render: (r) => <span className="mono">{pct(r.selfConsumptionPct, 1)}</span> },
    { key: 'performanceBand', label: 'Band', render: (r) => <Badge status={r.performanceBand === 'TARGET' ? 'GOOD' : r.performanceBand === 'POOR' ? 'BAD' : 'WARNING'}>{String(r.performanceBand).replace('_', ' ')}</Badge> },
    { key: 'yieldBand', label: 'Yield', render: (r) => <Badge status={r.yieldBand === 'STRONG' ? 'GOOD' : r.yieldBand === 'LOW' ? 'BAD' : 'NORMAL'}>{r.yieldBand}</Badge> },
    { key: 'dataSource', label: 'Source', render: (r) => <span className={cn('source-tag', r.dataSource === 'LIVE' ? 'live' : 'demo')}>{r.dataSource}</span> },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Photovoltaic performance"
        title="PV plant performance"
        subtitle="Specific yield, performance ratio, capacity factor and underperformance triage."
        actions={<Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => download(`/api/analytics/export${qs(params)}`)}>Export CSV</Button>}
      />

      <div className="filter-bar">
        <SiteSelector sites={sitesState.data?.sites || []} selected={selected} onChange={setSelected} />
        <RangePicker value={range} onChange={setRange} ranges={['7d', '30d', '90d', '365d']} />
        <span className="filter-meta"><Target size={14} /> PR target {pct((data.data?.targetPr || 0.82) * 100, 0)}</span>
      </div>

      {data.error && <ErrorState error={data.error} onRetry={data.reload} />}
      {data.loading && !data.data && <Spinner label="Calculating PV performance…" />}

      {s && (
        <>
          <div className="grid stats-grid">
            <StatCard label="PV generation" value={num(s.pvMwh, 1)} unit="MWh" tone="pv" icon={<Sun size={17} />} sub={<span>{num(s.totalPvCapacityKwp / 1000, 2)} MWp monitored</span>} />
            <StatCard label="Specific yield" value={num(s.specificYieldKwhPerKwp, 1)} unit="kWh/kWp" tone="pv" icon={<Zap size={17} />} sub={<span>Period normalised production</span>} />
            <StatCard label="Performance ratio" value={num(s.performanceRatio * 100, 1)} unit="%" tone="good" icon={<Target size={17} />} sub={<span>Target {pct((data.data?.targetPr || 0.82) * 100, 0)} · {sites.filter((r: any) => r.performanceRatio >= 0.82).length} sites on target</span>} />
            <StatCard label="Capacity factor" value={num(s.capacityUtilisationPct, 1)} unit="%" icon={<Gauge size={17} />} sub={<span>Utilisation of installed kWp</span>} />
            <StatCard label="Peak PV" value={num(s.peakPvMw, 2)} unit="MW" tone="pv" icon={<TrendingUp size={17} />} sub={<span>Highest instantaneous interval</span>} />
            <StatCard label="Sites below target" value={sites.filter((r: any) => r.performanceRatio < 0.82).length} tone="warn" icon={<TrendingDown size={17} />} sub={<span>PR under {pct((data.data?.targetPr || 0.82) * 100, 0)}</span>} />
          </div>

          <div className="grid two-col">
            <Card title="Yield versus performance ratio" subtitle="Bubble size represents installed capacity">
              {scatter.length ? (
                <div className="chart h-300">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 14, bottom: 8, left: -6 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis type="number" dataKey="x" name="Specific yield" unit=" kWh/kWp" {...AXIS} />
                      <YAxis type="number" dataKey="y" name="PR" unit="%" {...AXIS} width={48} domain={[40, 100]} />
                      <ZAxis type="number" dataKey="z" range={[70, 420]} />
                      <Tooltip {...TOOLTIP} formatter={(v: any, n: any) => [n === 'PR' ? `${num(v, 1)}%` : `${num(v, 2)} kWh/kWp`, n]} />
                      <ReferenceLine y={(data.data?.targetPr || 0.82) * 100} stroke={PALETTE.gridExport} strokeDasharray="5 4" label={{ value: 'PR target', fill: '#7dd3a7', fontSize: 10, position: 'insideTopRight' }} />
                      <Scatter data={scatter} name="Sites">
                        {scatter.map((r: any, i: number) => <Cell key={r.siteId} fill={r.performanceRatio >= 0.82 ? PALETTE.pv : r.performanceRatio >= 0.72 ? '#fbbf24' : '#ef4444'} fillOpacity={0.82} />)}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyState title="No performance records" />}
            </Card>

            <Card title="Performance ratio trend" subtitle="Portfolio average by month">
              <div className="chart h-300">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.data?.performanceRatioTrend || []} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="month" {...AXIS} />
                    <YAxis {...AXIS} width={54} domain={[0, 1]} tickFormatter={(v: any) => `${Math.round(v * 100)}%`} />
                    <Tooltip {...TOOLTIP} formatter={(v: any) => `${num(Number(v) * 100, 1)}%`} />
                    <ReferenceLine y={data.data?.targetPr || 0.82} stroke={PALETTE.gridExport} strokeDasharray="5 4" />
                    <Line type="monotone" dataKey="performanceRatio" name="PR" stroke={PALETTE.pv} strokeWidth={2.2} dot={{ r: 2.5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid two-col">
            <Card title="Specific yield by site" subtitle="Ranked production per installed kWp">
              <div className="chart h-300">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[...sites].sort((a: any, b: any) => b.specificYield - a.specificYield)} margin={{ top: 8, right: 8, left: -8, bottom: 40 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="code" {...AXIS} angle={-32} textAnchor="end" height={58} interval={0} tickFormatter={(v: any) => String(v).replace('PLTS-', '')} />
                    <YAxis {...AXIS} width={54} unit=" kWh" />
                    <Tooltip {...TOOLTIP} />
                    <Bar dataKey="specificYield" name="kWh/kWp" radius={[3, 3, 0, 0]}>
                      {sites.map((r: any, i: number) => <Cell key={r.siteId} fill={r.specificYield >= 3.6 ? PALETTE.pv : r.specificYield >= 2.8 ? '#fbbf24' : '#ef4444'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Triage" subtitle="Best and lowest yielding plants">
              <div className="rank-list">
                {best.slice(0, 3).map((r: any, i: number) => (
                  <div key={`b-${r.siteId}`} className="rank-row good">
                    <span className="rank-num">{i + 1}</span>
                    <div><strong>{r.code}</strong><small>{r.name}</small></div>
                    <span className="mono">{num(r.specificYield, 1)} kWh/kWp</span>
                    <Badge status="GOOD">TOP</Badge>
                  </div>
                ))}
                {worst.slice(0, 3).filter((r: any) => !best.slice(0, 3).some((b: any) => b.siteId === r.siteId)).map((r: any, i: number) => (
                  <div key={`w-${r.siteId}`} className="rank-row">
                    <span className="rank-num warn">{i + 1}</span>
                    <div><strong>{r.code}</strong><small>{r.name}</small></div>
                    <span className="mono">{num(r.specificYield, 1)} kWh/kWp</span>
                    <Badge status={r.performanceBand === 'POOR' ? 'CRITICAL' : 'WARNING'}>{r.performanceBand?.replace('_', ' ')}</Badge>
                  </div>
                ))}
              </div>
              <p className="form-note"><Percent size={13} /> PR compares actual against weather-normalised expected production. Low PR with normal irradiance usually indicates soiling, clipping or inverter faults.</p>
            </Card>
          </div>

          <Card title="Performance detail" subtitle="All monitored sites in the selected period" noPad>
            <DataTable columns={columns} rows={sites} dense />
          </Card>
        </>
      )}
    </div>
  );
}
