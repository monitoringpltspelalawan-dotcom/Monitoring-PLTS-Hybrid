import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db/adapter.js';
import { getSimulator } from './simulator.js';
import { getLive, setLive } from './liveStore.js';
import { broadcast } from './realtime.js';
import { nowIso } from '../lib/time.js';
import { round, tokenHash, uid } from '../lib/util.js';

const PARAM_PATHS = {
  pv_power_kw: ['pv', 'powerKw'],
  pv_voltage_v: ['pv', 'voltageV'],
  pv_current_a: ['pv', 'currentA'],
  soc_pct: ['bess', 'socPct'],
  soh_pct: ['bess', 'sohPct'],
  battery_power_kw: ['bess', 'powerKw'],
  battery_temp_c: ['bess', 'temperatureC'],
  battery_voltage_v: ['bess', 'voltageV'],
  grid_power_kw: ['grid', 'activePowerKw'],
  grid_voltage_l1_v: ['grid', 'voltageL1V'],
  grid_frequency_hz: ['grid', 'frequencyHz'],
  load_power_kw: ['load', 'powerKw'],
  generator_power_kw: ['generator', 'powerKw'],
  inverter_power_kw: ['inverter', 'activePowerKw'],
  inverter_temp_c: ['inverter', 'temperatureC'],
};

const gatewayCache = new Map();

export async function findGatewayByCredentials(gatewayId, token) {
  const db = getDb();
  const cached = gatewayCache.get(gatewayId);
  const gateway = cached || (await db.get('SELECT * FROM gateways WHERE id = ?', [gatewayId]));
  if (!gateway) return null;
  gatewayCache.set(gatewayId, gateway);
  if (!gateway.token_hash) return null;
  if (tokenHash(token) !== gateway.token_hash) return null;
  return gateway;
}

export function invalidateGatewayCache(gatewayId) {
  if (gatewayId) gatewayCache.delete(gatewayId);
  else gatewayCache.clear();
}

export function gatewayTopicPrefix(gateway, site) {
  return `plts/${site?.id || gateway.site_id}/${gateway.id}`;
}

function deepSet(obj, pathArr, value) {
  let cur = obj;
  for (let i = 0; i < pathArr.length - 1; i += 1) {
    cur[pathArr[i]] = cur[pathArr[i]] || {};
    cur = cur[pathArr[i]];
  }
  cur[pathArr[pathArr.length - 1]] = value;
}

