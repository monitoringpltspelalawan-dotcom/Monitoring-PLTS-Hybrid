import React, { useEffect, useMemo, useState } from 'react';
import {
  Cpu, Plus, RefreshCw, Search, Pencil, Trash2, Eye, Sun, BatteryCharging, PlugZap, Fuel,
  Gauge, AlertTriangle, ShieldCheck, SlidersHorizontal, Activity, Layers,
} from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, KV, Modal, Notice, PageHeader, Pagination,
  Spinner, StatCard,
} from '../components/ui';
import { Column, DataTable, SiteSelector } from '../components/filters';
import { useAsync, useDebounced, useSites } from '../lib/hooks';
import { del, get, patch, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn, dateTime, num, sourceLabel, timeAgo } from '../lib/format';

const DEVICE_TYPES = ['HYBRID_INVERTER', 'INVERTER', 'BESS', 'BMS', 'GENERATOR', 'METER', 'GRID_METER', 'LOAD_METER', 'SENSOR', 'WEATHER_STATION'];
const STATUSES = ['ONLINE', 'OFFLINE', 'FAULT', 'MAINTENANCE', 'UNKNOWN'];

const typeIcon = (type: string) => {
  if (type?.includes('INVERTER')) return <Sun size={14} />;
  if (type === 'BESS' || type === 'BMS') return <BatteryCharging size={14} />;
  if (type === 'GENERATOR') return <Fuel size={14} />;
  if (type?.includes('METER')) return <Gauge size={14} />;
  return <Cpu size={14} />;
};

const EMPTY_DEVICE = {
  siteId: '', name: '', deviceType: 'HYBRID_INVERTER', manufacturer: '', model: '', serial: '',
  ipAddress: '', port: '502', unitId: '1', firmware: '', modelId: '',
};

