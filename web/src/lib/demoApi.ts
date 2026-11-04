type DemoRequest = Omit<RequestInit, 'body'> & { body?: any };

const now = () => new Date().toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

const regions = [
  { id: 'REG-JB', code: 'REG-JB', name: 'West Java', timezone: 'Asia/Jakarta' },
  { id: 'REG-BTN', code: 'REG-BTN', name: 'Banten', timezone: 'Asia/Jakarta' },
  { id: 'REG-JTG', code: 'REG-JTG', name: 'Central Java & DIY', timezone: 'Asia/Jakarta' },
  { id: 'REG-JTM', code: 'REG-JTM', name: 'East Java', timezone: 'Asia/Jakarta' },
  { id: 'REG-BALI', code: 'REG-BALI', name: 'Bali & Nusa Tenggara', timezone: 'Asia/Makassar' },
  { id: 'REG-SUM', code: 'REG-SUM', name: 'Sumatera', timezone: 'Asia/Jakarta' },
];

const siteSeeds = [
  ['DEM-01', 'Hybrid Solar Demo Site 01', 'REG-JB', 'West Java', -6.28, 107.14, 320, 600, 'ONLINE'],
  ['DEM-02', 'Hybrid Solar Demo Site 02', 'REG-JB', 'West Java', -6.32, 107.33, 280, 500, 'ONLINE'],
  ['DEM-03', 'Hybrid Solar Demo Site 03', 'REG-BTN', 'Banten', -6.11, 106.15, 180, 300, 'WARNING'],
  ['DEM-04', 'Hybrid Solar Demo Site 04', 'REG-JTG', 'Central Java', -7.00, 110.43, 220, 380, 'ONLINE'],
  ['DEM-05', 'Hybrid Solar Demo Site 05', 'REG-JTM', 'East Java', -7.25, 112.75, 300, 500, 'ONLINE'],
  ['DEM-06', 'Hybrid Solar Demo Site 06', 'REG-BALI', 'Bali', -8.65, 115.21, 120, 200, 'MAINTENANCE'],
  ['DEM-07', 'Hybrid Solar Demo Site 07', 'REG-SUM', 'Sumatera', 0.50, 101.44, 140, 240, 'ONLINE'],
  ['DEM-08', 'Hybrid Solar Demo Site 08', 'REG-SUM', 'Sumatera', 3.59, 98.67, 260, 420, 'OFFLINE'],
] as const;

const sites = siteSeeds.map((seed, index) => {
  const [code, name, regionId, location, latitude, longitude, pv, bess, status] = seed;
  const id = `SITE-${code}`;
  const soc = 48 + ((index * 7 + 23) % 46);
  const pvPower = status === 'OFFLINE' ? 0 : round(pv * (0.32 + (index % 4) * 0.07));
  const loadPower = round(pv * (0.4 + (index % 3) * 0.08));
  const pvTodayKwh = round(pv * (3.4 + (index % 4) * 0.16));
  const alarms = status === 'WARNING' ? 2 : status === 'OFFLINE' ? 1 : 0;
  return {
    id, code: `PLTS-${code}`, name, region_id: regionId, regionId, region_name: location,
    regionName: location, region_code: regionId, location: `${location}, Indonesia`,
    latitude, longitude, timezone: 'Asia/Jakarta', pv_capacity_kwp: pv, pvCapacityKwp: pv,
    inverter_capacity_kw: round(pv * 1.1), bess_capacity_kwh: bess, bessCapacityKwh: bess,
    bess_power_kw: Math.round(bess / 4), inverter_count: 2 + index % 3, battery_rack_count: 2 + index % 3,
    meter_count: 2, grid_connection_type: '20 kV MV', grid_provider: 'Utility',
    grid_voltage_kv: 20, grid_capacity_kva: Math.round(pv * 1.25), generator_count: index % 3 ? 1 : 0,
    generator_capacity_kw: index % 3 ? Math.round(pv * 0.6) : 0, status,
    comm_status: status === 'OFFLINE' ? 'OFFLINE' : status === 'WARNING' ? 'DEGRADED' : 'ONLINE',
    last_seen_at: status === 'OFFLINE' ? ago(18) : ago(index + 1), data_source: 'DEMO', dataSource: 'DEMO',
    alarm_count: alarms, alarmCount: alarms, pvPowerKw: pvPower, loadPowerKw: loadPower,
    socPct: soc, pvTodayKwh, pvTodayMwh: round(pvTodayKwh / 1000, 2),
    bessPowerKw: round((soc - 65) * 0.18), locationLabel: `${location}, Indonesia`,
  };
});
export const demoSiteList = sites;

