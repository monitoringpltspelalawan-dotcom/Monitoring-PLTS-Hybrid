import React, { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon, RefreshCw, Save, Plus, Pencil, Trash2, Building2, Globe2, Receipt,
  ShieldCheck, AlertTriangle, ServerCog, Database, Bell, Check,
} from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, KV, Modal, Notice, PageHeader, Spinner, StatCard, Tabs, Toggle,
} from '../components/ui';
import { Column, DataTable } from '../components/filters';
import { useAsync } from '../lib/hooks';
import { del, get, patch, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, money, num } from '../lib/format';

type Tab = 'general' | 'tariffs' | 'regions';

const EMPTY_TARIFF = { name: '', siteId: '', type: 'ENERGY', rate: '1444.7', currency: 'IDR', effectiveFrom: new Date().toISOString().slice(0, 10) };
const EMPTY_REGION = { code: '', name: '', timezone: 'Asia/Jakarta' };

export default function Settings() {
  const { has } = useAuth();
  const canManage = has('settings:manage');
  const [tab, setTab] = useState<Tab>('general');
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const [tariffOpen, setTariffOpen] = useState(false);
  const [editTariff, setEditTariff] = useState<any>(null);
  const [tariffForm, setTariffForm] = useState<any>({ ...EMPTY_TARIFF });

  const [regionOpen, setRegionOpen] = useState(false);
  const [editRegion, setEditRegion] = useState<any>(null);
  const [regionForm, setRegionForm] = useState<any>({ ...EMPTY_REGION });

  const settings = useAsync<any>(() => get('/api/settings'), []);
  const sitesState = useAsync<any>(() => get('/api/sites'), []);

  useEffect(() => {
    if (settings.data?.settings) { setForm({ ...settings.data.settings }); setDirty(false); }
  }, [settings.data]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const set = (key: string, value: string) => { setForm((f) => ({ ...f, [key]: value })); setDirty(true); };

  const platform = settings.data?.platform;
  const tariffs = settings.data?.tariffs || [];
  const regions = settings.data?.regions || [];
  const sites = sitesState.data?.sites || [];

  const saveSettings = async () => {
    setBusy(true);
    try {
      await put('/api/settings', form);
      setDirty(false);
      settings.reload();
      setToast({ tone: 'success', text: 'Platform settings saved.' });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not save settings' });
    } finally { setBusy(false); }
  };

  const openTariff = (tariff?: any) => {
    setEditTariff(tariff || null);
    setTariffForm(tariff ? {
      name: tariff.name, siteId: tariff.site_id || '', type: tariff.type, rate: String(tariff.rate),
      currency: tariff.currency, effectiveFrom: tariff.effective_from || '',
    } : { ...EMPTY_TARIFF });
    setTariffOpen(true);
  };

  const saveTariff = async () => {
    setBusy(true);
    try {
      const payload = {
        name: tariffForm.name, siteId: tariffForm.siteId || null, type: tariffForm.type,
        rate: Number(tariffForm.rate), currency: tariffForm.currency, effectiveFrom: tariffForm.effectiveFrom || undefined,
      };
      if (editTariff) await patch(`/api/settings/tariffs/${editTariff.id}`, payload);
      else await post('/api/settings/tariffs', payload);
      setTariffOpen(false);
      settings.reload();
      setToast({ tone: 'success', text: `Tariff ${editTariff ? 'updated' : 'created'}.` });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not save tariff' });
    } finally { setBusy(false); }
  };

  const removeTariff = async (tariff: any) => {
    if (!window.confirm(`Delete tariff “${tariff.name}”? Savings calculations fall back to the portfolio default.`)) return;
    try {
      await del(`/api/settings/tariffs/${tariff.id}`);
      settings.reload();
      setToast({ tone: 'success', text: 'Tariff deleted.' });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not delete tariff' });
    }
  };

  const openRegion = (region?: any) => {
    setEditRegion(region || null);
    setRegionForm(region ? { code: region.code, name: region.name, timezone: region.timezone } : { ...EMPTY_REGION });
    setRegionOpen(true);
  };

  const saveRegion = async () => {
    setBusy(true);
    try {
      if (editRegion) await patch(`/api/settings/regions/${editRegion.id}`, { name: regionForm.name, timezone: regionForm.timezone });
      else await post('/api/settings/regions', regionForm);
      setRegionOpen(false);
      settings.reload();
      setToast({ tone: 'success', text: `Region ${editRegion ? 'updated' : 'created'}.` });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not save region' });
    } finally { setBusy(false); }
  };

  const tariffColumns: Column<any>[] = [
    { key: 'name', label: 'Tariff', render: (t) => <div className="cell-main"><strong>{t.name}</strong><small>{t.type} · effective {t.effective_from || '—'}</small></div> },
    { key: 'site_code', label: 'Scope', render: (t) => t.site_code ? <div className="cell-main"><strong>{t.site_code}</strong><small>{t.site_name}</small></div> : <Badge color="var(--info)">Portfolio default</Badge> },
    { key: 'rate', label: 'Rate', align: 'right', render: (t) => <span className="mono text-strong">{t.currency} {num(t.rate, 2)}</span> },
    { key: 'currency', label: 'Unit', render: (t) => <span className="muted small">per kWh</span> },
    {
      key: 'actions', label: '', align: 'right',
      render: (t) => (
        <span className="row-actions">
          <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => openTariff(t)}>Edit</Button>
          <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => void removeTariff(t)}>Delete</Button>
        </span>
      ),
    },
  ];

  const regionColumns: Column<any>[] = [
    { key: 'code', label: 'Region', render: (r) => <div className="cell-main"><strong>{r.code}</strong><small>{r.name}</small></div> },
    { key: 'timezone', label: 'Timezone', render: (r) => <span className="mono small">{r.timezone}</span> },
    { key: 'site_count', label: 'Sites', align: 'right', render: (r) => <span className="mono">{num(r.site_count ?? sites.filter((s: any) => s.region_id === r.id).length, 0)}</span> },
    {
      key: 'actions', label: '', align: 'right',
      render: (r) => <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => openRegion(r)}>Edit</Button>,
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        subtitle="Organisation profile, tariffs, regional structure and platform-level operating parameters."
        actions={<>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => settings.reload()}>Refresh</Button>
          {canManage && tab === 'general' && <Button size="sm" variant="primary" icon={<Save size={14} />} loading={busy} disabled={!dirty} onClick={() => void saveSettings()}>Save settings</Button>}
          {canManage && tab === 'tariffs' && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => openTariff()}>Add tariff</Button>}
          {canManage && tab === 'regions' && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => openRegion()}>Add region</Button>}
        </>}
      />

      {toast && <Notice tone={toast.tone} onClose={() => setToast(null)}>{toast.text}</Notice>}

      <div className="grid stats-grid compact">
        <StatCard label="Platform" value={platform?.version || '—'} icon={<ServerCog size={16} />} sub={<span>{platform?.environment || '—'} · {platform?.name || 'CHSMS'}</span>} />
        <StatCard label="Tariffs configured" value={tariffs.length} icon={<Receipt size={16} />} sub={<span>{tariffs.filter((t: any) => !t.site_id).length} portfolio default</span>} />
        <StatCard label="Regions" value={regions.length} icon={<Globe2 size={16} />} sub={<span>{sites.length} plants in portfolio</span>} />
        <StatCard label="Default tariff" value={money(Number(form.default_tariff || 0), false)} tone="info" icon={<Database size={16} />} sub={<span>per kWh · {form.base_currency || 'IDR'}</span>} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'general', label: 'General', count: settings.data?.rows?.length },
          { value: 'tariffs', label: 'Tariffs', count: tariffs.length },
          { value: 'regions', label: 'Regions', count: regions.length },
        ]}
      />

      {settings.error && <ErrorState error={settings.error} onRetry={settings.reload} />}
      {settings.loading && !settings.data && <Spinner label="Loading platform settings…" />}

      {tab === 'general' && settings.data && (
        <>
          <div className="grid two-col">
            <Card title="Organisation" subtitle="Displayed across reports, exports and dashboards">
              <div className="form-grid">
                <Field label="Company name" className="span-2"><input className="input" value={form.company_name || ''} onChange={(e) => set('company_name', e.target.value)} /></Field>
                <Field label="Portfolio name" className="span-2"><input className="input" value={form.portfolio_name || ''} onChange={(e) => set('portfolio_name', e.target.value)} /></Field>
                <Field label="Base currency"><input className="input" value={form.base_currency || ''} onChange={(e) => set('base_currency', e.target.value)} /></Field>
                <Field label="Default tariff" hint="Currency per kWh."><input className="input" type="number" step="any" value={form.default_tariff || ''} onChange={(e) => set('default_tariff', e.target.value)} /></Field>
                <Field label="Emission factor" hint="kg CO₂e per kWh displaced."><input className="input" type="number" step="any" value={form.emission_factor_kg_per_kwh || ''} onChange={(e) => set('emission_factor_kg_per_kwh', e.target.value)} /></Field>
                <Field label="Demo mode" hint="Controls the simulator when demo data is enabled.">
                  <Toggle checked={form.demo_mode === 'true'} onChange={(v) => set('demo_mode', v ? 'true' : 'false')} label={form.demo_mode === 'true' ? 'Enabled' : 'Disabled'} />
                </Field>
              </div>
            </Card>

            <Card title="Ingestion & security" subtitle="Edge gateway heartbeat, TLS broker and session policy">
              <div className="form-grid">
                <Field label="MQTT broker URL" className="span-2"><input className="input mono" value={form.mqtt_broker_url || ''} onChange={(e) => set('mqtt_broker_url', e.target.value)} /></Field>
                <Field label="Gateway heartbeat (s)"><input className="input" type="number" value={form.gateway_heartbeat_seconds || ''} onChange={(e) => set('gateway_heartbeat_seconds', e.target.value)} /></Field>
                <Field label="Session timeout (h)"><input className="input" type="number" value={form.session_timeout_hours || ''} onChange={(e) => set('session_timeout_hours', e.target.value)} /></Field>
                <Field label="Measurement retention (days)"><input className="input" type="number" value={form.measurement_retention_days || ''} onChange={(e) => set('measurement_retention_days', e.target.value)} /></Field>
                <Field label="Alarm notification channel">
                  <select className="input" value={form.alarm_notification_channel || 'EMAIL'} onChange={(e) => set('alarm_notification_channel', e.target.value)}>
                    {['EMAIL', 'WEBHOOK', 'SMS', 'NONE'].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Notification target" className="span-2"><input className="input" value={form.alarm_notification_target || ''} onChange={(e) => set('alarm_notification_target', e.target.value)} placeholder="control-room@company.co.id" /></Field>
              </div>
              <p className="field-hint">SMTP and MQTT passwords are stored as secrets and are never returned by the API. Configure them through the deployment environment.</p>
            </Card>
          </div>

          <div className="grid two-col">
            <Card title="Platform profile" subtitle="Read-only runtime information">
              <KV items={[
                { label: 'Application', value: platform?.name },
                { label: 'Version', value: <span className="mono">{platform?.version}</span> },
                { label: 'Environment', value: <Badge color="var(--info)" dot={false}>{platform?.environment}</Badge> },
                { label: 'Read-only monitoring', value: <span className="text-good">Enforced</span> },
                { label: 'Demo mode', value: platform?.demoMode ? 'Enabled' : 'Disabled' },
                { label: 'Measurement retention', value: `${platform?.retention?.measurementsDays} days` },
              ]} />
            </Card>
            <Card title="Compliance posture" subtitle="Controls applied platform-wide">
              <div className="security-list">
                <div><ShieldCheck size={15} /><span><strong>No remote control</strong><small>All Modbus interactions are read-only function codes 1–4.</small></span></div>
                <div><Database size={15} /><span><strong>Audited configuration</strong><small>Every settings change is recorded with actor and timestamp.</small></span></div>
                <div><Bell size={15} /><span><strong>Alarm notifications</strong><small>Delivery channel: {form.alarm_notification_channel || 'EMAIL'} · {form.alarm_notification_target || '—'}</small></span></div>
                <div><AlertTriangle size={15} /><span><strong>Demo data separation</strong><small>LIVE and DEMO sources are tracked independently per site.</small></span></div>
              </div>
            </Card>
          </div>

          <div className="mini-strip">
            <span><Save size={14} /> {dirty ? 'Unsaved changes — save to apply across the platform' : 'All settings are saved'}</span>
            <span><ShieldCheck size={14} /> Only users with settings:manage can change these values</span>
          </div>
        </>
      )}

      {tab === 'tariffs' && (
        <>
          <Card title="Electricity tariffs" subtitle="Per-site rates override the portfolio default in savings and CO₂ calculations" noPad>
            <DataTable columns={tariffColumns} rows={tariffs} dense />
          </Card>
          {!tariffs.length && <EmptyState title="No tariffs configured" message="Add a portfolio default so analytics can value energy." icon={<Receipt size={22} />} />}
          <div className="mini-strip">
            <span><Receipt size={14} /> Rates can be time-of-use or flat energy tariffs</span>
            <span><Database size={14} /> Effective dates are preserved for historical comparisons</span>
          </div>
        </>
      )}

      {tab === 'regions' && (
        <>
          <Card title="Regional structure" subtitle="Regions scope regional managers and group plants for reporting" noPad>
            <DataTable columns={regionColumns} rows={regions} dense />
          </Card>
          {!regions.length && <EmptyState title="No regions" message="Create a region before assigning regional managers." icon={<Globe2 size={22} />} />}
          <div className="mini-strip">
            <span><Globe2 size={14} /> {regions.length} regions · {sites.length} plants</span>
            <span><Building2 size={14} /> Site assignments are managed per user under Users &amp; Roles</span>
          </div>
        </>
      )}

      <Modal open={tariffOpen} title={editTariff ? 'Edit tariff' : 'Add tariff'} onClose={() => setTariffOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setTariffOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} icon={<Receipt size={14} />} onClick={() => void saveTariff()}>{editTariff ? 'Save tariff' : 'Add tariff'}</Button></>}>
        <div className="form-grid">
          <Field label="Tariff name" className="span-2"><input className="input" value={tariffForm.name} onChange={(e) => setTariffForm({ ...tariffForm, name: e.target.value })} placeholder="PLN I-3 industrial" /></Field>
          <Field label="Scope" className="span-2" hint="Select portfolio default or override for a single plant.">
            <select className="input" value={tariffForm.siteId} onChange={(e) => setTariffForm({ ...tariffForm, siteId: e.target.value })}>
              <option value="">Portfolio default</option>
              {sites.map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </Field>
          <Field label="Rate"><input className="input" type="number" step="any" value={tariffForm.rate} onChange={(e) => setTariffForm({ ...tariffForm, rate: e.target.value })} /></Field>
          <Field label="Currency"><input className="input" value={tariffForm.currency} onChange={(e) => setTariffForm({ ...tariffForm, currency: e.target.value })} /></Field>
          <Field label="Tariff type">
            <select className="input" value={tariffForm.type} onChange={(e) => setTariffForm({ ...tariffForm, type: e.target.value })}>
              {['ENERGY', 'CAPACITY', 'TIME_OF_USE', 'FEED_IN'].map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Effective from"><input className="input" type="date" value={tariffForm.effectiveFrom} onChange={(e) => setTariffForm({ ...tariffForm, effectiveFrom: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={regionOpen} title={editRegion ? 'Edit region' : 'Add region'} onClose={() => setRegionOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setRegionOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} icon={<Globe2 size={14} />} onClick={() => void saveRegion()}>{editRegion ? 'Save region' : 'Add region'}</Button></>}>
        <div className="form-grid">
          <Field label="Region code" hint={editRegion ? 'Region codes are immutable.' : 'Short unique code, e.g. REG-JB.'}>
            <input className="input mono" value={regionForm.code} disabled={Boolean(editRegion)} onChange={(e) => setRegionForm({ ...regionForm, code: e.target.value })} placeholder="REG-JB" />
          </Field>
          <Field label="Region name"><input className="input" value={regionForm.name} onChange={(e) => setRegionForm({ ...regionForm, name: e.target.value })} placeholder="West Java" /></Field>
          <Field label="Timezone" className="span-2">
            <select className="input" value={regionForm.timezone} onChange={(e) => setRegionForm({ ...regionForm, timezone: e.target.value })}>
              {['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'UTC'].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </Field>
          <p className="form-note span-2">Plants are assigned to a region when the site is created. Regional managers automatically inherit every plant in their region.</p>
        </div>
      </Modal>
    </div>
  );
}
