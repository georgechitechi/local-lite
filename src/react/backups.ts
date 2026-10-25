import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  CloudBackupClient,
  CloudBackupFile,
  ResolvableBackupDatabase,
  GoogleDriveBackupClient,
  OneDriveBackupClient,
} from '../backups/index.js';
import { performBackup, performRestore } from '../backups/index.js';

export interface UseCloudBackupOptions {
  passphrase?: string;
  autoRefresh?: boolean;
}

export interface UseCloudBackupResult {
  isConnected: boolean;
  isLoading: boolean;
  isBackingUp: boolean;
  isRestoring: boolean;
  backups: CloudBackupFile[];
  lastBackupAt: string | null;
  error: Error | null;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  refreshBackups: () => Promise<CloudBackupFile[]>;
  backup: (options?: { fileName?: string; passphrase?: string }) => Promise<string>;
  restore: (fileNameOrId: string, options?: { passphrase?: string }) => Promise<void>;
  deleteBackup: (fileNameOrId: string) => Promise<void>;
}

export function useCloudBackup(
  client: CloudBackupClient | null | undefined,
  database?: ResolvableBackupDatabase,
  options?: UseCloudBackupOptions,
): UseCloudBackupResult {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isBackingUp, setIsBackingUp] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [backups, setBackups] = useState<CloudBackupFile[]>([]);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const databaseRef = useRef(database);
  databaseRef.current = database;

  const defaultPassphrase = options?.passphrase;
  const autoRefresh = options?.autoRefresh ?? true;

  const refreshBackups = useCallback(async (): Promise<CloudBackupFile[]> => {
    if (!client) {
      setBackups([]);
      return [];
    }
    try {
      const connected = await client.isConnected();
      if (!connected) {
        setBackups([]);
        return [];
      }
      const list = await client.list();
      setBackups(list);
      return list;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    }
  }, [client]);

  useEffect(() => {
    if (!client) {
      setIsConnected(false);
      setIsLoading(false);
      setBackups([]);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    client
      .isConnected()
      .then(async connected => {
        if (!isMounted) return;
        setIsConnected(connected);
        setIsLoading(false);
        if (connected && autoRefresh) {
          try {
            const list = await client.list();
            if (isMounted) setBackups(list);
          } catch (listErr: any) {
            if (isMounted) {
              setError(listErr instanceof Error ? listErr : new Error(String(listErr)));
            }
          }
        }
      })
      .catch(err => {
        if (!isMounted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });

    let unsubscribe: (() => void) | undefined;
    if (typeof client.onStatusChange === 'function') {
      unsubscribe = client.onStatusChange(async connected => {
        if (!isMounted) return;
        setIsConnected(connected);
        if (connected && autoRefresh) {
          try {
            const list = await client.list();
            if (isMounted) setBackups(list);
          } catch (listErr: any) {
            if (isMounted) {
              setError(listErr instanceof Error ? listErr : new Error(String(listErr)));
            }
          }
        } else if (!connected) {
          setBackups([]);
        }
      });
    }

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [client, autoRefresh]);

  const connect = useCallback(async (): Promise<boolean> => {
    if (!client) throw new Error('Cloud backup client is not initialized.');
    setError(null);
    setIsLoading(true);
    try {
      const connected = await client.connect();
      setIsConnected(connected);
      if (connected && autoRefresh) {
        const list = await client.list();
        setBackups(list);
      }
      return connected;
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [client, autoRefresh]);

  const disconnect = useCallback(async (): Promise<void> => {
    if (!client) return;
    setError(null);
    setIsLoading(true);
    try {
      await client.disconnect();
      setIsConnected(false);
      setBackups([]);
    } catch (err: any) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  const backup = useCallback(
    async (backupOptions?: { fileName?: string; passphrase?: string }): Promise<string> => {
      if (!client) throw new Error('Cloud backup client is not initialized.');
      const currentDb = databaseRef.current;
      if (!currentDb) {
        throw new Error('A database instance or LocalFirstClient must be provided to create a backup.');
      }

      setError(null);
      setIsBackingUp(true);
      try {
        const passphrase = backupOptions?.passphrase ?? defaultPassphrase;
        let createdFileName: string;

        if (typeof client.backup === 'function') {
          createdFileName = await client.backup(currentDb, {
            fileName: backupOptions?.fileName,
            passphrase,
          });
        } else {
          createdFileName = await performBackup(currentDb, client, {
            fileName: backupOptions?.fileName,
            passphrase,
          });
        }

        setLastBackupAt(new Date().toISOString());

        if (autoRefresh) {
          try {
            const list = await client.list();
            setBackups(list);
          } catch {
            // Backup succeeded; silent list update failure is tolerated
          }
        }

        return createdFileName;
      } catch (err: any) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsBackingUp(false);
      }
    },
    [client, defaultPassphrase, autoRefresh],
  );

  const restore = useCallback(
    async (
      fileNameOrId: string,
      restoreOptions?: { passphrase?: string },
    ): Promise<void> => {
      if (!client) throw new Error('Cloud backup client is not initialized.');
      const currentDb = databaseRef.current;
      if (!currentDb) {
        throw new Error('A database instance or LocalFirstClient must be provided to restore a backup.');
      }

      setError(null);
      setIsRestoring(true);
      try {
        const passphrase = restoreOptions?.passphrase ?? defaultPassphrase;

        if (typeof client.restore === 'function') {
          await client.restore(currentDb, fileNameOrId, { passphrase });
        } else {
          await performRestore(currentDb, client, fileNameOrId, { passphrase });
        }
      } catch (err: any) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsRestoring(false);
      }
    },
    [client, defaultPassphrase],
  );

  const deleteBackup = useCallback(
    async (fileNameOrId: string): Promise<void> => {
      if (!client) throw new Error('Cloud backup client is not initialized.');
      setError(null);
      try {
        if (typeof client.deleteBackup === 'function') {
          await client.deleteBackup(fileNameOrId);
        } else if (typeof client.delete === 'function') {
          await client.delete(fileNameOrId);
        } else {
          throw new Error('Delete operation is not supported by this cloud storage client.');
        }

        if (autoRefresh) {
          const list = await client.list();
          setBackups(list);
        }
      } catch (err: any) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      }
    },
    [client, autoRefresh],
  );

  return {
    isConnected,
    isLoading,
    isBackingUp,
    isRestoring,
    backups,
    lastBackupAt,
    error,
    connect,
    disconnect,
    refreshBackups,
    backup,
    restore,
    deleteBackup,
  };
}

export function useGoogleDriveBackup(
  client: GoogleDriveBackupClient | null | undefined,
  database?: ResolvableBackupDatabase,
  options?: UseCloudBackupOptions,
): UseCloudBackupResult {
  return useCloudBackup(client, database, options);
}

export function useOneDriveBackup(
  client: OneDriveBackupClient | null | undefined,
  database?: ResolvableBackupDatabase,
  options?: UseCloudBackupOptions,
): UseCloudBackupResult {
  return useCloudBackup(client, database, options);
}
