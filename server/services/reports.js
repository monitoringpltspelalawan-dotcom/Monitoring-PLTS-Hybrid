import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { config } from '../config.js';
import { getDb } from '../db/adapter.js';
import { analyticsData, bessAnalytics, dayRangeFromRange, gridGeneratorAnalytics, toCsv } from './analytics.js';
import { localDayStartUtc, nowIso } from '../lib/time.js';
import { round, safeJsonParse, uid } from '../lib/util.js';

export const REPORT_TYPES = [
  { code: 'DAILY_SITE', name: 'Daily Site Report', description: 'Daily energy, load, BESS and grid performance for selected sites.' },
  { code: 'MONTHLY_SITE', name: 'Monthly Site Report', description: 'Monthly energy balance and availability per site.' },
  { code: 'ANNUAL_ENERGY', name: 'Annual Energy Report', description: 'Twelve-month energy production and consumption summary.' },
  { code: 'PORTFOLIO_PERFORMANCE', name: 'Multi-site Performance Report', description: 'Portfolio comparison, specific yield, PR, savings and CO₂.' },
  { code: 'BESS_PERFORMANCE', name: 'BESS Performance Report', description: 'Battery capacity, throughput, cycles and round-trip efficiency.' },
  { code: 'INVERTER_PERFORMANCE', name: 'Inverter Performance Report', description: 'PV production, specific yield and performance ratio by site.' },
  { code: 'ALARM_EVENT', name: 'Alarm & Event Report', description: 'Alarm history with acknowledgement and resolution audit.' },
  { code: 'GATEWAY_COMMUNICATION', name: 'Gateway Communication Report', description: 'Gateway availability, latency and buffer backlog.' },
];

const FORMATS = ['PDF', 'XLSX', 'CSV'];

function formatMoney(v) {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(v);
}

function reportLabel(type) {
  return REPORT_TYPES.find((t) => t.code === type)?.name || type;
}

async function buildData({ type, siteIds, fromDay, toDay }) {
  const db = getDb();
  const siteRows = siteIds.length
    ? await db.all(`SELECT * FROM sites WHERE id IN (${siteIds.map(() => '?').join(',')}) ORDER BY code`, siteIds)
    : await db.all('SELECT * FROM sites ORDER BY code');
  const allowedIds = siteRows.map((s) => s.id);
  const analytics = await analyticsData(allowedIds, fromDay, toDay);
  const fromUtc = localDayStartUtc(fromDay);
  const toUtc = localDayStartUtc(toDay, 'Asia/Jakarta');
  const endUtc = new Date(new Date(toUtc).getTime() + 86400_000).toISOString();

  const alarmRows = allowedIds.length
    ? await db.all(
        `SELECT a.*, s.code AS site_code, s.name AS site_name FROM alarms a JOIN sites s ON s.id = a.site_id
         WHERE a.site_id IN (${allowedIds.map(() => '?').join(',')}) AND a.triggered_at >= ? AND a.triggered_at < ?
         ORDER BY a.triggered_at DESC`,
        [...allowedIds, fromUtc, endUtc],
      )
    : [];

  const gateways = allowedIds.length
    ? await db.all(
        `SELECT g.*, s.code AS site_code, s.name AS site_name FROM gateways g JOIN sites s ON s.id = g.site_id
         WHERE g.site_id IN (${allowedIds.map(() => '?').join(',')}) ORDER BY s.code`,
        allowedIds,
      )
    : [];
  const commRows = allowedIds.length
    ? await db.all(
        `SELECT gateway_id, COUNT(*) AS samples, AVG(latency_ms) AS avg_latency, MAX(backlog) AS max_backlog
         FROM gateway_health WHERE site_id IN (${allowedIds.map(() => '?').join(',')}) AND ts >= ? AND ts < ?
         GROUP BY gateway_id`,
        [...allowedIds, fromUtc, endUtc],
      )
    : [];
  const bess = await bessAnalytics(allowedIds, fromDay, toDay);
  const grid = await gridGeneratorAnalytics(allowedIds, fromDay, toDay);

  return { siteRows, analytics, alarmRows, gateways, commRows, bess, grid, fromUtc, endUtc };
}

