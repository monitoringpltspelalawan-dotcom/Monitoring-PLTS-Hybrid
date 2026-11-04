import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import { config } from '../config.js';
import { getDb } from '../db/adapter.js';
import { findGatewayByCredentials, ingestHeartbeat, ingestTelemetry } from '../services/ingest.js';
import { nowIso } from '../lib/time.js';

let broker = null;
let servers = [];

function ensureCerts() {
  const certFile = config.tls.cert || path.join(config.certDir, 'server.crt');
  const keyFile = config.tls.key || path.join(config.certDir, 'server.key');
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile), certFile };
  }
  return null;
}

async function generateCerts() {
  const selfsigned = (await import('selfsigned')).default;
  const attrs = [
    { name: 'commonName', value: 'localhost' },
    { name: 'organizationName', value: 'CHSMS Local Development' },
    { name: 'countryName', value: 'ID' },
  ];
  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] },
    ],
  });
  const certFile = path.join(config.certDir, 'server.crt');
  const keyFile = path.join(config.certDir, 'server.key');
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  return { cert: pems.cert, key: pems.private, certFile };
}

export function getBrokerStatus() {
  if (!broker) return { running: false };
  return {
    running: true,
    tlsPort: config.mqtt.tlsPort,
    plainPort: config.mqtt.port,
    clients: broker.connectedClients || 0,
    version: 'aedes',
    connected: [...(broker.clientMeta?.entries?.() || [])].map(([id, meta]) => ({ id, siteId: meta?.siteId })),
  };
}

export async function startMqttBroker() {
  if (!config.mqtt.embedded) return null;
  if (broker) return broker;

  const aedesModule = await import('aedes');
  const createBroker = aedesModule.default?.createBroker || aedesModule.default;
  broker = await createBroker();
  broker.clientMeta = new Map();

  broker.authenticate = (client, username, password, done) => {
    const gatewayId = username ? username.toString() : '';
    const token = password ? password.toString() : '';
    findGatewayByCredentials(gatewayId, token)
      .then((gateway) => {
        if (!gateway) return done(null, false);
        client.gateway = gateway;
        broker.clientMeta.set(client.id, { gatewayId: gateway.id, siteId: gateway.site_id, connectedAt: nowIso() });
        return done(null, true);
      })
      .catch((err) => done(err, false));
  };

  broker.authorizePublish = (client, packet, done) => {
    const gw = client.gateway;
    if (!gw) return done(new Error('Unauthenticated gateway'));
    const allowed = packet.topic.startsWith(`plts/${gw.site_id}/${gw.id}/`);
    return done(allowed ? null : new Error('Topic not permitted'), allowed);
  };

  broker.authorizeSubscribe = (client, sub, done) => {
    // Gateways are publishers only in v1 (read-only telemetry plane).
    return done(null, false);
  };

  broker.on('client', (client) => {
    broker.clientMeta.set(client.id, { ...(broker.clientMeta.get(client.id) || {}), connectedAt: nowIso() });
    console.log(`[mqtt] gateway connected: ${client.gateway?.id || client.id}`);
  });

  broker.on('clientDisconnect', (client) => {
    console.log(`[mqtt] gateway disconnected: ${client.gateway?.id || client.id}`);
    broker.clientMeta.delete(client.id);
  });

  broker.on('publish', async (packet, client) => {
    if (!client || packet.retain) return;
    const gw = client.gateway;
    if (!gw) return;
    try {
      const payload = JSON.parse(packet.payload.toString());
      if (packet.topic.endsWith('/telemetry')) {
        await ingestTelemetry({
          gatewayId: gw.id,
          siteId: payload.siteId || gw.site_id,
          seq: payload.seq,
          ts: payload.ts,
          measurements: payload.measurements || [],
          snapshot: payload.snapshot || null,
          source: 'MQTT/TLS',
        });
      } else if (packet.topic.endsWith('/heartbeat')) {
        await ingestHeartbeat({
          gatewayId: gw.id,
          siteId: payload.siteId || gw.site_id,
          latencyMs: payload.latencyMs || 0,
          backlog: payload.backlog || 0,
          cpuPct: payload.cpuPct || 0,
          memPct: payload.memPct || 0,
          uptimeSec: payload.uptimeSec || 0,
          firmware: payload.firmware,
          source: 'MQTT/TLS',
        });
      }
    } catch (err) {
      console.error('[mqtt] ingest failed', err.message);
    }
  });

  // TLS listener (production path)
  let creds = ensureCerts();
  if (!creds) {
    if (config.env === 'production') {
      throw new Error('Production MQTT TLS certificate is missing; configure TLS_CERT and TLS_KEY. Self-signed fallback is disabled.');
    }
    try {
      creds = await generateCerts();
      console.log('[mqtt] generated self-signed TLS certificate in data/certs');
    } catch (err) {
      console.error('[mqtt] certificate generation failed', err.message);
    }
  }
  if (creds) {
    const tlsServer = tls.createServer({ key: creds.key, cert: creds.cert, minVersion: 'TLSv1.2' }, broker.handle);
    await new Promise((resolve, reject) => {
      tlsServer.once('error', reject);
      tlsServer.listen(config.mqtt.tlsPort, '0.0.0.0', () => {
        tlsServer.removeListener('error', reject);
        console.log(`[mqtt] TLS broker listening on mqtts://0.0.0.0:${config.mqtt.tlsPort}`);
        resolve();
      });
    });
    tlsServer.on('error', (err) => console.error('[mqtt] TLS server error', err.message));
    servers.push(tlsServer);
  }

  // Plain listener restricted to loopback for local gateway development only.
  const plain = net.createServer(broker.handle);
  await new Promise((resolve, reject) => {
    plain.once('error', reject);
    plain.listen(config.mqtt.port, '127.0.0.1', () => {
      plain.removeListener('error', reject);
      console.log(`[mqtt] local broker listening on mqtt://127.0.0.1:${config.mqtt.port} (loopback only)`);
      resolve();
    });
  });
  plain.on('error', (err) => console.error('[mqtt] plain server error', err.message));
  servers.push(plain);

  broker.on('error', (err) => console.error('[mqtt] broker error', err.message));
  console.log('[mqtt] embedded broker ready');
  return broker;
}

