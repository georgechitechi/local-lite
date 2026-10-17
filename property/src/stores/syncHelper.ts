import Storage from 'expo-sqlite/kv-store';
import { getAuthStateSyncSnapshot } from '@/shared/services/supabase';
import { getSyncClient } from '@/shared/services/sync/client';
import { safeReloadApp } from '@/shared/utils/safeReload';

/**
 * Wipes all local SQLite persistence, clears KV-storage, and prevents unauthorized sync loops.
 */
export async function clearAllPersistence(
  options: { reload?: boolean } = {},
): Promise<void> {
  const client = await getSyncClient();
  try {
    // Immediately stop syncWorker so no in-flight or background pulls/pushes occur during or after wipe
    if (typeof client.syncWorker?.stop === 'function') {
      client.syncWorker.stop();
    }
    await client.reset({ dropTables: false });
    await Storage.clearAsync();
  } catch (error) {
    console.error('clearAllPersistence failed:', error);
    throw error;
  }
  if (options.reload !== false) {
    await safeReloadApp();
  }
  // Only restart syncWorker if the user is actively authenticated online
  if (getAuthStateSyncSnapshot().isLoggedIn && typeof client.syncWorker?.start === 'function') {
    client.syncWorker.start();
  }
}
