import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('production config refuses missing secrets, PostgreSQL, and TLS configuration', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chsms-production-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configUrl = pathToFileURL(path.resolve('server/config.js')).href;
  const env = { ...process.env, NODE_ENV: 'production', DATA_DIR: path.join(directory, 'data') };
  for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'TLS_CERT', 'TLS_KEY', 'MQTT_URL']) delete env[key];
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(configUrl)})`], {
    cwd: directory,
    env,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid production configuration/);
  assert.match(result.stderr, /DATABASE_URL must use PostgreSQL/);
  assert.match(result.stderr, /SESSION_SECRET must be a non-placeholder/);
  assert.match(result.stderr, /TLS_CERT must point to an existing MQTT TLS certificate/);
  assert.equal(fs.existsSync(path.join(directory, 'data')), false);
});