export async function stopMqttBroker() {
  for (const server of servers) server.close();
  servers = [];
  if (broker) {
    await new Promise((resolve) => broker.close(resolve));
    broker = null;
  }
}

/** Provisioning helper: fetch gateway bootstrap configuration by auth token. */
export async function gatewayBootstrap(gateway) {
  const db = getDb();
  const site = await db.get('SELECT * FROM sites WHERE id = ?', [gateway.site_id]);
  const devices = await db.all('SELECT * FROM devices WHERE site_id = ? ORDER BY device_type, name', [site.id]);
  const registers = devices.length
    ? await db.all(
        `SELECT * FROM modbus_registers WHERE device_id IN (${devices.map(() => '?').join(',')}) AND enabled = 1`,
        devices.map((d) => d.id),
      )
    : [];
  return {
    gateway: {
      id: gateway.id, name: gateway.name, siteId: site.id, siteCode: site.code, siteName: site.name,
      timezone: site.timezone, pollIntervalMs: 5000, heartbeatSeconds: 30,
    },
    mqtt: {
      url: config.mqtt.url || `mqtts://localhost:${config.mqtt.tlsPort}`,
      clientId: gateway.mqtt_client_id || `gw-${site.code.toLowerCase()}`,
      topicPrefix: `plts/${site.id}/${gateway.id}`,
      tls: true,
    },
    site: {
      id: site.id, code: site.code, name: site.name, timezone: site.timezone,
      pvCapacityKwp: site.pv_capacity_kwp, bessCapacityKwh: site.bess_capacity_kwh,
      inverterCapacityKw: site.inverter_capacity_kw, generatorCapacityKw: site.generator_capacity_kw,
      gridCapacityKva: site.grid_capacity_kva,
    },
    devices: devices.map((d) => ({
      id: d.id, name: d.name, type: d.device_type, manufacturer: d.manufacturer, model: d.model,
      ipAddress: d.ip_address, port: d.port, unitId: d.unit_id,
      registers: registers.filter((r) => r.device_id === d.id).map((r) => ({
        parameterId: r.parameter_id, name: r.name, functionCode: r.function_code, address: r.address,
        registerType: r.register_type, dataType: r.data_type, wordOrder: r.word_order, byteOrder: r.byte_order,
        scale: r.scale, offset: r.offset, unit: r.unit, pollIntervalSec: r.poll_interval_sec,
        writable: Boolean(r.writable), enabled: Boolean(r.enabled),
      })),
    })),
    generatedAt: nowIso(),
  };
}