const alarms = [
  { id: 'ALM-DEMO-001', site_id: sites[2].id, site_code: sites[2].code, site_name: sites[2].name, code: 'BESS_HIGH_TEMP', severity: 'WARNING', category: 'BESS', title: 'Battery temperature elevated', message: 'Synthetic battery temperature exceeded the demo warning threshold.', status: 'ACTIVE', value: 41.8, threshold: 40, triggered_at: ago(12), data_source: 'DEMO' },
  { id: 'ALM-DEMO-002', site_id: sites[7].id, site_code: sites[7].code, site_name: sites[7].name, code: 'GATEWAY_OFFLINE', severity: 'CRITICAL', category: 'COMMUNICATION', title: 'Gateway communication interrupted', message: 'Synthetic demo gateway has not reported recently.', status: 'ACTIVE', value: 18, threshold: 10, triggered_at: ago(30), data_source: 'DEMO' },
  { id: 'ALM-DEMO-003', site_id: sites[1].id, site_code: sites[1].code, site_name: sites[1].name, code: 'PV_UNDERPERFORM', severity: 'INFO', category: 'PV', title: 'PV output below daily forecast', message: 'Synthetic production is within the expected demo variation.', status: 'ACKNOWLEDGED', value: 87, threshold: 90, triggered_at: ago(95), data_source: 'DEMO' },
  { id: 'ALM-DEMO-004', site_id: sites[4].id, site_code: sites[4].code, site_name: sites[4].name, code: 'GRID_VOLTAGE_VARIATION', severity: 'WARNING', category: 'GRID', title: 'Grid voltage variation', message: 'Sample grid voltage is outside the nominal range.', status: 'ACTIVE', value: 244.2, threshold: 242, triggered_at: ago(180), data_source: 'DEMO' },
  { id: 'ALM-DEMO-005', site_id: sites[5].id, site_code: sites[5].code, site_name: sites[5].name, code: 'MAINTENANCE_WINDOW', severity: 'INFO', category: 'SYSTEM', title: 'Scheduled maintenance window', message: 'Synthetic maintenance status for this demo site.', status: 'RESOLVED', value: null, threshold: null, triggered_at: ago(400), data_source: 'DEMO' },
];

