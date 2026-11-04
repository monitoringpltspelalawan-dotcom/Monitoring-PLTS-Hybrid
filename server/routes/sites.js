import express from 'express';
import { getDb } from '../db/adapter.js';
import { asyncHandler, badRequest, conflict, notFound } from '../lib/errors.js';
import { requireAuth, requirePermission, assertSiteAccess, audit } from '../middleware/auth.js';
import { allowedSites, filterSiteRows, siteStatusCounts, numberField } from './helpers.js';
import { portfolioOverview, siteEnergyHistory, siteTelemetryHistory } from '../services/analytics.js';
import { getLive, publicSnapshot } from '../services/liveStore.js';
import { nowIso } from '../lib/time.js';
import { round, safeJsonParse, shortId } from '../lib/util.js';

const router = express.Router();
router.use(requireAuth);

const SITE_FIELDS = {
  code: 'code', name: 'name', regionId: 'region_id', location: 'location', address: 'address',
  latitude: 'latitude', longitude: 'longitude', timezone: 'timezone',
  pvCapacityKwp: 'pv_capacity_kwp', inverterCapacityKw: 'inverter_capacity_kw',
  bessCapacityKwh: 'bess_capacity_kwh', bessPowerKw: 'bess_power_kw',
  inverterCount: 'inverter_count', batteryRackCount: 'battery_rack_count', meterCount: 'meter_count',
  gridConnectionType: 'grid_connection_type', gridProvider: 'grid_provider', gridVoltageKv: 'grid_voltage_kv',
  gridCapacityKva: 'grid_capacity_kva', generatorCount: 'generator_count', generatorCapacityKw: 'generator_capacity_kw',
  commissioningDate: 'commissioning_date', status: 'status', notes: 'notes',
};

function decorateSite(site, live) {
  return {
    ...site,
    regionName: site.region_name || null,
    regionCode: site.region_code || null,
    live: publicSnapshot(live),
    alarmCount: site.alarm_count || 0,
  };
}

async function loadSite(req, id) {
  const db = getDb();
  const site = await db.get(
    `SELECT s.*, r.name AS region_name, r.code AS region_code FROM sites s LEFT JOIN regions r ON r.id = s.region_id WHERE s.id = ?`,
    [id],
  );
  if (!site) throw notFound('Site not found');
  assertSiteAccess(req, site.id);
  return site;
}

router.get(
  '/regions',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const sites = await allowedSites(req);
    const visible = new Set(sites.map((s) => s.region_id));
    const regions = (await db.all('SELECT * FROM regions ORDER BY name')).filter((r) => visible.has(r.id));
    res.json({
      regions: regions.map((r) => ({
        id: r.id, code: r.code, name: r.name, timezone: r.timezone,
        siteCount: sites.filter((s) => s.region_id === r.id).length,
      })),
    });
  }),
);

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const all = await allowedSites(req);
    const filtered = filterSiteRows(all, req.query);
    const data = await portfolioOverview(filtered, { includeTrends: req.query.trends !== 'false' });
    res.json({
      ...data,
      regions: [...new Map(all.map((s) => [s.region_id, { id: s.region_id, code: s.region_code, name: s.region_name }])).values()],
      statusCounts: siteStatusCounts(filtered),
      filters: {
        region: req.query.region || null, status: req.query.status || null,
        search: req.query.search || null, dataSource: req.query.dataSource || null,
      },
      demoMode: filtered.some((s) => s.data_source === 'DEMO'),
      generatedAt: nowIso(),
    });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const all = await allowedSites(req);
    const filtered = filterSiteRows(all, req.query);
    const allowedIds = filtered.map((s) => s.id);
    const alarmRows = allowedIds.length
      ? await db.all(
          `SELECT site_id, COUNT(*) AS c FROM alarms WHERE status != 'RESOLVED' AND site_id IN (${allowedIds.map(() => '?').join(',')}) GROUP BY site_id`,
          allowedIds,
        )
      : [];
    const alarmMap = new Map(alarmRows.map((r) => [r.site_id, Number(r.c)]));
    const rows = filtered.map((s) => decorateSite({ ...s, alarm_count: alarmMap.get(s.id) || 0 }, getLive(s.id)));
    res.json({
      sites: rows,
      total: rows.length,
      statusCounts: siteStatusCounts(filtered),
      dataSources: {
        demo: rows.filter((s) => s.data_source === 'DEMO').length,
        live: rows.filter((s) => s.data_source === 'LIVE').length,
      },
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const site = await loadSite(req, req.params.id);
    const [devices, gateway, racks, alarmCounts, recentAlarms, configs, tariffs] = await Promise.all([
      db.all('SELECT * FROM devices WHERE site_id = ? ORDER BY device_type, name', [site.id]),
      db.get('SELECT id, name, serial, hardware, firmware, ip_address, status, last_seen_at, buffer_backlog, latency_ms, cpu_pct, mem_pct, uptime_sec, version, data_source FROM gateways WHERE site_id = ? ORDER BY created_at LIMIT 1', [site.id]),
      db.all('SELECT * FROM bess_racks WHERE site_id = ? ORDER BY name', [site.id]),
      db.all("SELECT severity, COUNT(*) AS c FROM alarms WHERE site_id = ? AND status != 'RESOLVED' GROUP BY severity", [site.id]),
      db.all(
        `SELECT id, code, severity, category, title, message, status, value, threshold, triggered_at, acknowledged_at, acknowledged_by
         FROM alarms WHERE site_id = ? ORDER BY triggered_at DESC LIMIT 8`,
        [site.id],
      ),
      db.all('SELECT key, value FROM site_configs WHERE site_id = ?', [site.id]),
      db.all('SELECT * FROM tariffs WHERE site_id = ? OR site_id IS NULL ORDER BY site_id', [site.id]),
    ]);
    const counts = { CRITICAL: 0, WARNING: 0, INFO: 0, total: 0 };
    for (const r of alarmCounts) { counts[r.severity] = Number(r.c); counts.total += Number(r.c); }
    const live = getLive(site.id);
    const energy = await db.get('SELECT * FROM site_energy_daily WHERE site_id = ? ORDER BY day DESC LIMIT 1', [site.id]);

    res.json({
      site: decorateSite(site, live),
      live: publicSnapshot(live),
      gateway: gateway || null,
      devices,
      bessRacks: racks,
      alarmCounts: counts,
      recentAlarms,
      config: Object.fromEntries(configs.map((c) => [c.key, c.value])),
      tariffs,
      energy,
      simProfile: safeJsonParse(site.sim_profile, null),
      readOnlyMonitoring: true,
    });
  }),
);

