import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: User }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: { username, password } });
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    setUser(null);
    window.location.href = '/login';
  }, []);

  const has = useCallback((permission: string) => Boolean(user?.permissions?.includes(permission)), [user]);

  const value = useMemo(() => ({ user, loading, login, logout, refresh, has }), [user, loading, login, logout, refresh, has]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
