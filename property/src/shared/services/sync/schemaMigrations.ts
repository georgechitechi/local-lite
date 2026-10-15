import type { LocalFirstClient } from 'local-lite';
import { CORE_TABLES } from './tables';

const TABLE_SCHEMAS: Record<string, Record<string, string>> = {
  businesses: {
    name: 'TEXT',
    phone: 'TEXT',
    email: 'TEXT',
    address: 'TEXT',
    latitude: 'REAL',
    longitude: 'REAL',
    user_id: 'TEXT',
    is_system: 'INTEGER',
    logo_url: 'TEXT',
    metadata: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  business_shares: {
    business_id: 'TEXT',
    user_id: 'TEXT',
    shared_with: 'TEXT',
    status: 'TEXT',
    roles: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT',
    deleted: 'INTEGER',
  },
  properties: {
    name: 'TEXT',
    location: 'TEXT',
    status: 'TEXT',
    business_id: 'TEXT',
    user_id: 'TEXT',
    latitude: 'REAL',
    longitude: 'REAL',
    metadata: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT',
    deleted: 'INTEGER',
  },
  houses: {
    property_id: 'TEXT',
    house_number: 'TEXT',
    status: 'TEXT',
    monthly_rent: 'REAL',
    deposit_amount: 'REAL',
    type: 'TEXT',
    floor: 'TEXT',
    business_id: 'TEXT',
    user_id: 'TEXT',
    metadata: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT',
    deleted: 'INTEGER',
  },
  tenants: {
    name: 'TEXT',
    phone: 'TEXT',
    email: 'TEXT',
    id_number: 'TEXT',
    status: 'TEXT',
    business_id: 'TEXT',
    user_id: 'TEXT',
    next_of_kin: 'TEXT',
    metadata: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT',
    deleted: 'INTEGER',
  },
  contracts: {
    house_id: 'TEXT',
    tenant_id: 'TEXT',
    business_id: 'TEXT',
    user_id: 'TEXT',
    start_date: 'TEXT',
    end_date: 'TEXT',
    rent_amount: 'REAL',
    status: 'TEXT',
    documents: 'TEXT',
    remarks: 'TEXT',
    metadata: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT',
    deleted: 'INTEGER',
  },
  receipts: {
    contract_id: 'TEXT',
    tenant_id: 'TEXT',
    business_id: 'TEXT',
    user_id: 'TEXT',
    amount: 'REAL',
    payment_method: 'TEXT',
    payment_date: 'TEXT',
    type: 'TEXT',
    status: 'TEXT',
    notes: 'TEXT',
    payment_period: 'TEXT',
    is_refunded: 'INTEGER',
    refunded_amount: 'REAL',
    metadata: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT',
    deleted: 'INTEGER',
  },
  expenses: {
    property_id: 'TEXT',
    house_id: 'TEXT',
    business_id: 'TEXT',
    user_id: 'TEXT',
    amount: 'REAL',
    category: 'TEXT',
    description: 'TEXT',
    date: 'TEXT',
    receipt_url: 'TEXT',
    metadata: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT',
    deleted: 'INTEGER',
  },
  settings: {
    business_id: 'TEXT',
    user_id: 'TEXT',
    setting_key: 'TEXT',
    setting_value: 'TEXT',
    metadata: 'TEXT',
    created_at: 'TEXT',
    updated_at: 'TEXT',
    deleted: 'INTEGER',
  },
  maintenance_requests: {
    business_id: 'TEXT',
    user_id: 'TEXT',
    property_id: 'TEXT',
    house_id: 'TEXT',
    tenant_id: 'TEXT',
    expense_id: 'TEXT',
    affected_houses: 'TEXT',
    description: 'TEXT',
    event_date: 'TEXT',
    images: 'TEXT',
    priority: 'TEXT',
    status: 'TEXT',
    metadata: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  payment_messages: {
    business_id: 'TEXT',
    user_id: 'TEXT',
    message_content: 'TEXT',
    transaction_date: 'TEXT',
    metadata: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  payment_message_receipts: {
    business_id: 'TEXT',
    user_id: 'TEXT',
    payment_message_id: 'TEXT',
    receipt_id: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  bookings: {
    business_id: 'TEXT',
    user_id: 'TEXT',
    property_id: 'TEXT',
    house_id: 'TEXT',
    converted_tenant_id: 'TEXT',
    name: 'TEXT',
    email: 'TEXT',
    phone: 'TEXT',
    gender: 'TEXT',
    nationality: 'TEXT',
    marital_status: 'TEXT',
    address: 'TEXT',
    status: 'TEXT',
    documents: 'TEXT',
    next_of_kin: 'TEXT',
    payment_details: 'TEXT',
    metadata: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  promotions: {
    business_id: 'TEXT',
    user_id: 'TEXT',
    property_id: 'TEXT',
    tenant_id: 'TEXT',
    code: 'TEXT',
    description: 'TEXT',
    type: 'TEXT',
    scope: 'TEXT',
    amount: 'REAL',
    is_active: 'INTEGER',
    valid_from: 'TEXT',
    valid_until: 'TEXT',
    metadata: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  message_templates: {
    business_id: 'TEXT',
    user_id: 'TEXT',
    name: 'TEXT',
    title: 'TEXT',
    content: 'TEXT',
    channel: 'TEXT',
    is_html: 'INTEGER',
    metadata: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  schedules: {
    business_id: 'TEXT',
    user_id: 'TEXT',
    schedule_type: 'TEXT',
    status: 'TEXT',
    schedule: 'TEXT',
    emails: 'TEXT',
    next_run: 'TEXT',
    last_run: 'TEXT',
    metadata: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  reminder_logs: {
    business_id: 'TEXT',
    user_id: 'TEXT',
    tenant_id: 'TEXT',
    contract_id: 'TEXT',
    channel: 'TEXT',
    reminder_type: 'TEXT',
    status: 'TEXT',
    message: 'TEXT',
    metadata: 'TEXT',
    sent_at: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  receipt_refunds: {
    business_id: 'TEXT',
    receipt_id: 'TEXT',
    user_id: 'TEXT',
    amount: 'REAL',
    reason: 'TEXT',
    metadata: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  backup_logs: {
    business_id: 'TEXT',
    user_id: 'TEXT',
    backup_status: 'TEXT',
    backup_started_at: 'TEXT',
    backup_completed_at: 'TEXT',
    file_name: 'TEXT',
    file_size: 'REAL',
    storage_path: 'TEXT',
    storage_url: 'TEXT',
    error_message: 'TEXT',
    error_details: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  api_keys: {
    business_id: 'TEXT',
    name: 'TEXT',
    key_prefix: 'TEXT',
    key_hash: 'TEXT',
    encrypted_key: 'TEXT',
    scopes: 'TEXT',
    expires_at: 'TEXT',
    last_used_at: 'TEXT',
    metadata: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  gallery_images: {
    business_id: 'TEXT',
    name: 'TEXT',
    url: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  transactions: {
    business_id: 'TEXT',
    user_id: 'TEXT',
    tenant_id: 'TEXT',
    contract_id: 'TEXT',
    amount: 'REAL',
    currency: 'TEXT',
    phone_number: 'TEXT',
    provider: 'TEXT',
    provider_reference: 'TEXT',
    transaction_reference: 'TEXT',
    status: 'TEXT',
    is_success: 'INTEGER',
    raw_payload: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
  profiles: {
    user_id: 'TEXT',
    email: 'TEXT',
    name: 'TEXT',
    phone: 'TEXT',
    avatar_url: 'TEXT',
    metadata: 'TEXT',
    deleted: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  },
};

/**
 * Ensures all core tables exist in SQLite with their complete set of columns.
 * Prevents "table X has no column named Y" runtime errors when pulling remote deltas.
 */
export async function ensureCoreSchemas(client: LocalFirstClient): Promise<void> {
  for (const table of CORE_TABLES) {
    try {
      // 1. Ensure table exists with id primary key
      await client.db.execute(
        `CREATE TABLE IF NOT EXISTS "${table}" ("id" TEXT PRIMARY KEY);`,
      );

      // 2. Discover existing columns
      const tableInfo = await client.db.execute(`PRAGMA table_info("${table}");`);
      const existingCols = new Set<string>();
      if (Array.isArray(tableInfo)) {
        for (const col of tableInfo) {
          if (col?.name) {
            existingCols.add(String(col.name).toLowerCase());
          }
        }
      }

      // 3. Add any missing columns
      const expectedCols = TABLE_SCHEMAS[table] || {};
      for (const [colName, colType] of Object.entries(expectedCols)) {
        if (!existingCols.has(colName.toLowerCase())) {
          try {
            await client.db.execute(
              `ALTER TABLE "${table}" ADD COLUMN "${colName}" ${colType};`,
            );
            existingCols.add(colName.toLowerCase());
          } catch (alterErr) {
            const msg = String(alterErr || '').toLowerCase();
            if (!msg.includes('duplicate column')) {
              console.warn(
                `[local-lite schema] Failed adding column ${colName} to ${table}:`,
                alterErr,
              );
            }
          }
        }
        // Register in schemaManager cache
        if (client.schemaManager) {
          (client.schemaManager as any).knownColumns?.add(
            `${table}:${colName.toLowerCase()}`,
          );
        }
      }
    } catch (err) {
      console.warn(`[local-lite schema] Error inspecting schema for ${table}:`, err);
    }
  }
}
