import type { LocalFirstClient } from 'local-lite';
import type React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import {
  getAuthStateSyncSnapshot,
  subscribeAuthStateSync,
} from '@/shared/services/supabase';
import { getSyncClient } from '@/shared/services/sync/client';

interface SyncClientContextValue {
  client: LocalFirstClient | null;
  isReady: boolean;
  isInitialSyncing: boolean;
}

const SyncClientContext = createContext<SyncClientContextValue>({
  client: null,
  isReady: false,
  isInitialSyncing: false,
});

export const SyncClientProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isInitialSyncing, setIsInitialSyncing] = useState(false);

  useEffect(() => {
    let mounted = true;
    let clientRef: LocalFirstClient | null = null;
    let initialPullTimer: any = null;

    const startInitialSync = (c: LocalFirstClient) => {
      const isOnline = getAuthStateSyncSnapshot().isLoggedIn;
      if (isOnline) {
        setIsInitialSyncing(true);
        c.syncWorker.start();

        const unsubPull = c.events.on('sync:pull', () => {
          if (mounted) {
            setIsInitialSyncing(false);
          }
          unsubPull();
        });

        // Safety timeout so dashboard never hangs indefinitely if network is slow or offline
        initialPullTimer = setTimeout(() => {
          if (mounted) {
            setIsInitialSyncing(false);
            try {
              unsubPull();
            } catch {}
          }
        }, 3500);
      } else {
        c.syncWorker.stop();
        setIsInitialSyncing(false);
      }
    };

    getSyncClient()
      .then(c => {
        if (mounted) {
          clientRef = c;
          setClient(c);
          setIsReady(true);
          startInitialSync(c);
        }
      })
      .catch(err => {
        console.error('Failed to initialize local-lite client:', err);
      });

    const unsubAuth = subscribeAuthStateSync(() => {
      if (!mounted || !clientRef) return;
      startInitialSync(clientRef);
    });

    return () => {
      mounted = false;
      unsubAuth();
      if (initialPullTimer) clearTimeout(initialPullTimer);
    };
  }, []);

  return (
    <SyncClientContext.Provider value={{ client, isReady, isInitialSyncing }}>
      {children}
    </SyncClientContext.Provider>
  );
};

export const useLocalClient = () => {
  const context = useContext(SyncClientContext);
  return context.isReady ? context.client : null;
};

export const useSyncClientContext = () => useContext(SyncClientContext);

export const useIsInitialSyncing = () => {
  const context = useContext(SyncClientContext);
  return context.isInitialSyncing;
};
