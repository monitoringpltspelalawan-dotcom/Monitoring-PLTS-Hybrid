import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const registers = Buffer.alloc(8);
registers.writeFloatBE(123.4, 0);
registers.writeUInt16BE(74, 4);
registers.writeUInt16BE(91, 6);

function responseFor(request) {
  if (request.length < 12) return null;
  const transactionId = request.readUInt16BE(0);
  const protocolId = request.readUInt16BE(2);
  const length = request.readUInt16BE(4);
  const unitId = request.readUInt8(6);
  const functionCode = request.readUInt8(7);
  const address = request.readUInt16BE(8);
  const count = request.readUInt16BE(10);
  if (protocolId !== 0 || length !== 6 || ![3, 4].includes(functionCode) || count < 1 || count > 4 || address + count > 4) {
    const error = Buffer.alloc(9);
    error.writeUInt16BE(transactionId, 0);
    error.writeUInt16BE(0, 2);
    error.writeUInt16BE(3, 4);
    error.writeUInt8(unitId, 6);
    error.writeUInt8(functionCode | 0x80, 7);
    error.writeUInt8(2, 8);
    return error;
  }
  const data = registers.subarray(address * 2, (address + count) * 2);
  const response = Buffer.alloc(9 + data.length);
  response.writeUInt16BE(transactionId, 0);
  response.writeUInt16BE(0, 2);
  response.writeUInt16BE(3 + data.length, 4);
  response.writeUInt8(unitId, 6);
  response.writeUInt8(functionCode, 7);
  response.writeUInt8(data.length, 8);
  data.copy(response, 9);
  return response;
}

export function createVirtualDeviceServer() {
  return net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 12) {
        const requestLength = 6 + buffer.readUInt16BE(4);
        if (buffer.length < requestLength) return;
        const request = buffer.subarray(0, requestLength);
        buffer = buffer.subarray(requestLength);
        const response = responseFor(request);
        if (response) socket.write(response);
      }
    });
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 1502;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be a valid TCP port');
  const server = createVirtualDeviceServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`[virtual-device] DEMO DATA Modbus TCP listening on 127.0.0.1:${port}; read-only`);
  });
  server.on('error', (err) => {
    console.error(`[virtual-device] ${err.message}`);
    process.exitCode = 1;
  });
  process.once('SIGINT', () => server.close(() => process.exit(0)));
  process.once('SIGTERM', () => server.close(() => process.exit(0)));
}
