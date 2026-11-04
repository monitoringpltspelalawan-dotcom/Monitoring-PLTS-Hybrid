import { getDb } from '../db/adapter.js';
import { getAllLive } from './liveStore.js';
import { broadcast, broadcastAlarm } from './realtime.js';
import { nowIso } from '../lib/time.js';
import { clamp, round, uid } from '../lib/util.js';

let db = null;
let timer = null;
let rules = [];
let sites = new Map();
let active = new Map(); // key -> alarm row
let debounce = new Map(); // key -> firstSeen ms
let maintenanceSites = new Set();
let lastScan = null;
let scans = 0;

const keyFor = (siteId, code, deviceId = '') => `${siteId}::${code}::${deviceId || ''}`;

const OPERATORS = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => Math.abs(a - b) < 1e-9,
};

export async function startAlarmEngine(database) {
  db = database;
  await reloadAlarmRules();
  await refreshSites();
  await loadActiveAlarms();
  timer = setInterval(() => scan().catch((e) => console.error('[alarm] scan failed', e)), 10_000);
  timer.unref?.();
  await scan();
  console.log('[alarm] engine started');
}

export async function reloadAlarmRules() {
  if (!db) return;
  rules = await db.all('SELECT * FROM alarm_rules WHERE enabled = 1');
}

export async function refreshSites() {
  if (!db) return;
  const rows = await db.all('SELECT * FROM sites');
  sites = new Map(rows.map((s) => [s.id, s]));
  maintenanceSites = new Set(rows.filter((s) => s.status === 'MAINTENANCE').map((s) => s.id));
}

async function loadActiveAlarms() {
  const rows = await db.all("SELECT * FROM alarms WHERE status != 'RESOLVED'");
  active = new Map();
  for (const row of rows) active.set(keyFor(row.site_id, row.code, row.device_id), { ...row, wasMatched: false });
}

export function getActiveAlarmCounts() {
  const counts = { CRITICAL: 0, WARNING: 0, INFO: 0, total: 0 };
  for (const alarm of active.values()) {
    counts[alarm.severity] = (counts[alarm.severity] || 0) + 1;
    counts.total += 1;
  }
  return counts;
}

function valueFor(rule, snap, site) {
  switch (rule.parameter_id) {
    case 'soc_pct': return snap.bess?.socPct ?? null;
    case 'battery_temp_c': return snap.bess?.temperatureC ?? null;
    case 'grid_voltage_l1_v': return snap.grid?.available ? snap.grid?.voltageL1V ?? null : null;
    case 'grid_frequency_hz': return snap.grid?.available ? snap.grid?.frequencyHz ?? null : null;
    case 'inverter_temp_c': return snap.inverter?.temperatureC ?? null;
    case 'load_over_inverter_pct': {
      const cap = site.inverter_capacity_kw || site.pv_capacity_kwp;
      return cap > 0 ? (snap.load?.powerKw || 0) / cap * 100 : null;
    }
    case 'pv_performance_pct': {
      const irradiance = snap.pv?.irradianceWm2 || 0;
      if (irradiance < 320) return null;
      const expected = (site.pv_capacity_kwp || 0) * (irradiance / 1000) * 0.865;
      if (expected < 10) return null;
      return ((snap.pv?.powerKw || 0) / expected) * 100;
    }
    default: return null;
  }
}

