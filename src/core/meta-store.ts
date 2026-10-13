import { LocalDBAdapter, LocalTransaction } from '../adapters/local/index.js';

export class MetaStore {
  /**
   * Initializes the sync_meta schema if it does not already exist.
   * This table is strictly local to the device and is never synced to the remote server.
   */
  static async ensureSchema(db: LocalDBAdapter): Promise<void> {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );`
    );
  }

  /**
   * Gets a metadata string value by key.
   */
  static async get(db: LocalDBAdapter, key: string): Promise<string | null> {
    try {
      const rows = await db.execute(
        `SELECT value FROM sync_meta WHERE key = ? LIMIT 1`,
        [key]
      );
      if (rows && rows.length > 0) {
        return rows[0].value ?? null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Sets a metadata value by key (atomic upsert).
   */
  static async set(db: LocalDBAdapter | LocalTransaction, key: string, value: string): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`,
      [key, String(value)]
    );
  }

  /**
   * Retrieves the persisted last_synced_at cursor timestamp (in ms). Returns 0 if never synced.
   */
  static async getLastSyncedAt(db: LocalDBAdapter): Promise<number> {
    const val = await this.get(db, 'last_synced_at');
    if (!val) return 0;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Persists the last_synced_at cursor timestamp.
   */
  static async setLastSyncedAt(
    db: LocalDBAdapter | LocalTransaction,
    timestamp: number
  ): Promise<void> {
    await this.set(db, 'last_synced_at', String(timestamp));
  }

  /**
   * Clears the persisted cursor (forces next pull to re-query active remote records).
   */
  static async clearLastSyncedAt(db: LocalDBAdapter | LocalTransaction): Promise<void> {
    try {
      await db.execute(`DELETE FROM sync_meta WHERE key = 'last_synced_at'`);
    } catch {
      // Ignored if table doesn't exist yet
    }
  }
}
