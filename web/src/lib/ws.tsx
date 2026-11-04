import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth';
import { demoLivePortfolio, demoLiveSites } from './demoApi';

export interface LiveSnapshot {
  siteId: string;
  siteCode: string;
  siteName: string;
  ts: string;
  stale?: boolean;
  commStatus?: string;
  dataSource?: string;
  quality?: string;
  pv?: { powerKw?: number | null; dailyKwh?: number | null; irradianceWm2?: number | null; performanceRatio?: number | null; inverters?: any[] };
  bess?: { socPct?: number | null; sohPct?: number | null; powerKw?: number | null; chargePowerKw?: number | null; dischargePowerKw?: number | null; temperatureC?: number | null; bmsStatus?: string; racks?: any[] };
  grid?: { available?: boolean; activePowerKw?: number | null; importKw?: number | null; exportKw?: number | null; voltageL1V?: number | null; frequencyHz?: number | null };
  generator?: { present?: boolean; running?: boolean; powerKw?: number | null; fuelLevelPct?: number | null; capacityKw?: number | null };
  load?: { powerKw?: number | null; powerFactor?: number | null };
  flow?: { pvKw?: number; batteryKw?: number; gridKw?: number; generatorKw?: number; loadKw?: number };
  energy?: Record<string, number | null>;
  gateway?: any;
}

export interface LivePortfolio {
  pvPowerMw: number; loadPowerMw: number; chargePowerMw: number; dischargePowerMw: number;
  gridImportMw: number; gridExportMw: number; generatorPowerMw: number; avgSocPct: number;
  onlineSites: number; offlineSites: number; ts: string;
}

interface RealtimeContextValue {
  connected: boolean;
  portfolio: LivePortfolio | null;
  sites: Map<string, LiveSnapshot>;
  lastEvent: any;
  alarmFeed: any[];
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false, portfolio: null, sites: new Map(), lastEvent: null, alarmFeed: [],
});

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [portfolio, setPortfolio] = useState<LivePortfolio | null>(null);
  const [sites, setSites] = useState<Map<string, LiveSnapshot>>(new Map());
  const [lastEvent, setLastEvent] = useState<any>(null);
  const [alarmFeed, setAlarmFeed] = useState<any[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user) {
      setConnected(false);
      setSites(new Map());
      setPortfolio(null);
      return;
    }
    if (import.meta.env.VITE_STATIC_DEMO === 'true') {
      const publish = () => {
        setConnected(true);
        setPortfolio(demoLivePortfolio());
        setSites(new Map(demoLiveSites().map((site) => [site.siteId, site])));
      };
      publish();
      const timer = window.setInterval(publish, 5000);
      return () => window.clearInterval(timer);
    }
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      socketRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: 'subscribe', portfolio: true, siteIds: user.siteIds }));
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'hello' && Array.isArray(msg.sites)) {
            setSites(new Map(msg.sites.map((s: LiveSnapshot) => [s.siteId, s])));
          } else if (msg.type === 'tick') {
            if (msg.portfolio) setPortfolio(msg.portfolio);
            if (Array.isArray(msg.sites)) setSites(new Map(msg.sites.map((s: LiveSnapshot) => [s.siteId, s])));
          } else if (msg.type === 'alarm') {
            setAlarmFeed((prev) => [msg.alarm, ...prev].slice(0, 30));
            setLastEvent(msg);
          } else if (msg.type === 'alarm_resolved' || msg.type === 'alarm_updated' || msg.type === 'alarm_counts' || msg.type === 'site_status') {
            setLastEvent(msg);
          }
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) retryRef.current = window.setTimeout(connect, 4000);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    };

    connect();
    return () => {
      cancelled = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [user]);

  useEffect(() => {
    if (!user) setAlarmFeed([]);
  }, [user]);

  const value = useMemo(() => ({ connected, portfolio, sites, lastEvent, alarmFeed }), [connected, portfolio, sites, lastEvent, alarmFeed]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

export function useSiteLive(siteId: string | undefined) {
  const { sites } = useRealtime();
  return siteId ? sites.get(siteId) || null : null;
}