function buildConditions(snap, site) {
  const conditions = [];
  const add = (code, severity, category, title, message, value, threshold, deviceId = null) => {
    conditions.push({ code, severity, category, title, message, value: value == null ? null : round(value, 2), threshold, deviceId });
  };

  if (snap.stale || snap.commStatus === 'OFFLINE') {
    add(
      'GATEWAY_OFFLINE', 'CRITICAL', 'COMMUNICATION', 'Edge gateway offline',
      `No telemetry received from ${site.name} gateway. Last seen ${snap.lastSeenAt || snap.ts}.`,
      null, null, snap.gateway?.id,
    );
  } else if ((snap.latencyMs || 0) > 500) {
    add(
      'GATEWAY_HIGH_LATENCY', 'WARNING', 'COMMUNICATION', 'High gateway communication latency',
      `Telemetry latency is ${Math.round(snap.latencyMs)} ms (threshold 500 ms).`,
      snap.latencyMs, 500, snap.gateway?.id,
    );
  }
  if (snap.commStatus === 'DEGRADED') {
    add(
      'DEVICE_COMM_FAILURE', 'WARNING', 'COMMUNICATION', 'Intermittent device communication',
      'One or more Modbus devices are timing out intermittently; retries are in progress.',
      3, 3, null,
    );
  }
  if (snap.grid && snap.grid.available === false) {
    add(
      'GRID_FAILURE', 'CRITICAL', 'GRID', 'PLN grid failure',
      'Grid supply is unavailable. The plant is serving load from BESS and generator where available.',
      0, 1, null,
    );
  }
  if (snap.grid && snap.grid.available === false && snap.generator?.present && !snap.generator.running) {
    add(
      'GENERATOR_FAILURE', 'CRITICAL', 'GENERATOR', 'Generator failed to start',
      'Grid is unavailable and the standby generator is not running.',
      0, 1, snap.generator?.deviceId || null,
    );
  }
  if (snap.bess?.bmsStatus && snap.bess.bmsStatus !== 'NORMAL') {
    add(
      'BESS_BMS_ALARM', 'CRITICAL', 'BESS', 'BMS protection active',
      `Battery management system reports ${snap.bess.bmsStatus}.`,
      null, null, null,
    );
  }
  for (const inv of snap.pv?.inverters || []) {
    if (inv.faultCode > 0 || inv.status === 'FAULT') {
      add(
        'INVERTER_FAULT', 'CRITICAL', 'INVERTER', `Inverter fault — ${inv.name}`,
        `Inverter reported fault code ${inv.faultCode || 'unknown'} (status ${inv.status}).`,
        inv.faultCode || 0, 0, inv.id,
      );
    }
    if (inv.temperatureC > 78) {
      add(
        'INVERTER_HIGH_TEMP', 'WARNING', 'INVERTER', 'Inverter temperature high',
        `${inv.name} temperature reached ${inv.temperatureC} °C.`,
        inv.temperatureC, 75, inv.id,
      );
    }
  }

  for (const rule of rules) {
    if (rule.site_id && rule.site_id !== site.id) continue;
    const value = valueFor(rule, snap, site);
    if (value === null || !Number.isFinite(Number(value))) continue;
    const op = OPERATORS[rule.operator] || OPERATORS['>'];
    if (!op(Number(value), Number(rule.threshold))) continue;
    add(
      rule.code, rule.severity, rule.category || 'GENERAL', rule.name,
      `${rule.name.replace(/\.$/, '')}: measured ${round(value, 2)} ${rule.parameter_id.includes('temp') ? '°C' : rule.parameter_id.includes('pct') ? '%' : ''} (threshold ${rule.operator} ${rule.threshold}).`,
      value, rule.threshold, null,
    );
  }
  return conditions;
}

