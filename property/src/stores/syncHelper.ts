import Storage from 'expo-sqlite/kv-store';
import { getSyncClient } from '@/shared/services/sync/client';
import { safeReloadApp } from '@/shared/utils/safeReload';

/**
 * Wipes all local SQLite persistence and forces a full JS runtime reload.
 */
export async function clearAllPersistence(options: { reload?: boolean } = {}): Promise<void> {
  const client = await getSyncClient();
  try {
    await client.reset({ dropTables: false });
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
