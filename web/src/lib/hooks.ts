import { useCallback, useEffect, useRef, useState } from 'react';
import { get, qs } from './api';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Small data-loading hook: keeps the previous payload while a refresh is in flight. */
export function useAsync<T>(loader: () => Promise<T>, deps: React.DependencyList = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loaderRef.current()
      .then((payload) => { if (alive) { setData(payload); setError(null); } })
      .catch((err) => { if (alive) setError(err?.message || 'Failed to load data'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

export interface SiteLite {
  id: string;
  code: string;
  name: string;
  regionId?: string | null;
  regionName?: string | null;
  status?: string;
  dataSource?: string;
  pvCapacityKwp?: number;
  bessCapacityKwh?: number;
  latitude?: number;
  longitude?: number;
  location?: string;
  live?: any;
}

/** Authorized sites for filter controls (single request per page). */
export function useSites() {
  return useAsync<{ sites: SiteLite[]; total: number; dataSources?: { demo: number; live: number } }>(
    () => get(`/api/sites${qs({})}`),
    [],
  );
}

export function useRegions() {
  return useAsync<{ regions: Array<{ id: string; code: string; name: string; timezone: string; siteCount: number }> }>(
    () => get('/api/sites/regions'),
    [],
  );
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function appDay(offset = 0): string {
  return new Date(Date.now() - offset * 86400_000).toISOString().slice(0, 10);
}
