// @ts-nocheck
import type React from 'react';
import { PendingRentModal } from '@/features/dashboard/components/PendingRentModal';
import { GenericReportModal } from '@/features/reports/components/GenericReportModal';
import SelectTenantModal from '@/features/tenants/components/SelectTenantModal';
import { TenantLedgerModal } from '@/features/tenants/components/TenantLedgerModal';

interface ReportModalSwitchProps {
  activeModal: string | null;
  onDismiss: () => void;
  reportParams: Record<string, any>;
  updateParam: (reportId: string, updates: Record<string, any>) => void;
  onGenerate: (
    type: string,
    format: string,
    dateOverride?: Date,
    extraOptions?: any,
  ) => void;
  exportLoading: boolean;
  storeData: {
    properties: any[];
    tenants: any[];
    contracts: any[];
    houses: any[];
  };
  pendingExport: {
    type: string;
    format: string;
    orientation?: 'portrait' | 'landscape';
    extra?: any;
  } | null;
}

const ReportModalContent: React.FC<ReportModalSwitchProps> = ({
  activeModal,
  onDismiss,
  reportParams,
  updateParam,
  onGenerate,
  exportLoading,
  storeData,
  pendingExport,
}) => {
  if (!activeModal) return null;
  const currentFormat = pendingExport?.format || 'pdf';
  const currentOrientation = pendingExport?.orientation || 'portrait';

  // Handle specific modals first
  if (activeModal === 'pending_rent') {
    return (
      <PendingRentModal
        visible={true}
        onDismiss={onDismiss}
        onGenerate={(date, opts) =>
          onGenerate('pending_rent', currentFormat, date, {
            ...opts,
            orientation: opts?.orientation || currentOrientation,
          })
        }
        exportLoading={exportLoading}
        reportDate={reportParams.pending_rent.reportDate}
        setReportDate={d => updateParam('pending_rent', { reportDate: d })}
        pendingRentGroupBy={reportParams.pending_rent.groupBy}
        setPendingRentGroupBy={v => updateParam('pending_rent', { groupBy: v })}
        pendingRentAllTime={reportParams.pending_rent.allTime}
        setPendingRentAllTime={v => updateParam('pending_rent', { allTime: v })}
        pendingRentIsYTD={reportParams.pending_rent.isYTD}
        setPendingRentIsYTD={v => updateParam('pending_rent', { isYTD: v })}
        initialOrientation={currentOrientation}
        isPdf={currentFormat === 'pdf'}
        zIndex={1000}
      />
    );
  }

  if (activeModal === 'tenant_ledger') {
    return (
      <TenantLedgerModal
        visible={true}
        onDismiss={onDismiss}
        onGenerate={opts =>
          onGenerate('tenant_ledger', currentFormat, undefined, {
            ...opts,
            orientation: opts?.orientation || currentOrientation,
          })
        }
        exportLoading={exportLoading}
        selectedTenant={reportParams.tenant_ledger.tenant}
        onSelectTenantPress={() => updateParam('ui', { showTenantSelector: true })}
        groupByStatus={reportParams.tenant_ledger.groupByStatus}
        setGroupByStatus={v => updateParam('tenant_ledger', { groupByStatus: v })}
        initialOrientation={currentOrientation}
        isPdf={currentFormat === 'pdf'}
        zIndex={1000}
      />
    );
  }

  // Generic configurations
  const configs: Record<string, any> = {
    financials: {
      title: 'Financial Statement Options',
      fields: [
        { type: 'date_range', key: 'period' },
        { type: 'property_select', key: 'propertyId', label: 'Filter by Building' },
        { type: 'checkbox', key: 'groupByMonth', label: 'Group by Month' },
      ],
    },
    business_summary: {
      title: 'Business Summary Options',
      fields: [{ type: 'date_range', key: 'period' }],
    },
    expenses_analysis: {
      title: 'Expense Analysis Options',
      fields: [
        { type: 'month_filter', key: 'date', label: 'Select Month' },
        { type: 'checkbox', key: 'showDetails', label: 'Show Transaction Details' },
      ],
    },
    tenants: {
      title: 'Tenant Report Options',
      fields: [
        {
          type: 'status_filter',
          key: 'status',
          label: 'Tenant Status',
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Former', value: 'former' },
            { label: 'All', value: 'all' },
          ],
        },
        {
          type: 'month_filter',
          key: 'moveOutMonth',
          label: 'Move-Out Month',
          showWhen: (p: Record<string, any>) => p.status === 'former',
        },
        { type: 'checkbox', key: 'groupByProperty', label: 'Group by Property' },
        { type: 'checkbox', key: 'missingEmail', label: 'Missing Email' },
        { type: 'checkbox', key: 'missingPhone', label: 'Missing Phone' },
      ],
    },

    houses: {
      title: 'Houses Report Options',
      fields: [
        { type: 'property_select', key: 'propertyId', label: 'Select Building' },
        {
          type: 'status_filter',
          key: 'status',
          label: 'House Status',
          options: [
            { label: 'All', value: 'all' },
            { label: 'Available', value: 'available' },
            { label: 'Occupied', value: 'occupied' },
          ],
        },
        { type: 'checkbox', key: 'groupByProperty', label: 'Group by Property' },
      ],
    },
    receipts: {
      title: 'Receipts Report Options',
      fields: [
        { type: 'property_select', key: 'propertyId', label: 'Select Building' },
        {
          type: 'text',
          key: 'monthsBack',
          label: 'Months to show',
          keyboardType: 'numeric',
        },
        {
          type: 'checkbox',
          key: 'includeFormerTenants',
          label: 'Include Former Tenants',
        },
      ],
    },
    contracts: {
      title: 'Contracts Report Options',
      fields: [
        {
          type: 'status_filter',
          key: 'status',
          label: 'Contract Status',
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Archived', value: 'archived' },
            { label: 'All', value: 'all' },
          ],
        },
        { type: 'checkbox', key: 'groupByProperty', label: 'Group by Property' },
      ],
    },
    stay_history: {
      title: 'Booking Report Options',
      fields: [
        {
          type: 'sorting',
          key: 'sort',
          options: [
            { label: 'Check-in', value: 'check_in' },
            { label: 'Guest', value: 'guest' },
            { label: 'Revenue', value: 'revenue' },
          ],
        },
        {
          type: 'status_filter',
          key: 'status',
          label: 'Booking Status',
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Former', value: 'former' },
            { label: 'All', value: 'all' },
          ],
        },
      ],
    },
    holidays: {
      title: 'Holiday Report Options',
      fields: [
        { type: 'month_filter', key: 'date', label: 'Filter Month' },
        {
          type: 'status_filter',
          key: 'status',
          label: 'Holiday Status',
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Past', value: 'past' },
            { label: 'All', value: 'all' },
          ],
        },
        {
          type: 'sorting',
          key: 'sort',
          options: [
            { label: 'Tenant', value: 'tenant' },
            { label: 'Property', value: 'property' },
            { label: 'Date', value: 'start_date' },
          ],
        },
      ],
    },
    promotions: {
      title: 'Promotions Report Options',
      fields: [
        { type: 'month_filter', key: 'date', label: 'Filter Month' },
        {
          type: 'status_filter',
          key: 'status',
          label: 'Promotion Status',
          options: [
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' },
            { label: 'All', value: 'all' },
          ],
        },
        {
          type: 'sorting',
          key: 'sort',
          options: [
            { label: 'Code', value: 'code' },
            { label: 'Type', value: 'type' },
            { label: 'Date', value: 'valid_from' },
          ],
        },
      ],
    },
    breaks_with_payments: {
      title: 'Breaks with Payments Options',
      fields: [
        { type: 'month_filter', key: 'date', label: 'Filter Month' },
        { type: 'checkbox', key: 'includePromo', label: 'Include Promo Receipts' },
      ],
    },
    maintenance: {
      title: 'Maintenance Report Options',
      fields: [
        { type: 'property_select', key: 'propertyId', label: 'Filter by Building' },
        {
          type: 'status_filter',
          key: 'maintenanceStatus',
          label: 'Status',
          options: [
            { label: 'All', value: 'all' },
            { label: 'Pending', value: 'pending' },
            { label: 'In Progress', value: 'in_progress' },
            { label: 'Completed', value: 'completed' },
            { label: 'Cancelled', value: 'cancelled' },
          ],
        },
        {
          type: 'status_filter',
          key: 'maintenancePriority',
          label: 'Priority',
          options: [
            { label: 'All', value: 'all' },
            { label: 'Low', value: 'low' },
            { label: 'Medium', value: 'medium' },
            { label: 'High', value: 'high' },
            { label: 'Urgent', value: 'urgent' },
          ],
        },
        { type: 'checkbox', key: 'groupByProperty', label: 'Group by Property' },
      ],
    },
    vacant_rooms: {
      title: 'Vacant Rooms Report Options',
      fields: [
        { type: 'property_select', key: 'propertyId', label: 'Filter by Building' },
        { type: 'checkbox', key: 'groupByProperty', label: 'Group by Property' },
      ],
    },
    rent_collection: {
      title: 'Rent Collection Report Options',
      fields: [
        { type: 'date_range', key: 'period' },
        { type: 'property_select', key: 'propertyId', label: 'Filter by Building' },
      ],
    },
    occupancy_rate: {
      title: 'Occupancy Rate Report Options',
      fields: [
        { type: 'date_range', key: 'period' },
        { type: 'property_select', key: 'propertyId', label: 'Filter by Building' },
        { type: 'checkbox', key: 'groupByMonth', label: 'Group by Month' },
      ],
    },
    expiring_contracts: {
      title: 'Expiring Contracts Options',
      fields: [
        {
          type: 'text',
          key: 'daysAhead',
          label: 'Days Ahead (e.g. 30, 60, 90)',
          keyboardType: 'numeric',
        },
        { type: 'property_select', key: 'propertyId', label: 'Filter by Building' },
        { type: 'checkbox', key: 'groupByProperty', label: 'Group by Property' },
      ],
    },
    refunds: {
      title: 'Refunds Report Options',
      fields: [
        { type: 'property_select', key: 'propertyId', label: 'Filter by Building' },
        {
          type: 'checkbox',
          key: 'includeFormerTenants',
          label: 'Include Former Tenants',
        },
      ],
    },
  };

  const config = configs[activeModal];
  if (!config) return null;

  const fields = [...config.fields];
  if (currentFormat === 'pdf') {
    const orientationField = {
      type: 'status_filter' as const,
      key: 'orientation',
      label: 'Page Orientation',
      options: [
        { label: 'Portrait', value: 'portrait' },
        { label: 'Landscape', value: 'landscape' },
      ],
    };
    const groupIdx = fields.findIndex(
      f =>
        f.key.toLowerCase().includes('group') || f.label?.toLowerCase().includes('group'),
    );
    if (groupIdx !== -1) {
      fields.splice(groupIdx, 0, orientationField);
    } else {
      fields.push(orientationField);
    }
  }

  return (
    <GenericReportModal
      visible={true}
      onDismiss={onDismiss}
      onGenerate={opts =>
        onGenerate(activeModal, currentFormat, undefined, {
          orientation: 'portrait',
          ...opts,
          configured: true,
          period: {
            start: reportParams[activeModal].startDate,
            end: reportParams[activeModal].endDate,
          },
        })
      }
      title={config.title}
      exportLoading={exportLoading}
      fields={fields}
      params={reportParams[activeModal]}
      updateParam={updates => updateParam(activeModal, updates)}
      properties={storeData.properties}
      zIndex={1000}
    />
  );
};

export const ReportModalSwitch: React.FC<ReportModalSwitchProps> = props => {
  const { reportParams, updateParam, storeData } = props;

  return (
    <>
      <ReportModalContent {...props} />

      {!!reportParams.ui?.showTenantSelector && (
        <SelectTenantModal
          visible={true}
          onDismiss={() => updateParam('ui', { showTenantSelector: false })}
          onSelect={tenant => {
            if (!Array.isArray(tenant)) {
              updateParam('tenant_ledger', { tenant });
              updateParam('ui', { showTenantSelector: false });
            }
          }}
          tenants={storeData.tenants}
          contracts={storeData.contracts}
          houses={storeData.houses}
          properties={storeData.properties}
          title="Select Tenant for Ledger"
          showAllTenants={true}
          zIndex={3000}
        />
      )}
    </>
  );
};
