import React, { useEffect, useMemo, useState } from 'react';
import {
  Users as UsersIcon, Plus, RefreshCw, Search, Pencil, Trash2, KeyRound, ShieldCheck, UserCheck,
  MonitorSmartphone, AlertTriangle, LockKeyhole, Check, Building2,
} from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, KV, Modal, Notice, PageHeader, Pagination,
  Spinner, StatCard, Tabs,
} from '../components/ui';
import { Column, DataTable, SiteSelector } from '../components/filters';
import { useAsync, useDebounced } from '../lib/hooks';
import { del, get, patch, post, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn, dateTime, timeAgo } from '../lib/format';

type Tab = 'users' | 'roles' | 'sessions';

const ROLES = ['SUPER_ADMIN', 'CORPORATE_ADMIN', 'REGIONAL_MANAGER', 'SITE_ADMIN', 'OPERATOR', 'VIEWER'];
const ACCOUNT_STATUS = ['ACTIVE', 'SUSPENDED', 'LOCKED'];
const EMPTY_USER = {
  username: '', fullName: '', email: '', role: 'VIEWER', regionId: '', status: 'ACTIVE', timezone: 'Asia/Jakarta',
  password: '', confirm: '',
};

export default function Users() {
  const { user, has } = useAuth();
  const isSuper = user?.role === 'SUPER_ADMIN';
  const canManage = has('user:manage');

  const [tab, setTab] = useState<Tab>('users');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [form, setForm] = useState<any>({ ...EMPTY_USER });
  const [formSiteIds, setFormSiteIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const [resetTarget, setResetTarget] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');

  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const users = useAsync<any>(() => get(`/api/users${qs({ role, status, search: debounced, page, pageSize })}`), [role, status, debounced, page]);
  const roles = useAsync<any>(() => get('/api/users/roles'), []);
  const sessions = useAsync<any>(() => get('/api/users/sessions/active'), []);
  const sitesState = useAsync<any>(() => get('/api/sites'), []);

  useEffect(() => { setPage(1); }, [role, status, debounced]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const rows = users.data?.users || [];
  const total = users.data?.total || 0;
  const roleList = roles.data?.roles || [];
  const availableRoles = useMemo(() => roleList.filter((r: any) => isSuper || r.code !== 'SUPER_ADMIN'), [roleList, isSuper]);
  const regions = users.data?.regions || [];
  const sites = sitesState.data?.sites || [];
  const sessionRows = sessions.data?.sessions || [];

  const openCreate = () => {
    setEditTarget(null);
    setForm({ ...EMPTY_USER, role: 'VIEWER' });
    setFormSiteIds([]);
    setFormError(null);
    setCreateOpen(true);
  };

  const openEdit = (row: any) => {
    setEditTarget(row);
    setForm({
      username: row.username, fullName: row.full_name, email: row.email || '', role: row.role,
      regionId: row.region_code ? regions.find((r: any) => r.code === row.region_code)?.id || '' : '',
      status: row.status, timezone: row.timezone || 'Asia/Jakarta', password: '', confirm: '',
    });
    setFormSiteIds((row.sites || []).map((s: any) => s.id));
    setFormError(null);
    setCreateOpen(true);
  };

  const saveUser = async () => {
    setBusy(true);
    setFormError(null);
    try {
      if (editTarget) {
        await patch(`/api/users/${editTarget.id}`, {
          fullName: form.fullName, email: form.email || null, role: form.role, status: form.status,
          timezone: form.timezone, regionId: form.role === 'REGIONAL_MANAGER' ? form.regionId || null : null,
          siteIds: form.role === 'REGIONAL_MANAGER' ? undefined : formSiteIds,
        });
        setToast({ tone: 'success', text: `${form.fullName} updated.` });
      } else {
        if (form.password !== form.confirm) throw new Error('Password confirmation does not match');
        await post('/api/users', {
          username: form.username, fullName: form.fullName, email: form.email || undefined, role: form.role,
          password: form.password, timezone: form.timezone,
          regionId: form.role === 'REGIONAL_MANAGER' ? form.regionId || undefined : undefined,
          siteIds: form.role === 'REGIONAL_MANAGER' ? undefined : formSiteIds,
        });
        setToast({ tone: 'success', text: `${form.fullName} created.` });
      }
      setCreateOpen(false);
      users.reload();
      roles.reload();
      sessions.reload();
    } catch (err: any) {
      setFormError(err?.message || 'Could not save user');
    } finally { setBusy(false); }
  };

  const resetPassword = async () => {
    if (!resetTarget) return;
    if (newPassword !== newPasswordConfirm) {
      setToast({ tone: 'error', text: 'Password confirmation does not match' });
      return;
    }
    setBusy(true);
    try {
      await post(`/api/users/${resetTarget.id}/reset-password`, { newPassword });
      setResetTarget(null);
      setNewPassword('');
      setNewPasswordConfirm('');
      sessions.reload();
      setToast({ tone: 'success', text: `Password reset for ${resetTarget.username}. All sessions revoked.` });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Password reset failed' });
    } finally { setBusy(false); }
  };

  const removeUser = async (row: any) => {
    if (!window.confirm(`Delete user account “${row.username}”? This action is audited and cannot be undone.`)) return;
    setBusy(true);
    try {
      await del(`/api/users/${row.id}`);
      setDetail(null);
      users.reload();
      roles.reload();
      sessions.reload();
      setToast({ tone: 'success', text: `${row.username} deleted.` });
    } catch (err: any) {
      setToast({ tone: 'error', text: err?.message || 'Could not delete user' });
    } finally { setBusy(false); }
  };

  const columns: Column<any>[] = [
    {
      key: 'username', label: 'Account',
      render: (u) => (
        <div className="cell-main">
          <strong>{u.username}</strong>
          <small>{u.full_name}{u.email ? ` · ${u.email}` : ''}</small>
        </div>
      ),
    },
    { key: 'role', label: 'Role', render: (u) => <Badge color="var(--info)">{u.role_name}</Badge> },
    { key: 'region_name', label: 'Region', render: (u) => <span className="muted">{u.region_name || '—'}</span> },
    {
      key: 'sites', label: 'Site scope',
      render: (u) => u.role === 'REGIONAL_MANAGER' ? <span className="muted">Region-wide</span>
        : u.sites?.length ? <span className="muted">{u.sites.length} site{u.sites.length === 1 ? '' : 's'}</span>
          : <span className="muted">All authorized</span>,
    },
    { key: 'status', label: 'Status', render: (u) => <Badge status={u.status}>{u.status}</Badge> },
    { key: 'last_login_at', label: 'Last login', align: 'right', render: (u) => <span className="muted">{u.last_login_at ? timeAgo(u.last_login_at) : 'Never'}</span> },
    {
      key: 'actions', label: '', align: 'right',
      render: (u) => (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => openEdit(u)}>Edit</Button>
          {canManage && <Button size="sm" variant="ghost" icon={<KeyRound size={12} />} onClick={() => { setResetTarget(u); setNewPassword(''); setNewPasswordConfirm(''); }}>Reset</Button>}
        </span>
      ),
    },
  ];

  const sessionColumns: Column<any>[] = [
    { key: 'username', label: 'User', render: (s) => <div className="cell-main"><strong>{s.username}</strong><small>{s.full_name}</small></div> },
    { key: 'id', label: 'Session', render: (s) => <span className="mono small">{s.id}</span> },
    { key: 'ip', label: 'Address', render: (s) => <span className="mono">{s.ip || '—'}</span> },
    { key: 'user_agent', label: 'Client', render: (s) => <span className="muted small">{s.user_agent || '—'}</span> },
    { key: 'created_at', label: 'Created', render: (s) => <span className="mono small">{dateTime(s.created_at)}</span> },
    { key: 'expires_at', label: 'Expires', align: 'right', render: (s) => <span className="mono small">{dateTime(s.expires_at)}</span> },
  ];

  const activeUsers = rows.filter((u: any) => u.status === 'ACTIVE').length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="Users & roles"
        subtitle="Role-based access with site scoping, session control and a complete audit trail."
        actions={<>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => { users.reload(); roles.reload(); sessions.reload(); }}>Refresh</Button>
          {canManage && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={openCreate}>New user</Button>}
        </>}
      />

      {toast && <Notice tone={toast.tone} onClose={() => setToast(null)}>{toast.text}</Notice>}

      <div className="grid stats-grid compact">
        <StatCard label="User accounts" value={total} icon={<UsersIcon size={16} />} sub={<span>{activeUsers} active on this page</span>} />
        <StatCard label="Role definitions" value={roleList.length} icon={<ShieldCheck size={16} />} sub={<span>Least-privilege permission matrix</span>} />
        <StatCard label="Active sessions" value={sessionRows.length} icon={<MonitorSmartphone size={16} />} sub={<span>Opaque hashed session tokens</span>} />
        <StatCard label="Site-scoped accounts" value={rows.filter((u: any) => (u.sites || []).length || u.region_code).length} icon={<Building2 size={16} />} sub={<span>Regional and site assignments</span>} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'users', label: 'User accounts', count: total },
          { value: 'roles', label: 'Roles & permissions', count: roleList.length },
          { value: 'sessions', label: 'Active sessions', count: sessionRows.length },
        ]}
      />

      {tab === 'users' && (
        <>
          <div className="filter-bar">
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role filter">
              <option value="">All roles</option>
              {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
              <option value="">Any status</option>
              {ACCOUNT_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <label className="search grow"><Search size={14} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search username, name or email…" /></label>
          </div>
          {users.error && <ErrorState error={users.error} onRetry={users.reload} />}
          <Card title="Directory" subtitle="Accounts inherit permissions from their role and site assignment" noPad>
            {users.loading && !users.data ? <Spinner label="Loading user directory…" /> : (
              <DataTable columns={columns} rows={rows} onRowClick={(u) => setDetail(u)} dense />
            )}
            <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
          </Card>
          {!users.loading && !rows.length && <EmptyState title="No matching accounts" message="Adjust the filters or create a new user." icon={<UsersIcon size={22} />} />}
        </>
      )}

      {tab === 'roles' && (
        <>
          {roles.error && <ErrorState error={roles.error} onRetry={roles.reload} />}
          <div className="grid two-col">
            {roleList.map((r: any) => (
              <Card key={r.id} title={r.name} subtitle={r.description} actions={<Badge color="var(--info)" dot={false}>{r.userCount} user{r.userCount === 1 ? '' : 's'}</Badge>}>
                <div className="permission-chips">
                  {r.permissions.map((p: string) => <span className="perm-chip" key={p}>{p}</span>)}
                </div>
                {r.code === 'SUPER_ADMIN' && <p className="field-hint">Destructive and security-sensitive operations are restricted to this role.</p>}
              </Card>
            ))}
          </div>
          <div className="mini-strip">
            <span><ShieldCheck size={14} /> Permissions are enforced server-side on every route; the UI only hides unavailable actions.</span>
          </div>
        </>
      )}

      {tab === 'sessions' && (
        <>
          {sessions.error && <ErrorState error={sessions.error} onRetry={sessions.reload} />}
          <Card title="Active sessions" subtitle="Sessions are revoked on password reset, suspension or sign-out" noPad>
            {sessions.loading && !sessions.data ? <Spinner label="Loading sessions…" /> : (
              <DataTable columns={sessionColumns} rows={sessionRows} dense />
            )}
          </Card>
          {!sessions.loading && !sessionRows.length && <EmptyState title="No active sessions" message="Sign in from a browser to establish a session." icon={<MonitorSmartphone size={22} />} />}
        </>
      )}

      <Modal open={!!detail} title={detail ? `${detail.full_name}` : 'Account'} onClose={() => setDetail(null)}
        footer={<>
          <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
          {canManage && detail && <>
            <Button variant="ghost" icon={<KeyRound size={14} />} onClick={() => { setResetTarget(detail); setNewPassword(''); setNewPasswordConfirm(''); }}>Reset password</Button>
            {detail.username !== 'admin' && detail.id !== user?.id && <Button variant="danger" icon={<Trash2 size={14} />} loading={busy} onClick={() => void removeUser(detail)}>Delete account</Button>}
          </>}
        </>}>
        {detail && <>
          <div className="detail-head">
            <div>
              <div className="eyebrow">{detail.role.replace(/_/g, ' ')}</div>
              <h3>{detail.full_name}</h3>
              <p>{detail.email || 'No email on file'} · {detail.timezone}</p>
            </div>
            <Badge status={detail.status}>{detail.status}</Badge>
          </div>
          <KV items={[
            { label: 'Username', value: <span className="mono">{detail.username}</span> },
            { label: 'Role', value: detail.role_name },
            { label: 'Region', value: detail.region_name || '—' },
            { label: 'Status', value: detail.status },
            { label: 'Last login', value: detail.last_login_at ? dateTime(detail.last_login_at) : 'Never' },
            { label: 'Created', value: dateTime(detail.created_at) },
          ]} />
          <div className="section-label">Site scope</div>
          {detail.role === 'REGIONAL_MANAGER' ? (
            <p className="muted">Regional access — every plant in {detail.region_name || 'the assigned region'}.</p>
          ) : (detail.sites || []).length ? (
            <div className="scope-chips">
              {detail.sites.map((s: any) => <span className="scope-chip" key={s.id}><Building2 size={12} /> {s.code}</span>)}
            </div>
          ) : <p className="muted">All sites permitted by the role (portfolio scope).</p>}
          <div className="mini-strip">
            <span><LockKeyhole size={14} /> Session tokens are stored as one-way hashes.</span>
            <span><Check size={14} /> Account changes are written to the audit trail.</span>
          </div>
        </>}
      </Modal>

      <Modal open={createOpen} title={editTarget ? `Edit ${editTarget.username}` : 'Create user account'} onClose={() => setCreateOpen(false)} wide
        footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} icon={<UserCheck size={14} />} onClick={() => void saveUser()}>{editTarget ? 'Save changes' : 'Create user'}</Button></>}>
        <div className="form-grid">
          {formError && <div className="login-error span-2"><AlertTriangle size={15} /> {formError}</div>}
          <Field label="Username" hint={editTarget ? 'Usernames are immutable.' : 'Lower-case, unique directory identifier.'}>
            <input className="input mono" value={form.username} disabled={Boolean(editTarget)} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="j.doe" />
          </Field>
          <Field label="Full name"><input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Jane Doe" /></Field>
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane.doe@company.co.id" /></Field>
          <Field label="Role">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {availableRoles.map((r: any) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
          </Field>
          {form.role === 'REGIONAL_MANAGER' && (
            <Field label="Region" hint="Regional managers automatically cover every plant in the region.">
              <select className="input" value={form.regionId} onChange={(e) => setForm({ ...form, regionId: e.target.value })}>
                <option value="">Select a region</option>
                {regions.map((r: any) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Status">
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {ACCOUNT_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Time zone">
            <select className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'UTC'].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </Field>
          {form.role !== 'REGIONAL_MANAGER' && (
            <div className="span-2">
              <span className="field-label">Site scope</span>
              <SiteSelector sites={sites} selected={formSiteIds} onChange={setFormSiteIds} />
              <p className="field-hint">Leave all sites selected for portfolio-wide access. Site scope narrows every API query.</p>
            </div>
          )}
          {!editTarget && <>
            <Field label="Password" hint="Minimum 10 characters with upper, lower, number and symbol.">
              <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Confirm password">
              <input className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
            </Field>
          </>}
          <p className="form-note span-2">Role assignment is enforced server-side. Only a Super Administrator can create another Super Administrator.</p>
        </div>
      </Modal>

      <Modal open={!!resetTarget} title={`Reset password · ${resetTarget?.username || ''}`} onClose={() => setResetTarget(null)}
        footer={<><Button variant="ghost" onClick={() => setResetTarget(null)}>Cancel</Button><Button variant="primary" loading={busy} icon={<KeyRound size={14} />} onClick={() => void resetPassword()}>Reset password</Button></>}>
        <div className="form-grid">
          <Field label="New password" className="span-2" hint="Minimum 10 characters with upper, lower, number and symbol.">
            <input className="input" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </Field>
          <Field label="Confirm new password" className="span-2">
            <input className="input" type="password" autoComplete="new-password" value={newPasswordConfirm} onChange={(e) => setNewPasswordConfirm(e.target.value)} />
          </Field>
          {newPassword && (
            <div className="span-2 policy-list">
              <span className={newPassword.length >= 10 ? 'ok' : ''}><Check size={12} /> 10+ characters</span>
              <span className={/[A-Z]/.test(newPassword) ? 'ok' : ''}><Check size={12} /> Uppercase</span>
              <span className={/[a-z]/.test(newPassword) ? 'ok' : ''}><Check size={12} /> Lowercase</span>
              <span className={/[0-9]/.test(newPassword) ? 'ok' : ''}><Check size={12} /> Number</span>
              <span className={/[^A-Za-z0-9]/.test(newPassword) ? 'ok' : ''}><Check size={12} /> Symbol</span>
            </div>
          )}
          <p className="form-note span-2">Resetting a password immediately revokes every active session for this account.</p>
        </div>
      </Modal>
    </div>
  );
}
