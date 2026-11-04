import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sun, BatteryCharging, MapPin, Download, Plus, Search, ArrowUpDown, Building2, AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Field, Modal, Notice, PageHeader, Spinner, StatCard } from '../components/ui';
import { Column, DataTable } from '../components/filters';
import { useAsync, SiteLite } from '../lib/hooks';
import { get, post, qs } from '../lib/api';
import { useRealtime } from '../lib/ws';
import { useAuth } from '../lib/auth';
import { cn, energy, money, num, pct, power, statusColor, timeAgo, dateShort } from '../lib/format';

export default function Sites() {
  const navigate = useNavigate();
  const { has } = useAuth();
  const { sites: liveMap } = useRealtime();
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [sort, setSort] = useState<'capacity' | 'pv' | 'alarms' | 'code'>('capacity');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<any>({ code: '', name: '', regionId: '', location: '', latitude: '', longitude: '', pvCapacityKwp: 100, bessCapacityKwh: 200, bessPowerKw: 50, generatorCapacityKw: 0, inverterCount: 2, batteryRackCount: 2 });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const data = useAsync<{ sites: SiteLite[]; total: number; statusCounts: Record<string, number>; dataSources: { demo: number; live: number } }>(
    () => get(`/api/sites${qs({ search, region, status, dataSource: source })}`),
    [search, region, status, source],
  );
  const regions = useAsync<{ regions: any[] }>(() => get('/api/sites/regions'), []);

  const all = (data.data?.sites || []) as any[];
  const rows = useMemo(() => {
    const mapped = all.map((s) => {
      const live = liveMap.get(s.id) || s.live;
      return {
        ...s,
        _pv: live?.pv?.powerKw ?? null,
        _load: live?.load?.powerKw ?? null,
        _soc: live?.bess?.socPct ?? null,
        _today: live?.energy?.pvTodayKwh ?? s.pvTodayKwh ?? null,
        _last: live?.lastSeenAt || s.last_seen_at,
      };
    });
    return mapped.sort((a, b) => {
      if (sort === 'capacity') return (b.pv_capacity_kwp || 0) - (a.pv_capacity_kwp || 0);
      if (sort === 'pv') return (b._pv || 0) - (a._pv || 0);
      if (sort === 'alarms') return (b.alarmCount || 0) - (a.alarmCount || 0);
      return a.code.localeCompare(b.code);
    });
  }, [all, liveMap, sort]);

  const totals = useMemo(() => ({
    sites: rows.length,
    pv: rows.reduce((a, s) => a + (s.pv_capacity_kwp || 0), 0),
    bess: rows.reduce((a, s) => a + (s.bess_capacity_kwh || 0), 0),
    alarms: rows.reduce((a, s) => a + (s.alarmCount || 0), 0),
    online: rows.filter((s) => s.status === 'ONLINE').length,
  }), [rows]);

  const exportCsv = () => {
    const header = ['Code', 'Name', 'Region', 'Status', 'Source', 'PV kWp', 'BESS kWh', 'PV now kW', 'SOC %', 'Alarms', 'Last seen'];
    const lines = rows.map((s) => [s.code, s.name, s.regionName, s.status, s.dataSource, s.pv_capacity_kwp, s.bess_capacity_kwh, s._pv ?? '', s._soc ?? '', s.alarmCount || 0, s._last || '']);
    const csv = `\uFEFF${[header, ...lines].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `chsms-sites-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await post('/api/sites', {
        ...form,
        latitude: Number(form.latitude) || null,
        longitude: Number(form.longitude) || null,
        pvCapacityKwp: Number(form.pvCapacityKwp),
        bessCapacityKwh: Number(form.bessCapacityKwh),
        bessPowerKw: Number(form.bessPowerKw),
        generatorCapacityKw: Number(form.generatorCapacityKw),
        inverterCount: Number(form.inverterCount),
        batteryRackCount: Number(form.batteryRackCount),
        generatorCount: Number(form.generatorCapacityKw) > 0 ? 1 : 0,
      });
      setAddOpen(false);
      data.reload();
    } catch (err: any) {
      setFormError(err?.message || 'Could not create site');
    } finally {
      setSaving(false);
    }
  };

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
    { key: 'regionName', label: 'Region', render: (s) => <span className="muted">{s.regionName || '—'}</span> },
    { key: 'status', label: 'Status', render: (s) => <Badge status={s.status}>{s.status}</Badge> },
    { key: 'dataSource', label: 'Source', render: (s) => <span className={cn('source-tag', s.dataSource === 'LIVE' ? 'live' : 'demo')}>{s.dataSource}</span> },
    { key: 'pv_capacity_kwp', label: 'PV capacity', align: 'right', render: (s) => <span className="mono">{num(s.pv_capacity_kwp, 0)} kWp</span> },
    { key: 'bess_capacity_kwh', label: 'BESS', align: 'right', render: (s) => <span className="mono">{num(s.bess_capacity_kwh, 0)} kWh</span> },
    { key: '_pv', label: 'PV now', align: 'right', render: (s) => <span className="mono">{power(s._pv)}</span> },
    { key: '_soc', label: 'SOC', align: 'right', render: (s) => <span className="mono">{pct(s._soc, 0)}</span> },
    { key: 'alarmCount', label: 'Alarms', align: 'right', render: (s) => s.alarmCount ? <span className="alarm-count">{s.alarmCount}</span> : <span className="muted">0</span> },
    { key: '_last', label: 'Last seen', align: 'right', render: (s) => <span className="muted">{timeAgo(s._last)}</span> },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Asset registry"
        title="Solar plant sites"
        subtitle="Every monitored hybrid plant with nameplate capacity, live state and data provenance."
        actions={<>
          <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={exportCsv}>Export CSV</Button>
          {has('site:manage') && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>Add site</Button>}
        </>}
      />

      {data.data && data.data.dataSources.demo > 0 && (
        <Notice tone="warn"><strong>DEMO DATA</strong> — {data.data.dataSources.demo} of {data.data.total} displayed sites are simulation profiles. Live ingest is never mixed into demo records.</Notice>
      )}

      <div className="grid stats-grid compact">
        <StatCard label="Sites in scope" value={totals.sites} icon={<Building2 size={16} />} sub={<span>{totals.online} reporting online</span>} />
        <StatCard label="PV nameplate" value={num(totals.pv / 1000, 2)} unit="MWp" tone="pv" icon={<Sun size={16} />} sub={<span>Across {totals.sites} authorized plants</span>} />
        <StatCard label="BESS nameplate" value={num(totals.bess / 1000, 2)} unit="MWh" tone="bess" icon={<BatteryCharging size={16} />} sub={<span>Distributed battery storage</span>} />
        <StatCard label="Open alarms" value={totals.alarms} tone={totals.alarms ? 'warn' : 'good'} icon={<AlertTriangle size={16} />} sub={<span>Unresolved in scope</span>} />
      </div>

      <div className="filter-bar">
        <label className="search grow"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code, name, location…" /></label>
        <select className="input" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
          <option value="">All regions</option>
          {(regions.data?.regions || []).map((r) => <option key={r.id} value={r.code}>{r.name}</option>)}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {['ONLINE', 'WARNING', 'CRITICAL', 'MAINTENANCE', 'OFFLINE'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Data source">
          <option value="">All sources</option>
          <option value="DEMO">DEMO</option>
          <option value="LIVE">LIVE</option>
        </select>
        <div className="sort-group">
          <ArrowUpDown size={13} />
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Sort">
            <option value="capacity">Capacity</option>
            <option value="pv">Live PV power</option>
            <option value="alarms">Alarm count</option>
            <option value="code">Site code</option>
          </select>
        </div>
      </div>

      {data.error && <ErrorState error={data.error} onRetry={data.reload} />}

      <Card title="Plant inventory" subtitle={`${rows.length} records · click a row to open the live plant dashboard`} noPad>
        {data.loading && !data.data ? <Spinner label="Loading sites…" /> : (
          <DataTable columns={columns} rows={rows} onRowClick={(s) => navigate(`/sites/${s.id}`)} dense
            footer={<tr><td colSpan={5}>Portfolio totals</td><td className="mono">{num(totals.pv, 0)} kWp</td><td className="mono">{num(totals.bess, 0)} kWh</td><td colSpan={3} /></tr>}
          />
        )}
      </Card>

      <div className="mini-strip">
        <span><MapPin size={14} /> {rows.length} geospatial records</span>
        <span><Sun size={14} /> {energy(rows.reduce((a, s) => a + (s._today || 0), 0))} PV reported today</span>
        <span><BatteryCharging size={14} /> {rows.filter((s) => (s.bess_capacity_kwh || 0) > 0).length} sites with storage</span>
        <span className="muted">Commissioning range {rows.length ? `${dateShort(rows.reduce((a, s) => (a && a < s.commissioning_date ? a : s.commissioning_date), null as any))} – ${dateShort(rows.reduce((a, s) => (a && a > s.commissioning_date ? a : s.commissioning_date), null as any))}` : '—'}</span>
      </div>

      <Modal open={addOpen} title="Register a new site" onClose={() => setAddOpen(false)} wide
        footer={<><Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button><Button variant="primary" loading={saving} onClick={submit}>Create site</Button></>}>
        <form className="form-grid" onSubmit={submit}>
          {formError && <div className="login-error span-2"><AlertTriangle size={15} /> {formError}</div>}
          <Field label="Site code"><input className="input" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="PLTS-XXX-01" /></Field>
          <Field label="Site name"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="PLTS Hybrid …" /></Field>
          <Field label="Region">
            <select className="input" value={form.regionId} onChange={(e) => setForm({ ...form, regionId: e.target.value })}>
              <option value="">Unassigned</option>
              {(regions.data?.regions || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Location"><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City, province" /></Field>
          <Field label="Latitude"><input className="input" type="number" step="0.0001" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></Field>
          <Field label="Longitude"><input className="input" type="number" step="0.0001" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></Field>
          <Field label="PV capacity (kWp)"><input className="input" type="number" value={form.pvCapacityKwp} onChange={(e) => setForm({ ...form, pvCapacityKwp: e.target.value })} /></Field>
          <Field label="BESS capacity (kWh)"><input className="input" type="number" value={form.bessCapacityKwh} onChange={(e) => setForm({ ...form, bessCapacityKwh: e.target.value })} /></Field>
          <Field label="BESS power (kW)"><input className="input" type="number" value={form.bessPowerKw} onChange={(e) => setForm({ ...form, bessPowerKw: e.target.value })} /></Field>
          <Field label="Generator capacity (kW)"><input className="input" type="number" value={form.generatorCapacityKw} onChange={(e) => setForm({ ...form, generatorCapacityKw: e.target.value })} /></Field>
          <Field label="Inverter count"><input className="input" type="number" value={form.inverterCount} onChange={(e) => setForm({ ...form, inverterCount: e.target.value })} /></Field>
          <Field label="Battery racks"><input className="input" type="number" value={form.batteryRackCount} onChange={(e) => setForm({ ...form, batteryRackCount: e.target.value })} /></Field>
          <p className="form-note span-2">New sites are created as <strong>LIVE</strong> assets and will stay offline until their edge gateway sends the first telemetry batch.</p>
        </form>
      </Modal>
    </div>
  );
}
