import { DBExecutable } from '../core/schema-manager.js';
import { KVRecord } from './types.js';

export const DEFAULT_KV_TABLE = '_local_kv';

export function mapKVRow(r: any): KVRecord {
  let val = r.value;
  const type = r.type;

  if (type === 'number') {
    val = Number(val);
  } else if (type === 'boolean') {
    val = val === 'true' || val === '1' || val === 1;
  } else if (type === 'json') {
    try {
      val = JSON.parse(val);
    } catch {
      // fallback
    }
  }

  return {
    key: r.key,
    value: val,
    type: r.type,
    createdAt: Number(r.created_at || 0),
    updatedAt: Number(r.updated_at || 0),
    expiresAt: r.expires_at != null ? Number(r.expires_at) : null,
  };
}

export class KVStore {
  static async ensureSchema(db: DBExecutable, tableName: string = DEFAULT_KV_TABLE): Promise<void> {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS ${tableName} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER
      );`
    );

    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_expires ON ${tableName} (expires_at);`
    );
  }

  static async set(
    db: DBExecutable,
    tableName: string = DEFAULT_KV_TABLE,
    key: string,
    valueStr: string,
    type: string,
    now: number,
    expiresAt: number | null
  ): Promise<void> {
    await db.execute(
      `INSERT INTO ${tableName} (key, value, type, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         type = excluded.type,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at;`,
      [key, valueStr, type, now, now, expiresAt]
    );
  }

  static async get(
    db: DBExecutable,
    tableName: string = DEFAULT_KV_TABLE,
    key: string
  ): Promise<KVRecord | null> {
    const rows = await db.execute(`SELECT * FROM ${tableName} WHERE key = ? LIMIT 1;`, [key]);
    if (!rows || rows.length === 0) return null;
    return mapKVRow(rows[0]);
  }

  static async delete(
    db: DBExecutable,
    tableName: string = DEFAULT_KV_TABLE,
    key: string
  ): Promise<boolean> {
    await db.execute(`DELETE FROM ${tableName} WHERE key = ?;`, [key]);
    return true;
  }

  static async listKeys(
    db: DBExecutable,
    tableName: string = DEFAULT_KV_TABLE,
    prefix?: string
  ): Promise<string[]> {
    let rows: any[];
    if (prefix) {
      rows = await db.execute(
        `SELECT key, expires_at FROM ${tableName} WHERE key LIKE ? ORDER BY key ASC;`,
        [`${prefix}%`]
      );
    } else {
      rows = await db.execute(
        `SELECT key, expires_at FROM ${tableName} ORDER BY key ASC;`
      );
    }

    const now = Date.now();
    return (rows || [])
      .filter((r) => r.expires_at == null || Number(r.expires_at) > now)
      .map((r) => r.key);
  }

  static async clear(
    db: DBExecutable,
    tableName: string = DEFAULT_KV_TABLE
  ): Promise<void> {
    await db.execute(`DELETE FROM ${tableName};`);
  }

  static async pruneExpired(
    db: DBExecutable,
    tableName: string = DEFAULT_KV_TABLE
  ): Promise<number> {
    const now = Date.now();
    await db.execute(
      `DELETE FROM ${tableName} WHERE expires_at IS NOT NULL AND expires_at <= ?;`,
      [now]
    );
    return 0;
  }
}
