export type ReportType =
  | 'business_summary'
  | 'houses'
  | 'tenants'
  | 'contracts'
  | 'receipts'
  | 'expenses'
  | 'expenses_analysis'
  | 'pending_rent'
  | 'vacant_rooms'
  | 'financials'
  | 'tenant_ledger'
  | 'stay_history'
  | 'holidays'
  | 'promotions'
  | 'breaks_with_payments'
  | 'maintenance'
  | 'rent_collection'
  | 'occupancy_rate'
  | 'expiring_contracts'
  | 'refunds';

export interface ReportData {
  data: Record<string, unknown>[];
  headers: string[];
  filename: string;
}
