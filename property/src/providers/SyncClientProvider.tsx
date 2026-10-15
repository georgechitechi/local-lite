import type { LocalFirstClient } from 'local-lite';
import type React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { getAuthStateSyncSnapshot } from '@/shared/services/supabase';
import { getSyncClient } from '@/shared/services/sync/client';

interface SyncClientContextValue {
  client: LocalFirstClient | null;
  isReady: boolean;
}

const SyncClientContext = createContext<SyncClientContextValue>({
  client: null,
  isReady: false,
});

export const SyncClientProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    getSyncClient()
      .then(c => {
        if (mounted) {
          setClient(c);
          setIsReady(true);

          if (getAuthStateSyncSnapshot().isLoggedIn) {
            c.syncWorker.pullRemoteChanges().catch(mErr => {
              console.warn('Initial background remote pull failed:', mErr);
            });
          }
        }
      })
      .catch(err => {
        console.error('Failed to initialize local-lite client:', err);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <SyncClientContext.Provider value={{ client, isReady }}>
      {children}
    </SyncClientContext.Provider>
  );
};

export const useLocalClient = () => {
  const context = useContext(SyncClientContext);
  return context.isReady ? context.client : null;
};

export const useSyncClientContext = () => useContext(SyncClientContext);
