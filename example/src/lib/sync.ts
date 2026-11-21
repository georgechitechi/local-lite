import * as SQLite from 'expo-sqlite';
import {
  defineSyncConfig,
  createSyncClient,
  defineTypedSchema,
  createTypedClient,
  createFieldMergeResolver,
  type LocalFirstClient,
} from 'local-lite';

export const appSchema = defineTypedSchema({
  properties: {
    id: 'string',
    name: 'string',
    location: 'string',
    manager_contact: 'string',
    created_at: 'number',
  },
  houses: {
    id: 'string',
    property_id: 'string',
    house_number: 'string',
    rent: 'number',
    status: 'string',
    amenities: 'json',
    created_at: 'number',
  },
  tenants: {
    id: 'string',
    name: 'string',
    phone: 'string',
    email: 'string',
    emergency_contact: 'string',
    created_at: 'number',
  },
  contracts: {
    id: 'string',
    house_id: 'string',
    tenant_id: 'string?',
    rent_amount: 'number',
    balance_due: 'number',
    status: 'string',
    start_date: 'string',
    created_at: 'number',
  },
  receipts: {
    id: 'string',
    contract_id: 'string',
    amount: 'number',
    method: 'string',
    paid_at: 'number',
  },
});

let clientPromise: Promise<LocalFirstClient> | null = null;

export const syncConfig = defineSyncConfig({
  database: () => SQLite.openDatabaseAsync('property_mgmt_example.db'),
  localOnly: true,
  autoSchema: true,
  tables: ['properties', 'houses', 'tenants', 'contracts', 'receipts'],
  relationships: [
    {
      table: 'houses',
      foreignKey: 'property_id',
      references: 'properties',
      onDelete: 'cascade',
    },
    {
      table: 'contracts',
      foreignKey: 'house_id',
      references: 'houses',
      onDelete: 'restrict',
    },
    {
      table: 'contracts',
      foreignKey: 'tenant_id',
      references: 'tenants',
      onDelete: 'setNull',
    },
    {
      table: 'receipts',
      foreignKey: 'contract_id',
      references: 'contracts',
      onDelete: 'cascade',
    },
  ],
  jsonColumns: {
    houses: ['amenities'],
  },
  conflictResolver: createFieldMergeResolver({
    fieldRules: {
      houses: {
        amenities: 'set-union',
      },
      contracts: {
        balance_due: 'pn-counter',
      },
    },
  }),
  auth: {
    minPasswordLength: 6,
    maxFailedAttempts: 3,
    lockoutDurationMs: 30 * 1000,
  },
  email: {
    provider: 'preview',
    defaults: {
      from: 'PropertyOps <no-reply@local-lite.dev>',
    },
  },
});

export function getClient(): Promise<LocalFirstClient> {
  if (!clientPromise) {
    clientPromise = createSyncClient(syncConfig);
  }
  return clientPromise;
}

export async function getTypedDb() {
  const client = await getClient();
  return createTypedClient(client, appSchema);
}
