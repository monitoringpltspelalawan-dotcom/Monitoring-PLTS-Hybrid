import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb, initDb } from './adapter.js';
import { DEFAULT_ALARM_RULES, DEVICE_MODELS, REGIONS, SITE_SEEDS } from './catalog.js';
import { DEFAULT_ROLES } from '../lib/permissions.js';
import { hashPassword } from '../lib/passwords.js';
import { clamp, hashSeed, randomToken, rng, round, tokenHash, uid } from '../lib/util.js';
import {
  dayKeyOffset, localDateKey, localHourDecimal, localHourKey, localDayStartUtc, nowIso,
} from '../lib/time.js';
import { loadFactor, solarFactor } from '../services/physics.js';

const nowIsoStr = () => new Date().toISOString();

function roleId(code) {
  return `ROLE-${code}`;
}

const DEMO_GATEWAY_TOKEN = process.env.GATEWAY_DEMO_TOKEN || 'demo-gw-cjk01-2e9f4b7c8a1d6e35';

const ALARM_TEMPLATES = [
  { code: 'INVERTER_FAULT', severity: 'CRITICAL', category: 'INVERTER', title: 'Inverter fault detected', message: 'Inverter reported fault code {v} during {period} operation.' },
  { code: 'INVERTER_OVERLOAD', severity: 'WARNING', category: 'INVERTER', title: 'Inverter overload', message: 'Load exceeded configured inverter capacity by {v}%.' },
  { code: 'BESS_HIGH_TEMP', severity: 'WARNING', category: 'BESS', title: 'Battery temperature high', message: 'Battery temperature reached {v} °C (threshold 45 °C).' },
  { code: 'BESS_LOW_SOC', severity: 'WARNING', category: 'BESS', title: 'Battery state of charge low', message: 'Battery SOC dropped to {v}% (threshold 25%).' },
  { code: 'GRID_UNDERVOLTAGE', severity: 'WARNING', category: 'GRID', title: 'Grid undervoltage', message: 'Grid voltage L1 at {v} V (threshold 200 V).' },
  { code: 'GRID_OVERVOLTAGE', severity: 'WARNING', category: 'GRID', title: 'Grid overvoltage', message: 'Grid voltage L1 at {v} V (threshold 242 V).' },
  { code: 'GENERATOR_FAILURE', severity: 'CRITICAL', category: 'GENERATOR', title: 'Generator failed to start', message: 'Generator controller reported failure during grid outage.' },
  { code: 'DEVICE_COMM_FAILURE', severity: 'WARNING', category: 'COMMUNICATION', title: 'Device communication failure', message: 'Modbus TCP timeout on {device} after 3 retries.' },
  { code: 'GATEWAY_OFFLINE', severity: 'CRITICAL', category: 'COMMUNICATION', title: 'Edge gateway offline', message: 'Gateway has not sent a heartbeat for more than 5 minutes.' },
  { code: 'PV_UNDERPERFORM', severity: 'WARNING', category: 'PV', title: 'PV generation below expectation', message: 'Specific yield at {v}% of expected for the current irradiance band.' },
];

function buildDevicesForSite(site, siteIndex, gatewayId) {
  const devices = [];
  const inverterModels = ['huawei-sun2000-100ktl', 'sungrow-sg110cx', 'deye-sun50k', 'goodwe-et75'];
  for (let i = 0; i < site.inverters; i += 1) {
    const modelKey = inverterModels[(siteIndex + i) % inverterModels.length];
    const model = DEVICE_MODELS.find((m) => m.key === modelKey);
    devices.push({
      id: `DEV-${site.code}-INV-${String(i + 1).padStart(2, '0')}`,
      site_id: site.id,
      gateway_id: gatewayId,
      model_key: modelKey,
      name: `Hybrid Inverter ${i + 1}`,
      device_type: model.device_type,
      manufacturer: model.manufacturer,
      model: model.model,
      serial: `${model.manufacturer.slice(0, 3).toUpperCase()}${String(siteIndex + 1).padStart(2, '0')}${String(i + 1).padStart(3, '0')}`,
      ip_address: `10.${20 + siteIndex}.10.${11 + i}`,
      port: 502,
      unit_id: 1 + i,
      firmware: 'V2.4.1',
      status: 'ONLINE',
    });
  }
  const bess = DEVICE_MODELS.find((m) => m.key === 'pylontech-us5000');
  devices.push({
    id: `DEV-${site.code}-BESS-01`, site_id: site.id, gateway_id: gatewayId, model_key: 'pylontech-us5000',
    name: 'BESS Controller', device_type: 'BESS', manufacturer: bess.manufacturer, model: bess.model,
    serial: `PYL${String(siteIndex + 1).padStart(2, '0')}BESS`, ip_address: `10.${20 + siteIndex}.10.30`,
    port: 502, unit_id: 1, firmware: 'V1.8.0', status: 'ONLINE',
  });
  const bms = DEVICE_MODELS.find((m) => m.key === 'pylontech-bms');
  devices.push({
    id: `DEV-${site.code}-BMS-01`, site_id: site.id, gateway_id: gatewayId, model_key: 'pylontech-bms',
    name: 'Battery Management System', device_type: 'BMS', manufacturer: bms.manufacturer, model: bms.model,
    serial: `PYL${String(siteIndex + 1).padStart(2, '0')}BMS`, ip_address: `10.${20 + siteIndex}.10.31`,
    port: 502, unit_id: 2, firmware: 'V1.8.0', status: 'ONLINE',
  });
  const meterModels = ['schneider-pm5560', 'siemens-pac3220'];
  const gridModel = DEVICE_MODELS.find((m) => m.key === meterModels[siteIndex % 2]);
  devices.push({
    id: `DEV-${site.code}-GRID-01`, site_id: site.id, gateway_id: gatewayId, model_key: gridModel.key,
    name: 'PLN Grid Meter', device_type: 'GRID_METER', manufacturer: gridModel.manufacturer, model: gridModel.model,
    serial: `GM${String(siteIndex + 1).padStart(2, '0')}001`, ip_address: `10.${20 + siteIndex}.10.40`,
    port: 502, unit_id: 1, firmware: 'V3.1.7', status: 'ONLINE',
  });
  const loadModel = DEVICE_MODELS.find((m) => m.key === meterModels[(siteIndex + 1) % 2]);
  devices.push({
    id: `DEV-${site.code}-LOAD-01`, site_id: site.id, gateway_id: gatewayId, model_key: loadModel.key,
    name: 'Main Load Meter', device_type: 'LOAD_METER', manufacturer: loadModel.manufacturer, model: loadModel.model,
    serial: `LM${String(siteIndex + 1).padStart(2, '0')}001`, ip_address: `10.${20 + siteIndex}.10.41`,
    port: 502, unit_id: 1, firmware: 'V3.1.7', status: 'ONLINE',
  });
  if (site.genCount > 0) {
    const gen = DEVICE_MODELS.find((m) => m.key === 'comap-inteligen');
    devices.push({
      id: `DEV-${site.code}-GEN-01`, site_id: site.id, gateway_id: gatewayId, model_key: 'comap-inteligen',
      name: 'Diesel Generator Controller', device_type: 'GENERATOR', manufacturer: gen.manufacturer, model: gen.model,
      serial: `GEN${String(siteIndex + 1).padStart(2, '0')}001`, ip_address: `10.${20 + siteIndex}.10.50`,
      port: 502, unit_id: 1, firmware: 'V1.2.0', status: 'ONLINE',
    });
  }
  return devices;
}

