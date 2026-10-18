import { ScrollView, StyleSheet } from 'react-native';
import { useTheme } from 'react-native-paper';
import { ReportCard } from '@/features/reports/components/ReportCard';
import { ReportModalSwitch } from '@/features/reports/components/ReportModalSwitch';
import AccessGuard from '@/shared/components/AccessGuard';
import { useReports } from '@/shared/hooks/useReports';

interface ReportType {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  pdfOnly?: boolean;
  adminOnly?: boolean;
}

const REPORT_TYPES: ReportType[] = [
  {
    id: 'business_summary',
    title: 'Business Overview',
    description: 'Comprehensive property & tenant statistics',
    icon: 'office-building',
    color: '#2196F3',
    pdfOnly: true,
    adminOnly: true,
  },
  {
    id: 'houses',
    title: 'Houses Report',
    description: 'List of all units and their status',
    icon: 'home-city',
    color: '#9C27B0',
  },
  {
    id: 'financials',
    title: 'Financial Statement',
    description: 'Revenue vs Expenses over a period',
    icon: 'finance',
    color: '#4CAF50',
    pdfOnly: true,
    adminOnly: true,
  },
  {
    id: 'expenses_analysis',
    title: 'Expense Analysis',
    description: 'Detailed category breakdown & trends',
    icon: 'chart-arc',
    color: '#FF5722',
    pdfOnly: true,
  },
  {
    id: 'pending_rent',
    title: 'Pending Rent',
    description: 'Unpaid rent for a specific period',
    icon: 'cash-clock',
    color: '#FF9800',
  },
  {
    id: 'tenants',
    title: 'Tenant Report',
    description: 'List of all tenants and their status',
    icon: 'account-group',
    color: '#E91E63',
  },
  {
    id: 'contracts',
    title: 'Contracts Report',
    description: 'List of all contracts',
    icon: 'file-document-outline',
    color: '#607D8B',
  },
  {
    id: 'receipts',
    title: 'Receipts Report',
    description: 'List of all receipts',
    icon: 'receipt',
    color: '#00BCD4',
    adminOnly: true,
  },
  {
    id: 'tenant_ledger',
    title: 'Tenant Ledger',
    description: 'Detailed statement for a specific tenant',
    icon: 'account-details',
    color: '#795548',
  },
  {
    id: 'stay_history',
    title: 'Stay History',
    description: 'Historical records of guest stays',
    icon: 'history',
    color: '#673AB7',
  },
  {
    id: 'holidays',
    title: 'Holiday Breaks',
    description: 'Rent waivers and partial breaks',
    icon: 'palm-tree',
    color: '#FF5722',
  },
  {
    id: 'promotions',
    title: 'Promotions Scan',
    description: 'Usage and impact of promo codes',
    icon: 'tag-multiple',
    color: '#009688',
  },
  {
    id: 'breaks_with_payments',
    title: 'Breaks with Payments',
    description: 'Tenants on break who made payments',
    icon: 'cash-check',
    color: '#FFC107',
  },
  {
    id: 'vacant_rooms',
    title: 'Vacant Rooms',
    description: 'Available units with time since last tenant',
    icon: 'home-lock-open',
    color: '#9E9E9E',
  },
  {
    id: 'rent_collection',
    title: 'Rent Collection',
    description: 'Expected vs collected rent by property',
    icon: 'cash-multiple',
    color: '#00ACC1',
    adminOnly: true,
  },
  {
    id: 'occupancy_rate',
    title: 'Occupancy Rate',
    description: 'Unit occupancy % by property or period',
    icon: 'chart-bar',
    color: '#3F51B5',
    adminOnly: true,
  },
  {
    id: 'expiring_contracts',
    title: 'Expiring Contracts',
    description: 'Contracts expiring within N days',
    icon: 'file-clock',
    color: '#FF9800',
  },
  {
    id: 'refunds',
    title: 'Refunds Report',
    description: 'All refunded payments with amounts',
    icon: 'cash-refund',
    color: '#E91E63',
  },
];

export default function ReportsScreen() {
  const theme = useTheme();
  const {
    handleExport,
    exportLoading,
    selectedReport,
    setSelectedReport,
    showFormatMenu,
    setShowFormatMenu,
    activeModal,
    setActiveModal,
    reportParams,
    updateParam,
    isAdmin,
    // Store data
    storeProperties,
    storeTenants,
    storeContracts,
    storeHouses,
    pendingExport,
  } = useReports();

  const handleDownloadPress = (reportId: string) => {
    setSelectedReport(reportId);
    setShowFormatMenu(true);
  };

  const handleExportAction = (reportId: string, format: 'pdf' | 'csv') => {
    handleExport(reportId, format);
  };

  return (
    <AccessGuard roles={['admin', 'staff']}>
      <ScrollView
        style={[styles.container, { backgroundColor: theme.colors.background }]}
        contentContainerStyle={styles.content}
      >
        {REPORT_TYPES.filter(r => !r.adminOnly || isAdmin).map(report => (
          <ReportCard
            key={report.id}
            report={report}
            onDownloadPress={handleDownloadPress}
            showFormatMenu={showFormatMenu && selectedReport === report.id}
            onDismissMenu={() => setShowFormatMenu(false)}
            onExportPress={handleExportAction}
            exportLoading={exportLoading}
          />
        ))}
      </ScrollView>

      {/* Modals */}
      <ReportModalSwitch
        activeModal={activeModal}
        onDismiss={() => setActiveModal(null)}
        reportParams={reportParams}
        updateParam={updateParam}
        onGenerate={handleExport}
        exportLoading={exportLoading}
        storeData={{
          properties: storeProperties,
          tenants: storeTenants,
          contracts: storeContracts,
          houses: storeHouses,
        }}
        pendingExport={pendingExport}
      />
    </AccessGuard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 12,
  },
});