function energyColumns(data) {
  return [
    { key: 'code', label: 'Site Code' },
    { key: 'name', label: 'Site' },
    { key: 'pvCapacityKwp', label: 'PV kWp' },
    { key: 'pvMwh', label: 'PV MWh' },
    { key: 'specificYield', label: 'kWh/kWp' },
    { key: 'loadMwh', label: 'Load MWh' },
    { key: 'importMwh', label: 'Import MWh' },
    { key: 'exportMwh', label: 'Export MWh' },
    { key: 'chargeMwh', label: 'Charge MWh' },
    { key: 'dischargeMwh', label: 'Discharge MWh' },
    { key: 'generatorMwh', label: 'Genset MWh' },
    { key: 'performanceRatio', label: 'PR' },
    { key: 'savingsIdr', label: 'Savings IDR' },
    { key: 'co2AvoidedKg', label: 'CO2 kg' },
  ];
}

function buildTable(type, data) {
  const { analytics, alarmRows, gateways, commRows, bess, grid } = data;
  switch (type) {
    case 'ALARM_EVENT':
      return {
        title: 'Alarm & Event Register',
        columns: [
          { key: 'triggered_at', label: 'Triggered (UTC)' },
          { key: 'site_code', label: 'Site' },
          { key: 'severity', label: 'Severity' },
          { key: 'code', label: 'Code' },
          { key: 'title', label: 'Description' },
          { key: 'status', label: 'Status' },
          { key: 'acknowledged_by', label: 'Acknowledged By' },
          { key: 'resolved_at', label: 'Resolved At' },
        ],
        rows: alarmRows,
        summary: [
          ['Total alarms', alarmRows.length],
          ['Critical', alarmRows.filter((a) => a.severity === 'CRITICAL').length],
          ['Warning', alarmRows.filter((a) => a.severity === 'WARNING').length],
          ['Open', alarmRows.filter((a) => a.status !== 'RESOLVED').length],
        ],
      };
    case 'GATEWAY_COMMUNICATION': {
      const rows = gateways.map((g) => {
        const comm = commRows.find((c) => c.gateway_id === g.id) || {};
        return {
          site_code: g.site_code, gateway: g.id, status: g.status, last_seen: g.last_seen_at,
          latency_ms: g.latency_ms, backlog: g.buffer_backlog, firmware: g.firmware,
          samples: comm.samples || 0, avg_latency: round(comm.avg_latency || 0, 1), max_backlog: comm.max_backlog || 0,
        };
      });
      return {
        title: 'Gateway Communication Report',
        columns: [
          { key: 'site_code', label: 'Site' }, { key: 'gateway', label: 'Gateway' }, { key: 'status', label: 'Status' },
          { key: 'last_seen', label: 'Last Seen (UTC)' }, { key: 'latency_ms', label: 'Latency ms' },
          { key: 'backlog', label: 'Backlog' }, { key: 'samples', label: 'Health Samples' },
          { key: 'avg_latency', label: 'Avg Latency ms' }, { key: 'max_backlog', label: 'Max Backlog' },
          { key: 'firmware', label: 'Firmware' },
        ],
        rows,
        summary: [
          ['Gateways', gateways.length],
          ['Online', gateways.filter((g) => g.status === 'ONLINE').length],
          ['Offline', gateways.filter((g) => g.status === 'OFFLINE').length],
          ['Avg latency (ms)', round(gateways.reduce((a, g) => a + (g.latency_ms || 0), 0) / Math.max(1, gateways.length), 1)],
        ],
      };
    }
    case 'BESS_PERFORMANCE': {
      const rows = bess.sites.map((s) => ({
        site_code: s.code, name: s.name, capacity_kwh: s.capacityKwh, power_kw: s.powerKw,
        charge_kwh: s.chargeKwh, discharge_kwh: s.dischargeKwh, cycles: s.cycles,
        soc_pct: s.socPct, soh_pct: s.sohPct, temperature_c: s.temperatureC,
      }));
      return {
        title: 'BESS Performance Report',
        columns: [
          { key: 'site_code', label: 'Site' }, { key: 'name', label: 'Name' }, { key: 'capacity_kwh', label: 'Capacity kWh' },
          { key: 'power_kw', label: 'Power kW' }, { key: 'charge_kwh', label: 'Charge kWh' },
          { key: 'discharge_kwh', label: 'Discharge kWh' }, { key: 'cycles', label: 'Equivalent Cycles' },
          { key: 'soc_pct', label: 'SOC %' }, { key: 'soh_pct', label: 'SOH %' }, { key: 'temperature_c', label: 'Temp °C' },
        ],
        rows,
        summary: [
          ['Installed BESS (kWh)', bess.totals.capacityKwh],
          ['Total charge (kWh)', bess.totals.chargeKwh],
          ['Total discharge (kWh)', bess.totals.dischargeKwh],
          ['Round-trip efficiency (%)', bess.totals.roundTripEfficiencyPct],
          ['Average SOC (%)', bess.totals.avgSocPct],
        ],
      };
    }
    case 'INVERTER_PERFORMANCE':
      return {
        title: 'Inverter / PV Performance Report',
        columns: [
          { key: 'code', label: 'Site' }, { key: 'name', label: 'Name' }, { key: 'pvCapacityKwp', label: 'PV kWp' },
          { key: 'pvMwh', label: 'PV MWh' }, { key: 'specificYield', label: 'kWh/kWp' },
          { key: 'performanceRatio', label: 'Performance Ratio' }, { key: 'capacityFactorPct', label: 'Capacity Factor %' },
          { key: 'selfConsumptionPct', label: 'Self-consumption %' },
        ],
        rows: analytics.comparison,
        summary: [
          ['Installed PV (kWp)', analytics.summary.totalPvCapacityKwp],
          ['PV production (MWh)', analytics.summary.pvMwh],
          ['Specific yield (kWh/kWp)', analytics.summary.specificYieldKwhPerKwp],
          ['Performance ratio', analytics.summary.performanceRatio],
          ['Renewable share (%)', analytics.summary.renewableSharePct],
        ],
      };
    case 'PORTFOLIO_PERFORMANCE':
    case 'ANNUAL_ENERGY':
    case 'MONTHLY_SITE':
    case 'DAILY_SITE':
    default:
      return {
        title: reportLabel(type),
        columns: energyColumns(data),
        rows: analytics.comparison,
        summary: [
          ['Sites', data.siteRows.length],
          ['Installed PV (kWp)', analytics.summary.totalPvCapacityKwp],
          ['PV production (MWh)', analytics.summary.pvMwh],
          ['Load (MWh)', analytics.summary.loadMwh],
          ['Grid import (MWh)', analytics.summary.importMwh],
          ['Grid export (MWh)', analytics.summary.exportMwh],
          ['BESS discharge (MWh)', analytics.summary.dischargeMwh],
          ['Generator (MWh)', analytics.summary.generatorMwh],
          ['Specific yield (kWh/kWp)', analytics.summary.specificYieldKwhPerKwp],
          ['Performance ratio', analytics.summary.performanceRatio],
          ['Renewable share (%)', analytics.summary.renewableSharePct],
          ['CO₂ avoided (kg)', analytics.summary.co2AvoidedKg],
          ['Estimated savings (IDR)', formatMoney(analytics.summary.savingsIdr)],
          ['Grid availability', `${grid.totals.gridAvailableSites}/${grid.totals.gridAvailableSites + grid.totals.gridOfflineSites}`],
        ],
      };
  }
}

