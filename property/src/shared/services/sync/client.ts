import { createSyncClient, type LocalFirstClient } from 'local-lite/config';
import { syncConfig } from './syncConfig';

let clientInstance: LocalFirstClient | null = null;
let clientPromise: Promise<LocalFirstClient> | null = null;

export async function getSyncClient(): Promise<LocalFirstClient> {
  if (clientInstance) {
    return clientInstance;
  }

  if (!clientPromise) {
    clientPromise = createSyncClient(syncConfig).then(async client => {
      client.events.on('sync:pull', event => {
        if (!event.success) {
          console.warn('[local-lite] Remote pull failed:', event.error);
          return;
        }

        console.info(
          `[local-lite] Remote pull completed: ${event.changesCount} changes in ${event.durationMs} ms`,
        );
      });

      await client.initialize();

      // Clean up any unrecoverable unique constraint / duplicate key violations from the outbox queue
      await client.clearFailedMutations().catch(() => {});

      clientInstance = client;
      return client;
    });
  }

  return clientPromise;
}

export function getSyncClientSync(): LocalFirstClient | null {
  return clientInstance;
}

export type { LocalFirstClient };
