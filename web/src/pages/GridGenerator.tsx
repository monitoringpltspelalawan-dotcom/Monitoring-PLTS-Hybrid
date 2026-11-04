import React, { useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PlugZap, ArrowDownToLine, ArrowUpFromLine, Fuel, Activity, Gauge, AlertTriangle, Radio, ShieldCheck } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorState, Notice, PageHeader, Spinner, StatCard } from '../components/ui';
import { Column, DataTable, RangePicker, RangeValue, SiteSelector } from '../components/filters';
import { useAsync, useSites } from '../lib/hooks';
import { get, qs } from '../lib/api';
import { cn, energy, num, pct, power } from '../lib/format';
import { AXIS, GRID, LEGEND, PALETTE, TOOLTIP } from '../lib/chart';

export default function GridGenerator() {
  const sitesState = useSites();
  const [selected, setSelected] = useState<string[]>([]);
  const [range, setRange] = useState<RangeValue>({ range: '30d' });

  const params = {
    siteIds: selected.join(','),
    ...(range.from && range.to ? { from: range.from, to: range.to } : { range: range.range }),
  };
  const data = useAsync<any>(() => get(`/api/analytics/grid-generator${qs(params)}`), [selected.join(','), range.range, range.from, range.to]);

  const totals = data.data?.totals;
  const hourly = data.data?.hourly || [];
  const sites = data.data?.sites || [];

  const columns: Column<any>[] = [
    { key: 'code', label: 'Site', render: (r) => <div className="cell-main"><strong>{r.code}</strong><small>{r.name}</small></div> },
    {
      key: 'gridAvailable', label: 'Grid', render: (r) => (
        <Badge status={r.gridAvailable === false ? 'CRITICAL' : r.gridAvailable ? 'ONLINE' : 'UNKNOWN'}>
          {r.gridAvailable === false ? 'UNAVAILABLE' : r.gridAvailable ? 'AVAILABLE' : 'NO DATA'}
        </Badge>
      ),
    },
    { key: 'gridVoltageV', label: 'Voltage L1', align: 'right', render: (r) => <span className="mono">{num(r.gridVoltageV, 1)} V</span> },
    { key: 'frequencyHz', label: 'Frequency', align: 'right', render: (r) => <span className={cn('mono', (r.frequencyHz || 50) < 49.5 || (r.frequencyHz || 50) > 50.5 ? 'text-warn' : '')}>{num(r.frequencyHz, 2)} Hz</span> },
    { key: 'importKw', label: 'Import', align: 'right', render: (r) => <span className="mono text-bad">{power(r.importKw)}</span> },
    { key: 'exportKw', label: 'Export', align: 'right', render: (r) => <span className="mono text-good">{power(r.exportKw)}</span> },
    { key: 'powerFactor', label: 'PF', align: 'right', render: (r) => <span className="mono">{num(r.powerFactor, 3)}</span> },
    {
      key: 'generatorRunning', label: 'Generator', render: (r) => !r.generatorPresent
        ? <span className="muted">Not installed</span>
        : <Badge status={r.generatorRunning ? 'RUNNING' : 'STANDBY'}>{r.generatorRunning ? 'RUNNING' : 'STANDBY'}</Badge>,
    },
    { key: 'generatorPowerKw', label: 'Genset output', align: 'right', render: (r) => <span className="mono">{r.generatorPresent ? power(r.generatorPowerKw) : '—'}</span> },
    { key: 'fuelLevelPct', label: 'Fuel', align: 'right', render: (r) => <span className={cn('mono', (r.fuelLevelPct || 0) < 30 && 'text-warn')}>{r.generatorPresent ? pct(r.fuelLevelPct, 0) : '—'}</span> },
    { key: 'generatorHours', label: 'Run hours', align: 'right', render: (r) => <span className="mono">{r.generatorPresent ? num(r.generatorHours, 1) : '—'}</span> },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Grid & backup generation"
        title="Grid and generator"
        subtitle="Utility exchange, power quality, grid availability and backup generator readiness."
        actions={<Badge color="var(--good)" dot><ShieldCheck size={11} /> READ-ONLY MONITORING</Badge>}
      />

      <div className="filter-bar">
        <SiteSelector sites={sitesState.data?.sites || []} selected={selected} onChange={setSelected} />
        <RangePicker value={range} onChange={setRange} ranges={['7d', '30d', '90d', '365d']} />
        <span className="filter-meta"><Radio size={14} /> {sites.length} live grid interfaces</span>
      </div>

      {data.error && <ErrorState error={data.error} onRetry={data.reload} />}
      {data.loading && !data.data && <Spinner label="Reading grid and generator data…" />}

      {totals && totals.gridOfflineSites > 0 && (
        <Notice tone="warn">
          <strong>{totals.gridOfflineSites} site{totals.gridOfflineSites === 1 ? '' : 's'}</strong> report the utility supply as unavailable.
          Backup generation and BESS discharge are displayed from the last known telemetry.
        </Notice>
      )}

      {totals && (
        <>
          <div className="grid stats-grid">
            <StatCard label="Grid import" value={num(totals.importKwh / 1000, 2)} unit="MWh" icon={<ArrowDownToLine size={17} />} sub={<span>Energy drawn from PLN in period</span>} />
            <StatCard label="Grid export" value={num(totals.exportKwh / 1000, 2)} unit="MWh" tone="good" icon={<ArrowUpFromLine size={17} />} sub={<span>Surplus solar exported</span>} />
            <StatCard label="Net exchange" value={num((totals.importKwh - totals.exportKwh) / 1000, 2)} unit="MWh" icon={<PlugZap size={17} />} sub={<span>Import minus export</span>} />
            <StatCard label="Grid availability" value={totals.gridAvailableSites} unit={`/ ${totals.gridAvailableSites + totals.gridOfflineSites}`} tone={totals.gridOfflineSites ? 'warn' : 'good'} icon={<Activity size={17} />} sub={<span>{totals.gridOfflineSites} unavailable right now</span>} />
            <StatCard label="Generator energy" value={num(totals.generatorKwh / 1000, 2)} unit="MWh" icon={<Fuel size={17} />} sub={<span>{totals.generatorsPresent} units installed</span>} />
            <StatCard label="Generator output" value={num(totals.generatorOutputKw, 1)} unit="kW" tone={totals.generatorRunning ? 'warn' : 'good'} icon={<Gauge size={17} />} sub={<span>{totals.generatorRunning} running · {num(totals.generatorCapacityKw, 0)} kW installed</span>} />
          </div>

          <div className="grid two-col">
            <Card title="Grid exchange profile" subtitle="Hourly import and export energy across selected sites">
              {hourly.length ? (
                <div className="chart h-300">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={hourly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="hour" {...AXIS} interval={1} />
                      <YAxis {...AXIS} unit=" kWh" width={64} />
                      <Tooltip {...TOOLTIP} />
                      <Legend {...LEGEND} />
                      <Bar dataKey="importKwh" name="Import" stackId="g" fill={PALETTE.gridImport} />
                      <Bar dataKey="exportKwh" name="Export" stackId="g" fill={PALETTE.gridExport} radius={[2, 2, 0, 0]} />
                      <Line type="monotone" dataKey="loadKwh" name="Load" stroke={PALETTE.load} strokeWidth={1.6} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyState title="No grid history" message="Hourly records are seeded for the previous 30 days." />}
            </Card>

            <Card title="Generator dispatch" subtitle="Hourly backup generation against load">
              {hourly.length ? (
                <div className="chart h-300">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={hourly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <defs>
                        <linearGradient id="ggGen" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={PALETTE.generator} stopOpacity={0.4} />
                          <stop offset="100%" stopColor={PALETTE.generator} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="hour" {...AXIS} interval={1} />
                      <YAxis {...AXIS} unit=" kWh" width={64} />
                      <Tooltip {...TOOLTIP} />
                      <Legend {...LEGEND} />
                      <Area type="monotone" dataKey="generatorKwh" name="Generator" stroke={PALETTE.generator} fill="url(#ggGen)" strokeWidth={2} />
                      <Line type="monotone" dataKey="loadKwh" name="Load" stroke={PALETTE.load} strokeWidth={1.4} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyState title="No generator history" />}
            </Card>
          </div>

          <Card title="Site grid & generator status" subtitle="Live power quality, utility availability and backup plant health" noPad>
            <DataTable columns={columns} rows={sites} dense />
          </Card>

          <div className="grid two-col">
            <Card title="Grid reliability" subtitle="Availability across the selected portfolio">
              <div className="reliability-list">
                <div>
                  <span>Utility available</span>
                  <strong>{totals.gridAvailableSites}</strong>
                  <div className="progress"><span style={{ width: `${(totals.gridAvailableSites / Math.max(1, totals.gridAvailableSites + totals.gridOfflineSites)) * 100}%`, background: 'var(--good)' }} /></div>
                </div>
                <div>
                  <span>Utility unavailable</span>
                  <strong>{totals.gridOfflineSites}</strong>
                  <div className="progress"><span style={{ width: `${(totals.gridOfflineSites / Math.max(1, totals.gridAvailableSites + totals.gridOfflineSites)) * 100}%`, background: 'var(--critical)' }} /></div>
                </div>
                <div>
                  <span>Generators running</span>
                  <strong>{totals.generatorRunning}</strong>
                  <div className="progress"><span style={{ width: `${(totals.generatorRunning / Math.max(1, totals.generatorsPresent)) * 100}%`, background: 'var(--generator)' }} /></div>
                </div>
              </div>
            </Card>
            <Card title="Operational notes" subtitle="How to read this module">
              <div className="security-list">
                <div><ShieldCheck size={15} /><span>Grid measurements are read-only at the point of common coupling; no breaker or relay control is exposed.</span></div>
                <div><AlertTriangle size={15} /><span>Frequency outside 49.5–50.5 Hz is highlighted and may indicate an unstable utility supply.</span></div>
                <div><Fuel size={15} /><span>Fuel below 30% is flagged for operator follow-up. Generator run hours are cumulative from the gateway.</span></div>
                <div><PlugZap size={15} /><span>Import and export are netted per interval; simultaneous import/export is not assumed.</span></div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
