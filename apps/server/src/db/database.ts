import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import pg from 'pg';

export type Dialect = 'sqlite' | 'postgres';
/** Uint8Array values are stored as BLOB (SQLite) or BYTEA (PostgreSQL). */
export type SqlParam = string | number | boolean | null | undefined | Uint8Array;
export type Row = Record<string, unknown>;

/** Minimal async database abstraction implemented for SQLite and PostgreSQL. SQL uses `?` placeholders. */
export interface Db {
  readonly dialect: Dialect;
  all<T = Row>(sql: string, params?: SqlParam[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: SqlParam[]): Promise<T | undefined>;
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// ---------- SQLite (node:sqlite) ----------

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => (release = resolve));
    const ready = this.tail.then(() => release);
    this.tail = this.tail.then(() => next);
    return ready;
  }
}

const toSqlite = (params: SqlParam[] = []): SQLInputValue[] =>
  params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

class SqliteExecutor {
  protected db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  allSync<T>(sql: string, params?: SqlParam[]): T[] {
    return this.db.prepare(sql).all(...toSqlite(params)) as T[];
  }

  getSync<T>(sql: string, params?: SqlParam[]): T | undefined {
    return this.db.prepare(sql).get(...toSqlite(params)) as T | undefined;
  }

  runSync(sql: string, params?: SqlParam[]): { changes: number } {
    const r = this.db.prepare(sql).run(...toSqlite(params));
    return { changes: Number(r.changes) };
  }
}

/** Handle used inside a transaction: the outer mutex is already held. */
class SqliteTx extends SqliteExecutor implements Db {
  readonly dialect = 'sqlite' as const;

  async all<T = Row>(sql: string, params?: SqlParam[]): Promise<T[]> {
    return this.allSync<T>(sql, params);
  }

  async get<T = Row>(sql: string, params?: SqlParam[]): Promise<T | undefined> {
    return this.getSync<T>(sql, params);
  }

  async run(sql: string, params?: SqlParam[]): Promise<{ changes: number }> {
    return this.runSync(sql, params);
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async close(): Promise<void> {
    throw new Error('Cannot close a database from inside a transaction');
  }
}

export class SqliteDb extends SqliteExecutor implements Db {
  readonly dialect = 'sqlite' as const;
  private mutex = new Mutex();

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    super(new DatabaseSync(file));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }

  private async locked<T>(fn: () => T): Promise<T> {
    const release = await this.mutex.lock();
    try {
      return fn();
    } finally {
      release();
    }
  }

  all<T = Row>(sql: string, params?: SqlParam[]): Promise<T[]> {
    return this.locked(() => this.allSync<T>(sql, params));
  }

  get<T = Row>(sql: string, params?: SqlParam[]): Promise<T | undefined> {
    return this.locked(() => this.getSync<T>(sql, params));
  }

  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }> {
    return this.locked(() => this.runSync(sql, params));
  }

  exec(sql: string): Promise<void> {
    return this.locked(() => this.db.exec(sql));
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const release = await this.mutex.lock();
    try {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(new SqliteTx(this.db));
        this.db.exec('COMMIT');
        return result;
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    } finally {
      release();
    }
  }

  async close(): Promise<void> {
    await this.locked(() => this.db.close());
  }
}

// ---------- PostgreSQL (pg) ----------

pg.types.setTypeParser(20, (v) => Number(v)); // int8 (COUNT)
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric (SUM/AVG)

/** Converts `?` placeholders to `$n`, ignoring question marks inside quoted literals. */
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let n = 0;
  let quote: string | null = null;
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') {
      out += `$${++n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

type Queryable = Pick<pg.Pool, 'query'>;

const toPg = (params: SqlParam[] = []): unknown[] => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

class PgExecutor {
  protected q: Queryable;

  constructor(q: Queryable) {
    this.q = q;
  }

  async all<T = Row>(sql: string, params?: SqlParam[]): Promise<T[]> {
    const r = await this.q.query(toPgPlaceholders(sql), toPg(params));
    return r.rows as T[];
  }

  async get<T = Row>(sql: string, params?: SqlParam[]): Promise<T | undefined> {
    return (await this.all<T>(sql, params))[0];
  }

  async run(sql: string, params?: SqlParam[]): Promise<{ changes: number }> {
    const r = await this.q.query(toPgPlaceholders(sql), toPg(params));
    return { changes: r.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.q.query(sql);
  }
}

class PgTx extends PgExecutor implements Db {
  readonly dialect = 'postgres' as const;

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async close(): Promise<void> {
    throw new Error('Cannot close a database from inside a transaction');
  }
}

export class PostgresDb extends PgExecutor implements Db {
  readonly dialect = 'postgres' as const;
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const pool = new pg.Pool({ connectionString, max: 10 });
    super(pool);
    this.pool = pool;
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PgTx(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function openDatabase(url: string): Db {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return new PostgresDb(url);
  const file = url.startsWith('sqlite:') ? url.slice('sqlite:'.length) : url;
  return new SqliteDb(file || ':memory:');
}

// ---------- Dialect helpers for JSON record data ----------

const SAFE_KEY = /^[a-z][a-z0-9_]{0,39}$/;

function key(field: string): string {
  if (!SAFE_KEY.test(field)) throw new Error(`Unsafe field name: ${field}`);
  return field;
}

/** SQL expression returning a JSON field as text (or native scalar in SQLite). */
export function jsonText(db: Pick<Db, 'dialect'>, field: string, column = 'data'): string {
  return db.dialect === 'sqlite' ? `json_extract(${column}, '$.${key(field)}')` : `(${column}->>'${key(field)}')`;
}

/** SQL expression returning a JSON field as a number (NULL when absent or non-numeric). */
export function jsonNumber(db: Pick<Db, 'dialect'>, field: string, column = 'data'): string {
  return db.dialect === 'sqlite'
    ? `CAST(json_extract(${column}, '$.${key(field)}') AS REAL)`
    : `(CASE WHEN jsonb_typeof(${column}->'${key(field)}') = 'number' THEN (${column}->>'${key(field)}')::double precision END)`;
}

/** SQL expression returning 1 when a JSON boolean is true, else 0. */
export function jsonBool(db: Pick<Db, 'dialect'>, field: string, column = 'data'): string {
  return db.dialect === 'sqlite'
    ? `COALESCE(json_extract(${column}, '$.${key(field)}'), 0)`
    : `(CASE WHEN (${column}->>'${key(field)}') = 'true' THEN 1 ELSE 0 END)`;
}

/** SQL predicate: JSON array field contains a (lower-cased) value. Consumes one `?` parameter. */
export function jsonArrayContains(db: Pick<Db, 'dialect'>, field: string, column = 'data'): string {
  return db.dialect === 'sqlite'
    ? `EXISTS (SELECT 1 FROM json_each(${column}, '$.${key(field)}') WHERE LOWER(json_each.value) = ?)`
    : `EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(${column}->'${key(field)}') = 'array' THEN ${column}->'${key(field)}' ELSE '[]'::jsonb END) AS e(v) WHERE LOWER(e.v) = ?)`;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Normalizes a BLOB/BYTEA column value (Uint8Array from SQLite, Buffer from PostgreSQL) to a Buffer. */
export function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('Expected binary column value');
}
