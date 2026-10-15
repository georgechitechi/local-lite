import { useEffect, useState } from 'react';
import { Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { formatDateForDB } from '@/shared/utils/formatters';

interface RenewContractModalProps {
  visible: boolean;
  onDismiss: () => void;
  tenant: any;
  onRenew: (newEndDate: Date) => Promise<void>;
  processing?: boolean;
}

export default function RenewContractModal({
  visible,
  onDismiss,
  tenant,
  onRenew,
  processing = false,
}: RenewContractModalProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(
    new Date(new Date().getFullYear(), 11, 31),
  );

  useEffect(() => {
    if (visible) {
      setSelectedDate(new Date(new Date().getFullYear(), 11, 31));
    }
  }, [visible]);

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Renew Contract"
      subtitle={tenant?.name ? `Tenant: ${tenant.name}` : 'Manage property contracts'}
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
        },
        {
          label: 'Renew',
          onPress: () => onRenew(selectedDate),
          mode: 'contained',
          loading: processing,
          disabled: processing,
        },
      ]}
    >
      <Text variant="bodyMedium" style={{ marginBottom: 16 }}>
        Select the new End Date for the contract.
      </Text>
      <DatePicker
        label="New End Date"
        value={formatDateForDB(selectedDate)}
        onChange={date => date && setSelectedDate(new Date(date))}
        minimumDate={new Date()}
      />
    </BaseModal>
  );
}
