import React, { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { BatteryCharging, BatteryFull, Zap, Thermometer, Repeat, Activity, Download, ShieldCheck } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorState, PageHeader, ProgressBar, Spinner, StatCard } from '../components/ui';
import { Column, DataTable, RangePicker, RangeValue, SiteSelector } from '../components/filters';
import { useAsync, useSites } from '../lib/hooks';
import { get, qs } from '../lib/api';
import { useRealtime } from '../lib/ws';
import { cn, energy, num, pct, power, timeAgo } from '../lib/format';
import { AXIS, GRID, LEGEND, PALETTE, TOOLTIP } from '../lib/chart';

export default function BESSAnalytics() {
  const sitesState = useSites();
  const { sites: liveMap } = useRealtime();
  const [selected, setSelected] = useState<string[]>([]);
  const [range, setRange] = useState<RangeValue>({ range: '30d' });

  const params = {
    siteIds: selected.join(','),
    ...(range.from && range.to ? { from: range.from, to: range.to } : { range: range.range }),
  };
  const data = useAsync<any>(() => get(`/api/analytics/bess${qs(params)}`), [selected.join(','), range.range, range.from, range.to]);
  const racks = useAsync<any>(() => get(`/api/devices/bess-racks${qs({ siteId: selected.length === 1 ? selected[0] : '' })}`), [selected.join(',')]);

  const totals = data.data?.totals;
  const hourly = data.data?.hourly || [];
  const siteRows = data.data?.sites || [];
  const rackRows = racks.data?.racks || [];

  const liveBySite = (siteId: string) => liveMap.get(siteId);

  const chartRows = useMemo(() => hourly.map((h: any) => ({
    ...h,
    chargeKwh: h.chargeKwh,
    dischargeKwh: h.dischargeKwh,
  })), [hourly]);

  const siteColumns: Column<any>[] = [
    { key: 'code', label: 'Site', render: (r) => <div className="cell-main"><strong>{r.code}</strong><small>{r.name}</small></div> },
    { key: 'capacityKwh', label: 'Capacity', align: 'right', render: (r) => <span className="mono">{num(r.capacityKwh, 0)} kWh</span> },
    { key: 'powerKw', label: 'Power', align: 'right', render: (r) => <span className="mono">{num(r.powerKw, 0)} kW</span> },
    {
      key: 'socPct', label: 'SOC', align: 'right',
      render: (r) => {
        const live = liveBySite(r.siteId);
        const soc = live?.bess?.socPct ?? r.socPct;
        return <div className="soc-cell"><ProgressBar value={soc} color={(soc || 0) < 25 ? 'var(--warning)' : 'var(--bess)'} /><span className="mono">{pct(soc, 0)}</span></div>;
      },
    },
    { key: 'sohPct', label: 'SOH', align: 'right', render: (r) => <span className={cn('mono', (r.sohPct || 100) < 92 && 'text-warn')}>{pct(r.sohPct, 1)}</span> },
    { key: 'temperatureC', label: 'Temp', align: 'right', render: (r) => <span className={cn('mono', (r.temperatureC || 0) > 40 && 'text-warn')}>{num(r.temperatureC, 1)} °C</span> },
    { key: 'chargeKwh', label: 'Charged', align: 'right', render: (r) => <span className="mono">{energy(r.chargeKwh)}</span> },
    { key: 'dischargeKwh', label: 'Discharged', align: 'right', render: (r) => <span className="mono">{energy(r.dischargeKwh)}</span> },
    { key: 'cycles', label: 'Cycles', align: 'right', render: (r) => <span className="mono">{num(r.cycles, 2)}</span> },
  ];

  const rackColumns: Column<any>[] = [
    { key: 'name', label: 'Rack', render: (r) => <div className="cell-main"><strong>{r.name}</strong><small>{r.site_code} · {r.device_id || 'unbound'}</small></div> },
    { key: 'capacity_kwh', label: 'Capacity', align: 'right', render: (r) => <span className="mono">{num(r.capacity_kwh, 0)} kWh</span> },
    {
      key: 'soc', label: 'Live SOC', align: 'right',
      render: (r) => {
        const live = liveBySite(r.site_id);
        const rack = (live?.bess?.racks || []).find((x: any) => x.id === r.id) || {};
        const soc = rack.socPct ?? live?.bess?.socPct ?? null;
        return <div className="soc-cell"><ProgressBar value={soc} color={(soc || 0) < 25 ? 'var(--warning)' : 'var(--bess)'} /><span className="mono">{pct(soc, 0)}</span></div>;
      },
    },
    { key: 'module_count', label: 'Modules', align: 'right', render: (r) => <span className="mono">{num(r.module_count, 0)}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge status={r.status}>{r.status}</Badge> },
    { key: 'site', label: 'Site', render: (r) => <span className="muted">{r.site_name}</span> },
  ];

  const socLive = siteRows.map((r: any) => {
    const live = liveBySite(r.siteId);
    return { code: r.code.replace('PLTS-', ''), soc: live?.bess?.socPct ?? r.socPct ?? 0 };
  }).filter((r: any) => r.soc != null);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Battery energy storage"
        title="BESS analytics"
        subtitle="Fleet-level battery throughput, round-trip efficiency, state of charge and rack health."
        actions={<>
          <Badge color="var(--bess)" dot>RACK-LEVEL TELEMETRY</Badge>
          <Badge color="var(--good)" dot><ShieldCheck size={11} /> READ-ONLY</Badge>
        </>}
      />

      <div className="filter-bar">
        <SiteSelector sites={sitesState.data?.sites || []} selected={selected} onChange={setSelected} />
        <RangePicker value={range} onChange={setRange} ranges={['7d', '30d', '90d', '365d']} />
        <span className="filter-meta"><BatteryCharging size={14} /> {siteRows.length} storage sites · {rackRows.length} racks</span>
      </div>

      {data.error && <ErrorState error={data.error} onRetry={data.reload} />}
      {data.loading && !data.data && <Spinner label="Aggregating battery telemetry…" />}
      {!data.loading && totals && !siteRows.length && <EmptyState title="No storage assets" message="The selected sites have no BESS capacity." />}

      {totals && (
        <>
          <div className="grid stats-grid">
            <StatCard label="Installed capacity" value={num(totals.capacityKwh / 1000, 2)} unit="MWh" tone="bess" icon={<BatteryFull size={17} />} sub={<span>{siteRows.length} systems in scope</span>} />
            <StatCard label="Average state of charge" value={num(totals.avgSocPct, 1)} unit="%" tone="bess" icon={<BatteryCharging size={17} />} sub={<span>Live fleet-weighted reading</span>} />
            <StatCard label="Energy charged" value={num(totals.chargeKwh / 1000, 2)} unit="MWh" icon={<Zap size={17} />} sub={<span>Across selected period</span>} />
            <StatCard label="Energy discharged" value={num(totals.dischargeKwh / 1000, 2)} unit="MWh" tone="bess" icon={<Activity size={17} />} sub={<span>{num(totals.cycles, 2)} equivalent full cycles</span>} />
            <StatCard label="Round-trip efficiency" value={num(totals.roundTripEfficiencyPct, 1)} unit="%" tone={totals.roundTripEfficiencyPct >= 88 ? 'good' : 'warn'} icon={<Repeat size={17} />} sub={<span>Discharge ÷ charge</span>} />
            <StatCard label="Thermal status" value={siteRows.filter((r: any) => (r.temperatureC || 0) > 40).length} unit="hot" tone="warn" icon={<Thermometer size={17} />} sub={<span>Racks above 40 °C</span>} />
          </div>

          <div className="grid two-col-wide">
            <Card title="Daily charge and discharge profile" subtitle="Aggregated hourly energy across the selected sites">
              {chartRows.length ? (
                <div className="chart h-320">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartRows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="hour" {...AXIS} interval={1} />
                      <YAxis {...AXIS} unit=" kWh" width={64} />
                      <Tooltip {...TOOLTIP} />
                      <Legend {...LEGEND} />
                      <Bar dataKey="chargeKwh" name="Charge" fill={PALETTE.charge} radius={[2, 2, 0, 0]} />
                      <Bar dataKey="dischargeKwh" name="Discharge" fill={PALETTE.discharge} radius={[2, 2, 0, 0]} />
                      <Line type="monotone" dataKey="chargeKwh" name="Charge trend" stroke="#7dd3fc" strokeWidth={1.3} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyState title="No hourly storage data" message="Hourly records are available for the last 30 days of the selected range." />}
            </Card>

            <Card title="Live state of charge" subtitle="Latest battery SOC by site">
              {socLive.length ? (
                <div className="chart h-320">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={socLive} layout="vertical" margin={{ top: 4, right: 22, left: 4, bottom: 0 }}>
                      <CartesianGrid {...GRID} horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} unit="%" {...AXIS} />
                      <YAxis type="category" dataKey="code" {...AXIS} width={76} />
                      <Tooltip {...TOOLTIP} formatter={(v: any) => `${num(v, 1)}%`} />
                      <Bar dataKey="soc" name="SOC" radius={[0, 4, 4, 0]}>
                        {socLive.map((r: any) => <Cell key={r.code} fill={r.soc < 25 ? 'var(--warning)' : r.soc < 55 ? '#fbbf24' : PALETTE.discharge} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyState title="No live SOC" message="Waiting for the next telemetry frame." />}
            </Card>
          </div>

          <Card title="Site storage performance" subtitle="Throughput and health by battery system" noPad>
            <DataTable columns={siteColumns} rows={siteRows} dense />
          </Card>

          <Card title="Rack registry" subtitle="Module-level capacity and live BESS rack state" noPad
            actions={<Badge color="var(--accent)" dot>{rackRows.length} RACKS</Badge>}>
            {racks.error && <ErrorState error={racks.error} onRetry={racks.reload} />}
            {racks.loading && !racks.data ? <Spinner label="Loading rack registry…" /> : <DataTable columns={rackColumns} rows={rackRows} dense />}
          </Card>

          <div className="mini-strip">
            <span><Activity size={14} /> Fleet throughput {energy(totals.chargeKwh + totals.dischargeKwh)}</span>
            <span><Repeat size={14} /> Round-trip {pct(totals.roundTripEfficiencyPct, 1)}</span>
            <span><BatteryCharging size={14} /> Live readings {siteRows.filter((r: any) => r.socPct != null).length} / {siteRows.length}</span>
            <span className="muted">Last refresh {timeAgo(new Date().toISOString())}</span>
          </div>
        </>
      )}
    </div>
  );
}
