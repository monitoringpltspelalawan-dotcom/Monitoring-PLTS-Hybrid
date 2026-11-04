import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, isPostgres } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function toSqliteValue(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** PostgreSQL implementation (production). Placeholders are converted from ? to $n. */
class PostgresAdapter {
  constructor(pool) {
    this.driver = 'postgres';
    this.pool = pool;
  }

  convert(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }

  async all(sql, params = []) {
    const res = await this.pool.query(this.convert(sql), params.map((p) => (p === undefined ? null : p)));
    return res.rows;
  }

  async get(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows[0] || undefined;
  }

  async run(sql, params = []) {
    const res = await this.pool.query(this.convert(sql), params.map((p) => (p === undefined ? null : p)));
    return { changes: res.rowCount || 0, lastInsertRowid: res.rows?.[0]?.id ?? 0 };
  }

  async exec(sql) {
    await this.pool.query(sql);
  }

  async insertMany(table, columns, rows, { conflict = '', chunkSize = 200 } = {}) {
    if (!rows.length) return 0;
    let inserted = 0;
    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      const tuples = chunk
        .map((_, ri) => `(${columns.map((__, ci) => `$${ri * columns.length + ci + 1}`).join(',')})`)
        .join(',');
      const params = chunk.flatMap((row) => columns.map((c) => (row[c] === undefined ? null : row[c])));
      const res = await this.pool.query(
        `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples} ${conflict}`,
        params,
      );
      inserted += res.rowCount || 0;
    }
    return inserted;
  }

  async close() {
    await this.pool.end();
  }
}

/** SQLite implementation backed by the built-in node:sqlite module. */
class SqliteAdapter {
  constructor(DatabaseSync, file) {
    this.driver = 'sqlite';
    this.db = new DatabaseSync(file);
    this.stmts = new Map();
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
    );
  }

  prepare(sql) {
    let stmt = this.stmts.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmts.set(sql, stmt);
    }
    return stmt;
  }

  async all(sql, params = []) {
    return this.prepare(sql).all(...params.map(toSqliteValue));
  }

  async get(sql, params = []) {
    return this.prepare(sql).get(...params.map(toSqliteValue));
  }

  async run(sql, params = []) {
    const result = this.prepare(sql).run(...params.map(toSqliteValue));
    return { changes: Number(result.changes || 0), lastInsertRowid: Number(result.lastInsertRowid || 0) };
  }

  async exec(sql) {
    this.db.exec(sql);
  }

  async insertMany(table, columns, rows, { conflict = '', chunkSize = 200 } = {}) {
    if (!rows.length) return 0;
    let inserted = 0;
    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      const tuples = chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
      const params = chunk.flatMap((row) => columns.map((c) => toSqliteValue(row[c])));
      const res = await this.run(
        `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples} ${conflict}`,
        params,
      );
      inserted += res.changes;
    }
    return inserted;
  }

  /** Synchronous transaction for bulk seeding (fn must not await). */
  seedTransaction(fn) {
    this.db.exec('BEGIN');
    try {
      fn(this.db);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async close() {
    this.db.close();
  }
}

let _db;

export async function initDb() {
  if (_db) return _db;
  if (isPostgres) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: Number(process.env.DATABASE_POOL_MAX || 20),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS || 5000),
      keepAlive: true,
    });
    _db = new PostgresAdapter(pool);
    await _db.exec(fs.readFileSync(path.join(__dirname, 'postgres.sql'), 'utf8'));
    await _db.exec('SELECT 1');
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    _db = new SqliteAdapter(DatabaseSync, config.dbFile);
    await _db.exec(fs.readFileSync(path.join(__dirname, 'sqlite.sql'), 'utf8'));
  }
  return _db;
}

export function getDb() {
  if (!_db) throw new Error('Database not initialised. Call initDb() first.');
  return _db;
}

export async function closeDb() {
  if (!_db) return;
  await _db.close();
  _db = null;
}
