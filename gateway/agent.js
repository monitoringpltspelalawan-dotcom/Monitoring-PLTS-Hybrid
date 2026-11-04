import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';
import { decodeRegister, readModbusTcp } from '../server/lib/modbus.js';
import { loadGatewayConfig } from './config.js';
import { DiskOutbox } from './outbox.js';

const startedAt = Date.now();

function postJson(url, { headers, body, timeoutMs, ca }) {
  const parsedUrl = new URL(url);
  const client = parsedUrl.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(parsedUrl, {
      method: 'POST',
      headers,
      ...(parsedUrl.protocol === 'https:' && ca ? { ca } : {}),
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          response.destroy(new Error('Ingest response exceeded 1 MiB'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          reject(new Error(`Ingest returned invalid JSON (HTTP ${response.statusCode || 0})`));
          return;
        }
        if ((response.statusCode || 500) < 200 || response.statusCode >= 300 || payload.ok === false) {
          reject(new Error(`Ingest failed (HTTP ${response.statusCode || 0}): ${payload.error?.message || payload.error || response.statusMessage}`));
          return;
        }
        resolve(payload);
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Ingest request timed out after ${timeoutMs} ms`)));
    request.once('error', reject);
    request.end(body);
  });
}

function wordCount(dataType) {
  return ({ BOOL: 1, INT16: 1, UINT16: 1, INT32: 2, UINT32: 2, FLOAT32: 2, INT64: 4, UINT64: 4, FLOAT64: 4 })[dataType];
}

export async function pollDevice(device, { timeoutMs = 3000, retries = 1, read = readModbusTcp, now = () => Date.now() } = {}) {
  const measurements = [];
  const failures = [];
  let latencyTotal = 0;

  for (const mapping of device.registers) {
    const count = mapping.functionCode <= 2 ? 1 : wordCount(mapping.dataType);
    let result;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        result = await read({
          host: device.ipAddress,
          port: device.port,
          unitId: device.unitId,
          functionCode: mapping.functionCode,
          address: mapping.address,
          count,
          timeoutMs,
        });
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (result.ok) break;
    }
    if (!result?.ok) {
      failures.push({ deviceId: device.id, parameterId: mapping.parameterId, error: result?.error || 'No Modbus response' });
      continue;
    }

    latencyTotal += Number(result.latencyMs) || 0;
    try {
      const decoded = decodeRegister(result.response.data, {
        dataType: mapping.dataType,
        wordOrder: mapping.wordOrder,
        byteOrder: mapping.byteOrder,
        scale: mapping.scale,
        offset: mapping.offset,
        functionCode: mapping.functionCode,
      });
      if (!Number.isFinite(decoded.value)) throw new Error('Decoded value is not finite');
      measurements.push({
        deviceId: device.id,
        parameterId: mapping.parameterId,
        value: decoded.value,
        unit: mapping.unit || null,
        quality: 'GOOD',
        deviceTs: new Date(now()).toISOString(),
      });
    } catch (err) {
      failures.push({ deviceId: device.id, parameterId: mapping.parameterId, error: err.message });
    }
  }

  return { measurements, failures, latencyMs: measurements.length ? latencyTotal / measurements.length : null };
}

function localLoopback(url) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
}

export function createTransport(config) {
  const endpoint = new URL(config.transport.url);
  const localPlaintext = (endpoint.protocol === 'http:' || endpoint.protocol === 'mqtt:') &&
    config.transport.allowInsecureLoopback === true && localLoopback(endpoint);

  if (config.transport.type === 'https') {
    return {
      async send(kind, payload) {
        if (endpoint.protocol !== 'https:' && !localPlaintext) throw new Error('Refusing non-TLS HTTPS gateway transport');
        return postJson(`${config.transport.url}/api/ingest/${kind}`, {
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.token}`,
            'x-gateway-id': config.gatewayId,
          },
          body: JSON.stringify(payload),
          timeoutMs: config.timeoutMs,
          ca: config.transport.caFile ? fs.readFileSync(config.transport.caFile) : undefined,
        });
      },
      async close() {},
    };
  }

  if (!['mqtts:', 'mqtt:'].includes(endpoint.protocol) || (endpoint.protocol === 'mqtt:' && !localPlaintext)) {
    throw new Error('MQTT gateway transport requires mqtts; plaintext mqtt is allowed only on explicitly configured loopback');
  }
  let client;
  const getClient = () => {
    if (!client) {
      client = mqtt.connect(endpoint.toString(), {
        clientId: config.clientId || `gw-${config.gatewayId}`,
        username: config.gatewayId,
        password: config.token,
        reconnectPeriod: 3000,
        connectTimeout: config.timeoutMs,
        rejectUnauthorized: true,
        ...(config.transport.caFile ? { ca: fs.readFileSync(config.transport.caFile) } : {}),
      });
      client.on('error', (err) => console.error(`[gateway] MQTT: ${err.message}`));
    }
    return client;
  };
  const waitUntilConnected = (connection) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('MQTT connection timed out')), config.timeoutMs);
    const finish = (err) => {
      clearTimeout(timer);
      connection.removeListener('connect', onConnect);
      connection.removeListener('error', onError);
      if (err) reject(err);
      else resolve();
    };
    const onConnect = () => finish();
    const onError = (err) => finish(err);
    connection.once('connect', onConnect);
    connection.once('error', onError);
  });
  return {
    async send(kind, payload) {
      const connection = getClient();
      if (!connection.connected) await waitUntilConnected(connection);
      await connection.publishAsync(`${config.topicPrefix}/${kind}`, JSON.stringify(payload), { qos: 1, retain: false });
      return { ok: true };
    },
    async close() {
      if (client) await new Promise((resolve) => client.end(false, {}, resolve));
    },
  };
}

