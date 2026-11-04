import { WebSocketServer } from 'ws';
import { SESSION_COOKIE, resolveToken } from './authService.js';
import { getAllLive, publicSnapshot } from './liveStore.js';
import { getDb } from '../db/adapter.js';
import { nowIso } from '../lib/time.js';

let wss = null;
let tickTimer = null;
const clients = new Set();

function parseCookie(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

export function initRealtime(server) {
  if (wss) return wss;
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (socket, req) => {
    const url = new URL(req.url, 'http://localhost');
    const cookies = parseCookie(req.headers.cookie || '');
    const token = url.searchParams.get('token') || cookies[SESSION_COOKIE];
    const user = await resolveToken(token).catch(() => null);
    if (!user) {
      socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
      socket.close(1008, 'Unauthorized');
      return;
    }
    const client = {
      socket,
      user,
      sites: new Set(user.siteIds),
      portfolio: true,
      alive: true,
    };
    clients.add(client);
    socket.on('pong', () => { client.alive = true; });
    socket.on('message', (buf) => {
      try {
        const msg = JSON.parse(buf.toString());
        if (msg.type === 'subscribe') {
          client.portfolio = msg.portfolio !== false;
          if (Array.isArray(msg.siteIds)) client.sites = new Set(msg.siteIds.filter((id) => user.siteIds.includes(id)));
        }
      } catch {
        /* ignore malformed client messages */
      }
    });
    socket.on('close', () => clients.delete(client));
    socket.on('error', () => clients.delete(client));

    const snapshots = getAllLive()
      .filter((s) => user.siteIds.includes(s.siteId))
      .map(publicSnapshot);
    socket.send(JSON.stringify({ type: 'hello', user: { id: user.id, username: user.username, role: user.role }, sites: snapshots, ts: nowIso() }));
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      try { client.socket.ping(); } catch { /* ignore */ }
    }
  }, 30_000);
  heartbeat.unref?.();

  tickTimer = setInterval(() => {
    if (!clients.size) return;
    const all = getAllLive();
    const overview = summarizeLive(all);
    for (const client of clients) {
      if (client.socket.readyState !== 1) continue;
      const sites = client.portfolio
        ? all.filter((s) => client.sites.has(s.siteId)).map(publicSnapshot)
        : all.filter((s) => client.sites.has(s.siteId)).map(publicSnapshot);
      try {
        client.socket.send(JSON.stringify({ type: 'tick', ts: nowIso(), portfolio: overview, sites }));
      } catch { /* ignore */ }
    }
  }, 3000);
  tickTimer.unref?.();

  console.log('[ws] realtime hub ready at /ws');
  return wss;
}

function summarizeLive(all) {
  const sum = (fn) => all.reduce((acc, s) => acc + (Number(fn(s)) || 0), 0);
  return {
    pvPowerMw: sum((s) => s.pv?.powerKw) / 1000,
    loadPowerMw: sum((s) => s.load?.powerKw) / 1000,
    chargePowerMw: sum((s) => s.bess?.chargePowerKw) / 1000,
    dischargePowerMw: sum((s) => s.bess?.dischargePowerKw) / 1000,
    gridImportMw: sum((s) => s.grid?.importKw) / 1000,
    gridExportMw: sum((s) => s.grid?.exportKw) / 1000,
    generatorPowerMw: sum((s) => s.generator?.powerKw) / 1000,
    avgSocPct: all.length ? sum((s) => s.bess?.socPct) / all.filter((s) => s.bess?.socPct != null).length || 0 : 0,
    onlineSites: all.filter((s) => s.commStatus !== 'OFFLINE' && !s.stale).length,
    offlineSites: all.filter((s) => s.commStatus === 'OFFLINE' || s.stale).length,
    ts: nowIso(),
  };
}

export function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.socket.readyState === 1) {
      try { client.socket.send(payload); } catch { /* ignore */ }
    }
  }
}

export async function broadcastAlarm(alarm) {
  broadcast({ type: 'alarm', alarm, ts: nowIso() });
  // keep a cached open-alarm count for fast portfolio headers
  try {
    const db = getDb();
    const rows = await db.all("SELECT severity, COUNT(*) AS c FROM alarms WHERE status != 'RESOLVED' GROUP BY severity");
    const counts = Object.fromEntries(rows.map((r) => [r.severity, Number(r.c)]));
    broadcast({ type: 'alarm_counts', counts, ts: nowIso() });
  } catch { /* ignore */ }
}

export function realtimeStats() {
  return { clients: clients.size, path: '/ws' };
}
