import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { LocalFirstClient } from 'outbox-sync';
import { useOutboxStatus } from 'outbox-sync/react';
import { getSyncClient } from '../sync.config';
import { seedRentalPortfolio, clearRentalPortfolio } from '../data/seeder';

interface SyncContextType {
  client: LocalFirstClient | null;
  isOnline: boolean;
  toggleOnline: () => void;
  lastSyncedText: string;
  pendingCount: number;
  pendingRecords: any[];
  refreshOutbox: () => Promise<void>;
  statusMessage: string;
  setStatusMessage: (msg: string) => void;
  seedDemoData: () => Promise<void>;
  clearDemoData: () => Promise<void>;
  forceResync: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [lastSyncedText, setLastSyncedText] = useState('Never');
  const [statusMessage, setStatusMessage] = useState('Initializing local-first SQLite engine...');

  useEffect(() => {
    let mounted = true;
    getSyncClient()
      .then((c) => {
        if (mounted) {
          setClient(c);
          setStatusMessage('✅ PropFlow Local-First Engine active! 0ms SQLite transactions.');
          updateCursor(c);
        }
      })
      .catch((err) => {
        setStatusMessage(`❌ Initialization error: ${err.message}`);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const updateCursor = async (c: LocalFirstClient) => {
    try {
      const ts = await c.getLastSyncedAt();
      if (ts > 0) {
        const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
        setLastSyncedText(`${secs}s ago`);
      } else {
        setLastSyncedText('First sync pending');
      }
    } catch {
      setLastSyncedText('Local only');
    }
  };

  useEffect(() => {
    if (!client) return;
    const interval = setInterval(() => {
      updateCursor(client);
    }, 3000);
    return () => clearInterval(interval);
  }, [client]);

  const { pendingCount, pendingRecords, refresh: refreshOutbox } = useOutboxStatus(client);

  const toggleOnline = () => {
    if (!client) return;
    const nextState = !isOnline;
    setIsOnline(nextState);
    if ((client as any).network && typeof (client as any).network.setOnline === 'function') {
      (client as any).network.setOnline(nextState);
    }
    setStatusMessage(
      nextState
        ? '📶 Network ONLINE: Pending outbox items flushing to backend!'
        : '✈️ Network OFFLINE: Mutations queue safely in local SQLite outbox.'
    );
  };

  const forceResync = async () => {
    if (!client) return;
    try {
      await client.resetSyncCursor();
      setStatusMessage('🔄 Sync cursor reset! Full refresh scheduled.');
      await updateCursor(client);
    } catch (err: any) {
      setStatusMessage(`Error resetting cursor: ${err.message}`);
    }
  };

  const seedDemoData = async () => {
    if (!client) return;
    setStatusMessage('⚡ Seeding rental portfolio with demo units, tenants, tickets & invoices...');
    try {
      const stats = await seedRentalPortfolio(client);
      setStatusMessage(
        `🎉 Seeded ${stats.propertiesCount} units, ${stats.tenantsCount} tenants, ${stats.maintenanceCount} tickets & ${stats.paymentsCount} invoices!`
      );
    } catch (err: any) {
      setStatusMessage(`Error seeding data: ${err.message}`);
    }
  };

  const clearDemoData = async () => {
    if (!client) return;
    try {
      await clearRentalPortfolio(client);
      setStatusMessage('🗑️ Rental portfolio cleared from local SQLite.');
    } catch (err: any) {
      setStatusMessage(`Error clearing data: ${err.message}`);
    }
  };

  return (
    <SyncContext.Provider
      value={{
        client,
        isOnline,
        toggleOnline,
        lastSyncedText,
        pendingCount,
        pendingRecords,
        refreshOutbox,
        statusMessage,
        setStatusMessage,
        seedDemoData,
        clearDemoData,
        forceResync,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncContextType {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return ctx;
}
