import { useEffect, useState } from 'react';
import { useSnackbar } from '@/context/SnackbarContext';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useNetworkStatus } from '@/shared/hooks/useNetworkStatus';

export default function OfflineBanner() {
  const isOnline = useNetworkStatus();
  const { showSnackbar } = useSnackbar();
  const [wasOffline, setWasOffline] = useState(false);
  const { isLocalMode } = useLocalSync();

  useEffect(() => {
    if (isLocalMode) return;

    if (!isOnline && !wasOffline) {
      // We just went offline
      showSnackbar('Working Offline - Changes will sync in background', 'warning');
      setWasOffline(true);
    } else if (isOnline && wasOffline) {
      // We just came back online
      showSnackbar('Back Online, Changes will sync in background', 'success');
      setWasOffline(false);
    }
  }, [isOnline, wasOffline, showSnackbar, isLocalMode]);

  return null;
}
