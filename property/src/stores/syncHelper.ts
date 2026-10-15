import Storage from 'expo-sqlite/kv-store';
import { getSyncClient } from '@/shared/services/sync/client';
import { safeReloadApp } from '@/shared/utils/safeReload';

/**
 * Wipes all local SQLite persistence and forces a full JS runtime reload.
 */
export async function clearAllPersistence(options: { reload?: boolean } = {}): Promise<void> {
  const client = await getSyncClient();
  try {
    client.stop();
    await client.db.transaction(async tx => {
      for (const table of [...client.tables, 'sync_outbox', 'sync_meta']) {
        await tx.execute(`DELETE FROM "${table.replace(/"/g, '""')}"`);
      }
    });
    await client.resetSyncCursor();
    (client.remote as any)?.reset?.();
    for (const table of [...client.tables, 'sync_outbox']) {
      client.events.emit(table, { operation: 'DELETE', rowId: '*', source: 'local' });
    }
    await Storage.clearAsync();
  } catch (error) {
    console.error('clearAllPersistence failed:', error);
    client.syncWorker.start();
    throw error;
  }
  if (options.reload !== false) {
    await safeReloadApp();
  }
  client.syncWorker.start();
}