function dailyEnergyFor(site, profile, dayKey, index) {
  const seed = hashSeed(`${site.code}-${dayKey}`);
  const r = rng(seed);
  const month = Number(dayKey.slice(5, 7));
  const wetSeason = month >= 11 || month <= 3;
  const seasonal = wetSeason ? 0.91 : 1.035;
  const weather = 0.88 + r() * 0.17;
  const availability = r() > 0.985 ? 0.86 + r() * 0.1 : 0.995;
  const yieldKwhPerKwp = 3.72 * seasonal * weather;
  const pvKwh = round(site.kwp * yieldKwhPerKwp * availability, 1);
  const loadPeak = profile.loadPeakKw || site.kwp * 0.7;
  const loadKwh = round(loadPeak * (9.6 + r() * 1.4), 1);
  const chargeKwh = round(Math.min(pvKwh * (0.22 + r() * 0.12), site.bessKwh * 0.62), 1);
  const dischargeKwh = round(chargeKwh * (0.9 + r() * 0.05), 1);
  const generatorKwh = round(
    (1 - (profile.gridReliability ?? 0.995)) > 0.02 && r() < 0.35 ? (site.genKw || 0) * (1.2 + r() * 3.2) : 0,
    1,
  );
  const importKwh = round(Math.max(0, loadKwh - pvKwh + chargeKwh - dischargeKwh - generatorKwh) * (0.96 + r() * 0.05), 1);
  const exportKwh = round(Math.max(0, pvKwh - loadKwh - chargeKwh) * (0.55 + r() * 0.4), 1);
  return {
    pv_kwh: pvKwh,
    charge_kwh: chargeKwh,
    discharge_kwh: dischargeKwh,
    load_kwh: loadKwh,
    import_kwh: importKwh,
    export_kwh: exportKwh,
    generator_kwh: generatorKwh,
    peak_load_kw: round(loadPeak * (0.88 + r() * 0.14), 1),
    peak_pv_kw: round(site.kwp * (0.72 + r() * 0.16), 1),
    performance_ratio: round(0.8 + r() * 0.08, 3),
    availability_pct: round(availability * 100, 1),
  };
}

/** Normalised solar shape for a local day (hour 0..23). Integrated to daily kWh. */
function pvHourShape(hour, dayKey, site) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const ts = new Date(Date.UTC(y, m - 1, d, hour) - 7 * 3600_000);
  const p = { latitude: site.lat, timezone: site.tz, seed: hashSeed(site.code), cloudiness: site.cloudiness };
  return solarFactor(p, ts);
}

function loadHourShape(hour, site) {
  return loadFactor(hour, { shifts: site.shifts });
}

function normalize(arr) {
  const total = arr.reduce((a, b) => a + b, 0) || 1;
  return arr.map((v) => v / total);
}

function pickAlarmDevice(siteDevices, category) {
  if (category === 'INVERTER') return siteDevices.find((d) => d.device_type.includes('INVERTER'))?.id;
  if (category === 'BESS') return siteDevices.find((d) => d.device_type === 'BESS')?.id;
  if (category === 'GRID') return siteDevices.find((d) => d.device_type === 'GRID_METER')?.id;
  if (category === 'GENERATOR') return siteDevices.find((d) => d.device_type === 'GENERATOR')?.id;
  if (category === 'COMMUNICATION') return siteDevices[0]?.id;
  return null;
}

