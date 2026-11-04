import { getDb } from '../db/adapter.js';
import { getAllLive } from './liveStore.js';
import { dayKeyOffset, localDateKey, nowIso } from '../lib/time.js';
import { clamp, round, safeJsonParse, sum } from '../lib/util.js';

const EF_DEFAULT = 0.87; // kg CO2 / kWh (Indonesia grid, configurable)
const TARIFF_DEFAULT = 1444.7; // IDR / kWh

export const RANGE_DAYS = { '24h': 1, '48h': 2, '7d': 7, '30d': 30, '90d': 90, '365d': 365, '1y': 365 };

export function dayRangeFromRange(range) {
  const days = RANGE_DAYS[range] || 30;
  const today = localDateKey(new Date(), 'Asia/Jakarta');
  return { days, fromDay: dayKeyOffset(today, -(days - 1)), toDay: today };
}

export async function loadSettingsMap() {
  const db = getDb();
  const rows = await db.all('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function activeAlarmCounts(siteIds = null) {
  const db = getDb();
  const params = [];
  let filter = "WHERE status != 'RESOLVED'";
  if (siteIds && siteIds.length) {
    filter += ` AND site_id IN (${siteIds.map(() => '?').join(',')})`;
    params.push(...siteIds);
  }
  const rows = await db.all(`SELECT severity, COUNT(*) AS c FROM alarms ${filter} GROUP BY severity`, params);
  const counts = { CRITICAL: 0, WARNING: 0, INFO: 0, total: 0 };
  for (const r of rows) {
    counts[r.severity] = Number(r.c);
    counts.total += Number(r.c);
  }
  return counts;
}

/** Portfolio summary for the corporate overview and KPI cards. */
export async function portfolioOverview(siteRows, { includeTrends = true } = {}) {
  const db = getDb();
  const siteIds = siteRows.map((s) => s.id);
  const live = getAllLive();
  const liveById = new Map(live.map((s) => [s.siteId, s]));
  const settings = await loadSettingsMap();
  const ef = Number(settings.emission_factor_kg_per_kwh || EF_DEFAULT);
  const tariff = Number(settings.default_tariff || TARIFF_DEFAULT);

  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const dailyRows = siteIds.length
    ? await db.all(
        `SELECT * FROM site_energy_daily WHERE site_id IN (${siteIds.map(() => '?').join(',')}) AND day >= ? ORDER BY day`,
        [...siteIds, yearStart],
      )
    : [];
  const bySiteDaily = new Map();
  for (const row of dailyRows) {
    const arr = bySiteDaily.get(row.site_id) || [];
    arr.push(row);
    bySiteDaily.set(row.site_id, arr);
  }

  const alarmRows = siteIds.length
    ? await db.all(
        `SELECT site_id, COUNT(*) AS c FROM alarms WHERE status != 'RESOLVED' AND site_id IN (${siteIds.map(() => '?').join(',')}) GROUP BY site_id`,
        siteIds,
      )
    : [];
  const alarmsBySite = new Map(alarmRows.map((r) => [r.site_id, Number(r.c)]));
  const counts = await activeAlarmCounts(siteIds);

  let pvToday = 0;
  let pvMonth = 0;
  let pvYear = 0;
  let loadToday = 0;
  let importToday = 0;
  let exportToday = 0;
  let chargeToday = 0;
  let dischargeToday = 0;
  let genToday = 0;
  let peakPvToday = 0;
  let peakLoadToday = 0;

  const siteSummaries = [];
  for (const site of siteRows) {
    const tz = site.timezone || 'Asia/Jakarta';
    const today = localDateKey(new Date(), tz);
    const rows = bySiteDaily.get(site.id) || [];
    const todayRow = rows.find((r) => r.day === today);
    const monthRows = rows.filter((r) => r.day.startsWith(today.slice(0, 7)));
    const yearRows = rows.filter((r) => r.day.startsWith(today.slice(0, 4)));
    const monthPv = sum(monthRows.map((r) => r.pv_kwh));
    const yearPv = sum(yearRows.map((r) => r.pv_kwh));
    pvToday += todayRow?.pv_kwh || 0;
    pvMonth += monthPv;
    pvYear += yearPv;
    loadToday += todayRow?.load_kwh || 0;
    importToday += todayRow?.import_kwh || 0;
    exportToday += todayRow?.export_kwh || 0;
    chargeToday += todayRow?.charge_kwh || 0;
    dischargeToday += todayRow?.discharge_kwh || 0;
    genToday += todayRow?.generator_kwh || 0;
    peakPvToday += todayRow?.peak_pv_kw || 0;
    peakLoadToday += todayRow?.peak_load_kw || 0;

    const snap = liveById.get(site.id);
    siteSummaries.push({
      id: site.id,
      code: site.code,
      name: site.name,
      regionId: site.region_id,
      location: site.location,
      latitude: site.latitude,
      longitude: site.longitude,
      status: site.status,
      commStatus: snap?.commStatus || site.comm_status,
      dataSource: site.data_source,
      pvCapacityKwp: site.pv_capacity_kwp,
      bessCapacityKwh: site.bess_capacity_kwh,
      pvPowerKw: snap?.pv?.powerKw ?? null,
      loadPowerKw: snap?.load?.powerKw ?? null,
      gridPowerKw: snap?.grid?.activePowerKw ?? null,
      batteryPowerKw: snap?.bess?.powerKw ?? null,
      socPct: snap?.bess?.socPct ?? null,
      pvTodayKwh: round(todayRow?.pv_kwh || 0, 1),
      loadTodayKwh: round(todayRow?.load_kwh || 0, 1),
      alarmCount: alarmsBySite.get(site.id) || 0,
      lastSeenAt: snap?.lastSeenAt || site.last_seen_at,
      stale: snap?.stale ?? true,
      quality: snap?.quality || 'BAD',
      generatorRunning: snap?.generator?.running || false,
      gridAvailable: snap?.grid?.available ?? null,
    });
  }

  const onlineSites = siteSummaries.filter((s) => s.status !== 'OFFLINE' && s.commStatus !== 'OFFLINE').length;
  const offlineSites = siteSummaries.filter((s) => s.status === 'OFFLINE' || s.commStatus === 'OFFLINE').length;
  const warningSites = siteSummaries.filter((s) => s.status === 'WARNING').length;
  const criticalSites = siteSummaries.filter((s) => s.status === 'CRITICAL').length;
  const maintenanceSites = siteSummaries.filter((s) => s.status === 'MAINTENANCE').length;

  const livePvKw = sum(live.filter((s) => siteIds.includes(s.siteId)).map((s) => s.pv?.powerKw || 0));
  const liveLoadKw = sum(live.filter((s) => siteIds.includes(s.siteId)).map((s) => s.load?.powerKw || 0));
  const chargeKw = sum(live.filter((s) => siteIds.includes(s.siteId)).map((s) => s.bess?.chargePowerKw || 0));
  const dischargeKw = sum(live.filter((s) => siteIds.includes(s.siteId)).map((s) => s.bess?.dischargePowerKw || 0));
  const importKw = sum(live.filter((s) => siteIds.includes(s.siteId)).map((s) => s.grid?.importKw || 0));
  const exportKw = sum(live.filter((s) => siteIds.includes(s.siteId)).map((s) => s.grid?.exportKw || 0));
  const genKw = sum(live.filter((s) => siteIds.includes(s.siteId)).map((s) => s.generator?.powerKw || 0));
  const socSites = live.filter((s) => siteIds.includes(s.siteId) && s.bess?.socPct != null);
  const bessCap = sum(siteRows.map((s) => s.bess_capacity_kwh));
  const weightedSoc = socSites.length
    ? socSites.reduce((acc, s) => acc + (s.bess.socPct || 0) * (siteRows.find((x) => x.id === s.siteId)?.bess_capacity_kwh || 1), 0) /
      Math.max(1, socSites.reduce((acc, s) => acc + (siteRows.find((x) => x.id === s.siteId)?.bess_capacity_kwh || 1), 0))
    : 0;

  const result = {
    portfolio: {
      siteCount: siteRows.length,
      onlineSites,
      offlineSites,
      warningSites,
      criticalSites,
      maintenanceSites,
      pvCapacityKwp: round(sum(siteRows.map((s) => s.pv_capacity_kwp)), 1),
      pvCapacityMwp: round(sum(siteRows.map((s) => s.pv_capacity_kwp)) / 1000, 3),
      bessCapacityKwh: round(bessCap, 1),
      bessCapacityMwh: round(bessCap / 1000, 3),
      pvPowerMw: round(livePvKw / 1000, 3),
      pvTodayMwh: round(pvToday / 1000, 3),
      pvMonthMwh: round(pvMonth / 1000, 3),
      pvYearMwh: round(pvYear / 1000, 3),
      avgSocPct: round(weightedSoc, 1),
      chargePowerMw: round(chargeKw / 1000, 3),
      dischargePowerMw: round(dischargeKw / 1000, 3),
      loadPowerMw: round(liveLoadKw / 1000, 3),
      gridImportMw: round(importKw / 1000, 3),
      gridExportMw: round(exportKw / 1000, 3),
      generatorPowerMw: round(genKw / 1000, 3),
      activeCriticalAlarms: counts.CRITICAL,
      activeWarningAlarms: counts.WARNING,
      openAlarms: counts.total,
      loadTodayMwh: round(loadToday / 1000, 3),
      importTodayMwh: round(importToday / 1000, 3),
      exportTodayMwh: round(exportToday / 1000, 3),
      chargeTodayMwh: round(chargeToday / 1000, 3),
      dischargeTodayMwh: round(dischargeToday / 1000, 3),
      generatorTodayMwh: round(genToday / 1000, 3),
      peakPvTodayMw: round(peakPvToday / 1000, 3),
      peakLoadTodayMw: round(peakLoadToday / 1000, 3),
      co2AvoidedTodayKg: round(pvToday * ef, 1),
      co2AvoidedYearKg: round(pvYear * ef, 1),
      savingsTodayIdr: Math.round(pvToday * tariff),
      savingsYearIdr: Math.round(pvYear * tariff),
      renewableSharePct: round((pvToday / Math.max(1, pvToday + importToday + genToday)) * 100, 1),
      specificYieldToday: round(pvToday / Math.max(1, sum(siteRows.map((s) => s.pv_capacity_kwp))), 2),
      tariffIdrPerKwh: tariff,
      emissionFactorKgPerKwh: ef,
      dataSources: {
        demo: siteRows.filter((s) => s.data_source === 'DEMO').length,
        live: siteRows.filter((s) => s.data_source === 'LIVE').length,
      },
      lastUpdate: nowIso(),
    },
    sites: siteSummaries,
    alarmCounts: counts,
  };

  if (includeTrends) {
    const trendDays = [];
    for (let i = 13; i >= 0; i -= 1) trendDays.push(dayKeyOffset(localDateKey(new Date(), 'Asia/Jakarta'), -i));
    const trendMap = new Map(trendDays.map((d) => [d, { day: d, pvKwh: 0, loadKwh: 0, importKwh: 0, exportKwh: 0, generatorKwh: 0 }]));
    for (const row of dailyRows) {
      const t = trendMap.get(row.day);
      if (!t) continue;
      t.pvKwh += row.pv_kwh;
      t.loadKwh += row.load_kwh;
      t.importKwh += row.import_kwh;
      t.exportKwh += row.export_kwh;
      t.generatorKwh += row.generator_kwh;
    }
    result.trends = [...trendMap.values()].map((t) => ({
      ...t,
      pvKwh: round(t.pvKwh, 1),
      loadKwh: round(t.loadKwh, 1),
      importKwh: round(t.importKwh, 1),
      exportKwh: round(t.exportKwh, 1),
      generatorKwh: round(t.generatorKwh, 1),
    }));
  }
  return result;
}

function emptyTotals() {
  return {
    pvKwh: 0, chargeKwh: 0, dischargeKwh: 0, loadKwh: 0, importKwh: 0, exportKwh: 0,
    generatorKwh: 0, peakLoadKw: 0, peakPvKw: 0,
  };
}

export async function analyticsData(siteIds, fromDay, toDay) {
  const db = getDb();
  const rows = siteIds.length
    ? await db.all(
        `SELECT * FROM site_energy_daily WHERE site_id IN (${siteIds.map(() => '?').join(',')}) AND day BETWEEN ? AND ? ORDER BY day`,
        [...siteIds, fromDay, toDay],
      )
    : [];
  const settings = await loadSettingsMap();
  const ef = Number(settings.emission_factor_kg_per_kwh || EF_DEFAULT);
  const tariff = Number(settings.default_tariff || TARIFF_DEFAULT);
  const sites = siteIds.length ? await db.all(`SELECT * FROM sites WHERE id IN (${siteIds.map(() => '?').join(',')})`, siteIds) : [];
  const siteById = new Map(sites.map((s) => [s.id, s]));

  const totals = emptyTotals();
  const bySite = new Map();
  const byDay = new Map();
  for (const row of rows) {
    totals.pvKwh += row.pv_kwh;
    totals.chargeKwh += row.charge_kwh;
    totals.dischargeKwh += row.discharge_kwh;
    totals.loadKwh += row.load_kwh;
    totals.importKwh += row.import_kwh;
    totals.exportKwh += row.export_kwh;
    totals.generatorKwh += row.generator_kwh;
    totals.peakLoadKw = Math.max(totals.peakLoadKw, row.peak_load_kw);
    totals.peakPvKw = Math.max(totals.peakPvKw, row.peak_pv_kw);
    const s = bySite.get(row.site_id) || { ...emptyTotals(), days: 0, prSum: 0, prCount: 0 };
    s.pvKwh += row.pv_kwh; s.chargeKwh += row.charge_kwh; s.dischargeKwh += row.discharge_kwh;
    s.loadKwh += row.load_kwh; s.importKwh += row.import_kwh; s.exportKwh += row.export_kwh;
    s.generatorKwh += row.generator_kwh; s.peakLoadKw = Math.max(s.peakLoadKw, row.peak_load_kw);
    s.peakPvKw = Math.max(s.peakPvKw, row.peak_pv_kw); s.days += 1;
    if (row.performance_ratio) { s.prSum += row.performance_ratio; s.prCount += 1; }
    bySite.set(row.site_id, s);
    const d = byDay.get(row.day) || { ...emptyTotals(), day: row.day };
    d.pvKwh += row.pv_kwh; d.loadKwh += row.load_kwh; d.importKwh += row.import_kwh;
    d.exportKwh += row.export_kwh; d.generatorKwh += row.generator_kwh; d.chargeKwh += row.charge_kwh;
    d.dischargeKwh += row.discharge_kwh; d.peakLoadKw = Math.max(d.peakLoadKw, row.peak_load_kw);
    byDay.set(row.day, d);
  }

  const totalCapacity = sum(sites.map((s) => s.pv_capacity_kwp));
  const totalBess = sum(sites.map((s) => s.bess_capacity_kwh));
  const renewable = totals.pvKwh + totals.importKwh + totals.generatorKwh;
  const summary = {
    from: fromDay,
    to: toDay,
    days: rows.length ? new Set(rows.map((r) => r.day)).size : 0,
    pvMwh: round(totals.pvKwh / 1000, 3),
    loadMwh: round(totals.loadKwh / 1000, 3),
    chargeMwh: round(totals.chargeKwh / 1000, 3),
    dischargeMwh: round(totals.dischargeKwh / 1000, 3),
    importMwh: round(totals.importKwh / 1000, 3),
    exportMwh: round(totals.exportKwh / 1000, 3),
    generatorMwh: round(totals.generatorKwh / 1000, 3),
    peakLoadMw: round(totals.peakLoadKw / 1000, 3),
    peakPvMw: round(totals.peakPvKw / 1000, 3),
    renewableSharePct: round((totals.pvKwh / Math.max(1, renewable)) * 100, 1),
    selfConsumptionPct: round(((totals.pvKwh - totals.exportKwh) / Math.max(1, totals.pvKwh)) * 100, 1),
    bessUtilisationPct: round((totals.dischargeKwh / Math.max(1, totalBess)) * 100, 1),
    bessCycles: round(totals.dischargeKwh / Math.max(1, totalBess), 2),
    capacityUtilisationPct: round((totals.pvKwh / Math.max(1, totalCapacity * Math.max(1, new Set(rows.map((r) => r.day)).size))) * 100, 1),
    specificYieldKwhPerKwp: round(totals.pvKwh / Math.max(1, totalCapacity), 1),
    performanceRatio: round(
      rows.length ? sum(rows.map((r) => r.performance_ratio || 0)) / Math.max(1, rows.filter((r) => r.performance_ratio).length) : 0,
      3,
    ),
    co2AvoidedKg: round(totals.pvKwh * ef, 1),
    savingsIdr: Math.round(totals.pvKwh * tariff),
    exportRevenueIdr: Math.round(totals.exportKwh * tariff * 0.65),
    emissionFactorKgPerKwh: ef,
    tariffIdrPerKwh: tariff,
    totalPvCapacityKwp: round(totalCapacity, 1),
    totalBessCapacityKwh: round(totalBess, 1),
  };

  const comparison = sites.map((site) => {
    const s = bySite.get(site.id) || emptyTotals();
    return {
      siteId: site.id, code: site.code, name: site.name, regionId: site.region_id,
      pvCapacityKwp: site.pv_capacity_kwp, bessCapacityKwh: site.bess_capacity_kwh,
      pvMwh: round(s.pvKwh / 1000, 3), loadMwh: round(s.loadKwh / 1000, 3),
      chargeMwh: round(s.chargeKwh / 1000, 3), dischargeMwh: round(s.dischargeKwh / 1000, 3),
      importMwh: round(s.importKwh / 1000, 3), exportMwh: round(s.exportKwh / 1000, 3),
      generatorMwh: round(s.generatorKwh / 1000, 3), peakLoadMw: round(s.peakLoadKw / 1000, 3),
      specificYield: round(s.pvKwh / Math.max(1, site.pv_capacity_kwp), 1),
      capacityFactorPct: round((s.pvKwh / Math.max(1, site.pv_capacity_kwp * Math.max(1, s.days) * 24)) * 100, 1),
      performanceRatio: round(s.prCount ? s.prSum / s.prCount : 0, 3),
      selfConsumptionPct: round(((s.pvKwh - s.exportKwh) / Math.max(1, s.pvKwh)) * 100, 1),
      bessCycles: round(s.dischargeKwh / Math.max(1, site.bess_capacity_kwh), 2),
      savingsIdr: Math.round(s.pvKwh * tariff),
      co2AvoidedKg: round(s.pvKwh * ef, 1),
      dataSource: site.data_source,
    };
  });

  const daily = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({
    day: d.day,
    pvMwh: round(d.pvKwh / 1000, 3),
    loadMwh: round(d.loadKwh / 1000, 3),
    importMwh: round(d.importKwh / 1000, 3),
    exportMwh: round(d.exportKwh / 1000, 3),
    generatorMwh: round(d.generatorKwh / 1000, 3),
    chargeMwh: round(d.chargeKwh / 1000, 3),
    dischargeMwh: round(d.dischargeKwh / 1000, 3),
    peakLoadMw: round(d.peakLoadKw / 1000, 3),
  }));

  const monthlyMap = new Map();
  for (const row of rows) {
    const key = row.day.slice(0, 7);
    const m = monthlyMap.get(key) || { month: key, pvMwh: 0, loadMwh: 0, importMwh: 0, exportMwh: 0, generatorMwh: 0 };
    m.pvMwh += row.pv_kwh / 1000;
    m.loadMwh += row.load_kwh / 1000;
    m.importMwh += row.import_kwh / 1000;
    m.exportMwh += row.export_kwh / 1000;
    m.generatorMwh += row.generator_kwh / 1000;
    monthlyMap.set(key, m);
  }
  const monthly = [...monthlyMap.values()].map((m) => Object.fromEntries(
    Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? round(v, 3) : v]),
  ));

  return { summary, comparison, daily, monthly, siteById };
}

