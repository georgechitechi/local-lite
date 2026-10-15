import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Surface, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateForDB, formatDisplayDate } from '@/shared/utils/formatters';

interface UpdateContractStartDateModalProps {
  visible: boolean;
  onDismiss: () => void;
  house: any;
  availableEarlyContracts: any[];
  allTenants: any[];
  onConfirmSingle: (contract: any, newDate: Date) => Promise<void>;
  onConfirmAll?: (contracts: any[], newDate: Date) => Promise<void>;
  processing?: boolean;
}

export default function UpdateContractStartDateModal({
  visible,
  onDismiss,
  house,
  availableEarlyContracts,
  allTenants,
  onConfirmSingle,
  onConfirmAll,
  processing = false,
}: UpdateContractStartDateModalProps) {
  const colors = useThemeColors();
  const [contractToUpdate, setContractToUpdate] = useState<any>(null);
  const [contractStartDate, setContractStartDate] = useState<Date>(new Date());

  useEffect(() => {
    if (visible) {
      if (availableEarlyContracts.length > 0) {
        setContractToUpdate(availableEarlyContracts[0]);
      } else {
        setContractToUpdate(null);
      }

      if (house?.effectiveDate) {
        setContractStartDate(new Date(house.effectiveDate));
      } else {
        setContractStartDate(new Date());
      }
    }
  }, [visible, availableEarlyContracts, house]);

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Update Contract Start Date"
      subtitle={`House ${house?.house_number || ''}`}
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
        },
        ...(availableEarlyContracts.length > 1 && onConfirmAll
          ? [
              {
                label: `Update All (${availableEarlyContracts.length})`,
                onPress: () => onConfirmAll(availableEarlyContracts, contractStartDate),
                mode: 'outlined' as const,
                loading: processing,
                disabled: processing,
              },
            ]
          : []),
        {
          label:
            availableEarlyContracts.length > 1 ? 'Update Selected' : 'Update Start Date',
          onPress: () =>
            contractToUpdate && onConfirmSingle(contractToUpdate, contractStartDate),
          mode: 'contained',
          loading: processing,
          disabled: processing || !contractToUpdate,
        },
      ]}
    >
      <Text variant="bodyMedium" style={{ marginBottom: 12, opacity: 0.8 }}>
        Select the new contract start date. Setting this on or after the house's
        commissioning date will resolve the issue.
      </Text>

      {availableEarlyContracts.length > 1 && (
        <View style={{ marginBottom: 12 }}>
          <Text
            variant="labelMedium"
            style={{ marginBottom: 6, color: colors.onSurfaceVariant }}
          >
            Select Contract to Update:
          </Text>
          {availableEarlyContracts.map(c => {
            const isSelected = contractToUpdate?.id === c.id;
            const t = allTenants.find((tenant: any) => tenant.id === c.tenant_id);
            return (
              <Surface
                key={c.id}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  marginBottom: 6,
                  borderWidth: 1,
                  borderColor: isSelected ? colors.primary : colors.outlineVariant,
                  backgroundColor: isSelected
                    ? (colors as any).primaryContainer
                    : colors.surface,
                }}
                onTouchEnd={() => setContractToUpdate(c)}
              >
                <Text
                  variant="bodyMedium"
                  style={{ fontWeight: isSelected ? 'bold' : 'normal' }}
                >
                  {t?.name || 'Unknown Tenant'}
                </Text>
                <Text variant="bodySmall" style={{ opacity: 0.7 }}>
                  Current Start Date: {formatDisplayDate(c.start_date)}
                </Text>
              </Surface>
            );
          })}
        </View>
      )}

      {availableEarlyContracts.length === 1 && contractToUpdate && (
        <View style={{ marginBottom: 12 }}>
          <Text variant="bodyMedium" style={{ fontWeight: '600' }}>
            Tenant:{' '}
            {allTenants.find((t: any) => t.id === contractToUpdate.tenant_id)?.name ||
              'Unknown Tenant'}
          </Text>
          <Text variant="bodySmall" style={{ opacity: 0.7 }}>
            Current Start Date: {formatDisplayDate(contractToUpdate.start_date)}
          </Text>
        </View>
      )}

      <DatePicker
        label="Contract Start Date"
        value={formatDateForDB(contractStartDate)}
        onChange={date => date && setContractStartDate(new Date(date))}
      />
    </BaseModal>
  );
}
