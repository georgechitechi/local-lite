import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type React from 'react';
import { View } from 'react-native';
import { Card, Checkbox, List, ProgressBar, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import type { SyncProgressData } from '@/shared/services/contactsSync';
import type { Tenant } from '@/shared/types/types';
import type { ExportResult } from '../hooks/useContactSync';

export interface ContactSyncModalsProps {
  contactOptionsModalVisible: boolean;
  setContactOptionsModalVisible: (visible: boolean) => void;
  syncModalVisible: boolean;
  setSyncModalVisible: (visible: boolean) => void;
  exclusionModalVisible: boolean;
  setExclusionModalVisible: (visible: boolean) => void;
  exportModalVisible: boolean;
  setExportModalVisible: (visible: boolean) => void;
  permissionModalVisible: boolean;
  setPermissionModalVisible: (visible: boolean) => void;
  syncCompleted: boolean;
  setSyncCompleted: (completed: boolean) => void;
  exportResult: ExportResult | null;
  setExportResult: (result: ExportResult | null) => void;
  syncProgress: SyncProgressData;
  syncTenants: Tenant[];
  syncSearchQuery: string;
  setSyncSearchQuery: (query: string) => void;
  excludedTenantIds: string[];
  setExcludedTenantIds: React.Dispatch<React.SetStateAction<string[]>>;
  contactActionType: 'sync' | 'export' | null;
  permissionModalData: { message: string; permanentlyDenied: boolean } | null;
  handleExportContacts: () => void;
  handleDirectSyncContacts: () => void;
  handleConfirmExport: () => void;
  handleConfirmSync: () => void;
  handleCancelSync: () => void;
  openDeviceSettings: () => void;
  colors: any;
}

export default function ContactSyncModals({
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
  colors,
}: ContactSyncModalsProps) {
  return (
    <>
      {/* Contact Options Selection Modal */}
      <BaseModal
        visible={contactOptionsModalVisible}
        onDismiss={() => setContactOptionsModalVisible(false)}
        title="Manage Contacts"
        subtitle="Choose how you want to manage tenant contacts"
      >
        <View style={{ gap: 12 }}>
          <Card
            mode="outlined"
            onPress={() => {
              setContactOptionsModalVisible(false);
              setTimeout(() => handleExportContacts(), 100);
            }}
            style={{ borderColor: colors.outline }}
          >
            <Card.Content style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialCommunityIcons
                name="export"
                size={24}
                color={colors.primary}
                style={{ marginRight: 16 }}
              />
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium">Export to File</Text>
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  Download contacts as a .vcf file
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={24}
                color={colors.onSurfaceVariant}
              />
            </Card.Content>
          </Card>

          <Card
            mode="outlined"
            onPress={() => {
              setContactOptionsModalVisible(false);
              setTimeout(() => handleDirectSyncContacts(), 100);
            }}
            style={{ borderColor: colors.outline }}
          >
            <Card.Content style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialCommunityIcons
                name="sync"
                size={24}
                color={colors.primary}
                style={{ marginRight: 16 }}
              />
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium">Sync to Device</Text>
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  Add contacts directly to your phone
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={24}
                color={colors.onSurfaceVariant}
              />
            </Card.Content>
          </Card>
        </View>
      </BaseModal>

      {/* Contact Exclusion Selection Modal */}
      <BaseModal
        visible={exclusionModalVisible}
        onDismiss={() => setExclusionModalVisible(false)}
        edgeToEdge
        title={
          contactActionType === 'sync'
            ? 'Select Contacts to Sync'
            : 'Select Contacts to Export'
        }
        subtitle="Uncheck contacts you want to exclude."
        maxHeight="85%"
        scrollable={true}
        search={{
          placeholder: 'Search tenants...',
          value: syncSearchQuery,
          onChangeText: setSyncSearchQuery,
          onClear: () => setSyncSearchQuery(''),
        }}
        actions={[
          {
            label: 'Cancel',
            mode: 'outlined',
            onPress: () => setExclusionModalVisible(false),
            style: { flex: 1 },
          },
          {
            label: contactActionType === 'sync' ? 'Confirm Sync' : 'Confirm Export',
            mode: 'contained',
            onPress: () => {
              setExclusionModalVisible(false);
              if (contactActionType === 'sync') {
                handleConfirmSync();
              } else {
                handleConfirmExport();
              }
            },
            style: { flex: 1 },
          },
        ]}
      >
        <View>
          {syncTenants
            .filter(
              tenant =>
                tenant.name.toLowerCase().includes(syncSearchQuery.toLowerCase()) ||
                tenant.phone?.includes(syncSearchQuery) ||
                tenant.email?.toLowerCase().includes(syncSearchQuery.toLowerCase()),
            )
            .map(tenant => (
              <List.Item
                key={tenant.id}
                title={tenant.name}
                description={tenant.phone || tenant.email}
                left={props => <List.Icon {...props} icon="account" />}
                right={() => (
                  <Checkbox.Android
                    status={
                      excludedTenantIds.includes(tenant.id) ? 'unchecked' : 'checked'
                    }
                    onPress={() => {
                      setExcludedTenantIds(prev =>
                        prev.includes(tenant.id)
                          ? prev.filter(id => id !== tenant.id)
                          : [...prev, tenant.id],
                      );
                    }}
                  />
                )}
                onPress={() => {
                  setExcludedTenantIds(prev =>
                    prev.includes(tenant.id)
                      ? prev.filter(id => id !== tenant.id)
                      : [...prev, tenant.id],
                  );
                }}
              />
            ))}
        </View>
      </BaseModal>

      {/* Contact Sync Progress Modal */}
      <BaseModal
        visible={syncModalVisible}
        onDismiss={() => {
          setSyncModalVisible(false);
          setSyncCompleted(false);
        }}
        title={syncCompleted ? 'Sync Completed!' : 'Syncing Contacts'}
        subtitle={
          syncCompleted
            ? 'All contacts have been processed.'
            : 'Please wait while we sync your contacts.'
        }
        actions={
          syncCompleted
            ? [
                {
                  label: 'Close',
                  mode: 'contained',
                  onPress: () => {
                    setSyncModalVisible(false);
                    setSyncCompleted(false);
                  },
                  buttonColor: colors.success,
                  style: { flex: 1 },
                },
              ]
            : [
                {
                  label: 'Cancel',
                  mode: 'outlined',
                  onPress: handleCancelSync,
                  style: { flex: 1 },
                },
              ]
        }
      >
        <View style={{ marginBottom: 20 }}>
          <Text variant="bodyMedium" style={{ textAlign: 'center', marginBottom: 10 }}>
            {syncCompleted
              ? `All ${syncProgress.totalSteps} contacts processed`
              : `${syncProgress.currentStep} of ${syncProgress.totalSteps} contacts processed`}
          </Text>
          <ProgressBar
            progress={
              syncProgress.totalSteps > 0
                ? syncProgress.progress / syncProgress.totalSteps
                : 0
            }
            style={{ height: 8, borderRadius: 4, marginBottom: 5 }}
            color={syncCompleted ? colors.success : colors.primary}
          />
          <Text
            variant="bodySmall"
            style={{
              textAlign: 'center',
              fontWeight: 'bold',
              color: syncCompleted ? colors.success : colors.primary,
            }}
          >
            {Math.round(
              syncProgress.totalSteps > 0
                ? (syncProgress.progress / syncProgress.totalSteps) * 100
                : 0,
            )}
            %
          </Text>
        </View>

        {syncProgress.stats && (
          <View
            style={{
              backgroundColor: colors.surfaceVariant,
              padding: 15,
              borderRadius: 8,
              marginBottom: 20,
            }}
          >
            <Text
              variant="bodyMedium"
              style={{
                fontWeight: 'bold',
                marginBottom: 10,
                color: colors.onSurface,
              }}
            >
              {syncCompleted ? 'Final Results:' : 'Current Results:'}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 5,
              }}
            >
              <Text variant="bodySmall">Created: {syncProgress.stats.created || 0}</Text>
              <Text variant="bodySmall">Updated: {syncProgress.stats.updated || 0}</Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 5,
              }}
            >
              <Text variant="bodySmall">
                Replaced: {syncProgress.stats.replaced || 0}
              </Text>
              <Text variant="bodySmall">
                Duplicates: {syncProgress.stats.duplicates || 0}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="bodySmall">Errors: {syncProgress.stats.errors || 0}</Text>
            </View>
          </View>
        )}
      </BaseModal>

      {/* Export Contacts Modal */}
      <BaseModal
        visible={exportModalVisible}
        onDismiss={() => {
          setExportModalVisible(false);
          setExportResult(null);
        }}
        title={
          exportResult
            ? exportResult.success
              ? 'Export Successful!'
              : 'Export Failed'
            : 'Export Contacts'
        }
        subtitle={
          exportResult
            ? exportResult.success
              ? 'Your contacts are ready.'
              : 'There was an error.'
            : 'Create a VCF file of your contacts.'
        }
        actions={
          exportResult
            ? [
                {
                  label: 'Close',
                  mode: 'contained',
                  onPress: () => {
                    setExportModalVisible(false);
                    setExportResult(null);
                  },
                  buttonColor: exportResult.success ? colors.success : colors.error,
                  style: { flex: 1 },
                },
              ]
            : [
                {
                  label: 'Cancel',
                  mode: 'outlined',
                  onPress: () => setExportModalVisible(false),
                  style: { flex: 1 },
                },
                {
                  label: 'Export',
                  mode: 'contained',
                  onPress: handleConfirmExport,
                  buttonColor: colors.primary,
                  style: { flex: 1 },
                },
              ]
        }
      >
        <Text variant="bodyMedium" style={{ lineHeight: 24 }}>
          {exportResult
            ? exportResult.success
              ? 'Contacts exported successfully! You can now import the VCF file into your phone contacts.'
              : exportResult.message || 'Failed to export contacts. Please try again.'
            : 'This will export all tenant contacts as a VCF file that you can import into your phone contacts.\n Continue?'}
        </Text>
      </BaseModal>

      {/* Permission Modal */}
      <BaseModal
        visible={permissionModalVisible}
        onDismiss={() => setPermissionModalVisible(false)}
        title="Permission Required"
        message={permissionModalData?.message}
        mode="confirm"
        confirmText={
          permissionModalData?.permanentlyDenied ? 'Open Settings' : 'Try Again'
        }
        onConfirm={() => {
          setPermissionModalVisible(false);
          if (permissionModalData?.permanentlyDenied) {
            openDeviceSettings();
          } else {
            handleDirectSyncContacts();
          }
        }}
      />
    </>
  );
}