function renderPdf(file, { title, subtitle, table, period, user }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 38, bufferPages: true });
    const stream = fs.createWriteStream(file);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);

    const pageWidth = doc.page.width - 76;
    const dark = '#0b1c2c';
    const accent = '#f5a524';
    const muted = '#64748b';

    // Header band
    doc.rect(0, 0, doc.page.width, 74).fill(dark);
    doc.fillColor(accent).fontSize(9).text('CENTRALIZED HYBRID SOLAR MONITORING SYSTEM', 38, 18, { characterSpacing: 1 });
    doc.fillColor('#ffffff').fontSize(19).text(title, 38, 32);
    doc.fillColor('#94a3b8').fontSize(9).text(`Period: ${period.from} → ${period.to}   •   Generated: ${new Date().toUTCString()}   •   By: ${user || 'system'}`, 38, 56);

    let y = 94;
    // Summary boxes
    const summary = table.summary || [];
    const boxW = Math.min(150, (pageWidth - 12) / 3);
    const cols = Math.floor(pageWidth / (boxW + 8));
    summary.forEach(([label, value], idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const bx = 38 + col * (boxW + 8);
      const by = y + row * 46;
      doc.roundedRect(bx, by, boxW, 38, 4).fillAndStroke('#f1f5f9', '#dbe3ec');
      doc.fillColor(muted).fontSize(7).text(String(label).toUpperCase(), bx + 8, by + 6, { width: boxW - 16 });
      doc.fillColor(dark).fontSize(12).text(String(value), bx + 8, by + 18, { width: boxW - 16, ellipsis: true });
    });
    y += Math.ceil(summary.length / cols) * 46 + 14;

    const columns = table.columns;
    const widths = columns.map((c, i) => {
      if (i === 0) return 78;
      if (i === 1) return 120;
      return Math.max(48, Math.floor((pageWidth - 198) / (columns.length - 2)));
    });
    const rowH = 18;
    const drawHeader = () => {
      doc.rect(38, y, pageWidth, rowH).fill('#13324a');
      let x = 38;
      columns.forEach((c, i) => {
        doc.fillColor('#e2e8f0').fontSize(7).text(c.label, x + 4, y + 5, { width: widths[i] - 8, ellipsis: true });
        x += widths[i];
      });
      y += rowH;
    };
    drawHeader();

    table.rows.forEach((row, idx) => {
      if (y > doc.page.height - 70) {
        doc.addPage();
        y = 40;
        drawHeader();
      }
      if (idx % 2 === 0) doc.rect(38, y, pageWidth, rowH).fill('#f8fafc');
      let x = 38;
      columns.forEach((c, i) => {
        const value = row[c.key];
        doc.fillColor('#1e293b').fontSize(7.2).text(value === null || value === undefined ? '—' : String(value), x + 4, y + 5, {
          width: widths[i] - 8, ellipsis: true, lineBreak: false,
        });
        x += widths[i];
      });
      doc.moveTo(38, y + rowH).lineTo(38 + pageWidth, y + rowH).strokeColor('#e9eef5').lineWidth(0.4).stroke();
      y += rowH;
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.fillColor(muted).fontSize(7).text(
        `CHSMS • Confidential • Page ${i + 1} of ${range.count}`,
        38, doc.page.height - 26, { width: pageWidth, align: 'center' },
      );
    }
    doc.end();
  });
}