export default function Devices() {
  const { has } = useAuth();
  const sitesState = useSites();
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);

  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyModel, setApplyModel] = useState('');
  const [applyReplace, setApplyReplace] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [form, setForm] = useState<any>({ ...EMPTY_DEVICE });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const sites = sitesState.data?.sites || [];
  const siteId = siteIds.length === 1 ? siteIds[0] : '';
  const devices = useAsync<any>(() => get(`/api/devices${qs({ siteId, type, status, search: debounced, page, pageSize })}`), [siteId, type, status, debounced, page]);
  const models = useAsync<any>(() => get('/api/devices/models'), []);

  useEffect(() => { setPage(1); }, [siteId, type, status, debounced]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const rows = devices.data?.devices || [];
  const total = devices.data?.total || 0;
  const byType = devices.data?.byType || {};
  const byStatus = devices.data?.byStatus || {};

  const modelOptions = useMemo(() => models.data?.models || [], [models.data]);

  const openDetail = async (device: any) => {
    setDetail({ device, registers: [], model: null, latest: {} });
    setDetailLoading(true);
    try {
      const payload = await get<any>(`/api/devices/${device.id}`);
      setDetail(payload);
      setApplyModel(payload.device?.model_id || '');
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not load device detail' });
    } finally { setDetailLoading(false); }
  };

  const openCreate = () => {
    setEditTarget(null);
    setForm({ ...EMPTY_DEVICE, siteId: sites[0]?.id || '', modelId: '' });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (device: any) => {
    setEditTarget(device);
    setForm({
      siteId: device.site_id, name: device.name, deviceType: device.device_type, manufacturer: device.manufacturer || '',
      model: device.model || '', serial: device.serial || '', ipAddress: device.ip_address || '',
      port: String(device.port ?? 502), unitId: String(device.unit_id ?? 1), firmware: device.firmware || '',
      modelId: device.model_id || '',
    });
    setFormError(null);
    setFormOpen(true);
  };

  const saveDevice = async () => {
    setBusy(true);
    setFormError(null);
    try {
      if (editTarget) {
        await patch(`/api/devices/${editTarget.id}`, {
          name: form.name, deviceType: form.deviceType, manufacturer: form.manufacturer || null,
          model: form.model || null, serial: form.serial || null, ipAddress: form.ipAddress || null,
          port: Number(form.port) || 502, unitId: Number(form.unitId) || 1, firmware: form.firmware || null,
          gatewayId: form.gatewayId || undefined, modelId: form.modelId || null,
        });
        setToast({ tone: 'success', text: `${form.name} updated.` });
        if (detail?.device?.id === editTarget.id) void openDetail({ id: editTarget.id });
      } else {
        await post('/api/devices', {
          siteId: form.siteId, name: form.name, deviceType: form.deviceType, manufacturer: form.manufacturer || undefined,
          model: form.model || undefined, serial: form.serial || undefined, ipAddress: form.ipAddress || undefined,
          port: Number(form.port) || 502, unitId: Number(form.unitId) || 1, firmware: form.firmware || undefined,
          modelId: form.modelId || undefined,
        });
        setToast({ tone: 'success', text: `${form.name} registered.` });
      }
      setFormOpen(false);
      devices.reload();
    } catch (err: any) {
      setFormError(err?.message || 'Could not save device');
    } finally { setBusy(false); }
  };

  const removeDevice = async (device: any) => {
    if (!window.confirm(`Delete device ${device.name} (${device.id})? Register mappings for this device will also be removed.`)) return;
    setBusy(true);
    try {
      await del(`/api/devices/${device.id}`);
      setDetail(null);
      devices.reload();
      setToast({ tone: 'success', text: 'Device deleted.' });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not delete device' });
    } finally { setBusy(false); }
  };

  const applyTemplate = async () => {
    if (!detail?.device) return;
    setBusy(true);
    try {
      const payload = await post<any>(`/api/devices/${detail.device.id}/registers/apply-template`, {
        modelId: applyModel || undefined, replace: applyReplace,
      });
      setApplyOpen(false);
      setToast({ tone: 'success', text: `Template applied · ${payload.added} registers added (${payload.registerCount} total).` });
      void openDetail(detail.device);
      devices.reload();
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not apply template' });
    } finally { setBusy(false); }
  };

  const columns: Column<any>[] = [
    {
      key: 'name', label: 'Device',
      render: (d) => (
        <div className="cell-main">
          <strong>{d.name}</strong>
          <small>{d.device_type.replace(/_/g, ' ')} · {d.id}</small>
        </div>
      ),
    },
    { key: 'site_code', label: 'Plant', render: (d) => <div className="cell-main"><strong>{d.site_code}</strong><small>{d.site_name}</small></div> },
    { key: 'model', label: 'Make / model', render: (d) => <div className="cell-main"><strong>{d.manufacturer || '—'}</strong><small>{d.model || '—'}</small></div> },
    { key: 'ip_address', label: 'Modbus endpoint', render: (d) => <span className="mono small">{d.ip_address || '—'}:{d.port} · unit {d.unit_id}</span> },
    { key: 'gateway_name', label: 'Gateway', render: (d) => <span className="muted">{d.gateway_name || 'Unassigned'}</span> },
    { key: 'register_count', label: 'Registers', align: 'right', render: (d) => <span className="mono">{num(d.register_count, 0)}</span> },
    { key: 'data_source', label: 'Source', render: (d) => <span className={cn('source-tag', d.data_source === 'LIVE' ? 'live' : 'demo')}>{sourceLabel(d.data_source)}</span> },
    { key: 'status', label: 'Status', render: (d) => <Badge status={d.status}>{d.status}</Badge> },
    { key: 'last_seen_at', label: 'Last seen', align: 'right', render: (d) => <span className="muted">{timeAgo(d.last_seen_at)}</span> },
    {
      key: 'actions', label: '', align: 'right',
      render: (d) => (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={<Eye size={12} />} onClick={() => void openDetail(d)}>Inspect</Button>
          {has('device:manage') && <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => openEdit(d)}>Edit</Button>}
        </span>
      ),
    },
  ];

  const latestRows = useMemo(() => {
    if (!detail) return [];
    const latest = detail.latest || {};
    return (detail.registers || []).map((r: any) => ({ ...r, current: latest[r.parameter_id] })).filter((r: any) => r.current);
  }, [detail]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Assets & connectivity"
        title="Devices"
        subtitle="Inverter, BESS, meter and generator endpoints polled read-only by the edge gateways."
        actions={<>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => devices.reload()}>Refresh</Button>
          {has('device:manage') && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={openCreate}>Register device</Button>}
        </>}
      />

      {toast && <Notice tone={toast.tone} onClose={() => setToast(null)}>{toast.text}</Notice>}

      <div className="grid stats-grid compact">
        <StatCard label="Devices in scope" value={num(total, 0)} icon={<Cpu size={16} />} sub={<span>{Object.keys(byType).length} device classes</span>} />
        <StatCard label="Online" value={num(byStatus.ONLINE || 0, 0)} tone="good" icon={<Activity size={16} />} sub={<span>{num(byStatus.OFFLINE || 0, 0)} offline · {num(byStatus.FAULT || 0, 0)} faulted</span>} />
        <StatCard label="Inverters" value={num((byType.HYBRID_INVERTER || 0) + (byType.INVERTER || 0), 0)} icon={<Sun size={16} />} sub={<span>String + hybrid converters</span>} />
        <StatCard label="Storage & metering" value={num((byType.BESS || 0) + (byType.BMS || 0) + (byType.GRID_METER || 0) + (byType.LOAD_METER || 0) + (byType.METER || 0), 0)} icon={<BatteryCharging size={16} />} sub={<span>BESS, BMS and revenue meters</span>} />
      </div>

      <div className="filter-bar">
        <SiteSelector sites={sites} selected={siteIds} onChange={setSiteIds} single />
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Device type">
          <option value="">All device types</option>
          {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Device status">
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="search grow"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, serial, model, IP…" /></label>
      </div>

      {devices.error && <ErrorState error={devices.error} onRetry={devices.reload} />}

      <Card title="Device register" subtitle={`${rows.length} of ${total} devices · read-only monitoring only`} noPad>
        {devices.loading && !devices.data ? <Spinner label="Loading device registry…" /> : (
          <DataTable columns={columns} rows={rows} onRowClick={openDetail} dense />
        )}
        <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
      </Card>

      {!devices.loading && !rows.length && (
        <EmptyState title="No devices match" message="Broaden the plant, type or status filter, or register a new endpoint." icon={<Cpu size={22} />} />
      )}

      <div className="mini-strip">
        <span><ShieldCheck size={14} /> Polling uses read-only function codes 1–4</span>
        <span><SlidersHorizontal size={14} /> Register maps are configurable per device in Modbus Mapping</span>
        <span><Layers size={14} /> Manufacturer templates seed addresses; verify against vendor documentation</span>
      </div>

      <Modal open={!!detail} title={detail ? `${detail.device.name}` : 'Device'} onClose={() => setDetail(null)} wide
        footer={<>
          <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
          {has('device:manage') && detail && <>
            <Button variant="ghost" icon={<SlidersHorizontal size={14} />} onClick={() => { setApplyModel(detail.device.model_id || modelOptions[0]?.id || ''); setApplyOpen(true); }}>Apply template</Button>
            <Button variant="ghost" icon={<Pencil size={14} />} onClick={() => openEdit(detail.device)}>Edit</Button>
            <Button variant="danger" icon={<Trash2 size={14} />} loading={busy} onClick={() => void removeDevice(detail.device)}>Delete</Button>
          </>}
        </>}>
        {!detail ? <Spinner /> : detailLoading ? <Spinner label="Loading device telemetry…" /> : (
          <>
            <div className="detail-head">
              <div>
                <div className="eyebrow">{detail.device.device_type.replace(/_/g, ' ')}</div>
                <h3>{detail.device.name}</h3>
                <p>{detail.device.site_name} · {detail.device.site_code}</p>
              </div>
              <div className="detail-actions">
                <Badge status={detail.device.status}>{detail.device.status}</Badge>
                <span className={cn('source-tag', detail.device.data_source === 'LIVE' ? 'live' : 'demo')}>{sourceLabel(detail.device.data_source)}</span>
              </div>
            </div>

            <div className="grid two-col">
              <KV items={[
                { label: 'Device ID', value: <span className="mono">{detail.device.id}</span> },
                { label: 'Manufacturer', value: detail.device.manufacturer || '—' },
                { label: 'Model', value: detail.device.model || '—' },
                { label: 'Serial', value: <span className="mono">{detail.device.serial || '—'}</span> },
                { label: 'Firmware', value: <span className="mono">{detail.device.firmware || '—'}</span> },
                { label: 'Source', value: sourceLabel(detail.device.data_source) },
              ]} />
              <KV items={[
                { label: 'Modbus endpoint', value: <span className="mono">{detail.device.ip_address || '—'}:{detail.device.port}</span> },
                { label: 'Unit ID', value: <span className="mono">{detail.device.unit_id}</span> },
                { label: 'Gateway', value: detail.device.gateway_name || '—' },
                { label: 'Registers mapped', value: num(detail.registers?.length, 0) },
                { label: 'Last seen', value: dateTime(detail.device.last_seen_at) },
                { label: 'Last update', value: <span className="muted">{timeAgo(detail.device.last_seen_at)}</span> },
              ]} />
            </div>

            <Card title="Latest measured values" subtitle="Most recent samples retained in the historian">
              {latestRows.length ? (
                <DataTable
                  dense
                  columns={[
                    { key: 'parameter_id', label: 'Parameter', render: (r) => <div className="cell-main"><strong>{r.parameter_id}</strong><small>{r.name}</small></div> },
                    { key: 'current', label: 'Value', align: 'right', render: (r) => <span className="mono text-strong">{num(r.current.value, 2)} {r.current.unit || r.unit || ''}</span> },
                    { key: 'quality', label: 'Quality', render: (r) => <Badge status={r.current.quality}>{r.current.quality}</Badge> },
                    { key: 'server_ts', label: 'Timestamp', align: 'right', render: (r) => <span className="muted mono small">{dateTime(r.current.server_ts)}</span> },
                  ]}
                  rows={latestRows}
                />
              ) : <EmptyState title="No recent samples" message="Live values appear once the gateway publishes telemetry." />}
            </Card>

            <Card title="Register mapping" subtitle="Read-only Modbus addresses applied to this device" noPad>
              <DataTable
                dense
                columns={[
                  { key: 'parameter_id', label: 'Parameter', render: (r) => <div className="cell-main"><strong>{r.parameter_id}</strong><small>{r.name}</small></div> },
                  { key: 'function_code', label: 'FC', align: 'center', render: (r) => <span className="tag">FC {r.function_code}</span> },
                  { key: 'address', label: 'Address', align: 'right', render: (r) => <span className="mono">{r.address}</span> },
                  { key: 'register_type', label: 'Register', render: (r) => <span className="muted small">{r.register_type}</span> },
                  { key: 'data_type', label: 'Type', render: (r) => <span className="tag">{r.data_type}</span> },
                  { key: 'scale', label: 'Scale / offset', align: 'right', render: (r) => <span className="mono small">×{r.scale} {r.offset ? `+${r.offset}` : ''}</span> },
                  { key: 'unit', label: 'Unit', render: (r) => <span className="muted">{r.unit || '—'}</span> },
                  { key: 'poll_interval_sec', label: 'Poll', align: 'right', render: (r) => <span className="mono">{r.poll_interval_sec}s</span> },
                  { key: 'enabled', label: 'Enabled', align: 'center', render: (r) => <Badge status={r.enabled ? 'GOOD' : 'UNKNOWN'} dot={false}>{r.enabled ? 'ON' : 'OFF'}</Badge> },
                ]}
                rows={detail.registers || []}
              />
            </Card>

            <div className="mini-strip">
              <span><ShieldCheck size={14} /> Writable flags are stored for documentation only; the platform never writes to plant equipment.</span>
            </div>
          </>
        )}
      </Modal>

      <Modal open={formOpen} title={editTarget ? `Edit ${editTarget.name}` : 'Register a device'} onClose={() => setFormOpen(false)} wide
        footer={<><Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} icon={<Cpu size={14} />} onClick={() => void saveDevice()}>{editTarget ? 'Save changes' : 'Register device'}</Button></>}>
        <div className="form-grid">
          {formError && <div className="login-error span-2"><AlertTriangle size={15} /> {formError}</div>}
          {!editTarget && (
            <Field label="Plant" className="span-2">
              <select className="input" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Device name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Inverter 3 — Rooftop B" /></Field>
          <Field label="Device type">
            <select className="input" value={form.deviceType} onChange={(e) => setForm({ ...form, deviceType: e.target.value })}>
              {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Manufacturer"><input className="input" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} placeholder="Huawei" /></Field>
          <Field label="Model"><input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="SUN2000-100KTL-M1" /></Field>
          <Field label="Serial"><input className="input" value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} /></Field>
          <Field label="Firmware"><input className="input" value={form.firmware} onChange={(e) => setForm({ ...form, firmware: e.target.value })} /></Field>
          <Field label="Modbus IP" hint="Private plant LAN address."><input className="input" value={form.ipAddress} onChange={(e) => setForm({ ...form, ipAddress: e.target.value })} placeholder="10.20.1.31" /></Field>
          <Field label="TCP port"><input className="input" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} /></Field>
          <Field label="Unit ID"><input className="input" type="number" value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })} /></Field>
          <Field label="Register template" hint="Applying a template seeds the register mapping.">
            <select className="input" value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })}>
              <option value="">No template</option>
              {modelOptions.map((m: any) => <option key={m.id} value={m.id}>{m.manufacturer} {m.model} · {m.register_template?.length || 0} regs</option>)}
            </select>
          </Field>
          <p className="form-note span-2">Only read-only polling is permitted. Do not expose port 502 to the public internet; the edge gateway initiates all outbound traffic.</p>
        </div>
      </Modal>

      <Modal open={applyOpen} title="Apply register template" onClose={() => setApplyOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setApplyOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void applyTemplate()}>Apply template</Button></>}>
        <div className="form-grid">
          <Field label="Template" className="span-2">
            <select className="input" value={applyModel} onChange={(e) => setApplyModel(e.target.value)}>
              {modelOptions.map((m: any) => <option key={m.id} value={m.id}>{m.manufacturer} {m.model} · {m.register_template?.length || 0} registers</option>)}
            </select>
          </Field>
          <label className="check-row span-2">
            <input type="checkbox" checked={applyReplace} onChange={(e) => setApplyReplace(e.target.checked)} />
            <span>Replace the existing register map for this device</span>
          </label>
          <p className="form-note span-2">Existing parameters are skipped unless replace is enabled. Verify addresses and byte/word order against manufacturer documentation before applying.</p>
        </div>
      </Modal>
    </div>
  );
}