export async function bessAnalytics(siteIds, fromDay, toDay) {
  const db = getDb();
  const rows = siteIds.length
    ? await db.all(
        `SELECT site_id, hour, charge_kwh, discharge_kwh FROM energy_hourly
         WHERE site_id IN (${siteIds.map(() => '?').join(',')}) AND substr(hour,1,10) BETWEEN ? AND ? ORDER BY hour`,
        [...siteIds, fromDay, toDay],
      )
    : [];
  const hourlyMap = new Map();
  for (const r of rows) {
    const h = r.hour.slice(11, 13);
    const slot = hourlyMap.get(h) || { hour: `${h}:00`, chargeKwh: 0, dischargeKwh: 0 };
    slot.chargeKwh += r.charge_kwh;
    slot.dischargeKwh += r.discharge_kwh;
    hourlyMap.set(h, slot);
  }
  const sites = siteIds.length ? await db.all(`SELECT * FROM sites WHERE id IN (${siteIds.map(() => '?').join(',')})`, siteIds) : [];
  const live = getAllLive().filter((s) => siteIds.includes(s.siteId));
  const liveById = new Map(live.map((s) => [s.siteId, s]));
  const totalCap = sum(sites.map((s) => s.bess_capacity_kwh));
  const totalCharge = sum(rows.map((r) => r.charge_kwh));
  const totalDischarge = sum(rows.map((r) => r.discharge_kwh));
  const rackRows = sites.map((site) => ({
    siteId: site.id, code: site.code, name: site.name, capacityKwh: site.bess_capacity_kwh,
    powerKw: site.bess_power_kw, socPct: liveById.get(site.id)?.bess?.socPct ?? null,
    sohPct: liveById.get(site.id)?.bess?.sohPct ?? null,
    temperatureC: liveById.get(site.id)?.bess?.temperatureC ?? null,
    chargeKwh: round(rows.filter((r) => r.site_id === site.id).reduce((a, r) => a + r.charge_kwh, 0), 1),
    dischargeKwh: round(rows.filter((r) => r.site_id === site.id).reduce((a, r) => a + r.discharge_kwh, 0), 1),
    cycles: round(rows.filter((r) => r.site_id === site.id).reduce((a, r) => a + r.discharge_kwh, 0) / Math.max(1, site.bess_capacity_kwh), 2),
  }));
  return {
    totals: {
      capacityKwh: round(totalCap, 1), chargeKwh: round(totalCharge, 1), dischargeKwh: round(totalDischarge, 1),
      cycles: round(totalDischarge / Math.max(1, totalCap), 2),
      roundTripEfficiencyPct: round((totalDischarge / Math.max(1, totalCharge)) * 100, 1),
      avgSocPct: round(live.length ? sum(live.map((s) => s.bess?.socPct || 0)) / Math.max(1, live.filter((s) => s.bess?.socPct != null).length) : 0, 1),
    },
    hourly: [...hourlyMap.values()].sort((a, b) => a.hour.localeCompare(b.hour)).map((h) => ({
      ...h, chargeKwh: round(h.chargeKwh, 1), dischargeKwh: round(h.dischargeKwh, 1),
    })),
    sites: rackRows,
  };
}