export async function seedDatabase({ reset = false, silent = false } = {}) {
  if (config.env === 'production') {
    throw new Error('Demo seeding is disabled in production. Provision a real administrator and sites instead.');
  }
  const db = getDb();
  const existing = await db.get('SELECT COUNT(*) AS c FROM sites');
  if (existing && Number(existing.c) > 0 && !reset) {
    if (!silent) console.log('[seed] database already seeded — skipping');
    return { seeded: false, sites: Number(existing.c) };
  }

  if (reset) {
    const tables = [
      'measurements', 'energy_hourly', 'site_energy_daily', 'site_live_state', 'alarms', 'alarm_rules', 'events',
      'gateway_health', 'comm_logs', 'audit_logs', 'sessions', 'tariffs', 'site_configs', 'settings',
      'ingest_messages', 'report_schedules', 'generated_reports', 'notifications', 'modbus_registers', 'devices',
      'device_models', 'bess_racks', 'gateways', 'user_sites', 'users', 'roles', 'sites', 'regions',
    ];
    for (const table of tables) await db.run(`DELETE FROM ${table}`);
    if (!silent) console.log('[seed] existing data cleared');
  }

  const now = nowIsoStr();
  const log = (...args) => !silent && console.log('[seed]', ...args);

  // ---- roles & users -------------------------------------------------
  const roleRows = DEFAULT_ROLES.map((r) => ({
    id: roleId(r.code), code: r.code, name: r.name, description: r.description,
    permissions: JSON.stringify(r.permissions), created_at: now,
  }));
  await db.insertMany('roles', Object.keys(roleRows[0]), roleRows);

  const regionRows = REGIONS.map((r, i) => ({
    id: `REG-${String(i + 1).padStart(2, '0')}`, code: r.code, name: r.name, timezone: r.timezone, created_at: now,
  }));
  await db.insertMany('regions', Object.keys(regionRows[0]), regionRows);
  const regionByCode = new Map(regionRows.map((r) => [r.code, r]));

  const userDefs = [
    { username: 'admin', password: config.demo.users.admin.password, full_name: 'Super Administrator', email: 'admin@chsms.local', role: 'SUPER_ADMIN' },
    { username: 'corpadmin', password: 'Corp@12345', full_name: 'Dewi Lestari', email: 'dewi.lestari@chsms.local', role: 'CORPORATE_ADMIN' },
    { username: 'regional', password: 'Regional@12345', full_name: 'Agus Setiawan', email: 'agus.setiawan@chsms.local', role: 'REGIONAL_MANAGER', region: 'REG-JB' },
    { username: 'siteadmin', password: 'Site@12345', full_name: 'Rina Handayani', email: 'rina.h@chsms.local', role: 'SITE_ADMIN', sites: ['CJK', 'KRW', 'BKS'] },
    { username: 'operator', password: config.demo.users.operator.password, full_name: 'Budi Santoso', email: 'budi.s@chsms.local', role: 'OPERATOR', sites: ['CJK', 'KRW', 'BKS', 'SRG', 'TNG'] },
    { username: 'viewer', password: config.demo.users.viewer.password, full_name: 'Sari Wulandari', email: 'sari.w@chsms.local', role: 'VIEWER', sites: ['CJK', 'SBY'] },
  ];

  const userRows = [];
  for (const u of userDefs) {
    const { salt, hash } = hashPassword(u.password);
    userRows.push({
      id: `USR-${u.username.toUpperCase()}`, username: u.username, email: u.email, full_name: u.full_name,
      password_hash: hash, password_salt: salt, role_id: roleId(u.role), region_id: u.region ? regionByCode.get(u.region).id : null,
      status: 'ACTIVE', timezone: 'Asia/Jakarta', last_login_at: null, created_at: now, updated_at: now,
    });
  }
  await db.insertMany('users', Object.keys(userRows[0]), userRows, { conflict: 'ON CONFLICT(id) DO NOTHING' });

  // ---- sites ---------------------------------------------------------
  const siteRows = SITE_SEEDS.map((s, i) => ({
    id: `SITE-${s.code}`, code: s.code, name: s.name, region_id: regionByCode.get(s.region).id,
    location: s.location, address: s.address, latitude: s.lat, longitude: s.lon, timezone: s.tz,
    pv_capacity_kwp: s.kwp, inverter_capacity_kw: Math.round(s.kwp * 1.15), bess_capacity_kwh: s.bessKwh,
    bess_power_kw: s.bessPowerKw, inverter_count: s.inverters, battery_rack_count: s.racks, meter_count: 2,
    grid_connection_type: s.gridType, grid_provider: 'PLN', grid_voltage_kv: 20, grid_capacity_kva: s.gridKva,
    generator_count: s.genCount, generator_capacity_kw: s.genKw, commissioning_date: s.commissioning,
    status: s.status, comm_status: s.comm, last_seen_at: s.comm === 'OFFLINE' ? new Date(Date.now() - 5 * 86400_000).toISOString() : now,
    data_source: 'DEMO', sim_profile: JSON.stringify({
      loadBaseKw: s.loadBaseKw, loadPeakKw: s.loadPeakKw, cloudiness: s.cloudiness,
      gridReliability: s.gridReliability, shifts: s.shifts, weakGrid: s.code === 'PLTS-SDA-01' || s.code === 'PLTS-MTR-01',
      thermalIssue: false,
    }),
    notes: null, created_at: now, updated_at: now,
  }));
  await db.insertMany('sites', Object.keys(siteRows[0]), siteRows);
  const siteSeedById = new Map(SITE_SEEDS.map((s) => [`SITE-${s.code}`, s]));

  // User site scoping
  const userSiteRows = [];
  for (const u of userDefs) {
    if (!u.sites) continue;
    const user = userRows.find((x) => x.username === u.username);
    for (const suffix of u.sites) {
      const site = siteRows.find((s) => s.code.includes(`-${suffix}-`));
      if (site) userSiteRows.push({ user_id: user.id, site_id: site.id });
    }
  }
  if (userSiteRows.length) await db.insertMany('user_sites', ['user_id', 'site_id'], userSiteRows);

  // ---- gateways ------------------------------------------------------
  const gatewayRows = [];
  SITE_SEEDS.forEach((s, i) => {
    const site = siteRows[i];
    const token = s.code === 'PLTS-CJK-01' ? DEMO_GATEWAY_TOKEN : `gw_${s.code.toLowerCase()}_${randomToken(18)}`;
    const id = `GW-${s.code}`;
    gatewayRows.push({
      id, site_id: site.id, name: `Edge Gateway ${s.code}`, serial: `EG-${String(i + 1).padStart(4, '0')}`,
      hardware: 'Intel NUC 11 / 8 GB RAM / 256 GB SSD', firmware: 'edge-1.4.2', ip_address: `10.${20 + i}.1.10`,
      status: s.comm === 'OFFLINE' ? 'OFFLINE' : 'ONLINE', last_seen_at: s.comm === 'OFFLINE' ? new Date(Date.now() - 5 * 86400_000).toISOString() : now,
      mqtt_client_id: `gw-${s.code.toLowerCase()}`, token_hash: tokenHash(token), token_hint: `${token.slice(0, 10)}…${token.slice(-4)}`,
      cert_fingerprint: null, buffer_backlog: s.comm === 'DEGRADED' ? 420 : 0, latency_ms: s.comm === 'DEGRADED' ? 680 : 45,
      cpu_pct: 18 + (i % 12), mem_pct: 38 + (i % 9), uptime_sec: 86400 * (12 + (i % 20)), version: '1.4.2',
      data_source: 'DEMO', created_at: now, updated_at: now,
    });
  });
  await db.insertMany('gateways', Object.keys(gatewayRows[0]), gatewayRows);

  // ---- device models -------------------------------------------------
  const modelRows = DEVICE_MODELS.map((m) => ({
    id: `MDL-${m.key}`, manufacturer: m.manufacturer, model: m.model, device_type: m.device_type,
    protocol: 'MODBUS_TCP', description: m.description, register_template: JSON.stringify(m.registers), created_at: now,
  }));
  await db.insertMany('device_models', Object.keys(modelRows[0]), modelRows);

  // ---- devices, racks, registers --------------------------------------
  const deviceRows = [];
  const rackRows = [];
  const registerRows = [];
  SITE_SEEDS.forEach((s, i) => {
    const site = siteRows[i];
    const gateway = gatewayRows[i];
    const devices = buildDevicesForSite(site, i, gateway.id);
    if (s.comm === 'OFFLINE') devices.forEach((d) => { d.status = 'OFFLINE'; });
    if (s.code === 'PLTS-SDA-01') {
      const inv = devices.find((d) => d.device_type.includes('INVERTER'));
      if (inv) inv.status = 'FAULT';
    }
    for (const d of devices) {
      deviceRows.push({
        id: d.id, site_id: d.site_id, gateway_id: d.gateway_id, model_id: `MDL-${d.model_key}`, name: d.name,
        device_type: d.device_type, manufacturer: d.manufacturer, model: d.model, serial: d.serial,
        ip_address: d.ip_address, port: d.port, unit_id: d.unit_id, firmware: d.firmware,
        status: d.status, last_seen_at: s.comm === 'OFFLINE' ? new Date(Date.now() - 5 * 86400_000).toISOString() : now,
        data_source: 'DEMO', created_at: now, updated_at: now,
      });
      const model = DEVICE_MODELS.find((m) => m.key === d.model_key);
      for (const r of model.registers) {
        registerRows.push({
          id: uid('reg'), device_id: d.id, parameter_id: r.parameter_id, name: r.name,
          function_code: r.function_code, address: r.address, register_type: r.register_type,
          data_type: r.data_type, word_order: r.word_order, byte_order: r.byte_order, scale: r.scale,
          offset: r.offset, unit: r.unit, poll_interval_sec: r.poll_interval_sec, writable: r.writable,
          description: r.description, enabled: 1, created_at: now, updated_at: now,
        });
      }
    }
    const rackBase = Math.round(s.bessKwh / s.racks);
    for (let r = 0; r < s.racks; r += 1) {
      rackRows.push({
        id: `RACK-${s.code}-${r + 1}`, site_id: site.id,
        device_id: `DEV-${s.code}-BESS-01`,
        name: `Rack ${String.fromCharCode(65 + Math.floor(r / 4))}${(r % 4) + 1}`,
        capacity_kwh: r === s.racks - 1 ? s.bessKwh - rackBase * (s.racks - 1) : rackBase,
        module_count: 4 + (r % 2), status: s.code === 'PLTS-SDA-01' && r === 1 ? 'WARNING' : 'ONLINE', created_at: now,
      });
    }
  });
  await db.insertMany('devices', Object.keys(deviceRows[0]), deviceRows);
  await db.insertMany('bess_racks', Object.keys(rackRows[0]), rackRows);
  await db.insertMany('modbus_registers', Object.keys(registerRows[0]), registerRows, { chunkSize: 150 });

  // ---- alarm rules ---------------------------------------------------
  const ruleRows = DEFAULT_ALARM_RULES.map((r) => ({
    id: `RULE-${r.code}`, code: r.code, parameter_id: r.parameter_id, name: r.name, severity: r.severity,
    operator: r.operator, threshold: r.threshold, duration_sec: r.duration_sec, category: r.category,
    enabled: 1, site_id: null, created_at: now, updated_at: now,
  }));
  await db.insertMany('alarm_rules', Object.keys(ruleRows[0]), ruleRows);

  // ---- tariffs, site configs, settings --------------------------------
  const tariffRows = siteRows.map((s) => ({
    id: uid('tar'), site_id: s.id, name: 'PLN B-3 / I-3 industrial', type: 'ENERGY', rate: 1444.7,
    currency: 'IDR', effective_from: '2024-01-01', created_at: now,
  }));
  tariffRows.push({
    id: uid('tar'), site_id: null, name: 'Portfolio default (PLN I-3)', type: 'ENERGY', rate: 1444.7,
    currency: 'IDR', effective_from: '2024-01-01', created_at: now,
  });
  await db.insertMany('tariffs', Object.keys(tariffRows[0]), tariffRows);

  const configRows = [];
  for (const [i, s] of siteRows.entries()) {
    const seed = SITE_SEEDS[i];
    configRows.push(
      { site_id: s.id, key: 'tariff_rate', value: String(1444.7), updated_at: now },
      { site_id: s.id, key: 'emission_factor', value: '0.87', updated_at: now },
      { site_id: s.id, key: 'pr_target', value: '0.82', updated_at: now },
      { site_id: s.id, key: 'grid_export_allowed', value: seed.gridKva > 0 ? 'true' : 'false', updated_at: now },
      { site_id: s.id, key: 'timezone', value: seed.tz, updated_at: now },
    );
  }
  await db.insertMany('site_configs', ['site_id', 'key', 'value', 'updated_at'], configRows);

  const settingRows = [
    { key: 'company_name', value: 'Nusantara Renewable Energy Group', updated_at: now },
    { key: 'portfolio_name', value: 'Hybrid Solar PV Portfolio — Indonesia', updated_at: now },
    { key: 'base_currency', value: 'IDR', updated_at: now },
    { key: 'default_tariff', value: '1444.7', updated_at: now },
    { key: 'emission_factor_kg_per_kwh', value: '0.87', updated_at: now },
    { key: 'demo_mode', value: 'true', updated_at: now },
    { key: 'measurement_retention_days', value: '30', updated_at: now },
    { key: 'alarm_notification_channel', value: 'EMAIL', updated_at: now },
    { key: 'alarm_notification_target', value: 'control-room@chsms.local', updated_at: now },
    { key: 'session_timeout_hours', value: '12', updated_at: now },
    { key: 'mqtt_broker_url', value: 'mqtts://localhost:8883', updated_at: now },
    { key: 'gateway_heartbeat_seconds', value: '30', updated_at: now },
  ];
  await db.insertMany('settings', ['key', 'value', 'updated_at'], settingRows);

  // ---- daily energy history (365 days) --------------------------------
  log('generating 365 days of energy history for', siteRows.length, 'sites…');
  const today = localDateKey(new Date(), 'Asia/Jakarta');
  const dailyRows = [];
  for (const [i, site] of siteRows.entries()) {
    const seed = SITE_SEEDS[i];
    const tz = seed.tz;
    const todayKey = localDateKey(new Date(), tz);
    for (let d = 1; d <= 365; d += 1) {
      const day = dayKeyOffset(todayKey, -d);
      const e = dailyEnergyFor({ ...seed, id: site.id }, seed, day, i);
      dailyRows.push({
        site_id: site.id, day, ...e, updated_at: now,
      });
    }
  }
  await db.insertMany('site_energy_daily', Object.keys(dailyRows[0]), dailyRows, { chunkSize: 200 });

  // ---- hourly history (30 days) ---------------------------------------
  log('generating 30 days of hourly history…');
  const hourlyRows = [];
  for (const [i, site] of siteRows.entries()) {
    const seed = SITE_SEEDS[i];
    const tz = seed.tz;
    const todayKey = localDateKey(new Date(), tz);
    for (let d = 1; d <= 30; d += 1) {
      const day = dayKeyOffset(todayKey, -d);
      const daily = dailyEnergyFor({ ...seed, id: site.id }, seed, day, i);
      const pvShape = normalize(Array.from({ length: 24 }, (_, h) => (h >= 6 && h <= 18 ? pvHourShape(h, day, seed) : 0)));
      const loadShape = normalize(Array.from({ length: 24 }, (_, h) => loadHourShape(h, seed)));
      const chargeShape = normalize(Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 15 ? Math.max(0, pvHourShape(h, day, seed)) : 0)));
      const dischargeShape = normalize(Array.from({ length: 24 }, (_, h) => (h >= 17 && h <= 21 ? 1 : h >= 6 && h <= 8 ? 0.4 : 0)));
      const genShape = normalize(Array.from({ length: 24 }, (_, h) => (h >= 18 && h <= 22 ? 1 : 0)));
      for (let h = 0; h < 24; h += 1) {
        hourlyRows.push({
          site_id: site.id, hour: `${day}T${String(h).padStart(2, '0')}:00`,
          pv_kwh: round(daily.pv_kwh * pvShape[h], 3),
          charge_kwh: round(daily.charge_kwh * chargeShape[h], 3),
          discharge_kwh: round(daily.discharge_kwh * dischargeShape[h], 3),
          load_kwh: round(daily.load_kwh * loadShape[h], 3),
          import_kwh: round(daily.import_kwh * loadShape[h] * 0.8, 3),
          export_kwh: round(daily.export_kwh * pvShape[h], 3),
          generator_kwh: round(daily.generator_kwh * genShape[h], 3),
          peak_load_kw: round(daily.peak_load_kw * loadShape[h] * 1.02, 2),
          updated_at: now,
        });
      }
    }
  }
  await db.insertMany('energy_hourly', Object.keys(hourlyRows[0]), hourlyRows, { chunkSize: 250 });

  // ---- 48h of 15-minute measurements ----------------------------------
  log('generating 48 hours of 15-minute telemetry…');
  const deviceBySite = new Map();
  for (const d of deviceRows) {
    const arr = deviceBySite.get(d.site_id) || [];
    arr.push(d);
    deviceBySite.set(d.site_id, arr);
  }
  const measurementRows = [];
  const slotMs = 15 * 60_000;
  const startSlot = Math.floor((Date.now() - 48 * 3600_000) / slotMs) * slotMs;
  for (const [i, site] of siteRows.entries()) {
    const seed = SITE_SEEDS[i];
    const tz = seed.tz;
    if (seed.comm === 'OFFLINE') continue;
    const devices = deviceBySite.get(site.id);
    const inv = devices.find((d) => d.device_type.includes('INVERTER'));
    const bess = devices.find((d) => d.device_type === 'BESS');
    const gridMeter = devices.find((d) => d.device_type === 'GRID_METER');
    const loadMeter = devices.find((d) => d.device_type === 'LOAD_METER');
    const gen = devices.find((d) => d.device_type === 'GENERATOR');
    const gateway = gatewayRows[i];
    const profile = { latitude: seed.lat, timezone: tz, seed: hashSeed(site.id), cloudiness: seed.cloudiness };
    for (let t = startSlot; t < Date.now(); t += slotMs) {
      const dt = new Date(t);
      const h = Math.floor(localHourDecimal(dt, tz));
      const solar = solarFactor(profile, dt);
      const pvKw = seed.kwp * solar * 0.865;
      const loadKw = seed.loadBaseKw + (seed.loadPeakKw - seed.loadBaseKw) * loadFactor(h, { shifts: seed.shifts });
      const soc = clamp(58 + 27 * Math.sin(((h - 8) / 24) * 2 * Math.PI), 18, 96);
      const batteryKw = pvKw > loadKw ? -Math.min(pvKw - loadKw, seed.bessPowerKw) : Math.min(loadKw - pvKw, seed.bessPowerKw);
      const gridKw = loadKw - pvKw - batteryKw;
      const base = {
        site_id: site.id, gateway_id: gateway.id, device_ts: dt.toISOString(),
        server_ts: new Date(t + 2000).toISOString(), quality: 'GOOD',
        seq: Math.floor(t / 1000), data_source: 'DEMO',
      };
      const push = (deviceId, parameterId, value, unit) => {
        measurementRows.push({ ...base, device_id: deviceId || null, parameter_id: parameterId, value: round(value, 3), unit });
      };
      push(inv?.id, 'pv_power_kw', pvKw, 'kW');
      push(inv?.id, 'pv_voltage_v', solar > 0.02 ? 620 + solar * 130 : 0, 'V');
      push(inv?.id, 'pv_current_a', solar > 0.02 ? (pvKw * 1000) / (620 + solar * 130) : 0, 'A');
      push(inv?.id, 'inverter_power_kw', pvKw, 'kW');
      push(inv?.id, 'inverter_temp_c', 38 + solar * 22, '°C');
      push(bess?.id, 'soc_pct', soc, '%');
      push(bess?.id, 'soh_pct', 97.2, '%');
      push(bess?.id, 'battery_power_kw', batteryKw, 'kW');
      push(bess?.id, 'battery_temp_c', 30 + Math.abs(batteryKw) / Math.max(1, seed.bessPowerKw) * 8, '°C');
      push(bess?.id, 'battery_voltage_v', 740 + soc * 0.6, 'V');
      push(gridMeter?.id, 'grid_power_kw', gridKw, 'kW');
      push(gridMeter?.id, 'grid_voltage_l1_v', 230 + Math.sin(t / 900_000) * 3.5, 'V');
      push(gridMeter?.id, 'grid_frequency_hz', 50 + Math.sin(t / 700_000) * 0.06, 'Hz');
      push(loadMeter?.id, 'load_power_kw', loadKw, 'kW');
      push(loadMeter?.id, 'load_energy_kwh', loadKw * ((t % 86_400_000) / 3_600_000), 'kWh');
      if (gen) push(gen.id, 'generator_power_kw', 0, 'kW');
    }
  }
  await db.insertMany('measurements', Object.keys(measurementRows[0]), measurementRows, { chunkSize: 250 });

  // ---- historical + active alarms -------------------------------------
  log('generating alarm history…');
  const alarmRows = [];
  const eventRows = [];
  const notificationRows = [];
  const pushAlarm = (site, template, deviceId, opts = {}) => {
    const id = uid('alarm');
    const triggeredAt = opts.triggeredAt || new Date(Date.now() - Math.random() * 30 * 86400_000).toISOString();
    const value = opts.value ?? round(1 + Math.random() * 20, 1);
    alarmRows.push({
      id, code: template.code, site_id: site.id, device_id: deviceId, severity: template.severity,
      category: template.category, title: template.title,
      message: template.message.replace('{v}', value).replace('{device}', 'device').replace('{period}', 'night'),
      status: opts.status || 'RESOLVED', value, threshold: opts.threshold ?? 45,
      triggered_at: triggeredAt, last_seen_at: triggeredAt,
      acknowledged_at: opts.status && opts.status !== 'ACTIVE' ? new Date(new Date(triggeredAt).getTime() + 12 * 60_000).toISOString() : null,
      acknowledged_by: opts.status && opts.status !== 'ACTIVE' ? 'operator' : null,
      resolved_at: opts.status === 'RESOLVED' || !opts.status ? new Date(new Date(triggeredAt).getTime() + 55 * 60_000).toISOString() : null,
      resolved_by: opts.status === 'RESOLVED' || !opts.status ? 'operator' : null,
      resolution_note: opts.status === 'RESOLVED' || !opts.status ? 'Condition cleared after operator inspection.' : null,
      data_source: 'DEMO',
    });
    notificationRows.push({
      id: uid('ntf'), alarm_id: id, channel: 'EMAIL', target: 'control-room@chsms.local',
      status: 'SENT', message: `${template.severity}: ${template.title} — ${site.name}`,
      created_at: triggeredAt, sent_at: triggeredAt,
    });
    return id;
  };
  SITE_SEEDS.forEach((s, i) => {
    const site = siteRows[i];
    if (s.code === 'PLTS-LPG-01' || s.code === 'PLTS-BTM-01') {
      const gw = gatewayRows[i];
      pushAlarm(site, ALARM_TEMPLATES.find((t) => t.code === 'GATEWAY_OFFLINE'), gw.id, {
        status: 'ACTIVE', triggeredAt: new Date(Date.now() - 26 * 3600_000).toISOString(), value: 26, threshold: 5,
      });
      pushAlarm(site, ALARM_TEMPLATES.find((t) => t.code === 'DEVICE_COMM_FAILURE'), null, {
        status: 'ACTIVE', triggeredAt: new Date(Date.now() - 26 * 3600_000).toISOString(), value: 3, threshold: 3,
      });
    }
    const count = 3 + Math.floor(Math.abs(Math.sin(hashSeed(site.id))) * 5);
    for (let a = 0; a < count; a += 1) {
      const template = ALARM_TEMPLATES[Math.floor(Math.abs(Math.sin(hashSeed(site.id) + a * 7.31)) * ALARM_TEMPLATES.length)];
      if (template.code === 'GATEWAY_OFFLINE') continue;
      const devices = deviceRows.filter((d) => d.site_id === site.id);
      pushAlarm(site, template, pickAlarmDevice(devices, template.category), {
        status: a % 4 === 0 ? 'ACKNOWLEDGED' : 'RESOLVED',
        triggeredAt: new Date(Date.now() - (2 + a * 5 + (hashSeed(site.id) % 6)) * 86400_000).toISOString(),
        threshold: template.severity === 'CRITICAL' ? 55 : 45,
        value: round(46 + Math.abs(Math.sin(a + i)) * 12, 1),
      });
    }
  });

  // explicit demo active faults
  const mdn = siteRows.find((s) => s.code === 'PLTS-MDN-01');
  const mdnDevices = deviceRows.filter((d) => d.site_id === mdn.id);
  pushAlarm(mdn, { code: 'GRID_FAILURE', severity: 'CRITICAL', category: 'GRID', title: 'PLN grid failure', message: 'Grid supply lost — plant running on BESS and diesel generator.' }, pickAlarmDevice(mdnDevices, 'GRID'), {
    status: 'ACTIVE', triggeredAt: new Date(Date.now() - 42 * 60_000).toISOString(), value: 0, threshold: 1,
  });
  const sda = siteRows.find((s) => s.code === 'PLTS-SDA-01');
  const sdaDevices = deviceRows.filter((d) => d.site_id === sda.id);
  pushAlarm(sda, ALARM_TEMPLATES.find((t) => t.code === 'BESS_HIGH_TEMP'), pickAlarmDevice(sdaDevices, 'BESS'), {
    status: 'ACTIVE', triggeredAt: new Date(Date.now() - 18 * 60_000).toISOString(), value: 47.8, threshold: 45,
  });
  const mtr = siteRows.find((s) => s.code === 'PLTS-MTR-01');
  const mtrDevices = deviceRows.filter((d) => d.site_id === mtr.id);
  pushAlarm(mtr, ALARM_TEMPLATES.find((t) => t.code === 'GRID_UNDERVOLTAGE'), pickAlarmDevice(mtrDevices, 'GRID'), {
    status: 'ACTIVE', triggeredAt: new Date(Date.now() - 6 * 60_000).toISOString(), value: 197.4, threshold: 200,
  });
  const bks = siteRows.find((s) => s.code === 'PLTS-BKS-01');
  const bksDevices = deviceRows.filter((d) => d.site_id === bks.id);
  pushAlarm(bks, ALARM_TEMPLATES.find((t) => t.code === 'INVERTER_FAULT'), pickAlarmDevice(bksDevices, 'INVERTER'), {
    status: 'ACKNOWLEDGED', triggeredAt: new Date(Date.now() - 3 * 3600_000).toISOString(), value: 42, threshold: 0,
  });
  const jap = siteRows.find((s) => s.code === 'PLTS-JAP-01');
  pushAlarm(jap, ALARM_TEMPLATES.find((t) => t.code === 'DEVICE_COMM_FAILURE'), null, {
    status: 'ACTIVE', triggeredAt: new Date(Date.now() - 2 * 3600_000).toISOString(), value: 3, threshold: 3,
  });

  await db.insertMany('alarms', Object.keys(alarmRows[0]), alarmRows);
  await db.insertMany('notifications', Object.keys(notificationRows[0]), notificationRows);

  for (const site of siteRows.slice(0, 10)) {
    eventRows.push({
      id: uid('evt'), ts: new Date(Date.now() - Math.random() * 20 * 86400_000).toISOString(), site_id: site.id,
      device_id: null, type: 'CONFIG_CHANGE', severity: 'INFO',
      message: `Site configuration reviewed by corporate operations.`, user_id: 'USR-CORPADMIN', data_source: 'DEMO',
    });
  }
  eventRows.push({
    id: uid('evt'), ts: now, site_id: null, device_id: null, type: 'SYSTEM', severity: 'INFO',
    message: 'Demo dataset seeded: 22 sites, 4.07 MWp PV, 6.9 MWh BESS.', user_id: 'USR-ADMIN', data_source: 'DEMO',
  });
  await db.insertMany('events', Object.keys(eventRows[0]), eventRows);

  // ---- report schedules ----------------------------------------------
  const schedules = [
    { id: uid('sch'), name: 'Monthly portfolio performance', report_type: 'PORTFOLIO_PERFORMANCE', format: 'PDF', frequency: 'MONTHLY', site_ids: JSON.stringify([]), recipients: 'board@chsms.local', enabled: 1, last_run_at: new Date(Date.now() - 6 * 86400_000).toISOString(), next_run_at: new Date(Date.now() + 9 * 86400_000).toISOString(), created_by: 'USR-ADMIN', created_at: now },
    { id: uid('sch'), name: 'Weekly BESS health', report_type: 'BESS_PERFORMANCE', format: 'XLSX', frequency: 'WEEKLY', site_ids: JSON.stringify(['SITE-PLTS-CJK-01', 'SITE-PLTS-SBY-01']), recipients: 'bess-team@chsms.local', enabled: 1, last_run_at: new Date(Date.now() - 2 * 86400_000).toISOString(), next_run_at: new Date(Date.now() + 5 * 86400_000).toISOString(), created_by: 'USR-CORPADMIN', created_at: now },
  ];
  await db.insertMany('report_schedules', Object.keys(schedules[0]), schedules);

  // ---- audit trail ----------------------------------------------------
  const auditRows = [
    { id: uid('aud'), ts: now, user_id: 'USR-ADMIN', username: 'admin', action: 'DATABASE_SEED', entity: 'system', entity_id: null, details: JSON.stringify({ sites: siteRows.length }), ip: '127.0.0.1', user_agent: 'seed-script' },
    { id: uid('aud'), ts: now, user_id: 'USR-ADMIN', username: 'admin', action: 'CREATE_USER', entity: 'user', entity_id: 'USR-OPERATOR', details: JSON.stringify({ role: 'OPERATOR' }), ip: '127.0.0.1', user_agent: 'seed-script' },
  ];
  await db.insertMany('audit_logs', Object.keys(auditRows[0]), auditRows);

  // Gateway credential provisioning file (demo only; never commit in production)
  const credPath = path.join(config.dataDir, 'gateway-credentials.json');
  fs.writeFileSync(credPath, JSON.stringify({
    note: 'DEMO credentials generated by seed. Replace with per-gateway certificates in production.',
    gatewayId: 'GW-PLTS-CJK-01',
    siteId: 'SITE-PLTS-CJK-01',
    mqttClientId: 'gw-plts-cjk-01',
    token: DEMO_GATEWAY_TOKEN,
    mqttUrl: `mqtts://localhost:${config.mqtt.tlsPort}`,
  }, null, 2), { mode: 0o600 });

  log(`seeded ${siteRows.length} sites, ${deviceRows.length} devices, ${registerRows.length} registers, ${alarmRows.length} alarms, ${dailyRows.length} daily rows, ${hourlyRows.length} hourly rows, ${measurementRows.length} measurements`);
  return { seeded: true, sites: siteRows.length, devices: deviceRows.length };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const reset = process.argv.includes('--reset');
  const { initDb, closeDb } = await import('./adapter.js');
  await initDb();
  await seedDatabase({ reset });
  await closeDb();
}
