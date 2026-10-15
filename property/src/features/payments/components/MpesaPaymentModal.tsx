import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { supabase } from '@/shared/services/supabase';
import { getAuthStateSnapshot } from '@/stores/authStore';

interface MpesaPaymentModalProps {
  visible: boolean;
  onDismiss: () => void;
  pendingAmount: number;
  contractId: string;
  tenantId: string;
  businessId: string;
  tenantName: string;
  initialPhone?: string;
  onPaymentSuccess?: () => void;
}

export default function MpesaPaymentModal({
  visible,
  onDismiss,
  pendingAmount,
  contractId,
  tenantId,
  businessId,
  tenantName,
  initialPhone,
  onPaymentSuccess,
}: MpesaPaymentModalProps) {
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const { requireCloudSync } = useLocalSync();
  const { checkOnline } = useOfflineCheck();
  const { user } = useAuth();

  const [phone, setPhone] = useState(initialPhone || '');
  const [amount, setAmount] = useState(String(pendingAmount));
  const [loading, setLoading] = useState(false);

  // Format initial phone number
  React.useEffect(() => {
    if (initialPhone) {
      let p = String(initialPhone).replace('+', '').replace(/\s/g, '').trim();
      if (p.startsWith('254')) p = p.substring(3);
      if (p.startsWith('0')) p = p.substring(1);
      setPhone(p);
    }
  }, [initialPhone]);

  React.useEffect(() => {
    setAmount(String(pendingAmount));
  }, [pendingAmount]);

  const handlePayment = async () => {
    if (!checkOnline('M-Pesa Payment') || !requireCloudSync('M-Pesa Payment')) return;

    if (phone?.length !== 9) {
      showSnackbar('Please enter a valid 9-digit phone number.', 'error');
      return;
    }

    if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      showSnackbar('Please enter a valid amount.', 'error');
      return;
    }

    setLoading(true);
    try {
      const formattedPhone = `254${phone}`;

      const { error } = await supabase.functions.invoke('payments', {
        headers: getAuthStateSnapshot().session
          ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
          : undefined,
        body: {
          provider: 'daraja',
          phone: formattedPhone,
          amount: Number(amount),
          business_id: businessId,
          user_id: user?.id ?? null,
          tenant_id: tenantId,
          contract_id: contractId,
          name: tenantName,
        },
      });

      if (error) {
        throw new Error(error.message || 'Payment initiation failed');
      }

      showSnackbar(
        'STK Push sent! Please check your phone to enter your M-Pesa PIN.',
        'success',
      );
      if (onPaymentSuccess) onPaymentSuccess();
      onDismiss();
    } catch (err: any) {
      showSnackbar(err.message || 'An error occurred while initiating payment.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Pay via M-Pesa"
      subtitle="M-Pesa STK Push"
      scrollable
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
          disabled: loading,
        },
        {
          label: 'Pay Now',
          onPress: handlePayment,
          mode: 'contained',
          loading: loading,
          disabled: loading || !phone,
        },
      ]}
    >
      <View style={styles.container}>
        <Text style={[styles.instruction, { color: colors.onSurfaceVariant }]}>
          Enter your M-Pesa phone number and the amount you wish to pay. You will receive
          a prompt on your phone to enter your PIN.
        </Text>

        <TextInput
          label="M-Pesa Phone Number"
          value={phone}
          onChangeText={text => {
            let v = text.replace(/\D/g, '');
            if (v.startsWith('0')) v = v.substring(1);
            setPhone(v);
          }}
          mode="outlined"
          keyboardType="phone-pad"
          left={<TextInput.Affix text="+254 " />}
          maxLength={9}
          style={styles.input}
          disabled={loading}
        />

        <TextInput
          label="Amount (KES)"
          value={amount}
          onChangeText={setAmount}
          mode="outlined"
          keyboardType="numeric"
          style={styles.input}
          disabled={loading}
        />
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
  },
  instruction: {
    marginBottom: 16,
    lineHeight: 20,
  },
  input: {
    marginBottom: 16,
  },
});