async function renderXlsx(file, { title, table, period, user, analytics }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CHSMS';
  wb.created = new Date();
  const meta = wb.addWorksheet('Summary');
  meta.columns = [{ width: 34 }, { width: 52 }];
  const rows = [
    ['CENTRALIZED HYBRID SOLAR MONITORING SYSTEM', ''],
    [title, ''],
    ['Period', `${period.from} to ${period.to}`],
    ['Generated (UTC)', new Date().toISOString()],
    ['Generated by', user || 'system'],
    ['', ''],
    ['Metric', 'Value'],
    ...(table.summary || []),
  ];
  rows.forEach((r, i) => {
    const row = meta.addRow(r);
    if (i === 0) row.font = { bold: true, size: 14, color: { argb: 'FFB45309' } };
    if (i === 1) row.font = { bold: true, size: 12 };
    if (i === 6) { row.font = { bold: true }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13324A' } }; row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; }
  });

  const ws = wb.addWorksheet('Report Data');
  ws.columns = table.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(14, Math.min(30, c.label.length + 6)) }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13324A' } };
  ws.getRow(1).height = 22;
  table.rows.forEach((r) => ws.addRow(r));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + table.columns.length)}1` };

  if (analytics?.daily?.length) {
    const trend = wb.addWorksheet('Daily Trend');
    trend.columns = [
      { header: 'Day', key: 'day', width: 14 },
      { header: 'PV MWh', key: 'pvMwh', width: 12 },
      { header: 'Load MWh', key: 'loadMwh', width: 12 },
      { header: 'Import MWh', key: 'importMwh', width: 12 },
      { header: 'Export MWh', key: 'exportMwh', width: 12 },
      { header: 'Generator MWh', key: 'generatorMwh', width: 14 },
    ];
    trend.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    trend.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13324A' } };
    analytics.daily.forEach((d) => trend.addRow(d));
  }

  await wb.xlsx.writeFile(file);
}

function renderCsv(file, table) {
  const rows = table.rows;
  const csv = `\uFEFF${toCsv(rows, table.columns)}`;
  fs.writeFileSync(file, csv);
}

export async function generateReport({ type, format = 'PDF', fromDay, toDay, siteIds = [], user, name }) {
  if (!REPORT_TYPES.some((t) => t.code === type)) throw new Error('Unknown report type');
  const fmt = String(format).toUpperCase();
  if (!FORMATS.includes(fmt)) throw new Error('Unsupported format');
  const range = dayRangeFromRange('30d');
  const from = fromDay || range.fromDay;
  const to = toDay || range.toDay;
  const data = await buildData({ type, siteIds, fromDay: from, toDay: to });
  const table = buildTable(type, data);
  const id = uid('rpt');
  const ext = fmt.toLowerCase();
  const filePath = path.join(config.reportDir, `${id}.${ext}`);
  const title = name || reportLabel(type);
  const period = { from, to };
  if (fmt === 'PDF') await renderPdf(filePath, { title, table, period, user });
  else if (fmt === 'XLSX') await renderXlsx(filePath, { title, table, period, user, analytics: data.analytics });
  else renderCsv(filePath, table);
  const stat = fs.statSync(filePath);
  const db = getDb();
  const record = {
    id, name: title, report_type: type, format: fmt, period_start: from, period_end: to,
    site_ids: JSON.stringify(siteIds), file_path: filePath, size_bytes: stat.size,
    status: 'READY', created_by: user || 'system', created_at: nowIso(),
  };
  await db.run(
    'INSERT INTO generated_reports (id, name, report_type, format, period_start, period_end, site_ids, file_path, size_bytes, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [record.id, record.name, record.report_type, record.format, record.period_start, record.period_end, record.site_ids, record.file_path, record.size_bytes, record.status, record.created_by, record.created_at],
  );
  return record;
}

function nextRunFor(frequency) {
  const d = new Date();
  if (frequency === 'DAILY') d.setUTCDate(d.getUTCDate() + 1);
  else if (frequency === 'WEEKLY') d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === 'QUARTERLY') d.setUTCMonth(d.getUTCMonth() + 3);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

let scheduleTimer = null;

export function startReportScheduler() {
  if (scheduleTimer) return;
  scheduleTimer = setInterval(async () => {
    try {
      const db = getDb();
      const due = await db.all('SELECT * FROM report_schedules WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)', [nowIso()]);
      for (const schedule of due) {
        const range = dayRangeFromRange(schedule.frequency === 'DAILY' ? '24h' : schedule.frequency === 'WEEKLY' ? '7d' : '30d');
        try {
          await generateReport({
            type: schedule.report_type, format: schedule.format, fromDay: range.fromDay, toDay: range.toDay,
            siteIds: safeJsonParse(schedule.site_ids, []), user: schedule.created_by, name: schedule.name,
          });
        } catch (err) {
          console.error(`[reports] scheduled '${schedule.name}' failed`, err.message);
        }
        await db.run('UPDATE report_schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?', [nowIso(), nextRunFor(schedule.frequency), schedule.id]);
      }
    } catch (err) {
      console.error('[reports] scheduler error', err.message);
    }
  }, 60_000);
  scheduleTimer.unref?.();
  console.log('[reports] scheduler started');
}

export function stopReportScheduler() {
  if (scheduleTimer) clearInterval(scheduleTimer);
  scheduleTimer = null;
}
