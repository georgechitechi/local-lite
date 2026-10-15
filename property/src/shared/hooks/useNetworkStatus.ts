import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const state = await NetInfo.fetch();
        const isConnected =
          state.isConnected === true &&
          (state.isInternetReachable === true || state.isInternetReachable === null);
        setIsOnline(isConnected);
      } catch (e) {
        console.warn('Network check failed', e);
        setIsOnline(true);
      }
    };

    checkStatus();

    // Subscribe to network state changes
    const unsubscribe = NetInfo.addEventListener(state => {
      const isConnected =
        state.isConnected === true &&
        (state.isInternetReachable === true || state.isInternetReachable === null);
      setIsOnline(isConnected);
    });

    // Re-check when coming back to foreground to ensure we catch state changes
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        checkStatus();
      }
    });

    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);

  return isOnline;
}
