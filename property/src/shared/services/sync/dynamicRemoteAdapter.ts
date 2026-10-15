import {
  type DeltaChange,
  type DeltaChanges,
  type RemoteDBAdapter,
  SupabaseRemoteAdapter,
  type SyncOperation,
} from 'local-lite';
import {
  getAuthStateSyncSnapshot,
  getCloudSyncStateSnapshot,
  supabase,
} from '@/shared/services/supabase';

export class DynamicSupabaseAdapter implements RemoteDBAdapter {
  private activeAdapter: SupabaseRemoteAdapter | null = null;
  private tables: string[];
  private liveChangeCallback: ((changes: DeltaChanges) => void) | null = null;
  private tableCursors = new Map<string, number>();
  private db: any = null;

  constructor(tables: string[]) {
    this.tables = tables;
  }

  private cursorsLoaded = false;

  setDb(db: any): void {
    this.db = db;
    this.cursorsLoaded = false;
  }

  reset(): void {
    this.tableCursors.clear();
    this.cursorsLoaded = false;
    if (this.db) {
      this.db.execute("DELETE FROM sync_meta WHERE key LIKE 'cursor:%'").catch(() => {});
    }
  }

  private async ensureCursorsLoaded(): Promise<void> {
    if (this.cursorsLoaded || !this.db) return;
    try {
      const rows = await this.db.execute(
        `SELECT key, value FROM sync_meta WHERE key LIKE 'cursor:%'`
      );
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (row?.key && row?.value) {
            const table = String(row.key).replace(/^cursor:/, '');
            const parsed = parseInt(String(row.value), 10);
            if (!isNaN(parsed) && parsed > 0) {
              this.tableCursors.set(table, parsed);
            }
          }
        }
      }
      this.cursorsLoaded = true;
    } catch {
      // ignore
    }
  }

  private async getTableCursor(table: string): Promise<number> {
    if (!this.cursorsLoaded) {
      await this.ensureCursorsLoaded();
    }
    return this.tableCursors.get(table) ?? 0;
  }

  private canSync(): boolean {
    return (
      !getCloudSyncStateSnapshot().isInitializing &&
      getCloudSyncStateSnapshot().isEnabled &&
      getAuthStateSyncSnapshot().isLoggedIn &&
      !!supabase
    );
  }

  private getAdapter(): SupabaseRemoteAdapter | null {
    if (!this.canSync()) {
      return null;
    }

    if (!this.activeAdapter || (this.activeAdapter as any).client !== supabase) {
      this.activeAdapter = new SupabaseRemoteAdapter(supabase as any, {
        tables: this.tables,
        updatedAtColumn: 'updated_at',
        deletedColumn: 'deleted',
        deletedValue: true,
        primaryKey: 'id',
      });

      if (this.liveChangeCallback) {
        this.activeAdapter.subscribeToLiveChanges(this.liveChangeCallback);
      }
    }

    return this.activeAdapter;
  }

  async pushChanges(operations: SyncOperation[]): Promise<boolean> {
    const adapter = this.getAdapter();
    if (!adapter) {
      // Offline / Demo mode: do not fail, but keep changes queued in SQLite outbox
      return false;
    }
    const pushPromise = adapter.pushChanges(operations);
    const timeoutPromise = new Promise<boolean>(resolve =>
      setTimeout(() => resolve(false), 8000),
    );
    return await Promise.race([pushPromise, timeoutPromise]);
  }

  async fetchChanges(sinceTimestamp: number): Promise<DeltaChanges> {
    const adapter = this.getAdapter();
    if (!adapter || !supabase) {
      return { timestamp: sinceTimestamp, changes: [] };
    }

    if (sinceTimestamp === 0) {
      this.tableCursors.clear();
      this.cursorsLoaded = false;
      if (this.db) {
        this.db.execute("DELETE FROM sync_meta WHERE key LIKE 'cursor:%'").catch(() => {});
      }
    }

    await this.ensureCursorsLoaded();

    const changes: DeltaChange[] = [];
    let maxServerTimestamp = sinceTimestamp;
    const updatedCursors: Array<{ table: string; timestamp: number }> = [];

    // Query tables in parallel batches of 4 to prevent network bottlenecks
    const BATCH_SIZE = 4;
    for (let i = 0; i < this.tables.length; i += BATCH_SIZE) {
      const batch = this.tables.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async table => {
          try {
            const lastCursor = this.tableCursors.get(table) ?? 0;

            let query = (supabase as any).from(table).select('*');
            if (lastCursor > 0) {
              query = query.gt('updated_at', new Date(lastCursor).toISOString());
            }
            if (typeof query.order === 'function') {
              query = query.order('updated_at', { ascending: true });
            }

            // Per-table timeout of 6 seconds ensures a slow query doesn't hang the worker
            const timeoutPromise = new Promise<{ data: null; error: { message: string } }>(
              resolve =>
                setTimeout(
                  () => resolve({ data: null, error: { message: 'PULL timeout' } }),
                  6000,
                ),
            );

            const { data, error } = await Promise.race([query, timeoutPromise]);
            if (error) {
              return;
            }

            if (data && Array.isArray(data) && data.length > 0) {
              let tableMaxTime = lastCursor;
              for (const row of data) {
                const isSoftDeleted =
                  row.deleted === true ||
                  row.deleted === 1 ||
                  row.deleted === '1' ||
                  row.deleted === 'true';
                const operation = isSoftDeleted ? 'DELETE' : 'UPDATE';
                const rowTime = row.updated_at
                  ? new Date(row.updated_at).getTime()
                  : Date.now();
                if (rowTime > tableMaxTime) {
                  tableMaxTime = rowTime;
                }
                if (rowTime > maxServerTimestamp) {
                  maxServerTimestamp = rowTime;
                }
                changes.push({
                  tableName: table,
                  operation,
                  rowId: String(row.id),
                  payload: isSoftDeleted ? null : row,
                  timestamp: rowTime,
                });
              }
              if (tableMaxTime > lastCursor) {
                this.tableCursors.set(table, tableMaxTime);
                updatedCursors.push({ table, timestamp: tableMaxTime });
              }
            }
          } catch {
            // ignore individual table fetch error
          }
        }),
      );
    }

    if (updatedCursors.length > 0 && this.db) {
      for (const item of updatedCursors) {
        this.db.execute(
          `INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)`,
          [`cursor:${item.table}`, String(item.timestamp)],
        ).catch(() => {});
      }
    }

    return {
      timestamp: changes.length > 0 ? maxServerTimestamp : sinceTimestamp,
      changes,
    };
  }

  subscribeToLiveChanges(callback: (changes: DeltaChanges) => void): void {
    this.liveChangeCallback = callback;
    const adapter = this.getAdapter();
    if (adapter) {
      adapter.subscribeToLiveChanges(callback);
    }
  }
}
