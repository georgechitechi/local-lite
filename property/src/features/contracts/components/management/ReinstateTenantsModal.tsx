import { View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import KeyboardScroll from '@/shared/components/KeyboardScroll';

export interface ReinstateTenantsModalProps {
  visible: boolean;
  onDismiss: () => void;
  reinstateDaysFilter: string;
  setReinstateDaysFilter: (f: string) => void;
  eligibleFormerTenants: any[];
  onExecuteReinstate: (tenantId: string, contractId: string) => void;
  colors: any;
}

export default function ReinstateTenantsModal({
  visible,
  onDismiss,
  reinstateDaysFilter,
  setReinstateDaysFilter,
  eligibleFormerTenants,
  onExecuteReinstate,
  colors,
}: ReinstateTenantsModalProps) {
  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Former Tenants Management"
      subtitle={
        reinstateDaysFilter === 'all'
          ? 'All recently deactivated tenants'
          : `Recently deactivated tenants (past ${reinstateDaysFilter} days)`
      }
      maxHeight="90%"
    >
      <View style={{ marginHorizontal: -16, marginTop: -16, marginBottom: 10 }}>
        <FilterButtons
          options={[
            { label: '1 Day', value: '1' },
            { label: '10 Days', value: '10' },
            { label: '30 Days', value: '30' },
            { label: '60 Days', value: '60' },
            { label: '90 Days', value: '90' },
            { label: 'All', value: 'all' },
          ]}
          selectedValue={reinstateDaysFilter}
          onValueChange={val => setReinstateDaysFilter(val || '30')}
        />
      </View>
      <KeyboardScroll style={{ flex: 1 }} useSafeArea={false}>
        {eligibleFormerTenants.length === 0 ? (
          <EmptyState
            icon="account-check-outline"
            title="No eligible former tenants found"
          />
        ) : (
          eligibleFormerTenants.map((t: any) => (
            <Surface
              key={t.id}
              style={{
                padding: 12,
                marginBottom: 8,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.outlineVariant,
                borderRadius: 8,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>
                  {t.name}
                </Text>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  {t.email || 'No email'}
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: colors.onSurfaceVariant, marginTop: 4 }}
                >
                  Last Contract: Unit {t.houseNumber} ({t.propertyName})
                </Text>
              </View>
              <Button
                mode="contained"
                compact
                disabled={t.isHouseTaken}
                onPress={() => onExecuteReinstate(t.id, t.latestContract.id)}
              >
                {t.isHouseTaken ? 'House Taken' : 'Reinstate'}
              </Button>
            </Surface>
          ))
        )}
      </KeyboardScroll>
    </BaseModal>
  );
}
