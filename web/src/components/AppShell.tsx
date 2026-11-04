import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Map, Building2, LineChart, Sun, BatteryCharging, PlugZap, Gauge,
  Bell, ClipboardList, FileText, Router, Cpu, SlidersHorizontal, Users, ScrollText,
  Settings, Activity, LogOut, Menu, X, ChevronRight, ShieldCheck, Radio, WifiOff,
  Moon,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useRealtime } from '../lib/ws';
import { api } from '../lib/api';
import { cn, dateTime, sourceLabel } from '../lib/format';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string }>;
  perm: string;
  end?: boolean;
  badge?: string;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    group: 'Monitoring',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, perm: 'site:view', end: true },
      { to: '/map', label: 'Live Map', icon: Map, perm: 'site:view' },
      { to: '/sites', label: 'Sites', icon: Building2, perm: 'site:view' },
    ],
  },
  {
    group: 'Performance',
    items: [
      { to: '/analytics', label: 'Energy Analytics', icon: LineChart, perm: 'analytics:view' },
      { to: '/pv', label: 'PV Performance', icon: Sun, perm: 'analytics:view' },
      { to: '/bess', label: 'BESS Analytics', icon: BatteryCharging, perm: 'analytics:view' },
      { to: '/grid', label: 'Grid & Generator', icon: PlugZap, perm: 'analytics:view' },
      { to: '/load', label: 'Load Analysis', icon: Gauge, perm: 'analytics:view' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { to: '/alarms', label: 'Alarms', icon: Bell, perm: 'alarm:view', badge: 'alarms' },
      { to: '/events', label: 'Events', icon: ClipboardList, perm: 'alarm:view' },
      { to: '/reports', label: 'Reports', icon: FileText, perm: 'report:view' },
    ],
  },
  {
    group: 'Assets & Connectivity',
    items: [
      { to: '/gateways', label: 'Edge Gateways', icon: Router, perm: 'gateway:view' },
      { to: '/devices', label: 'Devices', icon: Cpu, perm: 'device:view' },
      { to: '/modbus', label: 'Modbus Mapping', icon: SlidersHorizontal, perm: 'modbus:view' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/users', label: 'Users & Roles', icon: Users, perm: 'user:view' },
      { to: '/audit', label: 'Audit Trail', icon: ScrollText, perm: 'audit:view' },
      { to: '/settings', label: 'Settings', icon: Settings, perm: 'settings:manage' },
      { to: '/system', label: 'System Health', icon: Activity, perm: 'site:view' },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, has } = useAuth();
  const { connected, lastEvent, portfolio } = useRealtime();
  const [mobile, setMobile] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [alarmCount, setAlarmCount] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('chsms-theme') === 'light' ? 'light' : 'dark',
  );
  const location = useLocation();
  const navigate = useNavigate();

  const loadAlarms = useMemo(() => async () => {
    try {
      const data = await api<{ active: number }>('/api/alarms/stats');
      setAlarmCount(data.active || 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadAlarms(); const t = setInterval(loadAlarms, 30000); return () => clearInterval(t); }, [loadAlarms]);
  useEffect(() => { if (lastEvent?.type === 'alarm' || lastEvent?.type === 'alarm_resolved' || lastEvent?.type === 'alarm_counts') void loadAlarms(); }, [lastEvent, loadAlarms]);
  useEffect(() => { setMobile(false); setUserMenu(false); }, [location.pathname]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('chsms-theme', theme);
  }, [theme]);

  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => has(i.perm)) })).filter((g) => g.items.length);
  const title = useMemo(() => {
    const match = NAV.flatMap((g) => g.items).find((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to) && i.to !== '/'));
    if (location.pathname.startsWith('/sites/')) return 'Site Detail';
    return match?.label || 'Overview';
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <aside className={cn('sidebar', mobile && 'open')}>
        <div className="brand">
          <div className="brand-mark"><Sun size={20} /></div>
          <div>
            <strong>CHSMS</strong>
            <span>Hybrid Solar SCADA</span>
          </div>
          <button className="icon-btn mobile-only" onClick={() => setMobile(false)} aria-label="Close navigation"><X size={16} /></button>
        </div>
        <div className="side-status">
          <span className={cn('dot', connected ? 'good' : 'bad')} />
          <span>{import.meta.env.VITE_STATIC_DEMO === 'true' ? 'Synthetic demo data' : connected ? 'Realtime link active' : 'Realtime disconnected'}</span>
          {portfolio && <em>{portfolio.onlineSites}/{portfolio.onlineSites + portfolio.offlineSites}</em>}
        </div>
        <nav className="nav">
          {nav.map((group) => (
            <div className="nav-group" key={group.group}>
              <div className="nav-label">{group.group}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cn('nav-item', isActive && 'active')}>
                    <Icon size={16} />
                    <span>{item.label}</span>
                    {item.badge === 'alarms' && alarmCount > 0 && <span className="nav-badge">{alarmCount > 99 ? '99+' : alarmCount}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <ShieldCheck size={14} />
          <div>
            <span>Read-only monitoring</span>
            <small>No remote equipment control</small>
          </div>
        </div>
      </aside>

      {mobile && <div className="scrim" onClick={() => setMobile(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setMobile(true)} aria-label="Open navigation"><Menu size={18} /></button>
          <div className="crumb"><span>CHSMS</span><ChevronRight size={13} /><strong>{title}</strong></div>
          <div className="topbar-right">
            <span className={cn('live-chip', import.meta.env.VITE_STATIC_DEMO === 'true' ? 'demo' : connected ? 'on' : 'off')}>
              {import.meta.env.VITE_STATIC_DEMO === 'true'
                ? <><WifiOff size={12} /> DEMO</>
                : connected ? <><Radio size={12} /> LIVE</> : <><WifiOff size={12} /> RETRYING</>}
            </span>
            <span className="clock">{dateTime(new Date().toISOString())}</span>
            <button
              className="icon-btn theme-toggle"
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <NavLink to="/alarms" className="icon-btn alarm-btn" aria-label="Alarms">
              <Bell size={17} />
              {alarmCount > 0 && <i>{alarmCount > 99 ? '99+' : alarmCount}</i>}
            </NavLink>
            <div className="user-wrap">
              <button className="user-btn" onClick={() => setUserMenu((v) => !v)}>
                <span className="avatar">{(user?.fullName || user?.username || '?').slice(0, 2).toUpperCase()}</span>
                <span className="user-meta"><strong>{user?.fullName}</strong><small>{user?.roleName}</small></span>
              </button>
              {userMenu && (
                <div className="user-menu">
                  <div className="user-menu-head">
                    <strong>{user?.username}</strong>
                    <span>{user?.email || '—'}</span>
                    <small>{user?.sites.length || 0} authorized sites · {sourceLabel('LIVE')}</small>
                  </div>
                  <button onClick={() => navigate('/system')}><Activity size={14} /> System health</button>
                  <button onClick={() => navigate('/settings')}><Settings size={14} /> Settings</button>
                  <button onClick={() => void logout()} className="danger"><LogOut size={14} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content">
          {import.meta.env.VITE_STATIC_DEMO === 'true' && (
            <div className="demo-banner">
              Public visual demo · synthetic sample data only · no backend, login, database, MQTT, or live telemetry
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
