import React, { useEffect, useMemo, useState } from 'react';
import {
  SlidersHorizontal, Plus, RefreshCw, Search, Pencil, Trash2, Layers, PlugZap, Terminal,
  ShieldCheck, AlertTriangle, Activity, CheckCircle2, XCircle, Copy, FlaskConical, BookOpen,
} from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, KV, Modal, Notice, PageHeader, Pagination,
  Spinner, StatCard, Tabs, Toggle,
} from '../components/ui';
import { Column, DataTable, SiteSelector } from '../components/filters';
import { useAsync, useDebounced, useSites } from '../lib/hooks';
import { del, get, patch, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn, dateTime, num, timeAgo } from '../lib/format';

type Tab = 'registers' | 'templates' | 'tester' | 'log';

const FUNCTION_CODES = [
  { value: '1', label: '01 — Read coils' },
  { value: '2', label: '02 — Read discrete inputs' },
  { value: '3', label: '03 — Read holding registers' },
  { value: '4', label: '04 — Read input registers' },
];
const REGISTER_TYPES = ['HOLDING', 'INPUT', 'COIL', 'DISCRETE_INPUT'];
const DATA_TYPES = ['BOOL', 'INT16', 'UINT16', 'INT32', 'UINT32', 'FLOAT32', 'INT64', 'UINT64', 'FLOAT64'];
const DEVICE_TYPES = ['HYBRID_INVERTER', 'INVERTER', 'BESS', 'BMS', 'GENERATOR', 'METER', 'GRID_METER', 'LOAD_METER'];

const EMPTY_REGISTER = {
  deviceId: '', parameterId: '', name: '', functionCode: '3', address: '0', registerType: 'HOLDING',
  dataType: 'UINT16', wordOrder: 'BIG', byteOrder: 'BIG', scale: '1', offsetValue: '0', unit: '',
  pollIntervalSec: '10', description: '', enabled: true,
};