function defaultSnapshot(site, gateway) {
  return {
    siteId: site.id, siteCode: site.code, siteName: site.name, regionId: site.region_id,
    ts: nowIso(), lastSeenAt: nowIso(), localTime: nowIso(), dataSource: 'LIVE',
    quality: 'GOOD', stale: false, status: site.status, commStatus: 'ONLINE', latencyMs: 0,
    mixedSource: site.data_source === 'DEMO',
    gateway: {
      id: gateway.id, name: gateway.name, serial: gateway.serial, status: 'ONLINE',
      lastSeenAt: nowIso(), latencyMs: 0, backlog: 0, cpuPct: null, memPct: null,
      uptimeSec: null, firmware: gateway.firmware, ipAddress: gateway.ip_address,
    },
    pv: { powerKw: 0, voltageV: null, currentA: null, irradianceWm2: null, dailyKwh: null, monthlyKwh: null, annualKwh: null, inverters: [] },
    inverter: { activePowerKw: 0, reactivePowerKvar: null, apparentPowerKva: null, powerFactor: null, dcVoltageV: null, dcCurrentA: null, acVoltageL1V: null, acVoltageL2V: null, acVoltageL3V: null, acCurrentL1A: null, acCurrentL2A: null, acCurrentL3A: null, frequencyHz: null, temperatureC: null, efficiencyPct: null, status: 'UNKNOWN', faultCode: 0 },
    bess: { capacityKwh: site.bess_capacity_kwh, socPct: null, sohPct: null, voltageV: null, currentA: null, powerKw: 0, chargePowerKw: 0, dischargePowerKw: 0, temperatureC: null, availableKwh: null, remainingKwh: null, bmsStatus: 'NORMAL', racks: [] },
    grid: { available: true, voltageL1V: null, voltageL2V: null, voltageL3V: null, currentL1A: null, currentL2A: null, currentL3A: null, frequencyHz: null, activePowerKw: 0, importKw: 0, exportKw: 0, importKwh: null, exportKwh: null, powerFactor: null, reactivePowerKvar: null, capacityKva: site.grid_capacity_kva },
    generator: { present: (site.generator_count || 0) > 0, running: false, voltageV: null, currentA: null, frequencyHz: null, powerKw: 0, runHours: null, fuelLevelPct: null, status: 'UNKNOWN', capacityKw: site.generator_capacity_kw, energyKwh: null },
    load: { powerKw: 0, requestedKw: null, voltageV: null, currentA: null, frequencyHz: null, energyKwh: null, powerFactor: null, apparentPowerKva: null, peakDemandKw: null },
    flow: { pvKw: 0, batteryKw: 0, gridKw: 0, generatorKw: 0, loadKw: 0 },
    energy: {
      pvTodayKwh: null, pvMonthKwh: null, pvYearKwh: null, chargeTodayKwh: null, dischargeTodayKwh: null,
      loadTodayKwh: null, importTodayKwh: null, exportTodayKwh: null, generatorTodayKwh: null, peakLoadKw: null,
    },
  };
}

function deriveFlow(snap) {
  const pv = Number(snap.pv?.powerKw) || 0;
  const battery = Number(snap.bess?.powerKw);
  const batteryKw = Number.isFinite(battery) ? battery : (Number(snap.bess?.dischargePowerKw) || 0) - (Number(snap.bess?.chargePowerKw) || 0);
  const gen = Number(snap.generator?.powerKw) || 0;
  const grid = Number(snap.grid?.activePowerKw);
  const gridKw = Number.isFinite(grid) ? grid : (Number(snap.grid?.importKw) || 0) - (Number(snap.grid?.exportKw) || 0);
  const load = Number(snap.load?.powerKw) || 0;
  snap.flow = {
    pvKw: round(pv), batteryKw: round(batteryKw), gridKw: round(gridKw), generatorKw: round(gen), loadKw: round(load),
  };
  if (snap.bess) {
    snap.bess.chargePowerKw = round(Math.max(0, -batteryKw));
    snap.bess.dischargePowerKw = round(Math.max(0, batteryKw));
    snap.bess.powerKw = round(batteryKw);
  }
  if (snap.grid) {
    snap.grid.importKw = round(Math.max(0, gridKw));
    snap.grid.exportKw = round(Math.max(0, -gridKw));
    snap.grid.activePowerKw = round(gridKw);
  }
  return snap;
}

