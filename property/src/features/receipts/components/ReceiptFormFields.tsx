import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { HelperText, SegmentedButtons, Text, TextInput } from 'react-native-paper';
import LinkedMessages from '@/features/receipts/components/LinkedMessages';
import DatePicker from '@/shared/components/DatePicker';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import {
  formatDateForDB,
  formatWithCurrency,
  parseLocalDate,
} from '@/shared/utils/formatters';

export interface ReceiptFormState {
  amount: string;
  payment_method: string;
  payment_date: string | null;
  type: string;
  status: string;
  notes: string;
  payment_period: {
    month: number;
    year: number;
  };
  contract_id?: string;
  tenant_id?: string;
}

export interface ReceiptFormErrors {
  amount?: string;
  payment_method?: string;
  payment_date?: string;
  type?: string;
  month?: string;
  year?: string;
  contract?: string;
  contract_id?: string;
}

export interface ReceiptFormFieldsProps {
  form: ReceiptFormState;
  setForm: React.Dispatch<React.SetStateAction<any>>;
  errors: ReceiptFormErrors;
  defaultCurrency: any;
  amountAffix?: { text: string; color: string } | null;
  isRentWaived?: boolean;
  onAmountChange?: (amount: string) => void;
  onPeriodChange?: (month: number, year: number) => void;
  onTypeChange?: (type: string) => void;

  // Linked messages
  messages: any[];
  selectedMessageIds: string[];
  linkedMessages?: any[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onMessageToggle: (message: any) => void;
  linkModalVisible: boolean;
  setLinkModalVisible: (visible: boolean) => void;
  activeMessageId?: string;
  setActiveMessageId?: (id: string | undefined) => void;
  onCreateNewMessage?: () => void;
  onClearSelection?: () => void;
}

export default function ReceiptFormFields({
  form,
  setForm,
  errors,
  defaultCurrency,
  amountAffix,
  isRentWaived,
  onAmountChange,
  onPeriodChange,
  onTypeChange,
  messages,
  selectedMessageIds,
  linkedMessages = [],
  searchQuery,
  onSearchChange,
  onMessageToggle,
  linkModalVisible,
  setLinkModalVisible,
  activeMessageId,
  setActiveMessageId,
  onCreateNewMessage,
  onClearSelection,
}: ReceiptFormFieldsProps) {
  const colors = useThemeColors();

  const handleAmount = (text: string) => {
    if (onAmountChange) {
      onAmountChange(text);
    } else {
      setForm((prev: any) => ({ ...prev, amount: text }));
    }
  };

  const handleType = (value: string) => {
    if (onTypeChange) {
      onTypeChange(value);
    } else {
      setForm((prev: any) => ({
        ...prev,
        type: value,
        status: value === 'others' ? 'paid' : prev.status,
      }));
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        label={`Amount (${defaultCurrency?.symbol || '$'})`}
        value={form.amount}
        onChangeText={handleAmount}
        keyboardType="decimal-pad"
        style={styles.input}
        error={!!errors.amount}
        right={
          amountAffix ? (
            <TextInput.Affix
              text={amountAffix.text}
              textStyle={{
                color:
                  amountAffix.color === 'success'
                    ? (colors as any).success || colors.primary
                    : colors.error,
              }}
            />
          ) : null
        }
      />
      {errors.amount ? (
        <HelperText type="error">{errors.amount}</HelperText>
      ) : isRentWaived ? (
        <HelperText type="error" style={{ color: colors.warning }}>
          Expected rent is {formatWithCurrency(0, defaultCurrency as any)} due to active
          waivers.
        </HelperText>
      ) : null}

      <DatePicker
        label="Select Receipt Date"
        value={form.payment_date}
        onChange={date => setForm((prev: any) => ({ ...prev, payment_date: date }))}
        style={styles.input}
      />
      {errors.payment_date && <HelperText type="error">{errors.payment_date}</HelperText>}

      <DatePicker
        label="Payment Period"
        mode="month"
        value={formatDateForDB(
          new Date(form.payment_period.year, form.payment_period.month - 1, 1),
        )}
        onChange={date => {
          if (date) {
            const d = parseLocalDate(date);
            const m = d.getMonth() + 1;
            const y = d.getFullYear();
            if (onPeriodChange) {
              onPeriodChange(m, y);
            } else {
              setForm((prev: any) => ({
                ...prev,
                payment_period: { month: m, year: y },
              }));
            }
          }
        }}
        style={styles.input}
      />
      {(errors.month || errors.year) && (
        <HelperText type="error">{errors.month || errors.year}</HelperText>
      )}

      <Text variant="bodyMedium" style={styles.label}>
        Payment Status
      </Text>
      <SegmentedButtons
        value={form.status}
        onValueChange={value => setForm((prev: any) => ({ ...prev, status: value }))}
        buttons={[
          { value: 'paid', label: 'Fully Paid' },
          { value: 'partial', label: 'Partial Payment' },
        ]}
        style={styles.segmentedButton}
      />

      <Text variant="bodyMedium" style={styles.label}>
        Payment Type
      </Text>
      <SegmentedButtons
        value={form.type}
        onValueChange={handleType}
        buttons={[
          { value: 'rent', label: 'Rent' },
          { value: 'deposit', label: 'Deposit' },
          { value: 'others', label: 'Others' },
        ]}
        style={styles.segmentedButton}
      />

      <Text variant="bodyMedium" style={styles.label}>
        Payment Method
      </Text>
      <SegmentedButtons
        value={form.payment_method}
        onValueChange={value =>
          setForm((prev: any) => ({ ...prev, payment_method: value }))
        }
        buttons={[
          { value: 'cash', label: 'Cash', icon: 'cash' },
          { value: 'bank', label: 'Bank', icon: 'bank' },
          { value: 'mpesa', label: 'M-Pesa', icon: 'cellphone' },
          { value: 'card', label: 'Card', icon: 'credit-card' },
        ]}
        style={styles.segmentedButton}
      />

      <TextInput
        label="Notes"
        value={form.notes}
        onChangeText={text => setForm((prev: any) => ({ ...prev, notes: text }))}
        multiline
        numberOfLines={4}
        style={styles.input}
      />

      {/* Payment Messages Section */}
      <LinkedMessages
        messages={messages}
        selectedMessageIds={selectedMessageIds}
        linkedMessages={linkedMessages}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        onMessageToggle={onMessageToggle}
        visible={linkModalVisible}
        onDismiss={() => {
          setLinkModalVisible(false);
          setActiveMessageId?.(undefined);
        }}
        onShow={() => setLinkModalVisible(true)}
        activeMessageId={activeMessageId}
        onCreateNew={onCreateNewMessage || (() => {})}
        onClearSelection={onClearSelection || (() => {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  input: {
    marginBottom: 16,
  },
  label: {
    marginBottom: 8,
    fontWeight: '500',
  },
  segmentedButton: {
    marginBottom: 16,
  },
});
