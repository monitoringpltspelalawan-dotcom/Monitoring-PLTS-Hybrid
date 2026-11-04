import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Sun, ShieldCheck, Lock, User, ArrowRight, Radio, BatteryCharging, Activity, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../lib/auth';

const DEMO_USERS = [
  { username: 'admin', password: 'Admin@12345', role: 'SUPER_ADMIN', label: 'Super Administrator' },
  { username: 'corpadmin', password: 'Corp@12345', role: 'CORPORATE_ADMIN', label: 'Corporate Administrator' },
  { username: 'regional', password: 'Regional@12345', role: 'REGIONAL_MANAGER', label: 'Regional Manager' },
  { username: 'siteadmin', password: 'Site@12345', role: 'SITE_ADMIN', label: 'Site Administrator' },
  { username: 'operator', password: 'Operator@123', role: 'OPERATOR', label: 'Operator' },
  { username: 'viewer', password: 'Viewer@12345', role: 'VIEWER', label: 'Viewer' },
];

export default function Login() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Admin@12345');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = (location.state as any)?.from || '/';

  useEffect(() => { document.title = 'Sign in — CHSMS'; }, []);

  if (!loading && user) return <Navigate to={from} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="login-grid" />
        <div className="login-brand">
          <div className="brand-mark lg"><Sun size={26} /></div>
          <div>
            <strong>CHSMS</strong>
            <span>Centralized Hybrid Solar Monitoring System</span>
          </div>
        </div>
        <div className="login-copy">
          <div className="eyebrow">Enterprise multi-site SCADA</div>
          <h1>Every kilowatt.<br /><em>One command view.</em></h1>
          <p>
            Unified monitoring for hybrid solar PV, battery storage, PLN grid connections and backup generators
            across 22 sites — secured, read-only and built for operations.
          </p>
          <div className="login-features">
            <div><Radio size={15} /><span>Live telemetry over MQTT/TLS &amp; WebSocket</span></div>
            <div><BatteryCharging size={15} /><span>Rack-level BESS and inverter analytics</span></div>
            <div><Activity size={15} /><span>Alarms, audit trail and board-ready reports</span></div>
            <div><ShieldCheck size={15} /><span>RBAC with regional and site-level scoping</span></div>
          </div>
        </div>
        <div className="login-visual-foot">
          <span className="pill"><i className="dot good" /> Platform operational</span>
          <span>Read-only monitoring · No remote equipment control</span>
        </div>
      </div>

      <div className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <header>
            <div className="eyebrow">Secure access</div>
            <h2>Sign in to the control room</h2>
            <p>Use your corporate account or one of the demo profiles below.</p>
          </header>

          {error && (
            <div className="login-error"><AlertTriangle size={15} /><span>{error}</span></div>
          )}

          <label className="field">
            <span className="field-label">Username</span>
            <span className="input-icon">
              <User size={15} />
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </span>
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <span className="input-icon">
              <Lock size={15} />
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </span>
          </label>

          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}
            {busy ? 'Authenticating…' : 'Sign in'}
          </button>

          <div className="demo-divider"><span>Demo profiles · password shown for evaluation</span></div>
          <div className="demo-users">
            {DEMO_USERS.map((u) => (
              <button
                key={u.username}
                type="button"
                className={username === u.username ? 'active' : ''}
                onClick={() => { setUsername(u.username); setPassword(u.password); setError(null); }}
              >
                <strong>{u.role}</strong>
                <small>{u.username} · {u.password}</small>
              </button>
            ))}
          </div>
          <p className="login-foot">Sessions expire automatically. All actions are recorded in the audit trail.</p>
        </form>
      </div>
    </div>
  );
}
