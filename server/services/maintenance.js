import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db/adapter.js';
import { getLive, setLive } from './liveStore.js';
import { broadcast } from './realtime.js';
import { nowIso } from '../lib/time.js';

let timer = null;
let lastCleanup = null;
let lastStaleCheck = null;
let cleanupStats = null;

const RETENTION_TABLES = [
  { table: 'measurements', column: 'server_ts', days: config.retention.measurementsDays },
  { table: 'ingest_messages', column: 'received_at', days: config.retention.ingestMessagesDays },
  { table: 'gateway_health', column: 'ts', days: 90 },
  { table: 'comm_logs', column: 'ts', days: 30 },
  { table: 'audit_logs', column: 'ts', days: config.retention.auditDays },
  { table: 'notifications', column: 'created_at', days: 180 },
];

export async function runRetentionCleanup() {
  const db = getDb();
  const cutoffFor = (days) => new Date(Date.now() - days * 86400_000).toISOString();
  const stats = {};
  for (const rule of RETENTION_TABLES) {
    const cutoff = cutoffFor(rule.days);
    try {
      const res = await db.run(`DELETE FROM ${rule.table} WHERE ${rule.column} < ?`, [cutoff]);
      stats[rule.table] = res.changes;
    } catch (err) {
      stats[rule.table] = `error: ${err.message}`;
    }
  }
  // Expired sessions
  const sessions = await db.run('DELETE FROM sessions WHERE expires_at < ? OR revoked = 1', [cutoffFor(2)]);
  stats.sessions = sessions.changes;
  // Remove orphaned report files
  try {
    const dbReports = await db.all('SELECT id, file_path FROM generated_reports');
    const known = new Set(dbReports.map((r) => path.basename(r.file_path || '')));
    for (const file of fs.readdirSync(config.reportDir)) {
      if (!known.has(file) && !file.endsWith('.tmp')) {
        const full = path.join(config.reportDir, file);
        if (Date.now() - fs.statSync(full).mtimeMs > 86400_000) fs.unlinkSync(full);
      }
    }
  } catch { /* ignore */ }
  lastCleanup = nowIso();
  cleanupStats = stats;
  console.log('[maintenance] retention cleanup', stats);
  return stats;
}

export async function checkStaleGateways() {
  const db = getDb();
  const threshold = new Date(Date.now() - 5 * 60_000).toISOString();
  const stale = await db.all(
    "SELECT g.id, g.site_id, s.code, s.name FROM gateways g JOIN sites s ON s.id = g.site_id WHERE g.data_source = 'LIVE' AND (g.last_seen_at IS NULL OR g.last_seen_at < ?) AND g.status != 'OFFLINE'",
    [threshold],
  );
  for (const gw of stale) {
    await db.run("UPDATE gateways SET status = 'OFFLINE', updated_at = ? WHERE id = ?", [nowIso(), gw.id]);
    await db.run("UPDATE sites SET comm_status = 'OFFLINE', updated_at = ? WHERE id = ?", [nowIso(), gw.site_id]);
    const snap = getLive(gw.site_id);
    if (snap) {
      setLive(gw.site_id, { ...snap, stale: true, quality: 'BAD', commStatus: 'OFFLINE', gateway: { ...snap.gateway, status: 'OFFLINE' } });
    }
    broadcast({ type: 'gateway_offline', gatewayId: gw.id, siteId: gw.site_id, siteCode: gw.code, ts: nowIso() });
  }
  lastStaleCheck = nowIso();
  return stale;
}

export function startMaintenance() {
  if (timer) return;
  runRetentionCleanup().catch((e) => console.error('[maintenance]', e.message));
  timer = setInterval(async () => {
    try {
      await checkStaleGateways();
      if (!lastCleanup || Date.now() - new Date(lastCleanup).getTime() > 86400_000) await runRetentionCleanup();
    } catch (err) {
      console.error('[maintenance] job failed', err.message);
    }
  }, 60_000);
  timer.unref?.();
  console.log('[maintenance] retention & stale-gateway jobs started');
}

export function maintenanceStats() {
  return { lastCleanup, lastStaleCheck, cleanupStats };
}
