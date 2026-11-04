import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { buildReadRequest, decodeRegister, parseResponse, readModbusTcp } from '../server/lib/modbus.js';

test('buildReadRequest only permits bounded read operations', () => {
  assert.equal(buildReadRequest({ address: 12, count: 2 }).readUInt8(7), 3);
  assert.throws(() => buildReadRequest({ functionCode: 5 }), /read function codes/);
  assert.throws(() => buildReadRequest({ address: 65535, count: 2 }), /address range/);
  assert.throws(() => buildReadRequest({ functionCode: 3, count: 126 }), /count/);
});

test('parseResponse rejects malformed frame lengths', () => {
  const invalid = Buffer.from([0, 1, 0, 0, 0, 4, 1, 3, 2, 0]);
  assert.throws(() => parseResponse(invalid), /length|byte count/);
});

test('readModbusTcp collects a split response and validates its header', async (t) => {
  const server = net.createServer((socket) => {
    let request = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      request = Buffer.concat([request, chunk]);
      if (request.length < 12) return;
      const response = Buffer.alloc(11);
      response.writeUInt16BE(request.readUInt16BE(0), 0);
      response.writeUInt16BE(0, 2);
      response.writeUInt16BE(5, 4);
      response.writeUInt8(request.readUInt8(6), 6);
      response.writeUInt8(request.readUInt8(7), 7);
      response.writeUInt8(2, 8);
      response.writeUInt16BE(1234, 9);
      socket.write(response.subarray(0, 4));
      setTimeout(() => socket.write(response.subarray(4)), 5);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const result = await readModbusTcp({ host: '127.0.0.1', port, address: 4, count: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.response.data.readUInt16BE(0), 1234);
});

test('decodeRegister applies scale and uses the configured function area', () => {
  const bytes = Buffer.alloc(4);
  bytes.writeFloatBE(123.4);
  const decoded = decodeRegister(bytes, { dataType: 'FLOAT32', scale: 0.1, functionCode: 4 });
  assert.ok(Math.abs(decoded.value - 12.34) < 1e-5);
  assert.equal(decoded.area, 'INPUT');
});
