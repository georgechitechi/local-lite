import { createSyncClient, type LocalFirstClient } from 'local-lite/config';
import { syncConfig } from './syncConfig';
import { BUSINESS_COLLECTIONS } from './tables';
import { ensureSchemaForeignIndexes } from './schemaIndexes';

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

      // Ensure composite indexes exist on all business tables for instant local-first reads
      for (const table of BUSINESS_COLLECTIONS) {
        try {
          await client.db.execute(
            `CREATE INDEX IF NOT EXISTS "idx_${table}_biz_del" ON "${table}" ("business_id", "deleted");`,
          );
        } catch {}
      }

      // Specialized performance indexes for hot queries
      try {
        await client.db.execute(
          'CREATE INDEX IF NOT EXISTS "idx_receipts_biz_date" ON "receipts" ("business_id", "payment_date", "deleted");',
        );
        await client.db.execute(
          'CREATE INDEX IF NOT EXISTS "idx_contracts_biz_status_end" ON "contracts" ("business_id", "status", "end_date", "deleted");',
        );
        await client.db.execute(
          'CREATE INDEX IF NOT EXISTS "idx_contracts_biz_tenant" ON "contracts" ("business_id", "tenant_id", "deleted");',
        );
        await client.db.execute(
          'CREATE INDEX IF NOT EXISTS "idx_contracts_biz_house" ON "contracts" ("business_id", "house_id", "deleted");',
        );
        await client.db.execute(
          'CREATE INDEX IF NOT EXISTS "idx_houses_biz_prop" ON "houses" ("business_id", "property_id", "deleted");',
        );
        await client.db.execute(
          'CREATE INDEX IF NOT EXISTS "idx_expenses_biz_date" ON "expenses" ("business_id", "date", "deleted");',
        );
        await client.db.execute(
          'CREATE INDEX IF NOT EXISTS "idx_payment_messages_biz_date" ON "payment_messages" ("business_id", "date", "deleted");',
        );
        await client.db.execute(
          'CREATE INDEX IF NOT EXISTS "idx_bookings_biz_house" ON "bookings" ("business_id", "house_id", "deleted");',
        );
      } catch {}

      // Apply all foreign-key indexes extracted from database.types.ts
      await ensureSchemaForeignIndexes(client.db);

      // Clean up any unrecoverable unique constraint / duplicate key violations from the outbox queue
      await client.clearFailedMutations().catch(() => {});

      // Purge any stuck profile insertion poison pills from outbox
      try {
        await client.transaction(async tx => {
          await tx.rawTx.execute(
            "DELETE FROM sync_outbox WHERE table_name = 'profiles' AND operation = 'INSERT';",
          );
        });
      } catch {}

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