export async function gridGeneratorAnalytics(siteIds, fromDay, toDay) {
  const db = getDb();
  const rows = siteIds.length
    ? await db.all(
        `SELECT site_id, hour, import_kwh, export_kwh, generator_kwh, load_kwh FROM energy_hourly
         WHERE site_id IN (${siteIds.map(() => '?').join(',')}) AND substr(hour,1,10) BETWEEN ? AND ? ORDER BY hour`,
        [...siteIds, fromDay, toDay],
      )
    : [];
  const hourly = new Map();
  for (const r of rows) {
    const h = r.hour.slice(11, 13);
    const slot = hourly.get(h) || { hour: `${h}:00`, importKwh: 0, exportKwh: 0, generatorKwh: 0, loadKwh: 0 };
    slot.importKwh += r.import_kwh;
    slot.exportKwh += r.export_kwh;
    slot.generatorKwh += r.generator_kwh;
    slot.loadKwh += r.load_kwh;
    hourly.set(h, slot);
  }
  const live = getAllLive().filter((s) => siteIds.includes(s.siteId));
  return {
    totals: {
      importKwh: round(sum(rows.map((r) => r.import_kwh)), 1),
      exportKwh: round(sum(rows.map((r) => r.export_kwh)), 1),
      generatorKwh: round(sum(rows.map((r) => r.generator_kwh)), 1),
      generatorRunning: live.filter((s) => s.generator?.running).length,
      generatorCapacityKw: round(sum(live.map((s) => s.generator?.capacityKw || 0)), 1),
      generatorOutputKw: round(sum(live.map((s) => s.generator?.powerKw || 0)), 1),
      generatorsPresent: live.filter((s) => s.generator?.present).length,
      gridAvailableSites: live.filter((s) => s.grid?.available).length,
      gridOfflineSites: live.filter((s) => s.grid?.available === false).length,
    },
    hourly: [...hourly.values()].sort((a, b) => a.hour.localeCompare(b.hour)).map((h) => ({
      ...h,
      importKwh: round(h.importKwh, 1), exportKwh: round(h.exportKwh, 1),
      generatorKwh: round(h.generatorKwh, 1), loadKwh: round(h.loadKwh, 1),
    })),
    sites: live.map((s) => ({
      siteId: s.siteId, code: s.siteCode, name: s.siteName,
      gridAvailable: s.grid?.available, gridVoltageV: s.grid?.voltageL1V, frequencyHz: s.grid?.frequencyHz,
      importKw: s.grid?.importKw, exportKw: s.grid?.exportKw, powerFactor: s.grid?.powerFactor,
      generatorPresent: s.generator?.present, generatorRunning: s.generator?.running,
      generatorPowerKw: s.generator?.powerKw, generatorHours: s.generator?.runHours,
      fuelLevelPct: s.generator?.fuelLevelPct, capacityKw: s.generator?.capacityKw,
    })),
  };
}

