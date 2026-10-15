import { createSyncClient, type LocalFirstClient } from 'local-lite/config';
import { ensureCoreSchemas } from './schemaMigrations';
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

      try {
        await ensureCoreSchemas(client);
      } catch (sErr) {
        console.error('Failed to ensure core schemas:', sErr);
      }

      await client.initialize();
      (syncConfig.remote as any)?.setDb?.(client.db);

      // Clean up any unrecoverable unique constraint / duplicate key violations from the outbox queue
      await client.db
        .execute(
          `DELETE FROM sync_outbox WHERE (last_error LIKE '%unique constraint%' OR last_error LIKE '%duplicate key%' OR last_error LIKE '%23505%') AND status = 'FAILED'`,
        )
        .catch(() => {});

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
