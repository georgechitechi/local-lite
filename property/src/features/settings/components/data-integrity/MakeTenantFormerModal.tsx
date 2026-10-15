import { useEffect, useState } from 'react';
import { Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateForDB } from '@/shared/utils/formatters';

interface MakeTenantFormerModalProps {
  visible: boolean;
  onDismiss: () => void;
  tenant: any;
  onConfirm: (dateVacated: Date) => Promise<void>;
  processing?: boolean;
}

export default function MakeTenantFormerModal({
  visible,
  onDismiss,
  tenant,
  onConfirm,
  processing = false,
}: MakeTenantFormerModalProps) {
  const colors = useThemeColors();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  useEffect(() => {
    if (visible) {
      setSelectedDate(new Date());
    }
  }, [visible]);

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Make Tenant Former"
      subtitle={tenant?.name ? `Tenant: ${tenant.name}` : 'Manage your tenants'}
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
        },
        {
          label: 'Confirm',
          onPress: () => onConfirm(selectedDate),
          mode: 'contained',
          buttonColor: colors.error,
          textColor: 'white',
          loading: processing,
          disabled: processing,
        },
      ]}
    >
      <Text variant="bodyMedium" style={{ marginBottom: 16 }}>
        Select the Date Vacated. This will end the contract and update the house status.
      </Text>
      <DatePicker
        label="Date Vacated"
        value={formatDateForDB(selectedDate)}
        onChange={date => date && setSelectedDate(new Date(date))}
      />
    </BaseModal>
  );
}