export async function ingestTelemetry({ gatewayId, siteId, seq, ts, measurements = [], snapshot = null, source = 'MQTT' }) {
  const db = getDb();
  const gateway = await db.get('SELECT * FROM gateways WHERE id = ?', [gatewayId]);
  if (!gateway) return { ok: false, error: 'Unknown gateway' };
  const site = await db.get('SELECT * FROM sites WHERE id = ?', [gateway.site_id]);
  if (!site || site.id !== siteId) return { ok: false, error: 'Gateway/site mismatch' };
  if (!Array.isArray(measurements) || measurements.length > config.ingest.maxBatch) {
    return { ok: false, error: 'Invalid measurement batch' };
  }

  const messageId = `${gatewayId}:${seq ?? `${ts}-${measurements.length}`}`;
  const duplicate = await db.get('SELECT id FROM ingest_messages WHERE id = ?', [messageId]);
  if (duplicate) {
    await db.run('UPDATE ingest_messages SET status = ? WHERE id = ?', ['DUPLICATE', messageId]);
    return { ok: true, duplicate: true, accepted: 0 };
  }

  const serverTs = nowIso();
  const deviceRows = await db.all('SELECT id, device_type FROM devices WHERE site_id = ?', [site.id]);
  const validDevices = new Set(deviceRows.map((d) => d.id));
  const rows = [];
  for (const m of measurements) {
    if (!m || !m.parameterId || m.value === undefined || m.value === null) continue;
    const value = Number(m.value);
    if (!Number.isFinite(value)) continue;
    rows.push({
      site_id: site.id,
      gateway_id: gateway.id,
      device_id: validDevices.has(m.deviceId) ? m.deviceId : null,
      parameter_id: String(m.parameterId).slice(0, 80),
      value,
      unit: m.unit || null,
      device_ts: m.deviceTs || ts || serverTs,
      server_ts: serverTs,
      quality: ['GOOD', 'UNCERTAIN', 'BAD', 'STALE'].includes(m.quality) ? m.quality : 'GOOD',
      seq: Number(seq) || null,
      data_source: 'LIVE',
    });
  }
  if (rows.length) {
    await db.insertMany(
      'measurements',
      ['site_id', 'gateway_id', 'device_id', 'parameter_id', 'value', 'unit', 'device_ts', 'server_ts', 'quality', 'seq', 'data_source'],
      rows,
      { chunkSize: 250 },
    );
  }

  // Build / merge the live snapshot.
  const existing = getLive(site.id);
  const snap = existing && existing.dataSource === 'LIVE'
    ? JSON.parse(JSON.stringify(existing))
    : defaultSnapshot(site, gateway);
  snap.ts = ts || serverTs;
  snap.lastSeenAt = serverTs;
  snap.dataSource = 'LIVE';
  snap.quality = rows.some((r) => r.quality === 'BAD') ? 'UNCERTAIN' : 'GOOD';
  snap.stale = false;
  snap.commStatus = 'ONLINE';
  snap.mixedSource = site.data_source === 'DEMO';
  snap.status = site.status;
  snap.gateway = {
    ...snap.gateway, id: gateway.id, name: gateway.name, status: 'ONLINE',
    lastSeenAt: serverTs, firmware: gateway.firmware, ipAddress: gateway.ip_address,
  };

  // Apply flat parameter measurements.
  for (const row of rows) {
    const pathArr = PARAM_PATHS[row.parameter_id];
    if (pathArr) deepSet(snap, pathArr, row.value);
  }
  if (snapshot && typeof snapshot === 'object') {
    for (const key of ['pv', 'inverter', 'bess', 'grid', 'generator', 'load', 'energy', 'flow', 'gateway']) {
      if (snapshot[key] && typeof snapshot[key] === 'object') {
        snap[key] = { ...(snap[key] || {}), ...snapshot[key] };
      }
    }
    if (snapshot.ts) snap.ts = snapshot.ts;
  }
  if (Array.isArray(snapshot?.bess?.racks)) snap.bess.racks = snapshot.bess.racks;
  if (Array.isArray(snapshot?.pv?.inverters)) snap.pv.inverters = snapshot.pv.inverters;
  snap.latencyMs = gateway.latency_ms || 0;
  snap.gateway.latencyMs = gateway.latency_ms || 0;
  deriveFlow(snap);
  setLive(site.id, snap);

  // First LIVE message flips the site out of simulation mode (explicitly labelled).
  if (site.data_source === 'DEMO') {
    await db.run("UPDATE sites SET data_source = 'LIVE', updated_at = ? WHERE id = ?", [serverTs, site.id]);
    await db.run("UPDATE gateways SET data_source = 'LIVE', updated_at = ? WHERE id = ?", [serverTs, gateway.id]);
    await db.run('INSERT INTO events (id, ts, site_id, device_id, type, severity, message, user_id, data_source) VALUES (?,?,?,?,?,?,?,?,?)', [
      uid('evt'), serverTs, site.id, null, 'SOURCE_SWITCH', 'INFO',
      `Gateway ${gateway.id} connected — site switched from DEMO to LIVE data source.`, null, 'LIVE',
    ]);
    const sim = getSimulator();
    if (sim) await sim.refreshAll();
  }

  await db.run(
    'UPDATE gateways SET status = ?, last_seen_at = ?, buffer_backlog = ?, latency_ms = ?, updated_at = ? WHERE id = ?',
    ['ONLINE', serverTs, Number(snapshot?.backlog ?? 0), Number(snapshot?.latencyMs ?? gateway.latency_ms ?? 0), serverTs, gateway.id],
  );
  await db.run("UPDATE sites SET comm_status = 'ONLINE', last_seen_at = ?, updated_at = ? WHERE id = ?", [serverTs, serverTs, site.id]);

  const healthId = uid('gh');
  await db.run(
    'INSERT INTO gateway_health (id, gateway_id, site_id, ts, online, latency_ms, backlog, cpu_pct, mem_pct, uptime_sec, firmware) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [healthId, gateway.id, site.id, serverTs, 1, Number(snapshot?.latencyMs ?? 0), Number(snapshot?.backlog ?? 0),
      Number(snapshot?.gateway?.cpuPct ?? 0), Number(snapshot?.gateway?.memPct ?? 0), Number(snapshot?.gateway?.uptimeSec ?? 0), gateway.firmware],
  );
  await db.run(
    'INSERT INTO comm_logs (id, ts, gateway_id, site_id, direction, protocol, topic, status, bytes, latency_ms, error) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [uid('cl'), serverTs, gateway.id, site.id, 'INBOUND', source, `plts/${site.id}/${gateway.id}/telemetry`, 'OK',
      Buffer.byteLength(JSON.stringify({ measurements, snapshot })), Number(snapshot?.latencyMs ?? 0), null],
  );
  await db.run(
    'INSERT INTO ingest_messages (id, gateway_id, seq, received_at, status, rows) VALUES (?,?,?,?,?,?)',
    [messageId, gateway.id, Number(seq) || null, serverTs, 'ACCEPTED', rows.length],
  );

  broadcast({ type: 'ingest', siteId: site.id, seq, rows: rows.length, ts: serverTs });
  return { ok: true, accepted: rows.length, duplicate: false };
}

