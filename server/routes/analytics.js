import express from 'express';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { allowedSites, parseDayRange, resolveSiteIds } from './helpers.js';
import { analyticsData, bessAnalytics, gridGeneratorAnalytics, toCsv } from '../services/analytics.js';
import { getLive } from '../services/liveStore.js';
import { round, sum } from '../lib/util.js';

const router = express.Router();
router.use(requireAuth, requirePermission('analytics:view'));

async function ctx(req) {
  const all = await allowedSites(req);
  const requested = resolveSiteIds(req, req.query.siteIds || req.query.siteId);
  const visible = new Set(all.map((s) => s.id));
  const siteIds = requested.filter((id) => visible.has(id));
  const { from, to } = parseDayRange(req.query, '30d');
  return { all, siteIds, from, to };
}

function bucketKey(day, granularity) {
  const d = new Date(`${day}T00:00:00Z`);
  if (granularity === 'weekly') {
    const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - onejan) / 86400000) + onejan.getUTCDay() + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  if (granularity === 'monthly') return day.slice(0, 7);
  if (granularity === 'quarterly') return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  if (granularity === 'annual') return day.slice(0, 4);
  return day;
}

function groupSeries(daily, granularity) {
  if (!granularity || granularity === 'daily') return daily;
  const buckets = new Map();
  for (const row of daily) {
    const key = bucketKey(row.day, granularity);
    const b = buckets.get(key) || { period: key, pvMwh: 0, loadMwh: 0, importMwh: 0, exportMwh: 0, generatorMwh: 0, chargeMwh: 0, dischargeMwh: 0, peakLoadMw: 0, days: 0 };
    b.pvMwh += row.pvMwh; b.loadMwh += row.loadMwh; b.importMwh += row.importMwh;
    b.exportMwh += row.exportMwh; b.generatorMwh += row.generatorMwh;
    b.chargeMwh += row.chargeMwh; b.dischargeMwh += row.dischargeMwh;
    b.peakLoadMw = Math.max(b.peakLoadMw, row.peakLoadMw);
    b.days += 1;
    buckets.set(key, b);
  }
  return [...buckets.values()].map((b) => Object.fromEntries(
    Object.entries(b).map(([k, v]) => [k, typeof v === 'number' ? round(v, 3) : v]),
  ));
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { all, siteIds, from, to } = await ctx(req);
    if (!siteIds.length) return res.json({ summary: null, comparison: [], daily: [], monthly: [], message: 'No authorized sites selected.' });
    const data = await analyticsData(siteIds, from, to);
    const granularity = req.query.granularity || 'daily';
    const series = groupSeries(data.daily, granularity);
    const sites = all.filter((s) => siteIds.includes(s.id));
    const live = siteIds.map((id) => getLive(id)).filter(Boolean);

    const renewablePv = sum(live.map((s) => s.pv?.powerKw || 0));
    const liveLoad = sum(live.map((s) => s.load?.powerKw || 0));
    res.json({
      range: { from, to, granularity },
      summary: data.summary,
      comparison: data.comparison,
      daily: data.daily,
      monthly: data.monthly,
      series,
      granularity,
      live: {
        pvPowerMw: round(renewablePv / 1000, 3),
        loadPowerMw: round(liveLoad / 1000, 3),
        renewableSharePct: round((renewablePv / Math.max(1, liveLoad)) * 100, 1),
        sitesReporting: live.filter((s) => !s.stale).length,
      },
      siteCount: sites.length,
      dataSources: {
        demo: sites.filter((s) => s.data_source === 'DEMO').length,
        live: sites.filter((s) => s.data_source === 'LIVE').length,
      },
    });
  }),
);

router.get(
  '/performance',
  asyncHandler(async (req, res) => {
    const { all, siteIds, from, to } = await ctx(req);
    const data = await analyticsData(siteIds, from, to);
    const comparison = data.comparison.map((c) => ({
      ...c,
      capacityFactorPct: c.capacityFactorPct,
      performanceBand: c.performanceRatio >= 0.82 ? 'TARGET' : c.performanceRatio >= 0.72 ? 'BELOW_TARGET' : 'POOR',
      yieldBand: c.specificYield >= 3.6 ? 'STRONG' : c.specificYield >= 2.8 ? 'NORMAL' : 'LOW',
    }));
    const prTrend = data.monthly.map((m) => {
      const rows = [];
      const avg = comparison.length ? sum(comparison.map((c) => c.performanceRatio)) / comparison.length : 0;
      rows.push(avg);
      return { month: m.month, performanceRatio: round(avg, 3) };
    });
    const rankings = [...comparison].sort((a, b) => b.specificYield - a.specificYield);
    res.json({
      range: { from, to },
      summary: data.summary,
      sites: comparison,
      performanceRatioTrend: prTrend,
      bestPerformers: rankings.slice(0, 5),
      worstPerformers: [...rankings].reverse().slice(0, 5),
      targetPr: 0.82,
      siteCount: all.filter((s) => siteIds.includes(s.id)).length,
    });
  }),
);

