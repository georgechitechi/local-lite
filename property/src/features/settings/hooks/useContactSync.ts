import { useState } from 'react';
import { Linking } from 'react-native';
import {
  directSyncContacts,
  type SyncProgressData,
} from '@/shared/services/contactsSync';
import { sendNotification } from '@/shared/services/notifications';
import type { Contract, House, Property, Tenant } from '@/shared/types/types';
import { formatDateForDB } from '@/shared/utils/formatters';
import { isActiveTenantStatus } from '@/shared/utils/statusHelper';
import { exportAndDownloadTenantsVCF } from '@/shared/utils/vcfExport';

export interface ExportResult {
  success: boolean;
  message?: string;
}

interface UseContactSyncProps {
  selectedBusiness: any;
  tenants: Tenant[];
  contracts: Contract[];
  houses: House[];
  properties: Property[];
  pauseAutoLock: () => void;
  resumeAutoLock: () => void;
  setSaving: (saving: boolean) => void;
  showSnackbar: (msg: string, type?: 'info' | 'error' | 'success' | 'warning') => void;
}

export function useContactSync({
  selectedBusiness,
  tenants,
  contracts,
  houses,
  properties,
  pauseAutoLock,
  resumeAutoLock,
  setSaving,
  showSnackbar,
}: UseContactSyncProps) {
  const [contactOptionsModalVisible, setContactOptionsModalVisible] = useState(false);
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [exclusionModalVisible, setExclusionModalVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [permissionModalVisible, setPermissionModalVisible] = useState(false);

  const [syncCancelled, setSyncCancelled] = useState(false);
  const [syncCompleted, setSyncCompleted] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgressData>({
    currentStep: 0,
    totalSteps: 0,
    currentTenant: '',
    stats: { created: 0, updated: 0, replaced: 0, duplicates: 0, errors: 0 },
    progress: 0,
  });

  const [syncTenants, setSyncTenants] = useState<Tenant[]>([]);
  const [syncSearchQuery, setSyncSearchQuery] = useState('');
  const [excludedTenantIds, setExcludedTenantIds] = useState<string[]>([]);
  const [contactActionType, setContactActionType] = useState<'sync' | 'export' | null>(
    null,
  );
  const [permissionModalData, setPermissionModalData] = useState<{
    message: string;
    permanentlyDenied: boolean;
  } | null>(null);

  const handlePrepareContactSelection = (action: 'sync' | 'export') => {
    if (!selectedBusiness?.id) {
      showSnackbar('Please select a business first', 'error');
      return;
    }

    try {
      setContactActionType(action);
      const filteredTenants = tenants
        .filter(t => isActiveTenantStatus(t.status))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      if (!filteredTenants || filteredTenants.length === 0) {
        showSnackbar('No active tenants found.', 'info');
        return;
      }

      setSyncTenants(filteredTenants);
      setSyncSearchQuery('');
      const autoExcluded = filteredTenants
        .filter(
          t =>
            t.name?.toLowerCase().includes('self') ||
            t.name?.toLowerCase().includes('admin'),
        )
        .map(t => t.id);
      setExcludedTenantIds(autoExcluded);
      setExclusionModalVisible(true);
    } catch (error: any) {
      console.error('Error preparing tenant selection:', error);
      showSnackbar('Failed to prepare tenant selection.', 'error');
    }
  };

  const handleExportContacts = () => handlePrepareContactSelection('export');
  const handleDirectSyncContacts = () => handlePrepareContactSelection('sync');

  const handleConfirmExport = async () => {
    if (!selectedBusiness?.id) return;
    try {
      setSaving(true);
      pauseAutoLock();
      setExclusionModalVisible(false);

      const tenantsToExport = tenants
        .filter(t => isActiveTenantStatus(t.status))
        .map(t => ({
          ...t,
          contracts: contracts
            .filter(c => c.tenant_id === t.id)
            .map(c => ({
              ...c,
              house: houses.find(h => h.id === c.house_id)
                ? {
                    ...(houses.find(h => h.id === c.house_id) as any),
                    property: properties.find(
                      p => p.id === houses.find(h => h.id === c.house_id)?.property_id,
                    ),
                  }
                : undefined,
            })),
        }));

      const filename = `${selectedBusiness.name.replace(/[^a-zA-Z0-9]/g, '_')}_tenant_contacts_${formatDateForDB(new Date())}.vcf`;
      const result = await exportAndDownloadTenantsVCF(
        tenantsToExport as any,
        selectedBusiness.name,
        filename,
        excludedTenantIds,
      );

      setExportResult(result);
      setExportModalVisible(true);
    } catch (error: any) {
      console.error('Error exporting contacts:', error);
      setExportResult({
        success: false,
        message: error.message || 'Failed to export contacts. Please try again.',
      });
      setExportModalVisible(true);
    } finally {
      setSaving(false);
      resumeAutoLock();
    }
  };

  const openDeviceSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (error) {
      console.error('Error opening settings:', error);
      showSnackbar('Please enable Contacts permission in your device settings.', 'error');
    }
  };

  const handleCancelSync = () => {
    setSyncCancelled(true);
    setSyncModalVisible(false);
  };

  const handleConfirmSync = async () => {
    if (!selectedBusiness?.id) return;
    try {
      setSaving(true);
      pauseAutoLock();

      setSyncCancelled(false);
      setSyncCompleted(false);
      setSyncProgress({
        currentStep: 0,
        totalSteps: 0,
        currentTenant: '',
        stats: {
          created: 0,
          updated: 0,
          replaced: 0,
          duplicates: 0,
          errors: 0,
        },
        progress: 0,
      });

      setSyncModalVisible(true);

      const result = await directSyncContacts(
        syncTenants as any,
        selectedBusiness.name,
        (progressData: SyncProgressData) => {
          if (!syncCancelled) {
            setSyncProgress(progressData);
          }
        },
        () => syncCancelled,
        excludedTenantIds,
        pauseAutoLock,
        resumeAutoLock,
      );

      if (syncCancelled) {
        setSyncModalVisible(false);
        showSnackbar('Contact sync was cancelled by user.', 'info');
        return;
      }

      if (result.success) {
        setSyncCompleted(true);
        sendNotification(
          'Sync Completed',
          'Contact synchronization has finished successfully.',
          { type: 'system_sync' },
        );
      } else {
        setSyncModalVisible(false);

        if (result.permissionDenied) {
          setPermissionModalData({
            message: result.message || 'Contacts permission is required.',
            permanentlyDenied: !!result.permanentlyDenied,
          });
          setPermissionModalVisible(true);
        } else {
          showSnackbar(
            result.message || 'Failed to sync contacts directly. Please try again.',
            'error',
          );
        }
      }
    } catch (error: any) {
      console.error('Error in direct sync:', error);
      setSyncModalVisible(false);
      showSnackbar(
        error.message || 'Failed to sync contacts directly. Please try again.',
        'error',
      );
    } finally {
      setSaving(false);
      resumeAutoLock();
    }
  };

  return {
    contactOptionsModalVisible,
    setContactOptionsModalVisible,
    syncModalVisible,
    setSyncModalVisible,
    exclusionModalVisible,
    setExclusionModalVisible,
    exportModalVisible,
    setExportModalVisible,
    permissionModalVisible,
    setPermissionModalVisible,
    syncCompleted,
    setSyncCompleted,
    exportResult,
    setExportResult,
    syncProgress,
    syncTenants,
    syncSearchQuery,
    setSyncSearchQuery,
    excludedTenantIds,
    setExcludedTenantIds,
    contactActionType,
    permissionModalData,
    handleExportContacts,
    handleDirectSyncContacts,
    handleConfirmExport,
    handleConfirmSync,
    handleCancelSync,
    openDeviceSettings,
  };
}
