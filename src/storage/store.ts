import { DBExecutable } from '../core/schema-manager.js';
import { BlobRecord, BlobUploadStatus } from './types.js';

export const DEFAULT_BLOBS_TABLE = '_local_blobs';

export function mapBlobRow(r: any): BlobRecord {
  let meta: Record<string, any> | undefined;
  if (r.metadata) {
    try {
      meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
    } catch {
      meta = undefined;
    }
  }

  return {
    id: r.id,
    key: r.key,
    name: r.name,
    mimeType: r.mime_type,
    size: Number(r.size || 0),
    localPath: r.local_path,
    remoteUrl: r.remote_url || null,
    status: (r.status as BlobUploadStatus) || 'PENDING',
    sha256: r.sha256 || null,
    metadata: meta,
    createdAt: Number(r.created_at || 0),
    updatedAt: Number(r.updated_at || 0),
  };
}

export class BlobStore {
  static async ensureSchema(db: DBExecutable, tableName: string = DEFAULT_BLOBS_TABLE): Promise<void> {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        local_path TEXT NOT NULL,
        remote_url TEXT,
        status TEXT NOT NULL,
        sha256 TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );`
    );

    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_status ON ${tableName} (status);`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_key ON ${tableName} (key);`
    );
  }

  static async insertOrUpdate(
    db: DBExecutable,
    tableName: string = DEFAULT_BLOBS_TABLE,
    record: BlobRecord
  ): Promise<void> {
    const metaStr = record.metadata ? JSON.stringify(record.metadata) : null;
    await db.execute(
      `INSERT INTO ${tableName} (id, key, name, mime_type, size, local_path, remote_url, status, sha256, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         name = excluded.name,
         mime_type = excluded.mime_type,
         size = excluded.size,
         local_path = excluded.local_path,
         remote_url = excluded.remote_url,
         status = excluded.status,
         sha256 = excluded.sha256,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at;`,
      [
        record.id,
        record.key,
        record.name,
        record.mimeType,
        record.size,
        record.localPath,
        record.remoteUrl ?? null,
        record.status,
        record.sha256 ?? null,
        metaStr,
        record.createdAt,
        record.updatedAt,
      ]
    );
  }

  static async getByKey(
    db: DBExecutable,
    tableName: string = DEFAULT_BLOBS_TABLE,
    key: string
  ): Promise<BlobRecord | null> {
    const rows = await db.execute(`SELECT * FROM ${tableName} WHERE key = ? LIMIT 1;`, [key]);
    if (!rows || rows.length === 0) return null;
    return mapBlobRow(rows[0]);
  }

  static async getById(
    db: DBExecutable,
    tableName: string = DEFAULT_BLOBS_TABLE,
    id: string
  ): Promise<BlobRecord | null> {
    const rows = await db.execute(`SELECT * FROM ${tableName} WHERE id = ? LIMIT 1;`, [id]);
    if (!rows || rows.length === 0) return null;
    return mapBlobRow(rows[0]);
  }

  static async list(
    db: DBExecutable,
    tableName: string = DEFAULT_BLOBS_TABLE,
    status?: BlobUploadStatus
  ): Promise<BlobRecord[]> {
    let rows: any[];
    if (status) {
      rows = await db.execute(
        `SELECT * FROM ${tableName} WHERE status = ? ORDER BY created_at DESC;`,
        [status]
      );
    } else {
      rows = await db.execute(`SELECT * FROM ${tableName} ORDER BY created_at DESC;`);
    }
    return (rows || []).map(mapBlobRow);
  }

  static async updateStatus(
    db: DBExecutable,
    tableName: string = DEFAULT_BLOBS_TABLE,
    id: string,
    status: BlobUploadStatus,
    remoteUrl?: string | null
  ): Promise<void> {
    const now = Date.now();
    if (remoteUrl !== undefined) {
      await db.execute(
        `UPDATE ${tableName} SET status = ?, remote_url = ?, updated_at = ? WHERE id = ?;`,
        [status, remoteUrl, now, id]
      );
    } else {
      await db.execute(
        `UPDATE ${tableName} SET status = ?, updated_at = ? WHERE id = ?;`,
        [status, now, id]
      );
    }
  }

  static async deleteByKey(
    db: DBExecutable,
    tableName: string = DEFAULT_BLOBS_TABLE,
    key: string
  ): Promise<void> {
    await db.execute(`DELETE FROM ${tableName} WHERE key = ?;`, [key]);
  }

  static async clear(
    db: DBExecutable,
    tableName: string = DEFAULT_BLOBS_TABLE
  ): Promise<void> {
    await db.execute(`DELETE FROM ${tableName};`);
  }
}
