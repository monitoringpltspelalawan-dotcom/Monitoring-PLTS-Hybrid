import net from 'node:net';

/** Minimal Modbus TCP master used by the connection test tool (read-only function codes). */
export const READ_FUNCTIONS = { 1: 'COIL', 2: 'DISCRETE', 3: 'HOLDING', 4: 'INPUT' };

export function buildReadRequest({ unitId = 1, functionCode = 3, address = 0, count = 1, transactionId = 1 }) {
  if (!Number.isInteger(unitId) || unitId < 0 || unitId > 247) throw new Error('Unit ID must be an integer from 0 to 247');
  if (![1, 2, 3, 4].includes(functionCode)) throw new Error('Only Modbus read function codes 1-4 are supported');
  if (!Number.isInteger(address) || address < 0 || address > 0xffff) throw new Error('Register address must be an integer from 0 to 65535');
  const maxCount = functionCode <= 2 ? 2000 : 125;
  if (!Number.isInteger(count) || count < 1 || count > maxCount || address + count > 0x10000) {
    throw new Error(`Read count must be an integer from 1 to ${maxCount} and remain within the address range`);
  }
  if (!Number.isInteger(transactionId) || transactionId < 0 || transactionId > 0xffff) throw new Error('Invalid transaction ID');
  const buf = Buffer.alloc(12);
  buf.writeUInt16BE(transactionId, 0);
  buf.writeUInt16BE(0, 2);
  buf.writeUInt16BE(6, 4);
  buf.writeUInt8(unitId, 6);
  buf.writeUInt8(functionCode, 7);
  buf.writeUInt16BE(address, 8);
  buf.writeUInt16BE(count, 10);
  return buf;
}

export function parseResponse(buffer) {
  if (!buffer || buffer.length < 9) throw new Error('Short Modbus response');
  const transactionId = buffer.readUInt16BE(0);
  const protocol = buffer.readUInt16BE(2);
  const length = buffer.readUInt16BE(4);
  const unitId = buffer.readUInt8(6);
  const functionCode = buffer.readUInt8(7);
  if (protocol !== 0) throw new Error('Invalid Modbus protocol identifier');
  if (length !== buffer.length - 6) throw new Error('Invalid Modbus response length');
  if (functionCode & 0x80) {
    const exceptionCode = buffer.readUInt8(8);
    throw new Error(`Modbus exception ${exceptionCode}`);
  }
  const byteCount = buffer.readUInt8(8);
  if (byteCount !== length - 3 || buffer.length !== 9 + byteCount) throw new Error('Invalid Modbus byte count');
  return {
    transactionId, unitId, functionCode, length,
    data: buffer.subarray(9, 9 + byteCount),
    bytes: byteCount,
  };
}

export function readModbusTcp({ host, port = 502, unitId = 1, functionCode = 3, address = 0, count = 1, timeoutMs = 3000 }) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const socket = new net.Socket();
    const transactionId = Math.floor(Math.random() * 0x10000);
    let responseBuffer = Buffer.alloc(0);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ...result, latencyMs: Date.now() - started, host, port, unitId, functionCode, address, count });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      let req;
      try {
        req = buildReadRequest({ unitId, functionCode, address, count, transactionId });
      } catch (err) {
        finish({ reachable: false, ok: false, error: err.message });
        return;
      }
      socket.write(req);
    });
    socket.on('data', (data) => {
      responseBuffer = Buffer.concat([responseBuffer, data]);
      if (responseBuffer.length < 6) return;
      const expectedLength = 6 + responseBuffer.readUInt16BE(4);
      if (expectedLength < 9 || expectedLength > 260) {
        finish({ reachable: true, ok: false, error: 'Invalid Modbus response frame length' });
        return;
      }
      if (responseBuffer.length < expectedLength) return;
      try {
        const parsed = parseResponse(responseBuffer.subarray(0, expectedLength));
        if (parsed.transactionId !== transactionId) throw new Error('Modbus transaction ID mismatch');
        if (parsed.unitId !== unitId) throw new Error('Modbus unit ID mismatch');
        if (parsed.functionCode !== functionCode) throw new Error('Modbus function code mismatch');
        finish({ reachable: true, ok: true, response: { ...parsed, dataHex: parsed.data.toString('hex') } });
      } catch (err) {
        finish({ reachable: true, ok: false, error: err.message, dataHex: responseBuffer.toString('hex') });
      }
    });
    socket.once('timeout', () => finish({ reachable: false, ok: false, error: `TCP connection timeout after ${timeoutMs} ms` }));
    socket.once('error', (err) => finish({ reachable: false, ok: false, error: err.message }));
    socket.connect(port, host);
  });
}

