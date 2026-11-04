import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const DATA_TYPES = new Set(['BOOL', 'INT16', 'UINT16', 'INT32', 'UINT32', 'FLOAT32', 'INT64', 'UINT64', 'FLOAT64']);
const WORDS = { BOOL: 1, INT16: 1, UINT16: 1, INT32: 2, UINT32: 2, FLOAT32: 2, INT64: 4, UINT64: 4, FLOAT64: 4 };

function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (version === 6) {
    const ip = address.toLowerCase();
    return ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  }
  return false;
}

function validateTransport(transport) {
  if (!transport || !['https', 'mqtt'].includes(transport.type)) {
    throw new Error('transport.type must be "https" or "mqtt"');
  }
  let url;
  try {
    url = new URL(transport.url);
  } catch {
    throw new Error('transport.url must be a valid absolute URL');
  }
  const secureProtocols = transport.type === 'https' ? ['https:'] : ['mqtts:'];
  const localProtocols = transport.type === 'https' ? ['http:'] : ['mqtt:'];
  if (secureProtocols.includes(url.protocol)) return;
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.replace(/^\[|\]$/g, '').toLowerCase());
  if (!localProtocols.includes(url.protocol) || !loopback || transport.allowInsecureLoopback !== true) {
    throw new Error(`${transport.type} transport must use ${secureProtocols[0]}; plaintext is allowed only on loopback with allowInsecureLoopback enabled`);
  }
}

export function validateGatewayConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Gateway config must be a JSON object');
  for (const key of ['gatewayId', 'siteId', 'token']) {
    if (typeof input[key] !== 'string' || !input[key].trim() || /replace[-_ ]?me|your[-_ ]/i.test(input[key])) {
      throw new Error(`${key} must contain a provisioned, non-placeholder value`);
    }
  }
  validateTransport(input.transport);

  const pollIntervalMs = Number(input.pollIntervalMs ?? 5000);
  const heartbeatIntervalMs = Number(input.heartbeatIntervalMs ?? 30000);
  const timeoutMs = Number(input.timeoutMs ?? 3000);
  const retries = Number(input.retries ?? 1);
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 300000) throw new Error('pollIntervalMs must be between 250 and 300000');
  if (!Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1000 || heartbeatIntervalMs > 3600000) throw new Error('heartbeatIntervalMs must be between 1000 and 3600000');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new Error('timeoutMs must be between 100 and 60000');
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) throw new Error('retries must be between 0 and 5');
  if (!Array.isArray(input.devices)) throw new Error('devices must be an array');

  let registerCount = 0;
  const devices = input.devices.map((device, index) => {
    if (!device || typeof device !== 'object' || !device.id) throw new Error(`devices[${index}].id is required`);
    if (!isPrivateAddress(String(device.ipAddress || ''))) {
      throw new Error(`devices[${index}].ipAddress must be a private, loopback, or link-local IP address`);
    }
    const port = Number(device.port ?? 502);
    const unitId = Number(device.unitId ?? 1);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`devices[${index}].port is invalid`);
    if (!Number.isInteger(unitId) || unitId < 0 || unitId > 247) throw new Error(`devices[${index}].unitId is invalid`);
    if (!Array.isArray(device.registers)) throw new Error(`devices[${index}].registers must be an array`);
    const registers = device.registers.map((reg, registerIndex) => {
      registerCount += 1;
      if (!reg || !reg.parameterId) throw new Error(`devices[${index}].registers[${registerIndex}].parameterId is required`);
      const functionCode = Number(reg.functionCode ?? 3);
      const address = Number(reg.address);
      const dataType = String(reg.dataType || 'UINT16').toUpperCase();
      const scale = Number(reg.scale ?? 1);
      const offset = Number(reg.offset ?? 0);
      if (![1, 2, 3, 4].includes(functionCode)) throw new Error('Only read-only Modbus function codes 1-4 are supported');
      if ((functionCode === 1 || functionCode === 2) && dataType !== 'BOOL') throw new Error('Coils and discrete inputs must use BOOL data type');
      if (!Number.isInteger(address) || address < 0 || address > 0xffff) throw new Error(`Invalid register address for ${reg.parameterId}`);
      if (!DATA_TYPES.has(dataType)) throw new Error(`Unsupported data type for ${reg.parameterId}`);
      if (!Number.isFinite(scale) || !Number.isFinite(offset)) throw new Error(`Scale and offset must be finite for ${reg.parameterId}`);
      if (reg.writable === true) throw new Error('Writable Modbus mappings are not permitted; the gateway is read-only');
      const count = functionCode <= 2 ? 1 : WORDS[dataType];
      if (address + count > 0x10000) throw new Error(`Register range exceeds Modbus address space for ${reg.parameterId}`);
      const pollIntervalSec = Number(reg.pollIntervalSec ?? pollIntervalMs / 1000);
      if (!Number.isFinite(pollIntervalSec) || pollIntervalSec <= 0) throw new Error(`pollIntervalSec must be positive for ${reg.parameterId}`);
      return { ...reg, functionCode, address, dataType, scale, offset, pollIntervalSec };
    });
    return { ...device, port, unitId, registers };
  });
  if (registerCount > 2000) throw new Error('A gateway configuration may contain at most 2000 register mappings');

  return {
    ...input,
    transport: { ...input.transport, url: input.transport.url.replace(/\/+$/, '') },
    pollIntervalMs,
    heartbeatIntervalMs,
    timeoutMs,
    retries,
    devices,
  };
}

export function loadGatewayConfig(filePath) {
  const absolutePath = path.resolve(filePath);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (err) {
    throw new Error(`Unable to read gateway config ${absolutePath}: ${err.message}`);
  }
  const config = validateGatewayConfig(parsed);
  config.configFile = absolutePath;
  config.outboxFile = path.resolve(path.dirname(absolutePath), parsed.outboxFile || './data/outbox.json');
  if (config.transport.caFile) {
    config.transport.caFile = path.resolve(path.dirname(absolutePath), config.transport.caFile);
    if (!fs.existsSync(config.transport.caFile)) throw new Error(`Transport CA file not found: ${config.transport.caFile}`);
  }
  return config;
}