router.get(
  '/savings',
  asyncHandler(async (req, res) => {
    const { all, siteIds, from, to } = await ctx(req);
    const data = await analyticsData(siteIds, from, to);
    const s = data.summary || {};
    const monthly = data.monthly.map((m) => ({
      month: m.month,
      savingsIdr: Math.round((m.pvMwh * 1000) * (s.tariffIdrPerKwh || 1444.7)),
      co2AvoidedKg: round((m.pvMwh * 1000) * (s.emissionFactorKgPerKwh || 0.87), 1),
      pvMwh: m.pvMwh,
      exportRevenueIdr: Math.round((m.exportMwh * 1000) * (s.tariffIdrPerKwh || 1444.7) * 0.65),
    }));
    res.json({
      range: { from, to },
      summary: {
        savingsIdr: s.savingsIdr || 0,
        exportRevenueIdr: s.exportRevenueIdr || 0,
        totalBenefitIdr: (s.savingsIdr || 0) + (s.exportRevenueIdr || 0),
        co2AvoidedKg: s.co2AvoidedKg || 0,
        co2AvoidedTonnes: round((s.co2AvoidedKg || 0) / 1000, 2),
        pvMwh: s.pvMwh || 0,
        tariffIdrPerKwh: s.tariffIdrPerKwh || 1444.7,
        emissionFactorKgPerKwh: s.emissionFactorKgPerKwh || 0.87,
        equivalentTrees: Math.round((s.co2AvoidedKg || 0) / 21.7),
        equivalentCarsKm: Math.round((s.co2AvoidedKg || 0) / 0.12),
      },
      monthly,
      bySite: data.comparison.map((c) => ({
        siteId: c.siteId, code: c.code, name: c.name, pvMwh: c.pvMwh,
        savingsIdr: c.savingsIdr, co2AvoidedKg: c.co2AvoidedKg, dataSource: c.dataSource,
      })).sort((a, b) => b.savingsIdr - a.savingsIdr),
      siteCount: all.filter((x) => siteIds.includes(x.id)).length,
    });
  }),
);

router.get(
  '/bess',
  asyncHandler(async (req, res) => {
    const { siteIds, from, to } = await ctx(req);
    const data = await bessAnalytics(siteIds, from, to);
    res.json({ range: { from, to }, ...data });
  }),
);

router.get(
  '/grid-generator',
  asyncHandler(async (req, res) => {
    const { siteIds, from, to } = await ctx(req);
    const data = await gridGeneratorAnalytics(siteIds, from, to);
    res.json({ range: { from, to }, ...data });
  }),
);

