import { useEffect, useState } from 'react';
import { Surface, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateForDB, formatDisplayDate } from '@/shared/utils/formatters';

interface ChangeReceiptDateModalProps {
  visible: boolean;
  onDismiss: () => void;
  receipt: any;
  onConfirm: (receipt: any, newDate: Date) => Promise<void>;
  processing?: boolean;
}

export default function ChangeReceiptDateModal({
  visible,
  onDismiss,
  receipt,
  onConfirm,
  processing = false,
}: ChangeReceiptDateModalProps) {
  const colors = useThemeColors();
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());

  useEffect(() => {
    if (visible && receipt) {
      setPaymentDate(receipt.payment_date ? new Date(receipt.payment_date) : new Date());
    }
  }, [visible, receipt]);

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Change Receipt Date"
      subtitle={
        receipt?.name || (receipt?.id ? `Receipt ${receipt.id.substring(0, 8)}` : '')
      }
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
        },
        {
          label: 'Update Date',
          onPress: () => receipt && onConfirm(receipt, paymentDate),
          mode: 'contained',
          loading: processing,
          disabled: processing || !receipt,
        },
      ]}
    >
      <Text variant="bodyMedium" style={{ marginBottom: 12, opacity: 0.8 }}>
        Select a new payment date for this receipt.
      </Text>

      {receipt && (receipt.contract_start || receipt.contract_end) && (
        <Surface
          style={{
            padding: 12,
            borderRadius: 8,
            backgroundColor: colors.surfaceVariant,
            marginBottom: 16,
          }}
        >
          <Text variant="labelMedium" style={{ fontWeight: '600', marginBottom: 4 }}>
            Current Contract Period:
          </Text>
          <Text variant="bodySmall">
            {formatDisplayDate(receipt.contract_start)} -{' '}
            {formatDisplayDate(receipt.contract_end) || 'Present'}
          </Text>
          {receipt.better_contract_label && (
            <Text
              variant="bodySmall"
              style={{ color: (colors as any).success, marginTop: 4 }}
            >
              Suggested Contract: {receipt.better_contract_label}
            </Text>
          )}
        </Surface>
      )}

      <DatePicker
        label="Payment Date"
        value={formatDateForDB(paymentDate)}
        onChange={date => date && setPaymentDate(new Date(date))}
      />
    </BaseModal>
  );
}