/** Down-sampled telemetry for the site history page (last 48h available from raw table). */
export async function siteTelemetryHistory(siteId, { hours = 24, params = [] } = {}) {
  const db = getDb();
  const from = new Date(Date.now() - hours * 3600_000).toISOString();
  const wanted = params.length ? params : [
    'pv_power_kw', 'load_power_kw', 'grid_power_kw', 'battery_power_kw', 'generator_power_kw',
    'soc_pct', 'battery_temp_c', 'grid_voltage_l1_v', 'grid_frequency_hz', 'pv_voltage_v', 'inverter_temp_c',
  ];
  const rows = await db.all(
    `SELECT parameter_id, server_ts, value FROM measurements
     WHERE site_id = ? AND parameter_id IN (${wanted.map(() => '?').join(',')}) AND server_ts >= ?
     ORDER BY server_ts ASC`,
    [siteId, ...wanted, from],
  );
  const bucketMs = hours <= 24 ? 15 * 60_000 : 30 * 60_000;
  const buckets = new Map();
  for (const row of rows) {
    const t = new Date(row.server_ts).getTime();
    const key = Math.floor(t / bucketMs) * bucketMs;
    let b = buckets.get(key);
    if (!b) { b = { ts: new Date(key).toISOString() }; buckets.set(key, b); }
    const name = row.parameter_id;
    // choose the latest sample in the bucket
    b[name] = row.value;
  }
  const map = {
    pv_power_kw: 'pvPowerKw', load_power_kw: 'loadPowerKw', grid_power_kw: 'gridPowerKw',
    battery_power_kw: 'batteryPowerKw', generator_power_kw: 'generatorPowerKw', soc_pct: 'socPct',
    battery_temp_c: 'batteryTempC', grid_voltage_l1_v: 'gridVoltageV', grid_frequency_hz: 'frequencyHz',
    pv_voltage_v: 'pvVoltageV', inverter_temp_c: 'inverterTempC', load_energy_kwh: 'loadEnergyKwh',
  };
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => {
    const out = { ts: b.ts };
    for (const [k, v] of Object.entries(map)) out[v] = b[k] ?? null;
    return out;
  });
}

