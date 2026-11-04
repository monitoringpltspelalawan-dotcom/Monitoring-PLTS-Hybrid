import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createTransport, pollDevice } from '../gateway/agent.js';
import { validateGatewayConfig } from '../gateway/config.js';
import { DiskOutbox } from '../gateway/outbox.js';
import { createVirtualDeviceServer } from '../gateway/virtual-device.js';

const baseConfig = {
  gatewayId: 'GW-TEST',
  siteId: 'SITE-TEST',
  token: 'test-token-value',
  transport: { type: 'https', url: 'https://monitoring.example.test' },
  devices: [{
    id: 'DEV-TEST',
    ipAddress: '192.168.10.20',
    port: 502,
    unitId: 1,
    registers: [{
      parameterId: 'pv_power_kw',
      functionCode: 3,
      address: 0,
      dataType: 'UINT16',
      scale: 0.1,
      unit: 'kW',
      writable: false,
    }],
  }],
};

test('gateway config accepts private read-only mappings', () => {
  const config = validateGatewayConfig(baseConfig);
  assert.equal(config.devices[0].registers[0].scale, 0.1);
});

test('gateway config rejects public targets, writable maps, and plaintext remote transport', () => {
  assert.throws(() => validateGatewayConfig({
    ...baseConfig,
    devices: [{ ...baseConfig.devices[0], ipAddress: '8.8.8.8' }],
  }), /private/);
  assert.throws(() => validateGatewayConfig({
    ...baseConfig,
    devices: [{ ...baseConfig.devices[0], registers: [{ ...baseConfig.devices[0].registers[0], writable: true }] }],
  }), /read-only/);
  assert.throws(() => validateGatewayConfig({
    ...baseConfig,
    transport: { type: 'https', url: 'http://monitoring.example.test' },
  }), /loopback/);
});

test('pollDevice decodes values and reports failures without inventing measurements', async () => {
  const device = validateGatewayConfig(baseConfig).devices[0];
  const good = await pollDevice(device, {
    retries: 0,
    now: () => 0,
    read: async () => ({ ok: true, latencyMs: 2, response: { data: Buffer.from([0x04, 0xd2]) } }),
  });
  assert.equal(good.measurements[0].value, 123.4);
  assert.equal(good.measurements[0].quality, 'GOOD');
  assert.equal(good.measurements[0].deviceTs, '1970-01-01T00:00:00.000Z');

  const failed = await pollDevice(device, {
    retries: 0,
    read: async () => ({ ok: false, error: 'timeout' }),
  });
  assert.equal(failed.measurements.length, 0);
  assert.equal(failed.failures[0].error, 'timeout');
});

test('virtual Modbus device supplies labelled demo register values to the real poller', async (t) => {
  const server = createVirtualDeviceServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const device = {
    id: 'DEV-DEMO',
    ipAddress: '127.0.0.1',
    port,
    unitId: 1,
    registers: [
      { parameterId: 'pv_power_kw', functionCode: 3, address: 0, dataType: 'FLOAT32', scale: 1, offset: 0, unit: 'kW' },
      { parameterId: 'soc_pct', functionCode: 3, address: 2, dataType: 'UINT16', scale: 1, offset: 0, unit: '%' },
    ],
  };
  const result = await pollDevice(device, { retries: 0 });
  assert.equal(result.failures.length, 0);
  assert.ok(Math.abs(result.measurements[0].value - 123.4) < 1e-5);
  assert.equal(result.measurements[1].value, 74);
});

test('HTTPS transport posts authenticated ingest only to the explicitly allowed loopback endpoint', async (t) => {
  let received;
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      received = { method: request.method, url: request.url, gatewayId: request.headers['x-gateway-id'], authorization: request.headers.authorization, body: JSON.parse(body) };
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, accepted: 1 }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const config = validateGatewayConfig({
    ...baseConfig,
    transport: { type: 'https', url: `http://127.0.0.1:${port}`, allowInsecureLoopback: true },
  });
  const transport = createTransport(config);
  const payload = { siteId: config.siteId, seq: 1, measurements: [] };
  const result = await transport.send('telemetry', payload);
  await transport.close();
  assert.equal(result.accepted, 1);
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/api/ingest/telemetry');
  assert.equal(received.gatewayId, config.gatewayId);
  assert.equal(received.authorization, `Bearer ${config.token}`);
  assert.deepEqual(received.body, payload);
});

test('disk outbox persists ordered batches and refuses data loss', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plts-outbox-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'outbox.json');
  const outbox = new DiskOutbox(file, { maxBatches: 2 });
  const first = outbox.enqueue({ siteId: 'SITE-TEST', measurements: [{ parameterId: 'pv_power_kw', value: 1 }] });
  outbox.enqueue({ siteId: 'SITE-TEST', measurements: [] });
  assert.throws(() => outbox.enqueue({ siteId: 'SITE-TEST', measurements: [] }), /refusing to discard/);

  const restored = new DiskOutbox(file, { maxBatches: 2 });
  assert.equal(restored.size, 2);
  assert.equal(restored.peek().seq, first.seq);
  assert.throws(() => restored.acknowledge(first.seq + 1), /sequence order/);
  restored.acknowledge(first.seq);
  assert.equal(new DiskOutbox(file, { maxBatches: 2 }).peek().seq, first.seq + 1);
});

test('single gateway cycle queues, delivers, and acknowledges telemetry and heartbeat', async (t) => {
  const { runGateway } = await import('../gateway/agent.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plts-gateway-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = {
    ...validateGatewayConfig(baseConfig),
    outboxFile: path.join(directory, 'outbox.json'),
    heartbeatIntervalMs: 1000,
    timeoutMs: 1000,
    retries: 0,
  };
  const sent = [];
  let closed = false;
  const result = await runGateway(config, {
    once: true,
    transportFactory: () => ({
      async send(kind, payload) { sent.push({ kind, payload }); return { ok: true }; },
      async close() { closed = true; },
    }),
    read: async () => ({ ok: true, latencyMs: 1, response: { data: Buffer.from([0x04, 0xd2]) } }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.backlog, 0);
  assert.deepEqual(sent.map((item) => item.kind), ['telemetry', 'heartbeat']);
  assert.equal(sent[0].payload.measurements[0].value, 123.4);
  assert.equal(sent[1].payload.backlog, 0);
  assert.equal(closed, true);
});
