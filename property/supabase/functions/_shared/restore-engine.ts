// @ts-nocheck
import {
  applyUserMapping,
  createUserMapping,
  deleteBusinessById,
  filterDataByBusinesses,
  getTableColumns,
  getTablesToRestore,
  orderTablesForRestore,
  setMaintenanceMode,
} from './index.ts';

export interface RestoreOptions {
  supabase: any;
  sendProgress: (
    status: string,
    table?: string,
    percentage?: number,
    extra?: any,
  ) => Promise<void>;
  userIdForMapping?: string;
  isInternal?: boolean;
}

export interface RestoreResult {
  success: boolean;
  totalRecordsRestored: number;
  results: any[];
  failedTables: number;
  duration: number;
  businessesRestored: number;
  businessNames: string[];
}

/**
 * Modern Restore Engine for high-performance data restoration
 */
export class RestoreEngine {
  private supabase: any;
  private sendProgress: any;
  private userIdForMapping: string | null;
  private isInternal: boolean;
  private startTime: number;

  constructor(options: RestoreOptions) {
    this.supabase = options.supabase;
    this.sendProgress = options.sendProgress;
    this.userIdForMapping = options.userIdForMapping || null;
    this.isInternal = options.isInternal || false;
    this.startTime = Date.now();
  }

  /**
   * Execute the restoration process
   */
  async execute(backup: any): Promise<RestoreResult> {
    console.log('🏁 Starting restoration process...');
    let maintenanceEnabled = false;

    try {
      // 1. Validate and Filter Businesses
      const businesses = backup.data.businesses || [];
      if (businesses.length === 0) throw new Error('No businesses found in backup');

      const userBusinesses = businesses.filter(b => !b.is_system);
      const businessIds = userBusinesses.map(b => b.id);
      const businessNames = userBusinesses.map(b => b.name);

      // 2. Prepare User Mapping
      const userMapping = this.prepareUserMapping(backup.data, userBusinesses);

      // 3. Enable Maintenance Mode
      await setMaintenanceMode(this.supabase, true);
      maintenanceEnabled = true;

      // 4. Clear Existing Data
      await this.sendProgress('Clearing existing data...', 'businesses', 0.1);
      for (const b of userBusinesses) {
        if (!this.isInternal && this.userIdForMapping) {
          const { data: existingBusiness } = await this.supabase
            .from('businesses')
            .select('user_id')
            .eq('id', b.id)
            .maybeSingle();

          if (existingBusiness && existingBusiness.user_id !== this.userIdForMapping) {
            throw new Error(
              `Unauthorized: Cannot overwrite business belonging to another user. Check your backup file.`,
            );
          }
        }
        await deleteBusinessById(this.supabase, b.id, b.name);
      }

      // 5. Restore Tables in Order
      // Use getTablesToRestore to respect EXCLUDED_TABLES (like profiles)
      const validTables = getTablesToRestore(backup.data);
      const tablesToRestore = orderTablesForRestore(validTables, backup.data);

      const restoreResults = [];
      let totalRecordsRestored = 0;

      for (let i = 0; i < tablesToRestore.length; i++) {
        const table = tablesToRestore[i];

        let tableData = [];
        if (table === 'businesses') {
          tableData = userBusinesses;
        } else {
          tableData = filterDataByBusinesses(
            backup.data[table] || [],
            businessIds,
            table,
          );
        }

        if (tableData.length === 0) continue;

        const progress = 0.2 + (i / tablesToRestore.length) * 0.75;
        await this.sendProgress(`Restoring ${table}...`, table, progress);

        const result = await this.restoreTable(table, tableData, userMapping);
        restoreResults.push(result);
        if (result.success) totalRecordsRestored += result.count;
        else if (table === 'businesses') {
          throw new Error(`Critical failure restoring businesses: ${result.error}`);
        }
      }

      const duration = Math.round((Date.now() - this.startTime) / 1000);
      return {
        success: true,
        totalRecordsRestored,
        results: restoreResults,
        failedTables: restoreResults.filter(r => !r.success).length,
        duration,
        businessesRestored: userBusinesses.length,
        businessNames: businessNames,
      };
    } finally {
      if (maintenanceEnabled) {
        await setMaintenanceMode(this.supabase, false);
      }
    }
  }

  /**
   * Restore a single table using the high-performance RPC
   */
  private async restoreTable(table: string, data: any[], userMapping: any): Promise<any> {
    try {
      const columnNames = await getTableColumns(this.supabase, table);
      const mappedData = data.map(item =>
        applyUserMapping(item, userMapping, columnNames, table),
      );

      // Batch the data if it's too large for a single JSONB param (approx 50MB limit is safe)
      const batchSize = 2000;
      let totalInserted = 0;

      for (let i = 0; i < mappedData.length; i += batchSize) {
        const batch = mappedData.slice(i, i + batchSize);

        // Use the new bulk_restore_data RPC
        // We stringify the batch to ensure it's sent as a single JSONB object (array)
        // rather than a Postgres array (jsonb[])
        const { data: rpcResult, error: rpcError } = await this.supabase.rpc(
          'bulk_restore_data',
          {
            p_table_name: table,
            p_data: JSON.stringify(batch),
          },
        );

        if (rpcError) throw rpcError;
        if (!rpcResult?.success) {
          throw new Error(
            rpcResult?.error || 'Bulk restore returned unsuccessful status',
          );
        }

        totalInserted += rpcResult.count || batch.length;
      }

      return { table, count: totalInserted, success: true };
    } catch (err: any) {
      const errMsg =
        err?.message ||
        (typeof err === 'string' ? err : JSON.stringify(err)) ||
        'Unknown error';
      console.error(`❌ Error restoring ${table}:`, errMsg);
      return { table, count: 0, success: false, error: errMsg };
    }
  }

  /**
   * Collect all unique user IDs and create a mapping
   */
  private prepareUserMapping(data: any, businesses: any[]): any {
    const uniqueUserIds = new Set<string>();
    businesses.forEach(b => {
      if (b.user_id) uniqueUserIds.add(b.user_id);
    });

    // Sample other tables for user IDs
    const tablesToSample = ['properties', 'bookings', 'contracts', 'receipts'];
    tablesToSample.forEach(table => {
      if (Array.isArray(data[table])) {
        data[table].slice(0, 500).forEach(item => {
          if (item.user_id) uniqueUserIds.add(item.user_id);
          if (item.created_by) uniqueUserIds.add(item.created_by);
        });
      }
    });

    return createUserMapping(
      uniqueUserIds,
      this.userIdForMapping || 'unknown',
      'mapped_admin',
    );
  }
}