const functionArea = (fc) => (fc === 1 ? 'COIL' : fc === 2 ? 'DISCRETE' : fc === 4 ? 'INPUT' : 'HOLDING');

export function registersToBuffer(responseData, count) {
  return responseData.subarray(0, count * 2);
}

/** Decode a register payload according to configured byte/word order and data type. */
export function decodeRegister(buffer, { dataType = 'UINT16', wordOrder = 'BIG', byteOrder = 'BIG', scale = 1, offset = 0, functionCode = 3 } = {}) {
  const sizeMap = { BOOL: 1, INT16: 2, UINT16: 2, INT32: 4, UINT32: 4, FLOAT32: 4, FLOAT64: 8, UINT64: 8, INT64: 8 };
  const size = sizeMap[String(dataType).toUpperCase()];
  if (!size) throw new Error(`Unsupported data type ${dataType}`);
  if (buffer.length < size) throw new Error('Not enough register bytes');
  let bytes = Buffer.from(buffer.subarray(0, size));
  if (String(byteOrder).toUpperCase() === 'LITTLE') bytes = Buffer.from([...bytes].reverse());
  if (size >= 4 && String(wordOrder).toUpperCase() === 'LITTLE') {
    const words = [];
    for (let i = 0; i < size; i += 2) words.unshift(bytes.subarray(i, i + 2));
    bytes = Buffer.concat(words);
  }
  let raw;
  switch (String(dataType).toUpperCase()) {
    case 'BOOL': raw = bytes[0] ? 1 : 0; break;
    case 'INT16': raw = bytes.readInt16BE(0); break;
    case 'UINT16': raw = bytes.readUInt16BE(0); break;
    case 'INT32': raw = bytes.readInt32BE(0); break;
    case 'UINT32': raw = bytes.readUInt32BE(0); break;
    case 'FLOAT32': raw = bytes.readFloatBE(0); break;
    case 'FLOAT64': raw = bytes.readDoubleBE(0); break;
    case 'INT64': raw = Number(bytes.readBigInt64BE(0)); break;
    case 'UINT64': raw = Number(bytes.readBigUInt64BE(0)); break;
    default: throw new Error(`Unsupported data type ${dataType}`);
  }
  return { raw, value: raw * Number(scale || 1) + Number(offset || 0), area: functionArea(functionCode), size };
}

export function decodeRegisterMap(buffer, registers = []) {
  const results = [];
  for (const reg of registers) {
    const sizeMap = { BOOL: 1, INT16: 2, UINT16: 2, INT32: 4, UINT32: 4, FLOAT32: 4, FLOAT64: 8, UINT64: 8, INT64: 8 };
    const size = sizeMap[String(reg.dataType || reg.data_type || 'UINT16').toUpperCase()] || 2;
    const start = Number(reg.byteOffset ?? reg.offsetBytes ?? 0);
    const slice = buffer.subarray(start, start + size);
    try {
      const decoded = decodeRegister(slice, {
        dataType: reg.dataType || reg.data_type, wordOrder: reg.wordOrder || reg.word_order,
        byteOrder: reg.byteOrder || reg.byte_order, scale: reg.scale, offset: reg.offset,
        functionCode: Number(reg.functionCode || reg.function_code || 3),
      });
      results.push({ parameterId: reg.parameterId || reg.parameter_id, name: reg.name, ...decoded, unit: reg.unit });
    } catch (err) {
      results.push({ parameterId: reg.parameterId || reg.parameter_id, name: reg.name, error: err.message });
    }
  }
  return results;
}