export async function scan() {
  if (!db) return;
  scans += 1;
  const snapshots = getAllLive();
  const now = Date.now();
  const seenKeys = new Set();
  const statusBySite = new Map();
  let newAlarms = 0;

  for (const snap of snapshots) {
    const site = sites.get(snap.siteId);
    if (!site) continue;
    const conditions = buildConditions(snap, site);

    for (const cond of conditions) {
      const key = keyFor(site.id, cond.code, cond.deviceId);
      seenKeys.add(key);
      const existing = active.get(key);
      if (existing) {
        existing.wasMatched = true;
        existing.last_seen_at = nowIso();
        existing.value = cond.value;
        await db.run('UPDATE alarms SET last_seen_at = ?, value = ? WHERE id = ?', [nowIso(), cond.value, existing.id]);
        continue;
      }
      // debounce: require the condition to hold for rule.duration_sec
      const rule = rules.find((r) => r.code === cond.code);
      const durationMs = (rule?.duration_sec || 0) * 1000;
      if (durationMs > 0) {
        if (!debounce.has(key)) {
          debounce.set(key, now);
          continue;
        }
        if (now - debounce.get(key) < durationMs) continue;
      }
      debounce.delete(key);
      const alarm = {
        id: uid('alarm'), code: cond.code, site_id: site.id, device_id: cond.deviceId,
        severity: cond.severity, category: cond.category, title: cond.title, message: cond.message,
        status: 'ACTIVE', value: cond.value, threshold: cond.threshold, triggered_at: nowIso(),
        last_seen_at: nowIso(), acknowledged_at: null, acknowledged_by: null, resolved_at: null,
        resolved_by: null, resolution_note: null, data_source: snap.dataSource || 'DEMO', wasMatched: true,
      };
      await db.run(
        `INSERT INTO alarms (id, code, site_id, device_id, severity, category, title, message, status, value, threshold, triggered_at, last_seen_at, data_source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [alarm.id, alarm.code, alarm.site_id, alarm.device_id, alarm.severity, alarm.category, alarm.title,
          alarm.message, alarm.status, alarm.value, alarm.threshold, alarm.triggered_at, alarm.last_seen_at, alarm.data_source],
      );
      active.set(key, alarm);
      newAlarms += 1;
      await db.run('INSERT INTO events (id, ts, site_id, device_id, type, severity, message, user_id, data_source) VALUES (?,?,?,?,?,?,?,?,?)', [
        uid('evt'), nowIso(), site.id, cond.deviceId, 'ALARM_RAISED', cond.severity, cond.title, null, alarm.data_source,
      ]);
      await db.run(
        'INSERT INTO notifications (id, alarm_id, channel, target, status, message, created_at) VALUES (?,?,?,?,?,?,?)',
        [uid('ntf'), alarm.id, 'IN_APP', site.code, 'SENT', `${cond.severity}: ${cond.title}`, nowIso()],
      );
      await broadcastAlarm(alarm);
    }

    // Compute site status for this snapshot
    const siteAlarms = [...active.values()].filter((a) => a.site_id === site.id);
    let status = 'ONLINE';
    if (snap.commStatus === 'OFFLINE' || snap.stale) status = 'OFFLINE';
    else if (siteAlarms.some((a) => a.severity === 'CRITICAL')) status = 'CRITICAL';
    else if (siteAlarms.some((a) => a.severity === 'WARNING')) status = 'WARNING';
    else if (maintenanceSites.has(site.id)) status = 'MAINTENANCE';
    statusBySite.set(site.id, status);
  }

  // Resolve alarms whose condition cleared (only alarms the engine has observed).
  for (const [key, alarm] of [...active.entries()]) {
    if (seenKeys.has(key)) continue;
    if (!alarm.wasMatched) continue;
    // Debounce clearing for rules with duration as well
    const rule = rules.find((r) => r.code === alarm.code);
    const clearMs = Math.max(30_000, (rule?.duration_sec || 0) * 1000);
    const clearKey = `clear:${key}`;
    if (!debounce.has(clearKey)) {
      debounce.set(clearKey, now);
      continue;
    }
    if (now - debounce.get(clearKey) < clearMs) continue;
    debounce.delete(clearKey);
    const resolvedAt = nowIso();
    await db.run(
      "UPDATE alarms SET status = 'RESOLVED', resolved_at = ?, resolved_by = 'system', resolution_note = ? WHERE id = ?",
      [resolvedAt, 'Condition cleared automatically.', alarm.id],
    );
    active.delete(key);
    await db.run('INSERT INTO events (id, ts, site_id, device_id, type, severity, message, user_id, data_source) VALUES (?,?,?,?,?,?,?,?,?)', [
      uid('evt'), resolvedAt, alarm.site_id, alarm.device_id, 'ALARM_RESOLVED', 'INFO',
      `Auto-resolved: ${alarm.title}`, null, alarm.data_source,
    ]);
    broadcast({ type: 'alarm_resolved', alarmId: alarm.id, siteId: alarm.site_id, ts: resolvedAt });
  }

  // Persist site status transitions
  for (const [siteId, status] of statusBySite) {
    const site = sites.get(siteId);
    if (!site) continue;
    if (site.status === 'MAINTENANCE' && status === 'ONLINE') status = 'MAINTENANCE';
    if (site.status !== status) {
      await db.run('UPDATE sites SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), siteId]);
      site.status = status;
      broadcast({ type: 'site_status', siteId, status, ts: nowIso() });
    }
  }
  lastScan = nowIso();
  return { scans, newAlarms, active: active.size };
}

export function alarmEngineStats() {
  return {
    running: Boolean(timer),
    scans,
    active: active.size,
    lastScan,
    rules: rules.length,
    counts: getActiveAlarmCounts(),
  };
}

export async function reloadActiveAlarms() {
  if (db) await loadActiveAlarms();
}

export async function stopAlarmEngine() {
  if (timer) clearInterval(timer);
  timer = null;
}
