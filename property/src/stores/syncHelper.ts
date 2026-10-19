import Storage from 'expo-sqlite/kv-store';
import { getAuthStateSyncSnapshot, supabase } from '@/shared/services/supabase';
import { getSyncClient } from '@/shared/services/sync/client';
import { safeReloadApp } from '@/shared/utils/safeReload';

/**
 * Pushes any pending local SQLite changes and triggers the backend 'backup-scheduler'
 * edge function on Supabase to take an official cloud backup before local data is wiped.
 */
export async function backupToCloudBeforeClear(): Promise<boolean> {
  try {
    const client = await getSyncClient().catch(() => null);

    // 1. Push any pending local mutations to Supabase first
    if (client?.syncWorker && typeof client.syncWorker.pushLocalChanges === 'function') {
      try {
        await client.syncWorker.pushLocalChanges();
      } catch (pushErr) {
        console.warn('Failed to push pending changes before cloud backup:', pushErr);
      }
    }

    // 2. Invoke the backup-scheduler edge function if supabase is initialized
    if (supabase) {
      let businessIds: string[] = [];
      if (client && typeof client.findMany === 'function') {
        try {
          const businesses = await client.findMany('businesses');
          businessIds = (businesses || []).map((b: any) => b.id).filter(Boolean);
        } catch {}
      }

      const { error } = await supabase.functions.invoke('backup-scheduler', {
        body: {
          manual_trigger: true,
          manual_business_ids: businessIds.length > 0 ? businessIds : undefined,
        },
      });

      if (error) {
        console.error('backup-scheduler edge function error:', error);
        throw error;
      }
      return true;
    }
    return false;
  } catch (error) {
    console.error('backupToCloudBeforeClear failed:', error);
    throw error;
  }
}

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
  if (
    getAuthStateSyncSnapshot().isLoggedIn &&
    typeof client.syncWorker?.start === 'function'
  ) {
    client.syncWorker.start();
  }
}
