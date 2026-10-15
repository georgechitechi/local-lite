import type React from 'react';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Checkbox, SegmentedButtons, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import type { Tenant } from '@/stores/types';

interface TenantLedgerModalProps {
  visible: boolean;
  onDismiss: () => void;
  onGenerate: (options: any) => void;
  onSelectTenantPress: () => void;
  exportLoading: boolean;
  selectedTenant: Tenant | null;
  groupByStatus: boolean;
  setGroupByStatus: (val: boolean) => void;
  zIndex?: number;
  initialOrientation?: 'portrait' | 'landscape';
  isPdf?: boolean;
}

export const TenantLedgerModal: React.FC<TenantLedgerModalProps> = ({
  visible,
  onDismiss,
  onGenerate,
  onSelectTenantPress,
  exportLoading,
  selectedTenant,
  groupByStatus,
  setGroupByStatus,
  zIndex,
  initialOrientation = 'portrait',
  isPdf = true,
}) => {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(
    initialOrientation,
  );

  useEffect(() => {
    if (initialOrientation) {
      setOrientation(initialOrientation);
    }
  }, [initialOrientation]);

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Tenant Ledger Options"
      subtitle="Manage your tenants"
      scrollable={true}
      zIndex={zIndex}
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
        },
        {
          label: 'Generate Ledger',
          onPress: () => {
            if (selectedTenant) {
              onGenerate({
                tenantId: selectedTenant.id,
                groupByStatus,
                orientation,
              });
            }
          },
          mode: 'contained',
          loading: exportLoading,
          disabled: !selectedTenant,
        },
      ]}
    >
      <View style={{ gap: 16 }}>
        <Text variant="bodyMedium">
          {selectedTenant
            ? `Selected Tenant: ${selectedTenant.name}`
            : 'Select a tenant to generate their detailed statement of account.'}
        </Text>

        <Button
          mode="outlined"
          onPress={onSelectTenantPress}
          icon={selectedTenant ? 'account-edit' : 'account-plus'}
        >
          {selectedTenant ? 'Change Tenant' : 'Select Tenant'}
        </Button>

        {isPdf && (
          <View style={{ gap: 6 }}>
            <Text variant="labelMedium" style={{ opacity: 0.7 }}>
              Page Orientation
            </Text>
            <SegmentedButtons
              value={orientation}
              onValueChange={val => setOrientation(val as any)}
              buttons={[
                { value: 'portrait', label: 'Portrait', icon: 'crop-portrait' },
                { value: 'landscape', label: 'Landscape', icon: 'crop-landscape' },
              ]}
            />
          </View>
        )}

        <View style={{ gap: 8, marginTop: 8 }}>
          <Checkbox.Item
            label="Group by Status"
            status={groupByStatus ? 'checked' : 'unchecked'}
            onPress={() => setGroupByStatus(!groupByStatus)}
            position="leading"
            labelStyle={{ textAlign: 'left' }}
            style={{ paddingHorizontal: 2, paddingVertical: 2 }}
          />
        </View>
      </View>
    </BaseModal>
  );
};
