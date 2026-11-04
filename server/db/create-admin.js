import process from 'node:process';
import { initDb, closeDb, getDb } from './adapter.js';
import { DEFAULT_ROLES } from '../lib/permissions.js';
import { hashPassword, passwordIssues } from '../lib/passwords.js';
import { nowIso } from '../lib/time.js';
import { uid } from '../lib/util.js';

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--username' && args[i + 1]) options.username = args[++i];
    else if (args[i] === '--email' && args[i + 1]) options.email = args[++i];
    else throw new Error('Usage: node server/db/create-admin.js --username <name> [--email <email>]');
  }
  if (!options.username || !/^[a-zA-Z0-9._-]{3,64}$/.test(options.username)) {
    throw new Error('Username is required and must be 3-64 letters, numbers, dots, underscores or hyphens');
  }
  if (options.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.email)) throw new Error('Email address is invalid');
  return options;
}

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Password input requires an interactive TTY; run this command with docker compose exec -it');
  }
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          reject(new Error('Password entry cancelled'));
          return;
        }
        if (byte === 13 || byte === 10) {
          cleanup();
          resolve(value);
          return;
        }
        if (byte === 8 || byte === 127) {
          value = value.slice(0, -1);
        } else if (byte >= 32 && byte <= 126) {
          value += String.fromCharCode(byte);
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const password = await readHidden('New administrator password: ');
  const confirmation = await readHidden('Confirm administrator password: ');
  if (password !== confirmation) throw new Error('Passwords do not match');
  if (password.length > 256) throw new Error('Password must be no longer than 256 characters');
  const issues = passwordIssues(password);
  if (issues.length) throw new Error(`Password does not meet policy: ${issues.join('; ')}`);

  await initDb();
  const db = getDb();
  const existingUser = await db.get('SELECT id FROM users WHERE username = ?', [options.username]);
  if (existingUser) throw new Error(`User ${options.username} already exists; no changes made`);
  const now = nowIso();
  for (const role of DEFAULT_ROLES) {
    const roleId = `ROLE-${role.code}`;
    if (await db.get('SELECT id FROM roles WHERE id = ?', [roleId])) continue;
    await db.run(
      'INSERT INTO roles (id, code, name, description, permissions, created_at) VALUES (?,?,?,?,?,?)',
      [roleId, role.code, role.name, role.description, JSON.stringify(role.permissions), now],
    );
  }
  const roleId = 'ROLE-SUPER_ADMIN';
  const { salt, hash } = hashPassword(password);
  await db.run(
    `INSERT INTO users (id, username, email, full_name, password_hash, password_salt, role_id, region_id,
      status, timezone, last_login_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uid('usr'), options.username, options.email || null, options.username, hash, salt, roleId,
      null, 'ACTIVE', 'Asia/Jakarta', null, now, now],
  );
  console.log(`Created SUPER_ADMIN user "${options.username}". No demo sites or demo credentials were added.`);
}

main()
  .catch((err) => {
    console.error(`[provision-admin] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
