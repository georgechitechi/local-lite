import { DatabaseSync } from 'node:sqlite';
import { LocalFirstClient, LocalFirstClientConfig } from '../core/client.js';
import { NodeSQLiteAdapter } from '../adapters/local/node-sqlite.js';
import { MemoryDemoRemoteAdapter } from '../adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../adapters/network/index.js';
import type { SyncOperation } from '../core/types.js';

export interface CreateTestClientOptions
  extends Partial<Omit<LocalFirstClientConfig, 'local'>> {
  tables?: string[];
  online?: boolean;
  remoteLatencyMs?: number;
}

export interface TestClientHandle {
  client: LocalFirstClient;
  remote: MemoryDemoRemoteAdapter;
  network: DefaultNetworkStatusProvider;
  simulateOffline: () => void;
  simulateOnline: () => void;
  flushOutbox: () => Promise<void>;
  injectRemoteChange: (
    tableName: string,
    rowId: string,
    payload: Record<string, any>,
    operation?: 'INSERT' | 'UPDATE' | 'DELETE',
  ) => Promise<void>;
  dispose: () => Promise<void>;
}

/**
 * Creates an isolated in-memory `LocalFirstClient` with controllable network and remote state for deterministic tests.
 */
export async function createTestClient(
  options: CreateTestClientOptions = {},
): Promise<TestClientHandle> {
  const raw = new DatabaseSync(':memory:');
  const local = new NodeSQLiteAdapter(raw);
  const remote =
    (options.remote as MemoryDemoRemoteAdapter) ??
    new MemoryDemoRemoteAdapter(options.remoteLatencyMs ?? 0);
  const injectedChanges: Array<{
    tableName: string;
    rowId: string;
    operation: 'INSERT' | 'UPDATE' | 'DELETE';
    timestamp: number;
    payload: Record<string, any> | null;
  }> = [];

  if (!options.remote) {
    const origFetch = remote.fetchChanges.bind(remote);
    remote.fetchChanges = async (sinceTimestamp: number) => {
      const base = await origFetch(sinceTimestamp);
      const pending = injectedChanges.filter(
        (c) => c.timestamp > sinceTimestamp,
      );
      return {
        ...base,
        timestamp: Date.now(),
        changes: [...(base.changes ?? []), ...pending],
      };
    };
  }
  const network =
    (options.network as DefaultNetworkStatusProvider) ??
    new DefaultNetworkStatusProvider(options.online ?? true);

  const client = new LocalFirstClient({
    ...options,
    local,
    remote,
    network,
    tables: options.tables ?? ['todos'],
    autoSchema: options.autoSchema ?? true,
    autoStart: options.autoStart ?? false,
    logger: options.logger ?? false,
  });

  await client.initialize();

  return {
    client,
    remote,
    network,
    simulateOffline() {
      network.setOnline(false);
    },
    simulateOnline() {
      network.setOnline(true);
    },
    async flushOutbox() {
      await client.syncWorker.pushLocalChanges();
      await client.syncWorker.pullRemoteChanges();
    },
    async injectRemoteChange(
      tableName: string,
      rowId: string,
      payload: Record<string, any>,
      operation: 'INSERT' | 'UPDATE' | 'DELETE' = 'UPDATE',
    ) {
      const ts = Date.now() + 1000;
      const change = {
        tableName,
        rowId,
        operation,
        timestamp: ts,
        payload: operation === 'DELETE' ? null : payload,
      };
      injectedChanges.push(change);
      remote.emitLiveChanges({ timestamp: ts, changes: [change] });
    },
    async dispose() {
      client.stop();
      raw.close();
    },
  };
}
