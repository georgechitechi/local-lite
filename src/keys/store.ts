import { DBExecutable } from '../core/schema-manager.js';
import { ApiKeyRecord } from './types.js';

export const DEFAULT_KEYS_TABLE = '_local_api_keys';

export function mapKeyRow(r: any): ApiKeyRecord {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    display: r.display,
    keyHash: r.key_hash,
    metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : undefined,
    createdAt: Number(r.created_at || 0),
    expiresAt: r.expires_at != null ? Number(r.expires_at) : null,
    lastUsedAt: r.last_used_at != null ? Number(r.last_used_at) : null,
    revoked: Boolean(Number(r.revoked || 0)),
    revokedAt: r.revoked_at != null ? Number(r.revoked_at) : null,
  };
}

export class KeyStore {
  /**
   * Initializes the API keys schema and indexes if they do not exist.
   */
  static async ensureSchema(db: DBExecutable, tableName: string = DEFAULT_KEYS_TABLE): Promise<void> {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        display TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        last_used_at INTEGER,
        revoked INTEGER NOT NULL DEFAULT 0,
        revoked_at INTEGER
      );`
    );

    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_hash ON ${tableName} (key_hash);`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_revoked ON ${tableName} (revoked, expires_at);`
    );
  }

  static async insertRecord(
    db: DBExecutable,
    tableName: string = DEFAULT_KEYS_TABLE,
    record: ApiKeyRecord
  ): Promise<void> {
    await db.execute(
      `INSERT INTO ${tableName} (
        id, name, prefix, display, key_hash, metadata, created_at, expires_at, last_used_at, revoked, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.name,
        record.prefix,
        record.display,
        record.keyHash,
        record.metadata ? JSON.stringify(record.metadata) : null,
        record.createdAt,
        record.expiresAt ?? null,
        record.lastUsedAt ?? null,
        record.revoked ? 1 : 0,
        record.revokedAt ?? null,
      ]
    );
  }

  static async findByHash(
    db: DBExecutable,
    tableName: string = DEFAULT_KEYS_TABLE,
    hash: string
  ): Promise<ApiKeyRecord | null> {
    const rows = await db.execute(
      `SELECT * FROM ${tableName} WHERE key_hash = ? LIMIT 1;`,
      [hash]
    );
    if (!rows || rows.length === 0) return null;
    return mapKeyRow(rows[0]);
  }

  static async findById(
    db: DBExecutable,
    tableName: string = DEFAULT_KEYS_TABLE,
    id: string
  ): Promise<ApiKeyRecord | null> {
    const rows = await db.execute(
      `SELECT * FROM ${tableName} WHERE id = ? LIMIT 1;`,
      [id]
    );
    if (!rows || rows.length === 0) return null;
    return mapKeyRow(rows[0]);
  }

  static async updateLastUsed(
    db: DBExecutable,
    tableName: string = DEFAULT_KEYS_TABLE,
    id: string,
    timestamp: number
  ): Promise<void> {
    await db.execute(
      `UPDATE ${tableName} SET last_used_at = ? WHERE id = ?;`,
      [timestamp, id]
    );
  }

  static async revoke(
    db: DBExecutable,
    tableName: string = DEFAULT_KEYS_TABLE,
    id: string
  ): Promise<boolean> {
    const now = Date.now();
    await db.execute(
      `UPDATE ${tableName} SET revoked = 1, revoked_at = ? WHERE id = ? AND revoked = 0;`,
      [now, id]
    );
    const updated = await this.findById(db, tableName, id);
    return updated?.revoked === true;
  }

  static async list(
    db: DBExecutable,
    tableName: string = DEFAULT_KEYS_TABLE,
    filter: { revoked?: boolean; prefix?: string } = {}
  ): Promise<ApiKeyRecord[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.revoked !== undefined) {
      conditions.push('revoked = ?');
      params.push(filter.revoked ? 1 : 0);
    }

    if (filter.prefix !== undefined) {
      conditions.push('prefix = ?');
      params.push(filter.prefix);
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db.execute(
      `SELECT * FROM ${tableName}${whereClause} ORDER BY created_at DESC;`,
      params
    );
    return (rows || []).map(mapKeyRow);
  }

  static async prune(
    db: DBExecutable,
    tableName: string = DEFAULT_KEYS_TABLE,
    options: { revokedOlderThanMs?: number; expiredOlderThanMs?: number } = {}
  ): Promise<number> {
    const now = Date.now();
    let deletedCount = 0;

    if (options.revokedOlderThanMs !== undefined) {
      const cutoff = now - options.revokedOlderThanMs;
      await db.execute(
        `DELETE FROM ${tableName} WHERE revoked = 1 AND revoked_at IS NOT NULL AND revoked_at <= ?;`,
        [cutoff]
      );
    }

    if (options.expiredOlderThanMs !== undefined) {
      const cutoff = now - options.expiredOlderThanMs;
      await db.execute(
        `DELETE FROM ${tableName} WHERE expires_at IS NOT NULL AND expires_at <= ?;`,
        [cutoff]
      );
    }

    return deletedCount;
  }
}
