import React, { useState } from 'react';
import { View } from 'react-native';
import { Portal, Surface, Text, TextInput } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import type { PaymentMessage } from '@/shared/types/types';
import { extractMessageMetadata } from '@/shared/utils/parsers';

interface LinkAmountModalProps {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: (amount: string) => void;
  message: PaymentMessage | null;
  initialAmount: string;
  currencySymbol?: string;
  colors: any;
  saving: boolean;
}

const LinkAmountModal = React.memo(
  ({
    visible,
    onDismiss,
    onConfirm,
    message,
    initialAmount,
    currencySymbol,
    colors,
    saving,
  }: LinkAmountModalProps) => {
    const [amount, setAmount] = useState(initialAmount);

    const [initializedKey, setInitializedKey] = React.useState<string | null>(null);

    const handleDismiss = () => {
      setAmount('');
      setInitializedKey(null);
      onDismiss();
    };

    // Sync with initialAmount/message when modal opens (once per open/message)
    React.useEffect(() => {
      if (!visible) return;

      const targetKey = message?.id ?? `create-${initialAmount}`;
      if (initializedKey === targetKey) return;

      const parsedAmount = message
        ? extractMessageMetadata(message.message_content).amount
        : undefined;
      const extracted = parsedAmount != null ? parsedAmount.toString() : '';
      setAmount(extracted || initialAmount);
      setInitializedKey(targetKey);
    }, [visible, initialAmount, message, initializedKey]);

    return (
      <Portal>
        <BaseModal
          visible={visible}
          onDismiss={handleDismiss}
          title="Confirm Linking Amount"
          subtitle="Specify the amount from the message to link to this receipt."
          scrollable={true}
          actions={[
            {
              label: 'Cancel',
              onPress: handleDismiss,
              mode: 'outlined',
            },
            {
              label: 'Confirm & Link',
              onPress: () => onConfirm(amount),
              mode: 'contained',
              loading: saving,
              disabled: !amount.trim() || saving,
            },
          ]}
        >
          <View>
            <TextInput
              label="Amount to Link"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              mode="outlined"
              autoFocus
              left={currencySymbol ? <TextInput.Affix text={currencySymbol} /> : null}
            />
            {message && (
              <Surface
                style={{
                  marginTop: 16,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: colors.surfaceVariant,
                }}
                elevation={0}
              >
                <Text
                  variant="labelSmall"
                  style={{ color: colors.onSurfaceVariant, marginBottom: 4 }}
                >
                  Reference Message:
                </Text>
                <Text variant="bodySmall" style={{ fontStyle: 'italic' }}>
                  {message.message_content}
                </Text>
              </Surface>
            )}
          </View>
        </BaseModal>
      </Portal>
    );
  },
);

LinkAmountModal.displayName = 'LinkAmountModal';
export default LinkAmountModal;
