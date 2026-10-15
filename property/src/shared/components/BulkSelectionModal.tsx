import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Checkbox, Divider, Text } from 'react-native-paper';
import type { Tenant } from '@/features/reminders/utils/reminderUtils';
import BaseModal from '@/shared/components/BaseModal';
import SPressable from '@/shared/components/SlightPressable';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface BulkSelectionModalProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  subtitle: string;
  tenants: Tenant[];
  selectedTenants: Set<string>;
  onToggleTenant: (id: string) => void;
  onSetSelected: (tenants: Set<string>) => void;
  onConfirm: () => void;
  loading: boolean;
  contactField: 'email' | 'phone';
  headerComponent?: React.ReactNode;
}

export default function BulkSelectionModal({
  visible,
  onDismiss,
  title,
  subtitle,
  tenants,
  selectedTenants,
  onToggleTenant,
  onSetSelected,
  onConfirm,
  loading,
  contactField,
  headerComponent,
}: BulkSelectionModalProps) {
  const colors = useThemeColors();

  const hasContact = (tenant: Tenant) => {
    if (contactField === 'email') {
      return tenant.email && !tenant.email.startsWith('placeholder');
    }
    return !!tenant.phone;
  };

  const getContactDisplay = (tenant: Tenant) => {
    if (contactField === 'email') {
      return hasContact(tenant) ? tenant.email : '(No Email)';
    }
    return hasContact(tenant) ? tenant.phone : '(No Phone)';
  };

  const validTenants = tenants.filter(t => hasContact(t));
  const allSelected =
    validTenants.length > 0 && validTenants.every(t => selectedTenants.has(t.id));

  const handleToggleAll = () => {
    if (allSelected) {
      onSetSelected(new Set());
    } else {
      const newSet = new Set<string>();
      for (const t of validTenants) {
        newSet.add(t.id);
      }
      onSetSelected(newSet);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      subtitle={subtitle}
      maxHeight={'85%'}
      scrollable={true}
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
        },
        {
          label: `Send (${selectedTenants.size})`,
          onPress: onConfirm,
          loading,
          disabled: selectedTenants.size === 0,
          mode: 'contained',
        },
      ]}
    >
      {headerComponent}
      <View style={styles.headerRow}>
        <Text variant="bodyMedium">Showing {tenants.length} tenants.</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button mode="text" compact onPress={handleToggleAll}>
            {allSelected ? 'Deselect All' : 'Select All'}
          </Button>
        </View>
      </View>

      <View>
        {tenants.map((tenant, index) => {
          const contactOk = hasContact(tenant);
          const isSelected = selectedTenants.has(tenant.id);
          return (
            <React.Fragment key={tenant.id}>
              <SPressable
                onPress={() => contactOk && onToggleTenant(tenant.id)}
                disabled={!contactOk}
                style={[styles.tenantRow, { opacity: contactOk ? 1 : 0.5 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="bodyLarge" style={{ fontWeight: '500' }}>
                    {tenant.name}
                  </Text>
                  <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                    {getContactDisplay(tenant)}
                  </Text>
                </View>
                <View pointerEvents="none">
                  <Checkbox.Android status={isSelected ? 'checked' : 'unchecked'} />
                </View>
              </SPressable>
              {index < tenants.length - 1 && <Divider />}
            </React.Fragment>
          );
        })}
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  tenantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
});