function systemHealth() {
  const total = os.totalmem();
  return {
    cpuPct: null,
    memPct: total ? Math.round(((total - os.freemem()) / total) * 1000) / 10 : 0,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  };
}

async function sendPending(outbox, transport) {
  while (outbox.peek()) {
    const batch = outbox.peek();
    await transport.send('telemetry', batch);
    outbox.acknowledge(batch.seq);
  }
}

function waitForInterval(ms, signal) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export async function runGateway(config, { once = false, transportFactory = createTransport, read = readModbusTcp, signal } = {}) {
  const outbox = new DiskOutbox(config.outboxFile);
  const transport = transportFactory(config);
  const nextPollAt = new Map();
  let lastHeartbeat = 0;
  let hasErrors = false;

  const cycle = async () => {
    const now = Date.now();
    const measurements = [];
    for (const device of config.devices) {
      const due = device.registers.filter((register) => {
        const key = `${device.id}:${register.parameterId}`;
        if ((nextPollAt.get(key) || 0) > now) return false;
        nextPollAt.set(key, now + register.pollIntervalSec * 1000);
        return true;
      });
      if (!due.length) continue;
      const result = await pollDevice({ ...device, registers: due }, { timeoutMs: config.timeoutMs, retries: config.retries, read });
      measurements.push(...result.measurements);
      if (result.failures.length) hasErrors = true;
      for (const failure of result.failures) console.warn(`[gateway] Modbus read failed ${failure.deviceId}/${failure.parameterId}: ${failure.error}`);
    }
    if (measurements.length) outbox.enqueue({ siteId: config.siteId, measurements });

    try {
      await sendPending(outbox, transport);
    } catch (err) {
      hasErrors = true;
      console.error(`[gateway] Telemetry delivery deferred; ${outbox.size} batch(es) remain buffered: ${err.message}`);
    }

    const health = systemHealth();
    if (now - lastHeartbeat >= config.heartbeatIntervalMs) {
      try {
        await transport.send('heartbeat', {
          siteId: config.siteId,
          backlog: outbox.size,
          latencyMs: null,
          ...health,
          firmware: config.firmware || 'edge-1.0.0',
        });
        lastHeartbeat = now;
      } catch (err) {
        hasErrors = true;
        console.error(`[gateway] Heartbeat delivery failed: ${err.message}`);
      }
    }
    return { measurements: measurements.length, backlog: outbox.size };
  };

  try {
    if (once) {
      await cycle();
      return { ok: !hasErrors, backlog: outbox.size };
    }
    console.log(`[gateway] ${config.gatewayId} started for site ${config.siteId}; polling ${config.devices.length} device(s), read-only`);
    while (!signal?.aborted) {
      await cycle();
      await waitForInterval(config.pollIntervalMs, signal);
    }
    return { ok: !hasErrors, backlog: outbox.size };
  } finally {
    await transport.close();
  }
}

function parseArgs(args) {
  const result = { configPath: null, once: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--config' && args[i + 1]) result.configPath = args[++i];
    else if (args[i] === '--once') result.once = true;
    else throw new Error(`Unknown gateway argument: ${args[i]}`);
  }
  if (!result.configPath) throw new Error('Usage: npm run gateway -- --config <path-to-config.json> [--once]');
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadGatewayConfig(args.configPath);
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  const result = await runGateway(config, { once: args.once, signal: controller.signal });
  if (!result.ok || result.backlog) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((err) => {
    console.error(`[gateway] ${err.message}`);
    process.exitCode = 1;
  });
}
