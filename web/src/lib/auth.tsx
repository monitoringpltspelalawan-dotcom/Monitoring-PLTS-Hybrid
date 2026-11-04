import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { demoSiteList } from './demoApi';

export interface UserSite { id: string; code: string; name: string; region_id?: string }
export interface User {
  id: string; username: string; fullName: string; email?: string; role: string; roleName: string;
  permissions: string[]; regionId?: string | null; timezone: string; siteIds: string[]; sites: UserSite[];
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  has: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STATIC_DEMO_USER: User = {
  id: 'public-demo-user',
  username: 'demo-viewer',
  fullName: 'Public Demo Viewer',
  email: 'demo@example.invalid',
  role: 'SUPER_ADMIN',
  roleName: 'Public Demo · simulated access',
  permissions: [
    'site:view', 'site:manage', 'site:delete', 'analytics:view', 'alarm:view', 'alarm:ack',
    'alarm:resolve', 'alarm:rule:manage', 'report:view', 'report:generate', 'report:schedule',
    'gateway:view', 'gateway:manage', 'gateway:delete', 'gateway:token:rotate',
    'device:view', 'device:manage', 'device:delete', 'modbus:view', 'modbus:manage',
    'modbus:test', 'user:view', 'user:manage', 'user:delete', 'audit:view',
    'settings:manage',
  ],
  timezone: 'Asia/Jakarta',
  siteIds: demoSiteList.map((site) => site.id),
  sites: demoSiteList.map((site) => ({ id: site.id, code: site.code, name: site.name, region_id: site.region_id })),
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const staticDemo = import.meta.env.VITE_STATIC_DEMO === 'true';
  const [user, setUser] = useState<User | null>(staticDemo ? STATIC_DEMO_USER : null);
  const [loading, setLoading] = useState(!staticDemo);

  const refresh = useCallback(async () => {
    if (staticDemo) {
      setUser(STATIC_DEMO_USER);
      setLoading(false);
      return;
    }
    try {
      const data = await api<{ user: User }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [staticDemo]);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    if (staticDemo) {
      setUser(STATIC_DEMO_USER);
      return;
    }
    const data = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: { username, password } });
    setUser(data.user);
  }, [staticDemo]);

  const logout = useCallback(async () => {
    if (staticDemo) return;
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    setUser(null);
    window.location.href = '/login';
  }, [staticDemo]);

  const has = useCallback((permission: string) => Boolean(user?.permissions?.includes(permission)), [user]);

  const value = useMemo(() => ({ user, loading, login, logout, refresh, has }), [user, loading, login, logout, refresh, has]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