export default function ModbusMapping() {
  const { has } = useAuth();
  const sitesState = useSites();
  const [tab, setTab] = useState<Tab>('registers');

  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [deviceType, setDeviceType] = useState('');
  const [enabled, setEnabled] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);

  const [regOpen, setRegOpen] = useState(false);
  const [editReg, setEditReg] = useState<any>(null);
  const [regForm, setRegForm] = useState<any>({ ...EMPTY_REGISTER });
  const [regError, setRegError] = useState<string | null>(null);

  const [applyOpen, setApplyOpen] = useState(false);
  const [applyTemplate, setApplyTemplate] = useState('');
  const [applyDevice, setApplyDevice] = useState('');
  const [applyReplace, setApplyReplace] = useState(false);

  const [tester, setTester] = useState<any>({ deviceId: '', host: '', port: '502', unitId: '1', functionCode: '3', address: '0', count: '2' });
  const [testResult, setTestResult] = useState<any>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [decodeHex, setDecodeHex] = useState('');
  const [decodeRegister, setDecodeRegister] = useState('');
  const [decoded, setDecoded] = useState<any>(null);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const sites = sitesState.data?.sites || [];
  const siteId = siteIds.length === 1 ? siteIds[0] : '';
  const registers = useAsync<any>(() => get(`/api/modbus/registers${qs({ siteId, deviceType, enabled, search: debounced, page, pageSize })}`), [siteId, deviceType, enabled, debounced, page]);
  const templates = useAsync<any>(() => get('/api/modbus/templates'), []);
  const devices = useAsync<any>(() => get('/api/devices?pageSize=500'), []);
  const log = useAsync<any>(() => get(`/api/modbus/test-log${qs({ siteId, page: 1, pageSize: 50 })}`), [siteId, tab]);

  useEffect(() => { setPage(1); }, [siteId, deviceType, enabled, debounced]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const deviceList = devices.data?.devices || [];
  const templateList = templates.data?.templates || [];
  const rows = registers.data?.registers || [];
  const total = registers.data?.total || 0;

  const selectedTesterDevice = useMemo(() => deviceList.find((d: any) => d.id === tester.deviceId), [deviceList, tester.deviceId]);

  const openCreate = (deviceId?: string) => {
    setEditReg(null);
    setRegForm({ ...EMPTY_REGISTER, deviceId: deviceId || deviceList[0]?.id || '' });
    setRegError(null);
    setRegOpen(true);
  };

  const openEdit = (reg: any) => {
    setEditReg(reg);
    setRegForm({
      deviceId: reg.device_id, parameterId: reg.parameter_id, name: reg.name, functionCode: String(reg.function_code),
      address: String(reg.address), registerType: reg.register_type, dataType: reg.data_type, wordOrder: reg.word_order,
      byteOrder: reg.byte_order, scale: String(reg.scale), offsetValue: String(reg.offset), unit: reg.unit || '',
      pollIntervalSec: String(reg.poll_interval_sec), description: reg.description || '', enabled: Boolean(reg.enabled),
    });
    setRegError(null);
    setRegOpen(true);
  };

  const saveRegister = async () => {
    setBusy(true);
    setRegError(null);
    try {
      const payload = {
        deviceId: regForm.deviceId, parameterId: regForm.parameterId, name: regForm.name,
        functionCode: Number(regForm.functionCode), address: Number(regForm.address),
        registerType: regForm.registerType, dataType: regForm.dataType, wordOrder: regForm.wordOrder,
        byteOrder: regForm.byteOrder, scale: Number(regForm.scale), offsetValue: Number(regForm.offsetValue),
        unit: regForm.unit || null, pollIntervalSec: Number(regForm.pollIntervalSec) || 10,
        description: regForm.description || null, enabled: regForm.enabled,
      };
      if (editReg) {
        await patch(`/api/devices/registers/${editReg.id}`, payload);
        setToast({ tone: 'success', text: `${regForm.parameterId} updated.` });
      } else {
        await post(`/api/devices/${regForm.deviceId}/registers`, payload);
        setToast({ tone: 'success', text: `${regForm.parameterId} mapped.` });
      }
      setRegOpen(false);
      registers.reload();
      devices.reload();
    } catch (err: any) {
      setRegError(err?.message || 'Could not save register');
    } finally { setBusy(false); }
  };

  const toggleEnabled = async (reg: any) => {
    try {
      await patch(`/api/devices/registers/${reg.id}`, { enabled: !reg.enabled });
      registers.reload();
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not update register' });
    }
  };

  const removeRegister = async (reg: any) => {
    if (!window.confirm(`Remove ${reg.parameter_id} from ${reg.device_name}? Historical measurements are retained.`)) return;
    try {
      await del(`/api/devices/registers/${reg.id}`);
      registers.reload();
      setToast({ tone: 'success', text: 'Register mapping removed.' });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not delete register' });
    }
  };

  const applyToDevice = async () => {
    setBusy(true);
    try {
      const payload = await post<any>(`/api/devices/${applyDevice}/registers/apply-template`, {
        modelId: applyTemplate || undefined, replace: applyReplace,
      });
      setApplyOpen(false);
      registers.reload();
      devices.reload();
      setToast({ tone: 'success', text: `Template applied · ${payload.added} added · ${payload.registerCount} registers total.` });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not apply template' });
    } finally { setBusy(false); }
  };

  const runTest = async () => {
    setBusy(true);
    setTestError(null);
    setTestResult(null);
    try {
      const payload = await post<any>('/api/modbus/test-connection', {
        deviceId: tester.deviceId || undefined,
        host: tester.deviceId ? undefined : tester.host,
        port: Number(tester.port) || 502,
        unitId: Number(tester.unitId) || 1,
        functionCode: Number(tester.functionCode),
        address: Number(tester.address),
        count: Number(tester.count),
        decode: false,
      });
      setTestResult(payload);
      log.reload();
    } catch (err: any) {
      setTestError(err?.message || 'Connection test failed');
    } finally { setBusy(false); }
  };

  const decodePayload = async () => {
    setBusy(true);
    setTestError(null);
    try {
      const reg = rows.find((r: any) => r.id === decodeRegister);
      if (!decodeHex.trim()) throw new Error('Paste the response payload as hexadecimal bytes');
      if (!reg) throw new Error('Select a register definition for decoding');
      const payload = await post<any>('/api/modbus/decode', {
        hex: decodeHex,
        registers: [{
          parameterId: reg.parameter_id, name: reg.name, dataType: reg.data_type, wordOrder: reg.word_order,
          byteOrder: reg.byte_order, scale: reg.scale, offset: reg.offset, unit: reg.unit,
        }],
      });
      setDecoded(payload);
    } catch (err: any) {
      setTestError(err?.message || 'Decode failed');
    } finally { setBusy(false); }
  };

  const registerColumns: Column<any>[] = [
    { key: 'parameter_id', label: 'Parameter', render: (r) => <div className="cell-main"><strong>{r.parameter_id}</strong><small>{r.name}</small></div> },
    { key: 'device_name', label: 'Device', render: (r) => <div className="cell-main"><strong>{r.device_name}</strong><small>{r.site_code} · {r.device_type.replace(/_/g, ' ')}</small></div> },
    { key: 'function_code', label: 'FC', align: 'center', render: (r) => <span className="tag">FC {r.function_code}</span> },
    { key: 'address', label: 'Address', align: 'right', render: (r) => <span className="mono">{r.address}</span> },
    { key: 'register_type', label: 'Area', render: (r) => <span className="muted small">{r.register_type}</span> },
    { key: 'data_type', label: 'Type', render: (r) => <span className="tag">{r.data_type}</span> },
    { key: 'scale', label: 'Scale', align: 'right', render: (r) => <span className="mono small">×{r.scale}{Number(r.offset) ? ` / +${r.offset}` : ''}</span> },
    { key: 'unit', label: 'Unit', render: (r) => <span className="muted">{r.unit || '—'}</span> },
    { key: 'poll_interval_sec', label: 'Poll', align: 'right', render: (r) => <span className="mono">{r.poll_interval_sec}s</span> },
    {
      key: 'enabled', label: 'Enabled', align: 'center',
      render: (r) => <Toggle checked={Boolean(r.enabled)} onChange={() => void toggleEnabled(r)} />,
    },
    {
      key: 'actions', label: '', align: 'right',
      render: (r) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => openEdit(r)}>Edit</Button>
          {has('modbus:manage') && <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => void removeRegister(r)}>Delete</Button>}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Assets & connectivity"
        title="Modbus mapping"
        subtitle="Manufacturer-agnostic register maps, byte/word ordering, templates and read-only connection testing."
        actions={<>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => { registers.reload(); templates.reload(); devices.reload(); log.reload(); }}>Refresh</Button>
          {has('modbus:manage') && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => openCreate()}>Add register</Button>}
        </>}
      />

      {toast && <Notice tone={toast.tone} onClose={() => setToast(null)}>{toast.text}</Notice>}

      <div className="grid stats-grid compact">
        <StatCard label="Mapped registers" value={num(total, 0)} icon={<SlidersHorizontal size={16} />} sub={<span>{num(deviceList.length, 0)} polled devices</span>} />
        <StatCard label="Register templates" value={num(templateList.length, 0)} icon={<Layers size={16} />} sub={<span>{num(templateList.reduce((a: number, t: any) => a + t.registerCount, 0), 0)} template registers</span>} />
        <StatCard label="Read-only areas" value="4" icon={<ShieldCheck size={16} />} sub={<span>Coils, discrete, holding, input</span>} />
        <StatCard label="Comms tests" value={num(log.data?.total ?? 0, 0)} tone="info" icon={<FlaskConical size={16} />} sub={<span>Logged read-only probes</span>} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'registers', label: 'Register map', count: total },
          { value: 'templates', label: 'Templates', count: templateList.length },
          { value: 'tester', label: 'Connection tester' },
          { value: 'log', label: 'Test log', count: log.data?.total },
        ]}
      />

      {tab === 'registers' && (
        <>
          <div className="filter-bar">
            <SiteSelector sites={sites} selected={siteIds} onChange={setSiteIds} single />
            <select className="input" value={deviceType} onChange={(e) => setDeviceType(e.target.value)} aria-label="Device type">
              <option value="">All device types</option>
              {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
            <select className="input" value={enabled} onChange={(e) => setEnabled(e.target.value)} aria-label="Register enabled">
              <option value="">All registers</option>
              <option value="true">Enabled only</option>
              <option value="false">Disabled only</option>
            </select>
            <label className="search grow"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search parameter, device, plant…" /></label>
          </div>
          {registers.error && <ErrorState error={registers.error} onRetry={registers.reload} />}
          <Card title="Register definitions" subtitle="Addresses are always zero-based as configured per manufacturer documentation" noPad>
            {registers.loading && !registers.data ? <Spinner label="Loading register map…" /> : (
              <DataTable columns={registerColumns} rows={rows} dense />
            )}
            <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
          </Card>
        </>
      )}

      {tab === 'templates' && (
        <>
          {templates.error && <ErrorState error={templates.error} onRetry={templates.reload} />}
          <div className="grid three-col">
            {templateList.map((t: any) => (
              <Card key={t.id} title={`${t.manufacturer} ${t.model}`} subtitle={`${t.deviceType.replace(/_/g, ' ')} · ${t.registerCount} registers`}
                actions={has('modbus:manage') ? <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => { setApplyTemplate(t.id); setApplyDevice(deviceList[0]?.id || ''); setApplyReplace(false); setApplyOpen(true); }}>Apply</Button> : undefined}>
                <p className="muted small">{t.description}</p>
                <div className="template-registers">
                  {t.registers.slice(0, 6).map((r: any) => (
                    <div key={r.parameter_id}>
                      <span className="mono">{r.parameter_id}</span>
                      <span className="muted small">FC{r.function_code} @ {r.address} · {r.data_type}</span>
                    </div>
                  ))}
                  {t.registerCount > 6 && <div className="muted small">+ {t.registerCount - 6} more registers</div>}
                </div>
              </Card>
            ))}
          </div>
          {!templates.loading && !templateList.length && <EmptyState title="No templates" message="Device model templates seed register maps." icon={<BookOpen size={22} />} />}
        </>
      )}

      {tab === 'tester' && (
        <div className="grid two-col">
          <Card title="Read-only connection test" subtitle="Executed from the application server; only private/local addresses are permitted">
            <div className="form-grid">
              <Field label="Target device" className="span-2" hint="Leave blank to probe a custom private IP address.">
                <select className="input" value={tester.deviceId} onChange={(e) => {
                  const d = deviceList.find((x: any) => x.id === e.target.value);
                  setTester({ ...tester, deviceId: e.target.value, host: d?.ip_address || '', port: String(d?.port || 502), unitId: String(d?.unit_id || 1) });
                }}>
                  <option value="">Custom endpoint</option>
                  {deviceList.map((d: any) => <option key={d.id} value={d.id}>{d.site_code} · {d.name} ({d.ip_address})</option>)}
                </select>
              </Field>
              {!tester.deviceId && <>
                <Field label="Host"><input className="input" value={tester.host} onChange={(e) => setTester({ ...tester, host: e.target.value })} placeholder="10.20.1.31" /></Field>
                <Field label="Port"><input className="input" type="number" value={tester.port} onChange={(e) => setTester({ ...tester, port: e.target.value })} /></Field>
                <Field label="Unit ID"><input className="input" type="number" value={tester.unitId} onChange={(e) => setTester({ ...tester, unitId: e.target.value })} /></Field>
              </>}
              <Field label="Function code">
                <select className="input" value={tester.functionCode} onChange={(e) => setTester({ ...tester, functionCode: e.target.value })}>
                  {FUNCTION_CODES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </Field>
              <Field label="Start address"><input className="input" type="number" value={tester.address} onChange={(e) => setTester({ ...tester, address: e.target.value })} /></Field>
              <Field label="Register count" hint="1–125 registers."><input className="input" type="number" value={tester.count} onChange={(e) => setTester({ ...tester, count: e.target.value })} /></Field>
            </div>
            <div className="inline-actions">
              <Button variant="primary" icon={<PlugZap size={14} />} loading={busy} onClick={() => void runTest()}>Run read test</Button>
              <span className="field-hint">Never writes to equipment. Port 502 is not exposed publicly.</span>
            </div>
            {testError && <Notice tone="error">{testError}</Notice>}
            {testResult && (
              <div className="test-result">
                <div className="test-result-head">
                  {testResult.ok ? <CheckCircle2 size={18} className="text-good" /> : <XCircle size={18} className="text-bad" />}
                  <strong>{testResult.status}</strong>
                  <Badge status={testResult.status === 'OK' ? 'GOOD' : testResult.status === 'ERROR' ? 'WARNING' : 'CRITICAL'}>{testResult.reachable ? 'TCP reachable' : 'No TCP route'}</Badge>
                  <span className="mono">{num(testResult.latencyMs, 0)} ms</span>
                </div>
                <KV items={[
                  { label: 'Target', value: <span className="mono">{testResult.target?.host}:{testResult.target?.port} · unit {testResult.target?.unitId}</span> },
                  { label: 'Read', value: <span className="mono">{testResult.target?.functionName} @ {testResult.target?.address} × {testResult.target?.count}</span> },
                  { label: 'Response bytes', value: num(testResult.response?.bytes ?? 0, 0) },
                  { label: 'Hex payload', value: <span className="mono small break">{testResult.response?.dataHex || '—'}</span> },
                  { label: 'Error', value: testResult.error || '—' },
                ]} />
                <p className="field-hint">{testResult.hint}</p>
              </div>
            )}
          </Card>

          <Card title="Payload decoder" subtitle="Verify data type, scale and byte/word order against captured hex bytes">
            <div className="form-grid">
              <Field label="Register definition" className="span-2">
                <select className="input" value={decodeRegister} onChange={(e) => setDecodeRegister(e.target.value)}>
                  <option value="">Select a mapped register</option>
                  {rows.map((r: any) => <option key={r.id} value={r.id}>{r.site_code} · {r.device_name} · {r.parameter_id} ({r.data_type})</option>)}
                </select>
              </Field>
              <Field label="Hex payload" className="span-2" hint="Spaces and separators are ignored. Example: 00 64 or 43 48 00 00.">
                <textarea className="input textarea mono" rows={3} value={decodeHex} onChange={(e) => setDecodeHex(e.target.value)} placeholder="00 64" />
              </Field>
            </div>
            <div className="inline-actions">
              <Button variant="primary" icon={<Terminal size={14} />} loading={busy} onClick={() => void decodePayload()}>Decode payload</Button>
            </div>
            {decoded?.decoded?.length ? (
              <div className="test-result">
                <div className="test-result-head"><CheckCircle2 size={18} className="text-good" /><strong>Decoded value</strong><span className="muted">{decoded.bytes} bytes</span></div>
                <KV items={[
                  { label: 'Parameter', value: decoded.decoded[0].name || decoded.decoded[0].parameterId },
                  { label: 'Raw integer', value: <span className="mono">{num(decoded.decoded[0].raw, 4)}</span> },
                  { label: 'Scaled value', value: <span className="mono text-strong">{num(decoded.decoded[0].value, 4)} {decoded.decoded[0].unit || ''}</span> },
                  { label: 'Error', value: decoded.decoded[0].error || '—' },
                ]} />
              </div>
            ) : <EmptyState title="Decode a captured payload" message="Select a register to apply its scaling and byte order." icon={<Terminal size={22} />} />}
          </Card>
        </div>
      )}

      {tab === 'log' && (
        <>
          {log.error && <ErrorState error={log.error} onRetry={log.reload} />}
          <Card title="Modbus test log" subtitle="Every probe is audited; only read function codes are accepted" noPad>
            <DataTable
              dense
              columns={[
                { key: 'ts', label: 'Timestamp', render: (r) => <span className="mono small">{dateTime(r.ts)}</span> },
                { key: 'site_code', label: 'Plant', render: (r) => <div className="cell-main"><strong>{r.site_code || '—'}</strong><small>{r.site_name || ''}</small></div> },
                { key: 'protocol', label: 'Protocol', render: (r) => <span className="tag">{r.protocol}</span> },
                { key: 'topic', label: 'Probe', render: (r) => <span className="mono small">{r.topic}</span> },
                { key: 'status', label: 'Status', render: (r) => <Badge status={r.status === 'OK' ? 'GOOD' : r.status}>{r.status}</Badge> },
                { key: 'latency_ms', label: 'Latency', align: 'right', render: (r) => <span className="mono">{num(r.latency_ms, 0)} ms</span> },
                { key: 'error', label: 'Error', render: (r) => <span className="muted small">{r.error || '—'}</span> },
              ]}
              rows={log.data?.logs || []}
            />
          </Card>
        </>
      )}

      <div className="mini-strip">
        <span><ShieldCheck size={14} /> Function codes 1–4 only · no write or control operations</span>
        <span><AlertTriangle size={14} /> Templates are starting points — always validate against the current vendor register manual</span>
        <span><Activity size={14} /> Gateway polls inside the plant network; inbound port 502 is never required</span>
      </div>

      <Modal open={regOpen} title={editReg ? `Edit ${editReg.parameter_id}` : 'Add register mapping'} onClose={() => setRegOpen(false)} wide
        footer={<><Button variant="ghost" onClick={() => setRegOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} icon={<SlidersHorizontal size={14} />} onClick={() => void saveRegister()}>{editReg ? 'Save register' : 'Add register'}</Button></>}>
        <div className="form-grid">
          {regError && <div className="login-error span-2"><AlertTriangle size={15} /> {regError}</div>}
          {!editReg && (
            <Field label="Device" className="span-2">
              <select className="input" value={regForm.deviceId} onChange={(e) => setRegForm({ ...regForm, deviceId: e.target.value })}>
                {deviceList.map((d: any) => <option key={d.id} value={d.id}>{d.site_code} · {d.name} ({d.ip_address})</option>)}
              </select>
            </Field>
          )}
          <Field label="Parameter ID" hint="Stable key used by alarms and analytics."><input className="input mono" value={regForm.parameterId} onChange={(e) => setRegForm({ ...regForm, parameterId: e.target.value })} placeholder="active_power_kw" /></Field>
          <Field label="Display name"><input className="input" value={regForm.name} onChange={(e) => setRegForm({ ...regForm, name: e.target.value })} placeholder="Active Power" /></Field>
          <Field label="Function code">
            <select className="input" value={regForm.functionCode} onChange={(e) => setRegForm({ ...regForm, functionCode: e.target.value })}>
              {FUNCTION_CODES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </Field>
          <Field label="Address"><input className="input" type="number" value={regForm.address} onChange={(e) => setRegForm({ ...regForm, address: e.target.value })} /></Field>
          <Field label="Register area">
            <select className="input" value={regForm.registerType} onChange={(e) => setRegForm({ ...regForm, registerType: e.target.value })}>
              {REGISTER_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Data type">
            <select className="input" value={regForm.dataType} onChange={(e) => setRegForm({ ...regForm, dataType: e.target.value })}>
              {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Word order">
            <select className="input" value={regForm.wordOrder} onChange={(e) => setRegForm({ ...regForm, wordOrder: e.target.value })}>
              <option value="BIG">Big endian</option>
              <option value="LITTLE">Little endian</option>
            </select>
          </Field>
          <Field label="Byte order">
            <select className="input" value={regForm.byteOrder} onChange={(e) => setRegForm({ ...regForm, byteOrder: e.target.value })}>
              <option value="BIG">Big endian</option>
              <option value="LITTLE">Little endian</option>
            </select>
          </Field>
          <Field label="Scale multiplier"><input className="input" type="number" step="any" value={regForm.scale} onChange={(e) => setRegForm({ ...regForm, scale: e.target.value })} /></Field>
          <Field label="Offset"><input className="input" type="number" step="any" value={regForm.offsetValue} onChange={(e) => setRegForm({ ...regForm, offsetValue: e.target.value })} /></Field>
          <Field label="Unit"><input className="input" value={regForm.unit} onChange={(e) => setRegForm({ ...regForm, unit: e.target.value })} placeholder="kW, %, °C" /></Field>
          <Field label="Poll interval (s)"><input className="input" type="number" value={regForm.pollIntervalSec} onChange={(e) => setRegForm({ ...regForm, pollIntervalSec: e.target.value })} /></Field>
          <Field label="Description" className="span-2"><input className="input" value={regForm.description} onChange={(e) => setRegForm({ ...regForm, description: e.target.value })} placeholder="Source: vendor manual section 4.2" /></Field>
          <label className="check-row span-2">
            <input type="checkbox" checked={regForm.enabled} onChange={(e) => setRegForm({ ...regForm, enabled: e.target.checked })} />
            <span>Enable this register for polling</span>
          </label>
        </div>
      </Modal>

      <Modal open={applyOpen} title="Apply template to device" onClose={() => setApplyOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setApplyOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void applyToDevice()}>Apply template</Button></>}>
        <div className="form-grid">
          <Field label="Device" className="span-2">
            <select className="input" value={applyDevice} onChange={(e) => setApplyDevice(e.target.value)}>
              {deviceList.map((d: any) => <option key={d.id} value={d.id}>{d.site_code} · {d.name} · {d.device_type}</option>)}
            </select>
          </Field>
          <Field label="Template" className="span-2">
            <select className="input" value={applyTemplate} onChange={(e) => setApplyTemplate(e.target.value)}>
              {templateList.map((t: any) => <option key={t.id} value={t.id}>{t.manufacturer} {t.model} · {t.registerCount} registers</option>)}
            </select>
          </Field>
          <label className="check-row span-2">
            <input type="checkbox" checked={applyReplace} onChange={(e) => setApplyReplace(e.target.checked)} />
            <span>Replace existing mappings for this device</span>
          </label>
          <p className="form-note span-2">Template addresses are vendor defaults and may need correction for unit IDs, firmware revisions or gateway offsets.</p>
        </div>
      </Modal>
    </div>
  );
}
