import express from 'express';
import { asyncHandler, badRequest, unauthorized } from '../lib/errors.js';
import { findGatewayByCredentials, ingestHeartbeat, ingestTelemetry } from '../services/ingest.js';
import { getBrokerStatus } from '../mqtt/broker.js';
import { rateLimit } from '../middleware/auth.js';
import { config } from '../config.js';
import { nowIso } from '../lib/time.js';

const router = express.Router();

async function gatewayAuth(req, res, next) {
  try {
    const gatewayId = req.headers['x-gateway-id'] || req.query.gatewayId;
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : req.query.token;
    if (!gatewayId || !token) throw unauthorized('X-Gateway-Id and Bearer token are required');
    const gateway = await findGatewayByCredentials(String(gatewayId), String(token));
    if (!gateway) throw unauthorized('Invalid gateway credentials');
    req.gateway = gateway;
    next();
  } catch (err) {
    next(err);
  }
}

const ingestLimiter = rateLimit({
  windowMs: 60_000, max: config.ingest.rateLimitPerMin,
  keyFn: (req) => req.headers['x-gateway-id'] || req.ip,
});

router.post(
  '/telemetry',
  ingestLimiter,
  gatewayAuth,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const result = await ingestTelemetry({
      gatewayId: req.gateway.id,
      siteId: body.siteId || req.gateway.site_id,
      seq: body.seq,
      ts: body.ts,
      measurements: body.measurements || [],
      snapshot: body.snapshot || null,
      source: 'HTTPS',
    });
    if (!result.ok) throw badRequest(result.error || 'Telemetry rejected');
    res.status(result.duplicate ? 200 : 202).json({
      ...result, gatewayId: req.gateway.id, receivedAt: nowIso(),
      security: { transport: 'HTTPS', outboundGateway: true },
    });
  }),
);

router.post(
  '/heartbeat',
  ingestLimiter,
  gatewayAuth,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const result = await ingestHeartbeat({
      gatewayId: req.gateway.id,
      siteId: body.siteId || req.gateway.site_id,
      latencyMs: body.latencyMs || 0,
      backlog: body.backlog || 0,
      cpuPct: body.cpuPct || 0,
      memPct: body.memPct || 0,
      uptimeSec: body.uptimeSec || 0,
      firmware: body.firmware,
      source: 'HTTPS',
    });
    res.json({ ...result, gatewayId: req.gateway.id, receivedAt: nowIso() });
  }),
);

router.get(
  '/status',
  gatewayAuth,
  asyncHandler(async (req, res) => {
    const broker = getBrokerStatus();
    res.json({
      gatewayId: req.gateway.id,
      siteId: req.gateway.site_id,
      serverTime: nowIso(),
      mqtt: { tlsPort: config.mqtt.tlsPort, running: broker.running, tlsRequired: true },
      limits: { maxBatch: config.ingest.maxBatch, requestsPerMinute: config.ingest.rateLimitPerMin },
      security: { readOnly: true, outboundOnly: true },
    });
  }),
);

export default router;
