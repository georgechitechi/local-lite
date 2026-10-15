/**
 * Table and data utilities for edge functions
 */

import { EXCLUDED_COLUMNS, EXCLUDED_TABLES, TABLE_RESTORE_ORDER } from './constants.ts';

/**
 * Filter out excluded columns from a record or array of records
 */
export function filterExcludedColumns(data: any): any {
  if (!data) return data;

  const filterRecord = (record: any) => {
    const newRecord = { ...record };
    EXCLUDED_COLUMNS.forEach(col => {
      delete newRecord[col];
    });
    return newRecord;
  };

  if (Array.isArray(data)) {
    return data.map(filterRecord);
  }

  return filterRecord(data);
}

/**
 * Get list of tables to restore from backup data
 */
export function getTablesToRestore(backupData: Record<string, any[]>): string[] {
  const allTables = Object.keys(backupData).filter(
    table => backupData[table] && Array.isArray(backupData[table]),
  );

  return allTables.filter(table => !EXCLUDED_TABLES.includes(table));
}

/**
 * Order tables by dependency for safe restoration
 */
export function orderTablesForRestore(
  tablesToRestore: string[],
  backupData: Record<string, any[]>,
): string[] {
  // Tables in known order that have data
  const orderedTables = TABLE_RESTORE_ORDER.filter(
    table => tablesToRestore.includes(table) && backupData[table]?.length > 0,
  );

  // Remaining tables not in known order
  const remainingTables = tablesToRestore.filter(
    table => !TABLE_RESTORE_ORDER.includes(table) && backupData[table]?.length > 0,
  );

  return [...orderedTables, ...remainingTables];
}

/**
 * Filter data by business IDs
 */
export function filterDataByBusinesses(
  data: any[],
  businessIds: string[],
  tableName: string,
): any[] {
  if (tableName === 'businesses') {
    return data.filter(item => businessIds.includes(item.id));
  }

  // If the table has a business_id column, filter by it
  if (
    data.length > 0 &&
    ('business_id' in data[0] || Object.hasOwn(data[0], 'business_id'))
  ) {
    return data.filter(item => businessIds.includes(item.business_id));
  }

  // For tables without business_id (e.g. totp_secrets, profiles), keep all data
  // as they are usually global or mapped via other means.
  return data;
}

/**
 * Filter out system businesses from backup data
 */
export function filterSystemBusinesses(businesses: any[]): any[] {
  return businesses.filter(
    business => !business.is_system || business.is_system === false,
  );
}

/**
 * Apply user mapping to a record
 */
export function applyUserMapping(
  record: any,
  userMapping: Record<string, string>,
  columnNames: string[],
  tableName: string,
): any {
  const transformedRecord = { ...record };

  // Map user_id if the column exists (except for profiles)
  if (columnNames.includes('user_id') && record.user_id && tableName !== 'profiles') {
    transformedRecord.user_id =
      userMapping[record.user_id] || userMapping.__default__ || record.user_id;
  }

  // Map other potential user-reference columns
  const userColumns = ['refunded_by', 'reviewed_by', 'created_by', 'updated_by'];
  for (const col of userColumns) {
    if (columnNames.includes(col) && record[col]) {
      transformedRecord[col] =
        userMapping[record[col]] || userMapping.__default__ || record[col];
    }
  }

  return transformedRecord;
}

/**
 * Get table column names
 */
export async function getTableColumns(
  supabase: any,
  tableName: string,
): Promise<string[]> {
  const { data: tableColumns, error: columnsError } = await supabase.rpc(
    'get_table_columns',
    {
      table_name: tableName,
    },
  );

  if (columnsError) {
    console.warn(`⚠️ Could not get columns for ${tableName}:`, columnsError.message);
    return [];
  }

  return tableColumns.map((col: any) => col.column_name);
}