/** Energy history: hourly for short ranges, daily for long ranges. */
export async function siteEnergyHistory(siteId, range = '7d') {
  const db = getDb();
  const { days, fromDay, toDay } = dayRangeFromRange(range);
  const dayRows = await db.all(
    'SELECT * FROM site_energy_daily WHERE site_id = ? AND day BETWEEN ? AND ? ORDER BY day',
    [siteId, fromDay, toDay],
  );
  let series = [];
  let resolution = 'daily';
  if (days <= 31) {
    resolution = 'hourly';
    const rows = await db.all(
      `SELECT * FROM energy_hourly WHERE site_id = ? AND substr(hour,1,10) BETWEEN ? AND ? ORDER BY hour`,
      [siteId, fromDay, toDay],
    );
    series = rows.map((r) => ({
      ts: r.hour, pvKwh: round(r.pv_kwh, 2), loadKwh: round(r.load_kwh, 2), chargeKwh: round(r.charge_kwh, 2),
      dischargeKwh: round(r.discharge_kwh, 2), importKwh: round(r.import_kwh, 2), exportKwh: round(r.export_kwh, 2),
      generatorKwh: round(r.generator_kwh, 2),
    }));
  } else {
    series = dayRows.map((r) => ({
      ts: r.day, pvKwh: round(r.pv_kwh, 2), loadKwh: round(r.load_kwh, 2), chargeKwh: round(r.charge_kwh, 2),
      dischargeKwh: round(r.discharge_kwh, 2), importKwh: round(r.import_kwh, 2), exportKwh: round(r.export_kwh, 2),
      generatorKwh: round(r.generator_kwh, 2),
    }));
  }
  return {
    range,
    resolution,
    series,
    totals: {
      pvKwh: round(sum(dayRows.map((r) => r.pv_kwh)), 1),
      loadKwh: round(sum(dayRows.map((r) => r.load_kwh)), 1),
      chargeKwh: round(sum(dayRows.map((r) => r.charge_kwh)), 1),
      dischargeKwh: round(sum(dayRows.map((r) => r.discharge_kwh)), 1),
      importKwh: round(sum(dayRows.map((r) => r.import_kwh)), 1),
      exportKwh: round(sum(dayRows.map((r) => r.export_kwh)), 1),
      generatorKwh: round(sum(dayRows.map((r) => r.generator_kwh)), 1),
      days: dayRows.length,
    },
    daily: dayRows.map((r) => ({ day: r.day, pvKwh: round(r.pv_kwh, 1), loadKwh: round(r.load_kwh, 1), importKwh: round(r.import_kwh, 1), exportKwh: round(r.export_kwh, 1) })),
  };
}

/** Simple CSV builder used by analytics exports and reports. */
export function toCsv(rows, columns) {
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escape(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','));
  return [header, ...body].join('\r\n');
}

export function getSettingsValue(settings, key, fallback = null) {
  return settings[key] ?? fallback;
}

export { safeJsonParse, clamp };
