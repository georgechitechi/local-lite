export type IntegrityIssue = {
  id: string;
  title: string;
  description: string;
  category: 'Relationship' | 'Status' | 'Financial' | 'Logical' | 'Quality';
  severity: 'critical' | 'warning' | 'info';
  items: any[];
  onAction?: (item: any) => void;
  actionLabel?: string;
};

export interface IntegrityScanData {
  allTenants: any[];
  allContracts: any[];
  allHouses: any[];
  allReceipts: any[];
  allProperties: any[];
  allExpenses: any[];
  allPaymentMessages: any[];
  allPaymentMessageReceipts: any[];
  allBookings: any[];
  allMaintenance: any[];
  allPromos: any[];
}

export interface IntegrityRule {
  id: string;
  evaluate(data: IntegrityScanData, helpers: any): IntegrityIssue | null;
}
