import { useSyncExternalStore } from 'react';
import { useSnackbar } from '@/context/SnackbarContext';
import { useLocalClient } from '@/providers/SyncClientProvider';
import {
  configureSupabaseClient,
  disableCloudSync,
  getAuthStateSyncSnapshot,
  getCloudSyncStateSnapshot,
  subscribeAuthStateSync,
  subscribeCloudSyncState,
} from '@/shared/services/supabase';

export function useLocalSync() {
  const localClient = useLocalClient();
  const cloudSync = useSyncExternalStore(subscribeCloudSyncState, getCloudSyncStateSnapshot);
  const authState = useSyncExternalStore(subscribeAuthStateSync, getAuthStateSyncSnapshot);

  const isCloudSyncEnabled = cloudSync.isEnabled;
  const isLoggedIn = authState.isLoggedIn;
  const isSyncActive = isCloudSyncEnabled && isLoggedIn;
  const isInitializing = cloudSync.isInitializing;
  const isDemoMode = cloudSync.isDemoMode;
  const { showSnackbar } = useSnackbar();

  const requireCloudSync = (featureName: string): boolean => {
    if (!isSyncActive) {
      showSnackbar(`${featureName} requires Cloud Sync`, 'warning');
      return false;
    }
    return true;
  };

  const enableSync = async (url: string, key: string) => {
    const client = await configureSupabaseClient(url, key);
    if (localClient?.syncWorker) {
      localClient.syncWorker.start();
    }
    return client;
  };

  const disableSync = async () => {
    await disableCloudSync();
    if (localClient?.syncWorker) {
      localClient.syncWorker.stop();
    }
  };

  return {
    isCloudSyncEnabled,
    isSyncActive,
    isInitializing,
    isDemoMode,
    enableSync,
    disableSync,
    requireCloudSync,
  };
}