router.post(
  '/',
  requirePermission('site:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const body = req.body || {};
    if (!body.code || !body.name) throw badRequest('Site code and name are required');
    const code = String(body.code).trim().toUpperCase();
    const exists = await db.get('SELECT id FROM sites WHERE code = ?', [code]);
    if (exists) throw conflict(`Site code ${code} already exists`);
    const now = nowIso();
    const id = body.id || `SITE-${code}`;
    const cols = ['id', 'code', 'name', 'region_id', 'location', 'address', 'latitude', 'longitude', 'timezone',
      'pv_capacity_kwp', 'inverter_capacity_kw', 'bess_capacity_kwh', 'bess_power_kw', 'inverter_count',
      'battery_rack_count', 'meter_count', 'grid_connection_type', 'grid_provider', 'grid_voltage_kv',
      'grid_capacity_kva', 'generator_count', 'generator_capacity_kw', 'commissioning_date', 'status',
      'comm_status', 'last_seen_at', 'data_source', 'sim_profile', 'notes', 'created_at', 'updated_at'];
    const values = {
      id, code, name: body.name, region_id: body.regionId || body.region_id || null,
      location: body.location || null, address: body.address || null,
      latitude: numberField(body.latitude, 0), longitude: numberField(body.longitude, 0),
      timezone: body.timezone || 'Asia/Jakarta',
      pv_capacity_kwp: numberField(body.pvCapacityKwp), inverter_capacity_kw: numberField(body.inverterCapacityKw, numberField(body.pvCapacityKwp) * 1.15),
      bess_capacity_kwh: numberField(body.bessCapacityKwh), bess_power_kw: numberField(body.bessPowerKw),
      inverter_count: numberField(body.inverterCount), battery_rack_count: numberField(body.batteryRackCount),
      meter_count: numberField(body.meterCount, 2), grid_connection_type: body.gridConnectionType || '20 kV MV',
      grid_provider: body.gridProvider || 'PLN', grid_voltage_kv: numberField(body.gridVoltageKv, 20),
      grid_capacity_kva: numberField(body.gridCapacityKva), generator_count: numberField(body.generatorCount),
      generator_capacity_kw: numberField(body.generatorCapacityKw), commissioning_date: body.commissioningDate || null,
      status: body.status || 'ONLINE', comm_status: 'OFFLINE', last_seen_at: null, data_source: 'LIVE',
      sim_profile: null, notes: body.notes || null, created_at: now, updated_at: now,
    };
    await db.run(`INSERT INTO sites (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => values[c]));
    await audit(req, 'CREATE', 'site', id, { code, name: body.name });
    const site = await db.get('SELECT * FROM sites WHERE id = ?', [id]);
    res.status(201).json({ site });
  }),
);

router.patch(
  '/:id',
  requirePermission('site:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const site = await loadSite(req, req.params.id);
    const body = req.body || {};
    if (body.status && !['ONLINE', 'OFFLINE', 'WARNING', 'CRITICAL', 'MAINTENANCE'].includes(body.status)) {
      throw badRequest('Invalid site status');
    }
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(SITE_FIELDS)) {
      if (body[key] === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(body[key]);
    }
    if (!sets.length) throw badRequest('No supported fields supplied');
    sets.push('updated_at = ?');
    params.push(nowIso(), site.id);
    await db.run(`UPDATE sites SET ${sets.join(', ')} WHERE id = ?`, params);
    await audit(req, 'UPDATE', 'site', site.id, { fields: Object.keys(body) });
    res.json({ site: await db.get('SELECT * FROM sites WHERE id = ?', [site.id]) });
  }),
);

router.delete(
  '/:id',
  requirePermission('site:delete'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const site = await loadSite(req, req.params.id);
    const devices = await db.get('SELECT COUNT(*) AS c FROM devices WHERE site_id = ?', [site.id]);
    await db.run('DELETE FROM sites WHERE id = ?', [site.id]);
    await audit(req, 'DELETE', 'site', site.id, { code: site.code, devices: Number(devices.c) });
    res.json({ ok: true, deleted: site.id });
  }),
);

router.get(
  '/:id/live',
  asyncHandler(async (req, res) => {
    const site = await loadSite(req, req.params.id);
    const snap = getLive(site.id);
    if (!snap) {
      return res.json({
        site: { id: site.id, code: site.code, name: site.name, status: site.status, dataSource: site.data_source },
        live: null,
        message: 'No live telemetry available for this site yet.',
      });
    }
    res.json({ site: { id: site.id, code: site.code, name: site.name }, live: publicSnapshot(snap), stale: snap.stale });
  }),
);

router.get(
  '/:id/energy-flow',
  asyncHandler(async (req, res) => {
    const site = await loadSite(req, req.params.id);
    const snap = getLive(site.id);
    if (!snap) {
      return res.json({
        siteId: site.id, ts: null, dataAvailable: false,
        nodes: {
          pv: { kw: null, status: 'NO_DATA' }, grid: { kw: null, status: 'NO_DATA' },
          bess: { kw: null, status: 'NO_DATA' }, generator: { kw: null, status: 'NO_DATA' },
          load: { kw: null, status: 'NO_DATA' },
        },
        message: 'No telemetry received. Check gateway connectivity.',
      });
    }
    const flow = snap.flow || {};
    const battery = Number(flow.batteryKw) || 0;
    const grid = Number(flow.gridKw) || 0;
    const nodes = {
      pv: {
        kw: flow.pvKw == null ? null : round(flow.pvKw, 2),
        status: snap.pv?.powerKw == null ? 'NO_DATA' : Number(flow.pvKw) > 0 ? 'PRODUCING' : 'IDLE',
        capacityKwp: site.pv_capacity_kwp,
        utilPct: site.pv_capacity_kwp ? round((Number(flow.pvKw) / site.pv_capacity_kwp) * 100, 1) : null,
      },
      grid: {
        kw: flow.gridKw == null ? null : round(Math.abs(grid), 2),
        direction: grid > 0.01 ? 'IMPORT' : grid < -0.01 ? 'EXPORT' : 'IDLE',
        status: snap.grid?.available === false ? 'UNAVAILABLE' : snap.grid?.available == null ? 'NO_DATA' : 'AVAILABLE',
        voltageV: snap.grid?.voltageL1V ?? null,
        frequencyHz: snap.grid?.frequencyHz ?? null,
        importKw: snap.grid?.importKw ?? null,
        exportKw: snap.grid?.exportKw ?? null,
      },
      bess: {
        kw: flow.batteryKw == null ? null : round(Math.abs(battery), 2),
        direction: battery > 0.01 ? 'DISCHARGING' : battery < -0.01 ? 'CHARGING' : 'IDLE',
        status: snap.bess?.socPct == null ? 'NO_DATA' : snap.bess?.bmsStatus || 'NORMAL',
        socPct: snap.bess?.socPct ?? null,
        sohPct: snap.bess?.sohPct ?? null,
        availableKwh: snap.bess?.availableKwh ?? null,
        temperatureC: snap.bess?.temperatureC ?? null,
        capacityKwh: site.bess_capacity_kwh,
        racks: snap.bess?.racks || [],
      },
      generator: {
        kw: flow.generatorKw == null ? null : round(flow.generatorKw, 2),
        status: !snap.generator?.present ? 'NOT_INSTALLED' : snap.generator?.running ? 'RUNNING' : 'STANDBY',
        fuelLevelPct: snap.generator?.fuelLevelPct ?? null,
        runHours: snap.generator?.runHours ?? null,
        capacityKw: site.generator_capacity_kw,
      },
      load: {
        kw: flow.loadKw == null ? null : round(flow.loadKw, 2),
        status: snap.load?.powerKw == null ? 'NO_DATA' : 'SUPPLIED',
        powerFactor: snap.load?.powerFactor ?? null,
      },
    };
    const supplied = (Number(flow.pvKw) || 0) + (Number(flow.generatorKw) || 0) + Math.max(0, battery) + Math.max(0, grid);
    res.json({
      siteId: site.id, siteCode: site.code, siteName: site.name, ts: snap.ts,
      dataSource: snap.dataSource, quality: snap.quality, stale: snap.stale,
      dataAvailable: true, nodes, flow,
      balance: {
        totalSuppliedKw: round(supplied, 2),
        loadKw: round(Number(flow.loadKw) || 0, 2),
        unservedKw: round(Math.max(0, (Number(flow.loadKw) || 0) - supplied), 2),
        renewableKw: round((Number(flow.pvKw) || 0) + Math.max(0, battery), 2),
      },
      colors: {
        pv: '#f5a524', gridImport: '#ef4444', gridExport: '#22c55e', bessCharge: '#38bdf8',
        bessDischarge: '#a78bfa', generator: '#fb923c', load: '#e2e8f0', missing: '#475569',
      },
    });
  }),
);

router.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    const site = await loadSite(req, req.params.id);
    const range = req.query.range || '7d';
    const hours = Math.min(48, Math.max(1, Number(req.query.hours) || 24));
    const [energy, telemetry] = await Promise.all([
      siteEnergyHistory(site.id, range),
      siteTelemetryHistory(site.id, { hours, params: req.query.params ? String(req.query.params).split(',') : [] }),
    ]);
    const latest = await getDb().get(
      `SELECT * FROM site_energy_daily WHERE site_id = ? ORDER BY day DESC LIMIT 1`, [site.id],
    );
    res.json({ siteId: site.id, siteCode: site.code, siteName: site.name, energy, telemetry, latestDay: latest || null });
  }),
);

router.get(
  '/:id/devices',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const site = await loadSite(req, req.params.id);
    const devices = await db.all('SELECT * FROM devices WHERE site_id = ? ORDER BY device_type, name', [site.id]);
    const counts = {};
    for (const d of devices) counts[d.device_type] = (counts[d.device_type] || 0) + 1;
    res.json({ devices, counts, bessRacks: await db.all('SELECT * FROM bess_racks WHERE site_id = ? ORDER BY name', [site.id]) });
  }),
);

router.get(
  '/:id/alarms',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const site = await loadSite(req, req.params.id);
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const rows = await db.all(
      `SELECT * FROM alarms WHERE site_id = ? ${status ? 'AND status = ?' : ''} ORDER BY triggered_at DESC LIMIT 200`,
      status ? [site.id, status] : [site.id],
    );
    res.json({ alarms: rows, total: rows.length });
  }),
);

router.get(
  '/:id/config',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const site = await loadSite(req, req.params.id);
    const rows = await db.all('SELECT key, value, updated_at FROM site_configs WHERE site_id = ? ORDER BY key', [site.id]);
    res.json({ config: Object.fromEntries(rows.map((r) => [r.key, r.value])), rows });
  }),
);

router.put(
  '/:id/config',
  requirePermission('site:manage'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const site = await loadSite(req, req.params.id);
    const body = req.body || {};
    if (!body || typeof body !== 'object') throw badRequest('Configuration object required');
    const now = nowIso();
    for (const [key, value] of Object.entries(body)) {
      await db.run(
        `INSERT INTO site_configs (site_id, key, value, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(site_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [site.id, key, String(value), now],
      );
    }
    await audit(req, 'UPDATE_CONFIG', 'site', site.id, { keys: Object.keys(body) });
    const rows = await db.all('SELECT key, value FROM site_configs WHERE site_id = ?', [site.id]);
    res.json({ config: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  }),
);

export default router;
