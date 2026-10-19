/**
 * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY.
 * Generated from src/shared/types/database.types.ts by scripts/generateSchemaIndexes.js.
 * Run "node scripts/generateSchemaIndexes.js" to regenerate.
 */

export interface SchemaIndexDefinition {
  table: string;
  columns: readonly string[];
  isOneToOne: boolean;
  sql: string;
  comment?: string;
}

/**
 * Foreign key relationships extracted from database.types.ts.
 */
export const SCHEMA_INDEXES: readonly SchemaIndexDefinition[] = [
  {
    "table": "api_keys",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_api_keys_business_id\" ON \"api_keys\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "backup_logs",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_backup_logs_business_id\" ON \"backup_logs\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "bookings",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_bookings_business_id\" ON \"bookings\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "bookings",
    "columns": [
      "converted_tenant_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_bookings_converted_tenant_id\" ON \"bookings\" (\"converted_tenant_id\");",
    "comment": "References tenants"
  },
  {
    "table": "bookings",
    "columns": [
      "house_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_bookings_house_id\" ON \"bookings\" (\"house_id\");",
    "comment": "References houses"
  },
  {
    "table": "bookings",
    "columns": [
      "property_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_bookings_property_id\" ON \"bookings\" (\"property_id\");",
    "comment": "References properties"
  },
  {
    "table": "business_shares",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_business_shares_business_id\" ON \"business_shares\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "contracts",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_contracts_business_id\" ON \"contracts\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "contracts",
    "columns": [
      "house_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_contracts_house_id\" ON \"contracts\" (\"house_id\");",
    "comment": "References houses"
  },
  {
    "table": "contracts",
    "columns": [
      "tenant_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_contracts_tenant_id\" ON \"contracts\" (\"tenant_id\");",
    "comment": "References tenants"
  },
  {
    "table": "expenses",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_expenses_business_id\" ON \"expenses\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "gallery_images",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_gallery_images_business_id\" ON \"gallery_images\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "houses",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_houses_business_id\" ON \"houses\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "houses",
    "columns": [
      "property_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_houses_property_id\" ON \"houses\" (\"property_id\");",
    "comment": "References properties"
  },
  {
    "table": "maintenance_requests",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_maintenance_requests_business_id\" ON \"maintenance_requests\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "maintenance_requests",
    "columns": [
      "expense_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_maintenance_requests_expense_id\" ON \"maintenance_requests\" (\"expense_id\");",
    "comment": "References expenses"
  },
  {
    "table": "maintenance_requests",
    "columns": [
      "house_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_maintenance_requests_house_id\" ON \"maintenance_requests\" (\"house_id\");",
    "comment": "References houses"
  },
  {
    "table": "maintenance_requests",
    "columns": [
      "property_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_maintenance_requests_property_id\" ON \"maintenance_requests\" (\"property_id\");",
    "comment": "References properties"
  },
  {
    "table": "maintenance_requests",
    "columns": [
      "tenant_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_maintenance_requests_tenant_id\" ON \"maintenance_requests\" (\"tenant_id\");",
    "comment": "References tenants"
  },
  {
    "table": "message_templates",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_message_templates_business_id\" ON \"message_templates\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "payment_message_receipts",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_payment_message_receipts_business_id\" ON \"payment_message_receipts\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "payment_message_receipts",
    "columns": [
      "payment_message_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_payment_message_receipts_payment_message_id\" ON \"payment_message_receipts\" (\"payment_message_id\");",
    "comment": "References payment_messages"
  },
  {
    "table": "payment_message_receipts",
    "columns": [
      "receipt_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_payment_message_receipts_receipt_id\" ON \"payment_message_receipts\" (\"receipt_id\");",
    "comment": "References receipts"
  },
  {
    "table": "payment_messages",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_payment_messages_business_id\" ON \"payment_messages\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "promotions",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_promotions_business_id\" ON \"promotions\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "promotions",
    "columns": [
      "property_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_promotions_property_id\" ON \"promotions\" (\"property_id\");",
    "comment": "References properties"
  },
  {
    "table": "promotions",
    "columns": [
      "tenant_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_promotions_tenant_id\" ON \"promotions\" (\"tenant_id\");",
    "comment": "References tenants"
  },
  {
    "table": "properties",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_properties_business_id\" ON \"properties\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "receipt_refunds",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_receipt_refunds_business_id\" ON \"receipt_refunds\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "receipt_refunds",
    "columns": [
      "receipt_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_receipt_refunds_receipt_id\" ON \"receipt_refunds\" (\"receipt_id\");",
    "comment": "References receipts"
  },
  {
    "table": "receipts",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_receipts_business_id\" ON \"receipts\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "receipts",
    "columns": [
      "contract_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_receipts_contract_id\" ON \"receipts\" (\"contract_id\");",
    "comment": "References contracts"
  },
  {
    "table": "receipts",
    "columns": [
      "promotion_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_receipts_promotion_id\" ON \"receipts\" (\"promotion_id\");",
    "comment": "References promotions"
  },
  {
    "table": "receipts",
    "columns": [
      "tenant_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_receipts_tenant_id\" ON \"receipts\" (\"tenant_id\");",
    "comment": "References tenants"
  },
  {
    "table": "reminder_logs",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_reminder_logs_business_id\" ON \"reminder_logs\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "reminder_logs",
    "columns": [
      "contract_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_reminder_logs_contract_id\" ON \"reminder_logs\" (\"contract_id\");",
    "comment": "References contracts"
  },
  {
    "table": "reminder_logs",
    "columns": [
      "tenant_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_reminder_logs_tenant_id\" ON \"reminder_logs\" (\"tenant_id\");",
    "comment": "References tenants"
  },
  {
    "table": "schedules",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_schedules_business_id\" ON \"schedules\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "settings",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_settings_business_id\" ON \"settings\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "tenants",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_tenants_business_id\" ON \"tenants\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "tokens",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_tokens_business_id\" ON \"tokens\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "transactions",
    "columns": [
      "business_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_transactions_business_id\" ON \"transactions\" (\"business_id\");",
    "comment": "References businesses"
  },
  {
    "table": "transactions",
    "columns": [
      "contract_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_transactions_contract_id\" ON \"transactions\" (\"contract_id\");",
    "comment": "References contracts"
  },
  {
    "table": "transactions",
    "columns": [
      "tenant_id"
    ],
    "isOneToOne": false,
    "sql": "CREATE INDEX IF NOT EXISTS \"idx_transactions_tenant_id\" ON \"transactions\" (\"tenant_id\");",
    "comment": "References tenants"
  }
] as const;

/**
 * Applies all schema foreign-key indexes into SQLite to ensure 0ms local reads.
 * Executes each index creation safely, catching missing tables during early initialization.
 */
export async function ensureSchemaForeignIndexes(db: {
  execute: (query: string) => Promise<any>;
}): Promise<void> {
  for (const index of SCHEMA_INDEXES) {
    try {
      await db.execute(index.sql);
    } catch {
      // Ignore if table does not exist yet on fresh install
    }
  }
}