export async function ingestHeartbeat({ gatewayId, siteId, latencyMs = 0, backlog = 0, cpuPct = 0, memPct = 0, uptimeSec = 0, firmware, source = 'MQTT' }) {
  const db = getDb();
  const gateway = await db.get('SELECT * FROM gateways WHERE id = ?', [gatewayId]);
  if (!gateway || gateway.site_id !== siteId) return { ok: false, error: 'Unknown gateway' };
  const ts = nowIso();
  await db.run(
    'UPDATE gateways SET status = ?, last_seen_at = ?, latency_ms = ?, buffer_backlog = ?, cpu_pct = ?, mem_pct = ?, uptime_sec = ?, updated_at = ? WHERE id = ?',
    ['ONLINE', ts, latencyMs, backlog, cpuPct, memPct, uptimeSec, ts, gatewayId],
  );
  await db.run("UPDATE sites SET comm_status = 'ONLINE', last_seen_at = ?, updated_at = ? WHERE id = ?", [ts, ts, siteId]);
  await db.run(
    'INSERT INTO gateway_health (id, gateway_id, site_id, ts, online, latency_ms, backlog, cpu_pct, mem_pct, uptime_sec, firmware) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [uid('gh'), gatewayId, siteId, ts, 1, latencyMs, backlog, cpuPct, memPct, uptimeSec, firmware || gateway.firmware],
  );
  return { ok: true, ts };
}

export function gatewayCredentialsFile() {
  const file = path.join(config.dataDir, 'gateway-credentials.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
