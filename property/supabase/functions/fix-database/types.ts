export interface Anomaly {
  id: string;
  name?: string;
  issue?: string;
  type?: string;
}

export interface Fix {
  type: string;
  id: string;
  action: string;
}

export interface AnomaliesList {
  tenantsWithoutContracts: Anomaly[];
  paidTenantsWithoutStatus: Anomaly[];
  houseStatusMismatches: Anomaly[];
  overlappingContracts: Anomaly[];
  invalidContractDates: Anomaly[];
  missingMaintDates: Anomaly[];
  invalidPromoDates: Anomaly[];
  duplicateHouses: Anomaly[];
  formerFutureContracts: Anomaly[];
  unconvertedBookings: Anomaly[];
  orphanedHouses: Anomaly[];
  orphanedReceipts: Anomaly[];
  brokenMaintenance: Anomaly[];
  brokenContracts: Anomaly[];
  orphanedPromos: Anomaly[];
  orphanedBookings: Anomaly[];
  duplicateDetection: Anomaly[];
  receiptDateMismatches: Anomaly[];
  invalidRent: Anomaly[];
  invalidReceipts: Anomaly[];
  invalidExpenses: Anomaly[];
  overRefundedReceipts: Anomaly[];
  duplicateTenants: Anomaly[];
  missingHouseNumbers: Anomaly[];
  uncontactableTenants: Anomaly[];
  emptyProperties: Anomaly[];
}

export interface DBData {
  tenants: any[];
  houses: any[];
  contracts: any[];
  receipts: any[];
  properties: any[];
  expenses: any[];
  paymentMessages: any[];
  bookings: any[];
  maintenanceReqs: any[];
  promotionList: any[];
}