const devices = sites.flatMap((site, siteIndex) => [
  { id: `DEV-${site.code}-INV-01`, site_id: site.id, site_code: site.code, site_name: site.name, gateway_id: `GW-${site.code}`, name: 'Hybrid inverter 01', device_type: 'HYBRID_INVERTER', manufacturer: 'Demo Energy', model: 'HE-100', serial: `DEMO-INV-${siteIndex + 1}-01`, ip_address: '—', port: 502, unit_id: 1, firmware: 'demo-1.0', status: site.status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE', last_seen_at: site.last_seen_at, model_id: 'MODEL-DEMO-INV', data_source: 'DEMO' },
  { id: `DEV-${site.code}-BESS-01`, site_id: site.id, site_code: site.code, site_name: site.name, gateway_id: `GW-${site.code}`, name: 'Battery energy storage', device_type: 'BESS', manufacturer: 'Demo Storage', model: 'DS-200', serial: `DEMO-BESS-${siteIndex + 1}`, ip_address: '—', port: 502, unit_id: 2, firmware: 'demo-1.0', status: site.status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE', last_seen_at: site.last_seen_at, model_id: 'MODEL-DEMO-BESS', data_source: 'DEMO' },
  { id: `DEV-${site.code}-METER-01`, site_id: site.id, site_code: site.code, site_name: site.name, gateway_id: `GW-${site.code}`, name: 'Grid meter', device_type: 'GRID_METER', manufacturer: 'Demo Metering', model: 'DM-3P', serial: `DEMO-MTR-${siteIndex + 1}`, ip_address: '—', port: 502, unit_id: 3, firmware: 'demo-1.0', status: site.status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE', last_seen_at: site.last_seen_at, model_id: 'MODEL-DEMO-METER', data_source: 'DEMO' },
]);

const gateways = sites.map((site, index) => ({
  id: `GW-${site.code}`, site_id: site.id, site_code: site.code, site_name: site.name,
  site_location: site.location, region_name: site.regionName, name: `Edge gateway ${String(index + 1).padStart(2, '0')}`,
  serial: `DEMO-GW-${String(index + 1).padStart(3, '0')}`, hardware: 'Simulated edge gateway',
  firmware: 'demo-1.0', ip_address: 'not connected', status: site.status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE',
  last_seen_at: site.last_seen_at, mqtt_client_id: `demo-client-${index + 1}`, token_hint: 'not provisioned',
  cert_fingerprint: 'demo-only', buffer_backlog: site.status === 'OFFLINE' ? 12 : 0,
  latency_ms: site.status === 'OFFLINE' ? null : 32 + index * 7, cpu_pct: 15 + index * 3,
  mem_pct: 28 + index * 2, uptime_sec: 86400 * (index + 2), version: 'demo-1.0',
  data_source: 'DEMO', created_at: ago(24 * 60), updated_at: ago(index + 2),
}));

const daily = Array.from({ length: 30 }, (_, index) => {
  const day = new Date(Date.now() - (29 - index) * 86400_000).toISOString().slice(0, 10);
  const factor = 0.88 + ((index * 13) % 22) / 100;
  return {
    day, period: day, pvMwh: round(2.1 * factor, 3), loadMwh: round(1.7 * factor, 3),
    importMwh: round(0.55 * factor, 3), exportMwh: round(0.72 * factor, 3),
    generatorMwh: round(index % 9 === 0 ? 0.04 : 0, 3), chargeMwh: round(0.36 * factor, 3),
    dischargeMwh: round(0.31 * factor, 3), peakLoadMw: round(0.29 * factor, 3),
  };
});

const performanceSites = sites.map((site, index) => ({
  siteId: site.id, code: site.code, name: site.name, location: site.location,
  pvCapacityKwp: site.pv_capacity_kwp, pvMwh: round(4.2 + index * 0.61, 2),
  specificYield: round(3.55 + (index % 5) * 0.19, 2),
  performanceRatio: round(0.73 + (index % 4) * 0.045, 3),
  capacityFactorPct: round(14 + (index % 5) * 1.6, 1),
  capacityUtilisationPct: round(14 + (index % 5) * 1.6, 1),
  selfConsumptionPct: 62 + index * 3, performanceBand: index % 4 ? 'TARGET' : 'WATCH',
  yieldBand: index % 3 ? 'NORMAL' : 'STRONG', dataSource: 'DEMO',
}));

const alarmRules = [
  { id: 'RULE-DEMO-01', code: 'BESS_HIGH_TEMP', name: 'Battery temperature high', parameter_id: 'bess.temperature_c', severity: 'WARNING', operator: '>', threshold: 40, duration_sec: 60, category: 'BESS', enabled: 1 },
  { id: 'RULE-DEMO-02', code: 'GATEWAY_OFFLINE', name: 'Gateway offline', parameter_id: 'gateway.last_seen', severity: 'CRITICAL', operator: '>', threshold: 10, duration_sec: 300, category: 'COMMUNICATION', enabled: 1 },
  { id: 'RULE-DEMO-03', code: 'PV_UNDERPERFORM', name: 'PV underperformance', parameter_id: 'pv.performance_ratio', severity: 'INFO', operator: '<', threshold: 0.72, duration_sec: 600, category: 'PV', enabled: 1 },
];

const registers = devices.slice(0, 16).map((device, index) => ({
  id: `REG-DEMO-${index + 1}`, device_id: device.id, device_name: device.name,
  device_type: device.device_type, ip_address: '—', port: 502, unit_id: 1,
  site_id: device.site_id, site_code: device.site_code, site_name: device.site_name,
  parameter_id: ['pv_power_kw', 'battery_soc_pct', 'grid_voltage_v', 'load_power_kw'][index % 4],
  name: ['PV active power', 'Battery state of charge', 'Grid line voltage', 'Load power'][index % 4],
  function_code: 3, address: index * 2, register_type: 'HOLDING',
  data_type: index % 2 ? 'UINT16' : 'FLOAT32', word_order: 'BIG', byte_order: 'BIG',
  scale: 1, offset: 0, unit: ['kW', '%', 'V', 'kW'][index % 4],
  poll_interval_sec: 10, enabled: 1, description: 'Synthetic read-only example mapping',
}));

const roles = [
  { id: 'ROLE-SUPER_ADMIN', code: 'SUPER_ADMIN', name: 'Super Administrator', permissions: [] },
  { id: 'ROLE-CORPORATE_ADMIN', code: 'CORPORATE_ADMIN', name: 'Corporate Administrator', permissions: [] },
  { id: 'ROLE-REGIONAL_MANAGER', code: 'REGIONAL_MANAGER', name: 'Regional Manager', permissions: [] },
  { id: 'ROLE-SITE_ADMIN', code: 'SITE_ADMIN', name: 'Site Administrator', permissions: [] },
  { id: 'ROLE-OPERATOR', code: 'OPERATOR', name: 'Operator', permissions: [] },
  { id: 'ROLE-VIEWER', code: 'VIEWER', name: 'Viewer', permissions: [] },
];

const users = [
  { id: 'USR-DEMO-01', username: 'demo-admin', full_name: 'Demo Administrator', email: 'admin@example.invalid', role_code: 'SUPER_ADMIN', role_name: 'Super Administrator', status: 'ACTIVE', last_login_at: ago(15), site_count: sites.length },
  { id: 'USR-DEMO-02', username: 'demo-operator', full_name: 'Demo Operator', email: 'operator@example.invalid', role_code: 'OPERATOR', role_name: 'Operator', status: 'ACTIVE', last_login_at: ago(120), site_count: 3 },
  { id: 'USR-DEMO-03', username: 'demo-viewer', full_name: 'Demo Viewer', email: 'viewer@example.invalid', role_code: 'VIEWER', role_name: 'Viewer', status: 'ACTIVE', last_login_at: ago(360), site_count: 2 },
];

function liveSnapshot(site: (typeof sites)[number], index: number) {
  const solar = site.status === 'OFFLINE' ? 0 : site.pvPowerKw;
  const load = site.loadPowerKw;
  const battery = site.socPct < 55 ? 14 : -18;
  const grid = Math.max(0, load - solar - battery);
  return {
    siteId: site.id, siteCode: site.code, siteName: site.name, ts: now(), stale: site.status === 'OFFLINE',
    commStatus: site.comm_status, dataSource: 'DEMO', quality: 'SYNTHETIC',
    pv: { powerKw: solar, dailyKwh: site.pvTodayKwh, irradianceWm2: 420 + index * 35, performanceRatio: 0.78 + (index % 3) * 0.04 },
    bess: { socPct: site.socPct, sohPct: 96 - index % 4, powerKw: battery, chargePowerKw: battery < 0 ? Math.abs(battery) : 0, dischargePowerKw: battery > 0 ? battery : 0, temperatureC: 29 + index, bmsStatus: 'NORMAL', racks: [] },
    grid: { available: site.status !== 'OFFLINE', activePowerKw: grid, importKw: grid, exportKw: Math.max(0, solar - load), voltageL1V: 229 + index % 7, frequencyHz: 50 + (index % 3) / 100 },
    generator: { present: index % 3 !== 0, running: false, powerKw: 0, fuelLevelPct: 76 - index * 2, capacityKw: site.generator_capacity_kw },
    load: { powerKw: load, powerFactor: 0.94 + (index % 4) / 100 },
    flow: { pvKw: solar, batteryKw: battery, gridKw: grid, generatorKw: 0, loadKw: load },
    energy: { pvTodayKwh: site.pvTodayKwh, loadTodayKwh: round(site.pvTodayKwh * 0.74), importTodayKwh: round(site.pvTodayKwh * 0.18) },
    gateway: { status: site.status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE' },
  };
}

export function demoLivePortfolio() {
  const active = sites.filter((site) => site.status !== 'OFFLINE');
  return {
    pvPowerMw: round(active.reduce((sum, site) => sum + site.pvPowerKw, 0) / 1000, 3),
    loadPowerMw: round(active.reduce((sum, site) => sum + site.loadPowerKw, 0) / 1000, 3),
    chargePowerMw: 0.12, dischargePowerMw: 0.08, gridImportMw: 0.22, gridExportMw: 0.31,
    generatorPowerMw: 0, avgSocPct: round(sites.reduce((sum, site) => sum + site.socPct, 0) / sites.length, 1),
    onlineSites: active.length, offlineSites: sites.length - active.length, ts: now(),
  };
}

export function demoLiveSites() {
  return sites.map((site, index) => liveSnapshot(site, index));
}

const hourly = Array.from({ length: 24 }, (_, hour) => {
  const sun = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  return {
    hour: `${String(hour).padStart(2, '0')}:00`,
    pvKwh: round(72 * sun), loadKwh: round(95 + 32 * Math.sin((hour / 24) * Math.PI * 2)),
    importKwh: round(Math.max(0, 32 - 60 * sun)), exportKwh: round(Math.max(0, 24 * sun)),
    chargeKwh: round(28 * sun), dischargeKwh: round(hour < 6 || hour > 18 ? 14 : 2),
    generatorKwh: hour === 2 ? 3 : 0,
  };
});

const reportTypes = [
  { code: 'PORTFOLIO_PERFORMANCE', name: 'Portfolio performance' },
  { code: 'SITE_PERFORMANCE', name: 'Site performance' },
  { code: 'BESS_PERFORMANCE', name: 'BESS performance' },
  { code: 'ALARM_SUMMARY', name: 'Alarm summary' },
];

const sampleReports = [
  { id: 'RPT-DEMO-01', name: 'Synthetic monthly portfolio summary', report_type: 'PORTFOLIO_PERFORMANCE', format: 'PDF', site_ids: [], size_kb: 248, created_by: 'demo-viewer', created_at: ago(720), period_start: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10), period_end: new Date().toISOString().slice(0, 10), status: 'READY', downloadUrl: '#demo-report' },
];

const sampleSchedules = [
  { id: 'SCH-DEMO-01', name: 'Demo monthly portfolio review', report_type: 'PORTFOLIO_PERFORMANCE', format: 'PDF', frequency: 'MONTHLY', site_ids: [], recipients: [], enabled: 1, next_run_at: ago(-24 * 60), last_run_at: ago(6 * 24 * 60), created_by: 'demo-viewer' },
];

const sampleTariffs = [
  { id: 'TAR-DEMO-01', site_id: null, name: 'Demo flat utility tariff', type: 'ENERGY', rate: 1444.7, currency: 'IDR', import_rate_idr_kwh: 1444.7, export_rate_idr_kwh: 900, effective_from: '2025-01-01', enabled: 1 },
];

function filterSites(params: URLSearchParams) {
  const region = params.get('region') || '';
  const status = params.get('status') || '';
  const search = (params.get('search') || '').toLowerCase();
  const source = params.get('dataSource') || '';
  return sites.filter((site) =>
    (!region || site.region_code === region || site.region_id === region)
    && (!status || site.status === status)
    && (!source || source === 'DEMO')
    && (!search || `${site.code} ${site.name} ${site.location}`.toLowerCase().includes(search)),
  );
}

function overviewPayload(rows = sites) {
  const pvCapacity = rows.reduce((sum, site) => sum + site.pv_capacity_kwp, 0);
  const bessCapacity = rows.reduce((sum, site) => sum + site.bess_capacity_kwh, 0);
  const live = demoLivePortfolio();
  const alarmsInScope = alarms.filter((alarm) => rows.some((site) => site.id === alarm.site_id) && alarm.status !== 'RESOLVED');
  return {
    portfolio: {
      siteCount: rows.length, onlineSites: rows.filter((s) => s.status === 'ONLINE').length,
      offlineSites: rows.filter((s) => s.status === 'OFFLINE').length,
      pvCapacityMwp: round(pvCapacity / 1000, 2), bessCapacityMwh: round(bessCapacity / 1000, 2),
      pvPowerMw: live.pvPowerMw, loadPowerMw: live.loadPowerMw, pvTodayMwh: round(rows.reduce((n, s) => n + s.pvTodayKwh, 0) / 1000, 2),
      importTodayMwh: 1.24, exportTodayMwh: 1.86, generatorTodayMwh: 0.04, dischargeTodayMwh: 0.46,
      renewableSharePct: 72.4, avgSocPct: live.avgSocPct, activeAlarms: alarmsInScope.length,
      savingsIdr: 12_845_000, co2AvoidedKg: 2840,
    },
    sites: rows.map((site) => ({
      ...site, pvPowerKw: site.pvPowerKw, loadPowerKw: site.loadPowerKw,
      socPct: site.socPct, pvTodayKwh: site.pvTodayKwh,
    })),
    trends: daily.slice(-14).map((row) => ({ day: row.day, pvKwh: row.pvMwh * 1000, loadKwh: row.loadMwh * 1000 })),
    alarmCounts: {
      CRITICAL: alarmsInScope.filter((a) => a.severity === 'CRITICAL').length,
      WARNING: alarmsInScope.filter((a) => a.severity === 'WARNING').length,
      INFO: alarmsInScope.filter((a) => a.severity === 'INFO').length,
      total: alarmsInScope.length,
    },
    regions: regions.filter((region) => rows.some((site) => site.region_id === region.id)),
    statusCounts: Object.fromEntries(['ONLINE', 'WARNING', 'CRITICAL', 'MAINTENANCE', 'OFFLINE'].map((status) => [status, rows.filter((s) => s.status === status).length])),
    dataSources: { demo: rows.length, live: 0 }, demoMode: true, generatedAt: now(),
  };
}

function performancePayload() {
  const totalCapacity = performanceSites.reduce((sum, site) => sum + site.pvCapacityKwp, 0);
  const totalPv = performanceSites.reduce((sum, site) => sum + site.pvMwh, 0);
  return {
    targetPr: 0.82,
    summary: {
      pvMwh: round(totalPv, 2), totalPvCapacityKwp: totalCapacity,
      specificYieldKwhPerKwp: round(totalPv * 1000 / totalCapacity, 2),
      performanceRatio: 0.806, capacityUtilisationPct: 16.8, peakPvMw: 1.42,
    },
    sites: performanceSites,
    bestPerformers: [...performanceSites].sort((a, b) => b.performanceRatio - a.performanceRatio).slice(0, 4),
    worstPerformers: [...performanceSites].sort((a, b) => a.performanceRatio - b.performanceRatio).slice(0, 4),
    performanceRatioTrend: Array.from({ length: 12 }, (_, i) => ({ month: `M${i + 1}`, performanceRatio: round(0.77 + (i % 5) * 0.018, 3) })),
  };
}

function energyPayload() {
  const summary = {
    days: 30, pvMwh: 62.4, loadMwh: 51.2, importMwh: 16.8, exportMwh: 20.6, generatorMwh: 0.18,
    chargeMwh: 10.2, dischargeMwh: 8.8, peakLoadMw: 0.43, renewableSharePct: 72.4,
    co2AvoidedKg: 38_400, selfConsumptionPct: 68.5, capacityUtilisationPct: 16.8,
    bessCycles: 18.4, savingsIdr: 91_240_000, exportRevenueIdr: 18_540_000,
    tariffIdrPerKwh: 1444.7, specificYieldKwhPerKwp: 3.72, performanceRatio: 0.806,
  };
  return {
    range: { from: daily[0].day, to: daily[daily.length - 1].day, granularity: 'daily' },
    summary, comparison: performanceSites.map((site) => ({
      ...site, loadMwh: round(site.pvMwh * 0.82, 2), importMwh: round(site.pvMwh * 0.27, 2),
      exportMwh: round(site.pvMwh * 0.31, 2), savingsIdr: Math.round(site.pvMwh * 1_420_000),
      specificYield: site.specificYield, performanceRatio: site.performanceRatio,
    })),
    daily, monthly: daily.slice(-12), series: daily, granularity: 'daily',
    siteCount: sites.length,
    live: { pvPowerMw: demoLivePortfolio().pvPowerMw, loadPowerMw: demoLivePortfolio().loadPowerMw, renewableSharePct: 72.4, sitesReporting: sites.length - 1 },
    dataSources: { demo: sites.length, live: 0 },
  };
}

function alarmStats() {
  const open = alarms.filter((alarm) => alarm.status !== 'RESOLVED');
  const bySeverity = Object.fromEntries(['CRITICAL', 'WARNING', 'INFO'].map((severity) => [severity, open.filter((a) => a.severity === severity).length]));
  return {
    active: open.length, total: alarms.length, last24h: alarms.length - 1,
    counts: { ...bySeverity, total: open.length, byStatus: { ACTIVE: alarms.filter((a) => a.status === 'ACTIVE').length, ACKNOWLEDGED: alarms.filter((a) => a.status === 'ACKNOWLEDGED').length, RESOLVED: alarms.filter((a) => a.status === 'RESOLVED').length } },
    bySeverity, byCategory: { BESS: 1, COMMUNICATION: 1, GRID: 1, PV: 1 },
  };
}

function gatewayDetail(id: string) {
  const gateway = gateways.find((item) => item.id === id) || gateways[0];
  return {
    gateway, devices: devices.filter((item) => item.gateway_id === gateway.id),
    health: Array.from({ length: 24 }, (_, i) => ({ ts: ago(24 * 60 - i * 60), online: gateway.status === 'ONLINE', latency_ms: gateway.latency_ms, backlog: gateway.buffer_backlog, cpu_pct: gateway.cpu_pct, mem_pct: gateway.mem_pct })),
    comm: [],
  };
}

function analyticsResponse(path: string) {
  if (path === '/api/analytics/performance') return performancePayload();
  if (path === '/api/analytics/savings') {
    return { totals: { savingsIdr: 91_240_000, co2AvoidedKg: 38_400, exportRevenueIdr: 18_540_000 }, bySite: performanceSites.map((site) => ({ ...site, savingsIdr: Math.round(site.pvMwh * 1_420_000), co2AvoidedKg: Math.round(site.pvMwh * 612) })) };
  }
  if (path === '/api/analytics/bess') {
    const bessSites = sites.map((site, index) => ({
      siteId: site.id, code: site.code, name: site.name, capacityKwh: site.bess_capacity_kwh,
      powerKw: Math.round(site.bess_capacity_kwh / 4), socPct: site.socPct,
      sohPct: 96 - index % 4, temperatureC: 29 + index, chargeKwh: 130 + index * 12,
      dischargeKwh: 116 + index * 10, cycles: round(18 + index * 0.7, 1),
    }));
    return {
      totals: { capacityKwh: sites.reduce((sum, site) => sum + site.bess_capacity_kwh, 0), avgSocPct: demoLivePortfolio().avgSocPct, chargeKwh: 1120, dischargeKwh: 984, cycles: 18.4, roundTripEfficiencyPct: 87.9 },
      sites: bessSites, hourly: hourly.map(({ hour, chargeKwh, dischargeKwh }) => ({ hour, chargeKwh: chargeKwh * sites.length, dischargeKwh: dischargeKwh * sites.length })),
    };
  }
  if (path === '/api/analytics/grid-generator') {
    const gridSites = sites.map((site, i) => ({
      siteId: site.id, code: site.code, name: site.name, gridAvailable: site.status !== 'OFFLINE',
      gridVoltageV: 229 + i % 7, frequencyHz: 50 + (i % 3) / 100,
      importKw: site.loadPowerKw * 0.28, exportKw: site.pvPowerKw * 0.22, powerFactor: 0.94 + (i % 4) / 100,
      generatorPresent: site.generator_count > 0, generatorRunning: false, generatorPowerKw: 0,
      fuelLevelPct: 72 - i * 3, generatorHours: 120 + i * 18,
    }));
    return {
      totals: { importKwh: 16_800, exportKwh: 20_600, gridAvailableSites: 7, gridOfflineSites: 1, generatorKwh: 180, generatorsPresent: 6, generatorOutputKw: 0, generatorRunning: 0, generatorCapacityKw: 900 },
      sites: gridSites, hourly,
    };
  }
  if (path === '/api/analytics/load') {
    return {
      totals: { loadMwh: 51.2, peakLoadMw: 0.43, loadFactorPct: 63.2, pvMwh: 62.4, solarCoveragePct: 72.4, gridImportMwh: 16.8, liveLoadMw: demoLivePortfolio().loadPowerMw, livePvMw: demoLivePortfolio().pvPowerMw },
      sites: sites.map((site) => ({ siteId: site.id, code: site.code, name: site.name, location: site.location, capacityKwp: site.pv_capacity_kwp, liveLoadKw: site.loadPowerKw, livePvKw: site.pvPowerKw })),
      hourlyProfile: hourly, daily: daily.map((row) => ({ day: row.day, loadMwh: row.loadMwh, pvMwh: row.pvMwh, importMwh: row.importMwh })),
    };
  }
  return energyPayload();
}

export async function demoApi<T>(rawPath: string, options: DemoRequest = {}): Promise<T> {
  await new Promise((resolve) => window.setTimeout(resolve, 25));
  const url = new URL(rawPath, window.location.origin);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = (options.method || 'GET').toUpperCase();
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
  const result = respond(path, url.searchParams, method, body);
  return result as T;
}

function respond(path: string, query: URLSearchParams, method: string, body: any): any {
  if (path === '/api/auth/me') return { user: { id: 'public-demo-user', username: 'demo-viewer', fullName: 'Public Demo Viewer', role: 'SUPER_ADMIN', roleName: 'Public Demo', permissions: [], timezone: 'Asia/Jakarta', siteIds: sites.map((site) => site.id), sites } };
  if (path === '/api/auth/login') return { user: { id: 'public-demo-user', username: 'demo-viewer', fullName: 'Public Demo Viewer', role: 'SUPER_ADMIN', roleName: 'Public Demo', permissions: [], timezone: 'Asia/Jakarta', siteIds: sites.map((site) => site.id), sites } };
  if (path === '/api/auth/logout') return { ok: true };

  if (path === '/api/sites/regions' || path === '/api/settings/regions') {
    return { regions: regions.map((region) => ({ ...region, siteCount: sites.filter((site) => site.region_id === region.id).length })) };
  }
  if (path === '/api/sites/overview') return overviewPayload(filterSites(query));
  if (path === '/api/sites') {
    const rows = filterSites(query);
    return { sites: rows, total: rows.length, statusCounts: overviewPayload(rows).statusCounts, dataSources: { demo: rows.length, live: 0 } };
  }
  const siteHistory = path.match(/^\/api\/sites\/([^/]+)\/history$/);
  if (siteHistory) return { energy: { series: daily.slice(-14) }, telemetry: hourly };
  const siteMatch = path.match(/^\/api\/sites\/([^/]+)$/);
  if (siteMatch) {
    const site = sites.find((item) => item.id === decodeURIComponent(siteMatch[1]));
    if (!site) return { site: null, live: null, devices: [], bessRacks: [], recentAlarms: [], alarmCounts: {}, tariffs: [], config: {} };
    const gateway = gateways.find((item) => item.site_id === site.id) || null;
    return {
      site, live: liveSnapshot(site, sites.indexOf(site)), gateway,
      devices: devices.filter((device) => device.site_id === site.id),
      bessRacks: [{ id: `RACK-${site.code}-01`, site_id: site.id, site_code: site.code, site_name: site.name, device_id: `DEV-${site.code}-BESS-01`, name: 'Battery rack 01', capacity_kwh: Math.round(site.bess_capacity_kwh / 2), module_count: 8, soc: site.socPct, status: 'ONLINE' }],
      alarmCounts: { CRITICAL: 0, WARNING: site.alarmCount, INFO: 0, total: site.alarmCount },
      recentAlarms: alarms.filter((alarm) => alarm.site_id === site.id),
      config: { demo: 'true', readOnlyMonitoring: 'true' },
      tariffs: sampleTariffs,
      energy: { pv_kwh: site.pvTodayKwh, load_kwh: round(site.pvTodayKwh * 0.74), day: new Date().toISOString().slice(0, 10) },
      telemetry: liveSnapshot(site, sites.indexOf(site)), readOnlyMonitoring: true,
    };
  }

  if (path.startsWith('/api/analytics')) return analyticsResponse(path);

  if (path === '/api/alarms/stats') return alarmStats();
  if (path === '/api/alarms/rules') return { rules: alarmRules };
  if (path === '/api/alarms/events') {
    const filtered = alarms.filter((alarm) =>
      (!query.get('siteId') || alarm.site_id === query.get('siteId'))
      && (!query.get('severity') || alarm.severity === query.get('severity'))
      && (!query.get('type') || alarm.category === query.get('type')),
    );
    return { events: filtered, alarms: filtered, sites, total: filtered.length, page: 1, pageSize: 25 };
  }
  if (path === '/api/alarms') {
    const filtered = alarms.filter((alarm) => {
      const status = query.get('status');
      return (!status || status === 'OPEN' ? alarm.status !== 'RESOLVED' : alarm.status === status)
        && (!query.get('siteId') || alarm.site_id === query.get('siteId'));
    });
    const counts = alarmStats().counts;
    return { alarms: filtered, total: filtered.length, page: 1, pageSize: 25, counts };
  }
  if (/^\/api\/alarms\/[^/]+$/.test(path) && method === 'GET') {
    const alarm = alarms.find((item) => item.id === path.split('/').pop()) || alarms[0];
    return { alarm, notifications: [], history: [] };
  }

  if (path === '/api/devices/models') return {
    models: [
      { id: 'MODEL-DEMO-INV', manufacturer: 'Demo Energy', model: 'HE-100', device_type: 'HYBRID_INVERTER', protocol: 'MODBUS_TCP', register_template: [] },
      { id: 'MODEL-DEMO-BESS', manufacturer: 'Demo Storage', model: 'DS-200', device_type: 'BESS', protocol: 'MODBUS_TCP', register_template: [] },
      { id: 'MODEL-DEMO-METER', manufacturer: 'Demo Metering', model: 'DM-3P', device_type: 'GRID_METER', protocol: 'MODBUS_TCP', register_template: [] },
    ],
  };
  if (path === '/api/devices/bess-racks') {
    const racks = sites.map((site) => ({ id: `RACK-${site.code}-01`, site_id: site.id, site_code: site.code, site_name: site.name, device_id: `DEV-${site.code}-BESS-01`, name: 'Battery rack 01', capacity_kwh: Math.round(site.bess_capacity_kwh / 2), module_count: 8, soc: site.socPct, status: 'ONLINE' }));
    return { racks, total: racks.length };
  }
  if (path === '/api/devices') {
    const filtered = devices.filter((device) =>
      (!query.get('siteId') || device.site_id === query.get('siteId'))
      && (!query.get('type') || device.device_type === query.get('type'))
      && (!query.get('status') || device.status === query.get('status'))
      && (!query.get('search') || `${device.name} ${device.site_code} ${device.serial}`.toLowerCase().includes((query.get('search') || '').toLowerCase())),
    );
    return { devices: filtered, total: filtered.length, byType: Object.fromEntries([...new Set(devices.map((d) => d.device_type))].map((type) => [type, devices.filter((d) => d.device_type === type).length])), byStatus: { ONLINE: filtered.filter((d) => d.status === 'ONLINE').length, OFFLINE: filtered.filter((d) => d.status === 'OFFLINE').length }, page: 1, pageSize: filtered.length };
  }
  const deviceMatch = path.match(/^\/api\/devices\/([^/]+)$/);
  if (deviceMatch && method === 'GET') {
    const device = devices.find((item) => item.id === decodeURIComponent(deviceMatch[1])) || devices[0];
    return { device, registers: registers.filter((row) => row.device_id === device.id), model: { id: device.model_id, register_template: [] }, latest: {} };
  }

  if (path === '/api/gateways') {
    const filtered = gateways.filter((gateway) =>
      (!query.get('status') || gateway.status === query.get('status'))
      && (!query.get('search') || `${gateway.name} ${gateway.serial} ${gateway.site_code}`.toLowerCase().includes((query.get('search') || '').toLowerCase())),
    );
    return {
      gateways: filtered, total: filtered.length,
      summary: { total: filtered.length, ONLINE: filtered.filter((g) => g.status === 'ONLINE').length, OFFLINE: filtered.filter((g) => g.status === 'OFFLINE').length, DEGRADED: 0, backlog: 12, avgLatencyMs: 48 },
      broker: { tlsPort: 8883, plainPort: 1883, tlsRequired: true, outboundOnly: true, readOnly: true },
    };
  }
  const gatewayHealth = path.match(/^\/api\/gateways\/([^/]+)\/health$/);
  if (gatewayHealth) return { gatewayId: gatewayHealth[1], hours: 24, samples: 24, availabilityPct: 97.9, avgLatencyMs: 48, maxBacklog: 12, series: Array.from({ length: 24 }, (_, i) => ({ ts: ago((24 - i) * 60), online: i !== 4, latencyMs: 34 + (i * 13) % 47, backlog: i === 4 ? 12 : 0, cpuPct: 18 + i % 13, memPct: 32 + i % 9 })) };
  const gatewayConfig = path.match(/^\/api\/gateways\/([^/]+)\/config$/);
  if (gatewayConfig) return { gateway: gateways.find((g) => g.id === gatewayConfig[1]) || gateways[0], config: { demo: true }, tokenHint: 'not provisioned', security: { outboundOnly: true, tlsRequired: true, plaintextLoopbackOnly: true, modbusPortExposedPublicly: false, readOnlyMonitoring: true } };
  const gatewayMatch = path.match(/^\/api\/gateways\/([^/]+)$/);
  if (gatewayMatch) return gatewayDetail(decodeURIComponent(gatewayMatch[1]));

  if (path === '/api/modbus/registers') return { registers, total: registers.length, page: 1, pageSize: registers.length };
  if (path === '/api/modbus/templates') return { templates: [
    { id: 'TPL-DEMO-INV', manufacturer: 'Demo Energy', model: 'HE-100', deviceType: 'HYBRID_INVERTER', protocol: 'MODBUS_TCP', description: 'Synthetic inverter example', registerCount: 2, registers: registers.slice(0, 2) },
    { id: 'TPL-DEMO-BESS', manufacturer: 'Demo Storage', model: 'DS-200', deviceType: 'BESS', protocol: 'MODBUS_TCP', description: 'Synthetic storage example', registerCount: 2, registers: registers.slice(2, 4) },
  ] };
  if (path === '/api/modbus/test-log') return { logs: [], total: 0, page: 1, pageSize: 50 };
  if (path === '/api/modbus/decode') return { values: [], decoded: [], message: 'Static demonstration: no device connection was made.' };

  if (path === '/api/reports/types') return { types: reportTypes, formats: ['PDF', 'XLSX', 'CSV'], frequencies: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] };
  if (path === '/api/reports/schedules') return { schedules: sampleSchedules };
  if (path === '/api/reports') return { reports: sampleReports, total: sampleReports.length, page: 1, pageSize: 50 };

  if (path === '/api/settings') return {
    settings: { platformName: 'Hybrid Solar Monitoring Demo', timezone: 'Asia/Jakarta', currency: 'IDR', demoMode: true, readOnlyMonitoring: true },
    platform: { name: 'CHSMS', version: '1.0.0', environment: 'Public synthetic demo' },
    tariffs: sampleTariffs, regions, sites,
  };
  if (path === '/api/settings/tariffs') return { tariffs: sampleTariffs, rows: sampleTariffs, total: sampleTariffs.length };
  if (path === '/api/users/roles') return { roles };
  if (path === '/api/users/sessions/active') return { sessions: [{ id: 'SESSION-DEMO-01', username: 'demo-viewer', created_at: ago(30), last_seen_at: ago(1), ip: 'not collected', user_agent: 'Static demo' }] };
  if (path === '/api/users') return { users, total: users.length, page: 1, pageSize: users.length, regions };
  if (path === '/api/users/audit/log') return { logs: [
    { id: 'AUD-DEMO-01', ts: ago(4), username: 'demo-viewer', action: 'VIEW_DEMO', entity: 'dashboard', entity_id: null, details: 'Synthetic demonstration event', ip: 'not collected', user_agent: 'Static demo' },
    { id: 'AUD-DEMO-02', ts: ago(30), username: 'demo-operator', action: 'ACKNOWLEDGE_DEMO', entity: 'alarm', entity_id: alarms[0].id, details: 'Synthetic example event', ip: 'not collected', user_agent: 'Static demo' },
  ], total: 2, summary: { total: 2, users: 2, actions: 2 } };

  if (path === '/api/system/health') return { status: 'degraded', app: 'Centralized Hybrid Solar Monitoring System', version: '1.0.0', environment: 'Public synthetic demo', uptimeSec: 86400, timestamp: now(), database: { ok: false, driver: 'none (static demo)' }, mqtt: { running: false, clients: 0 }, simulation: { running: true, sites: sites.length }, readOnly: true };
  if (path === '/api/system/stats') return {
    process: { pid: null, uptimeSec: 86400, node: 'Static browser app', platform: 'GitHub Pages', arch: 'web', memoryMb: { rss: 0, heapUsed: 0, heapTotal: 0 }, cpuLoad: [], hostname: 'GitHub Pages' },
    database: { driver: 'none (static demo)', recentMeasurements: 0 },
    ingest: { messagesLastHour: 0, failuresLastHour: 0, lastHourSuccessPct: 100 },
    gateways: { ONLINE: 7, OFFLINE: 1 }, alarms: { CRITICAL: 1, WARNING: 2, INFO: 1 }, gatewayHealth: [],
    mqtt: { running: false, clients: 0 }, simulation: { running: true, sites: sites.length },
    realtime: { clients: 0 }, alarmsEngine: { active: 3, counts: alarmStats().counts },
    maintenance: { running: false }, timestamp: now(),
  };
  if (path === '/api/system/info') return {
    app: 'Centralized Hybrid Solar Monitoring System', version: '1.0.0', environment: 'Public synthetic demo',
    database: { driver: 'none (static demo)', production: false }, simulation: { running: true, sites: sites.length },
    mqtt: { running: false, clients: 0 }, realtime: { clients: 0 }, alarms: { active: 3, counts: alarmStats().counts },
    maintenance: { running: false }, retention: { measurementsDays: 30, ingestMessagesDays: 7, auditDays: 365 },
    counts: { sites: sites.length, devices: devices.length, gateways: gateways.length, modbus_registers: registers.length, measurements: 0, alarms: alarms.length, events: 0, users: users.length, generated_reports: sampleReports.length },
    features: { readOnlyMonitoring: true, demoMode: true, multiSite: true, rbac: true, auditTrail: true, mqttTls: false, modbusTemplates: true, reports: ['CSV'], schedules: false, websocket: false },
  };
  if (path === '/api/system/data-quality') return {
    sites: sites.map((site) => ({ siteId: site.id, code: site.code, name: site.name, dataSource: 'DEMO', status: site.status, commStatus: site.comm_status, lastSeenAt: site.last_seen_at, ageSec: site.status === 'OFFLINE' ? 1080 : 20, samplesLast2h: 120, goodPct: 99.2, quality: site.status === 'OFFLINE' ? 'STALE' : 'GOOD' })),
    summary: { total: sites.length, good: sites.length - 1, degraded: 1, noData: 0, bad: 0 },
  };

  if (method !== 'GET' && path.startsWith('/api/')) {
    if (path.endsWith('/rotate-token')) return { token: 'DEMO-ONLY-NOT-A-REAL-GATEWAY-TOKEN', warning: 'Public demo only. This is not a valid token.' };
    if (path.includes('/config')) return { ok: true, message: 'Simulated demo action only.' };
    if (path.includes('/generate') || path.includes('/schedules')) return { ok: true, report: sampleReports[0], schedule: sampleSchedules[0] };
    return { ok: true, message: 'Simulated in this browser only; no server or device was changed.' };
  }

  throw new Error(`Unsupported public-demo endpoint: ${method} ${path}`);
}