router.get(
  '/load',
  asyncHandler(async (req, res) => {
    const { all, siteIds, from, to } = await ctx(req);
    const { getDb } = await import('../db/adapter.js');
    const db = getDb();
    const rows = siteIds.length
      ? await db.all(
          `SELECT site_id, hour, load_kwh, peak_load_kw, import_kwh, pv_kwh FROM energy_hourly
           WHERE site_id IN (${siteIds.map(() => '?').join(',')}) AND substr(hour,1,10) BETWEEN ? AND ? ORDER BY hour`,
          [...siteIds, from, to],
        )
      : [];
    const profile = new Map();
    for (const r of rows) {
      const h = r.hour.slice(11, 13);
      const slot = profile.get(h) || { hour: `${h}:00`, loadKwh: 0, pvKwh: 0, importKwh: 0, peakKw: 0, samples: 0 };
      slot.loadKwh += r.load_kwh;
      slot.pvKwh += r.pv_kwh;
      slot.importKwh += r.import_kwh;
      slot.peakKw = Math.max(slot.peakKw, r.peak_load_kw);
      slot.samples += 1;
      profile.set(h, slot);
    }
    const daily = new Map();
    for (const r of rows) {
      const day = r.hour.slice(0, 10);
      const d = daily.get(day) || { day, loadKwh: 0, pvKwh: 0, importKwh: 0, peakKw: 0 };
      d.loadKwh += r.load_kwh; d.pvKwh += r.pv_kwh; d.importKwh += r.import_kwh;
      d.peakKw = Math.max(d.peakKw, r.peak_load_kw);
      daily.set(day, d);
    }
    const liveLoads = siteIds.map((id) => getLive(id)).filter(Boolean);
    const sites = all.filter((s) => siteIds.includes(s.id));
    const liveLoadKw = sum(liveLoads.map((s) => s.load?.powerKw || 0));
    const livePvKw = sum(liveLoads.map((s) => s.pv?.powerKw || 0));
    res.json({
      range: { from, to },
      totals: {
        loadMwh: round(sum(rows.map((r) => r.load_kwh)) / 1000, 3),
        pvMwh: round(sum(rows.map((r) => r.pv_kwh)) / 1000, 3),
        gridImportMwh: round(sum(rows.map((r) => r.import_kwh)) / 1000, 3),
        peakLoadMw: round(Math.max(0, ...rows.map((r) => r.peak_load_kw || 0)) / 1000, 3),
        loadFactorPct: round((sum(rows.map((r) => r.load_kwh)) / Math.max(1, Math.max(0, ...rows.map((r) => r.peak_load_kw || 0)) * Math.max(1, new Set(rows.map((r) => r.hour.slice(0, 10))).size * 24))) * 100, 1),
        liveLoadMw: round(liveLoadKw / 1000, 3),
        livePvMw: round(livePvKw / 1000, 3),
        solarCoveragePct: round((livePvKw / Math.max(1, liveLoadKw)) * 100, 1),
        totalCapacityKwp: round(sum(sites.map((s) => s.pv_capacity_kwp)), 1),
      },
      hourlyProfile: [...profile.values()].sort((a, b) => a.hour.localeCompare(b.hour)).map((p) => ({
        ...p, loadKwh: round(p.loadKwh, 1), pvKwh: round(p.pvKwh, 1), importKwh: round(p.importKwh, 1), peakKw: round(p.peakKw, 1),
      })),
      daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({
        ...d, loadMwh: round(d.loadKwh / 1000, 3), pvMwh: round(d.pvKwh / 1000, 3), importMwh: round(d.importKwh / 1000, 3), peakMw: round(d.peakKw / 1000, 3),
      })),
      sites: sites.map((s, i) => ({
        siteId: s.id, code: s.code, name: s.name, location: s.location,
        capacityKwp: s.pv_capacity_kwp,
        liveLoadKw: getLive(s.id)?.load?.powerKw ?? null,
        livePvKw: getLive(s.id)?.pv?.powerKw ?? null,
      })),
    });
  }),
);

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const { siteIds, from, to } = await ctx(req);
    const data = await analyticsData(siteIds, from, to);
    const format = String(req.query.format || 'csv').toLowerCase();
    if (format !== 'csv') throw badRequest('Only CSV export is supported here; use /api/reports for PDF/XLSX.');
    const columns = [
      { key: 'code', label: 'Site Code' }, { key: 'name', label: 'Site' },
      { key: 'pvCapacityKwp', label: 'PV kWp' }, { key: 'pvMwh', label: 'PV MWh' },
      { key: 'loadMwh', label: 'Load MWh' }, { key: 'importMwh', label: 'Import MWh' },
      { key: 'exportMwh', label: 'Export MWh' }, { key: 'chargeMwh', label: 'Charge MWh' },
      { key: 'dischargeMwh', label: 'Discharge MWh' }, { key: 'generatorMwh', label: 'Generator MWh' },
      { key: 'specificYield', label: 'kWh/kWp' }, { key: 'performanceRatio', label: 'PR' },
      { key: 'selfConsumptionPct', label: 'Self-consumption %' }, { key: 'savingsIdr', label: 'Savings IDR' },
      { key: 'co2AvoidedKg', label: 'CO2 kg' }, { key: 'dataSource', label: 'Data Source' },
    ];
    const csv = `\uFEFF${toCsv(data.comparison, columns)}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="chsms-analytics-${from}-to-${to}.csv"`);
    res.send(csv);
  }),
);

export default router;
