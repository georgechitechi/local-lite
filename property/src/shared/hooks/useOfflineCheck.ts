import { useCallback } from 'react';
import { useSnackbar } from '@/context/SnackbarContext';
import { useNetworkStatus } from './useNetworkStatus';

/**
 * Hook to check if device is online and show Snackbar notification if offline
 * @returns Object with isOnline status and checkOnline function
 */
export const useOfflineCheck = () => {
  const isOnline = useNetworkStatus();
  const { showSnackbar } = useSnackbar();

  /**
   * Check if device is online and show Snackbar if offline
   * @param featureName - Name of the feature requiring internet connection
   * @returns true if online, false if offline
   */
  const checkOnline = useCallback(
    (featureName: string): boolean => {
      if (!isOnline) {
        const message = `${featureName} requires an internet connection`;
        showSnackbar(message, 'warning');
        return false;
      }
      return true;
    },
    [isOnline, showSnackbar],
  );

  return {
    isOnline,
    checkOnline,
  };
};
