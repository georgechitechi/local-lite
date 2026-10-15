import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Avatar,
  Button,
  Divider,
  HelperText,
  SegmentedButtons,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import PaymentMessageModal from '@/features/payments/components/PaymentMessageModal';
import PaymentMessagesListModal from '@/features/payments/components/PaymentMessagesListModal';
import LinkedMessages from '@/features/receipts/components/LinkedMessages';
import {
  calculateReceiptTargetRent,
  getAmountAffix,
} from '@/features/receipts/utils/receiptHelper';
import { useAuth } from '@/providers/AuthProvider';
import AccessGuard from '@/shared/components/AccessGuard';
import DatePicker from '@/shared/components/DatePicker';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import LoadingCard from '@/shared/components/LoadingCard';
import { useCurrency } from '@/shared/hooks/useCurrency';
import {
  useContracts,
  useCoreMutations,
  useHouses,
  usePaymentMessageReceipts,
  usePaymentMessages,
  useProperties,
  useReceipts,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { PaymentMessage } from '@/shared/types/types';
import {
  formatDateForDB,
  formatWithCurrency,
  parseLocalDate,
} from '@/shared/utils/formatters';
import { validateFields, validations } from '@/shared/utils/validations';

interface FormData {
  amount: string;
  payment_method: string;
  payment_date: string | null;
  type: string;
  notes: string;
  status: string;
  payment_period: {
    month: number;
    year: number;
  };
}

interface ContractDetails {
  tenant: string;
  property: string;
  house: string;
  rent_amount: number;
}

interface Errors {
  amount?: string;
  payment_method?: string;
  type?: string;
  payment_date?: string;
  month?: string;
  year?: string;
}

export default function EditReceiptScreen() {
  const { user } = useAuth();

  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { selectedBusiness, requireBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const colors = useThemeColors();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);
  const [initError, setInitError] = useState<string | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const hasInitializedRef = useRef<string | null>(null);
  const [linkedPaymentMessages, setLinkedPaymentMessages] = useState<PaymentMessage[]>(
    [],
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [createMessageModalVisible, setCreateMessageModalVisible] = useState(false);
  const [messagesListModalVisible, setMessagesListModalVisible] = useState(false);
  const [linkModalVisible, setLinkModalVisible] = useState(false);

  const [form, setForm] = useState<FormData>({
    amount: '',
    payment_method: 'cash',
    payment_date: formatDateForDB(new Date()),
    type: 'rent',
    notes: '',
    status: 'paid',
    payment_period: {
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    },
  });

  const [contractDetails, setContractDetails] = useState<ContractDetails>({
    tenant: '',
    property: '',
    house: '',
    rent_amount: 0,
  });

  const [errors, setErrors] = useState<Errors>({});

  const { update, insert, delete: deleteRecord } = useCoreMutations();
  const rawReceipts = useReceipts(selectedBusiness?.id);
  const rawContracts = useContracts(selectedBusiness?.id);
  const tenants = useTenants(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const properties = useProperties(selectedBusiness?.id);
  const rawPaymentMessages = usePaymentMessages(selectedBusiness?.id);
  const rawPaymentMessageReceipts = usePaymentMessageReceipts(selectedBusiness?.id);

  const { effectiveRentAmount, isRentWaived } = useMemo(() => {
    if (!id) return { effectiveRentAmount: 0, isRentWaived: false };
    const receipt = rawReceipts.find(r => r.id === id);
    if (!receipt) return { effectiveRentAmount: 0, isRentWaived: false };
    const contract = rawContracts.find(c => c.id === receipt.contract_id);
    return calculateReceiptTargetRent(
      contract,
      form.payment_period.month,
      form.payment_period.year,
      form.type,
    );
  }, [
    id,
    form.type,
    form.payment_period.month,
    form.payment_period.year,
    rawReceipts,
    rawContracts,
  ]);

  const amountAffix = useMemo(() => {
    if (form.type === 'others') return null;
    return getAmountAffix(form.amount, effectiveRentAmount, defaultCurrency);
  }, [form.amount, effectiveRentAmount, form.type, defaultCurrency]);

  // Define validation rules
  const validationRules = {
    amount: validations.combine(validations.required, validations.amount),
    payment_method: validations.required,
    type: validations.required,
    payment_date: validations.combine(validations.required, validations.date),
    'payment_period.month': validations.required,
    'payment_period.year': validations.required,
  };

  const fetchReceipt = useCallback(async () => {
    if (!id) {
      router.push('/receipts');
      return;
    }

    if (!selectedBusiness?.id) {
      return;
    }

    try {
      const receipt = rawReceipts.find(r => r.id === id);
      if (!receipt) {
        throw new Error('Receipt not found');
      }

      const contract = rawContracts.find(c => c.id === receipt.contract_id);
      const house = contract ? houses.find(h => h.id === contract.house_id) : undefined;
      const property = house
        ? properties.find(p => p.id === house.property_id)
        : undefined;
      const tenant = tenants.find(t => t.id === receipt.tenant_id);

      const rentAmount = parseFloat(String(contract?.rent_amount || 0));
      const amount = parseFloat(String(receipt.amount || 0));
      const status = receipt.status || (amount >= rentAmount ? 'paid' : 'partial');

      setForm({
        amount: amount.toString(),
        payment_method: receipt.payment_method || 'cash',
        payment_date: receipt.payment_date ? formatDateForDB(receipt.payment_date) : null,
        type: receipt.type || 'rent',
        notes: receipt.notes || '',
        status: status,
        payment_period: (receipt.payment_period as any) || {
          month: new Date().getMonth() + 1,
          year: new Date().getFullYear(),
        },
      });

      setContractDetails({
        tenant: tenant?.name || 'Unknown Tenant',
        property: property?.name || 'Unknown Property',
        house: house?.house_number || 'Unknown',
        rent_amount: rentAmount,
      });
    } catch (error: any) {
      console.error('Error fetching receipt:', error);
      showSnackbar('Failed to load receipt details', 'error');
      router.push('/receipts');
    }
  }, [
    id,
    selectedBusiness,
    router,
    rawReceipts,
    rawContracts,
    houses,
    properties,
    tenants,
    showSnackbar,
  ]);

  // Reactive payment messages with receipt counts
  const paymentMessagesWithCounts = useMemo(() => {
    return (rawPaymentMessages || []).map(msg => {
      const linkedCount = (rawPaymentMessageReceipts || []).filter(
        pmr => pmr.payment_message_id === msg.id,
      ).length;
      return {
        ...msg,
        linked_receipts_count: linkedCount,
      };
    });
  }, [rawPaymentMessages, rawPaymentMessageReceipts]);

  // Get currently linked messages for this receipt
  const currentlyLinkedMessageIds = useMemo(() => {
    return new Set(
      (rawPaymentMessageReceipts || [])
        .filter(pmr => pmr.receipt_id === id)
        .map(pmr => pmr.payment_message_id),
    );
  }, [rawPaymentMessageReceipts, id]);

  // Update linked messages list and initialize selection ONLY ONCE per receipt
  useEffect(() => {
    if (paymentMessagesWithCounts.length > 0) {
      const linked = paymentMessagesWithCounts.filter((msg: any) =>
        currentlyLinkedMessageIds.has(String(msg.id)),
      );

      setLinkedPaymentMessages(prev => {
        const isSame = JSON.stringify(prev) === JSON.stringify(linked);
        return isSame ? prev : (linked as any);
      });

      // Initialize selection once per different receipt ID
      if (hasInitializedRef.current !== id) {
        const linkedIds = Array.from(currentlyLinkedMessageIds).map(String);
        setSelectedMessageIds(linkedIds);
        hasInitializedRef.current = id as string;
      }
    }
  }, [paymentMessagesWithCounts, currentlyLinkedMessageIds, id]);

  const fetchInitialData = useCallback(async () => {
    try {
      setLoading(true);

      // First, try to fetch the receipt data
      await fetchReceipt();
    } catch (error) {
      console.error('Error fetching initial data:', error);
      setInitError('Failed to load receipt data');
    } finally {
      setLoading(false);
    }
  }, [fetchReceipt]);

  useEffect(() => {
    if (selectedBusiness?.id && id) {
      // Reset form to initial state when id changes
      setForm({
        amount: '',
        payment_method: 'cash',
        payment_date: formatDateForDB(new Date()),
        type: 'rent',
        notes: '',
        status: 'paid',
        payment_period: {
          month: new Date().getMonth() + 1,
          year: new Date().getFullYear(),
        },
      });
      setContractDetails({
        tenant: '',
        property: '',
        house: '',
        rent_amount: 0,
      });
      setErrors({});
      setLoading(true);
      fetchInitialData();
    }
  }, [id, selectedBusiness?.id, fetchInitialData]);

  const validateForm = (): boolean => {
    const { isValid, errors: validationErrors } = validateFields(
      form as unknown as Record<string, unknown>,
      validationRules,
    );
    setErrors(validationErrors);
    return isValid;
  };

  const handleAmountChange = (text: string) => {
    const amount = parseFloat(text.replace(/,/g, '')) || 0;
    const status =
      form.type === 'others'
        ? 'paid'
        : (effectiveRentAmount > 0 || isRentWaived) &&
            amount >= effectiveRentAmount - 0.01
          ? 'paid'
          : 'partial';
    setForm(prev => ({ ...prev, amount: text, status }));
  };

  // Memoized filtered and sorted messages
  const filteredMessages = useMemo((): PaymentMessage[] => {
    let filtered = paymentMessagesWithCounts;

    // Apply search filter if query exists
    if (searchQuery.trim()) {
      const queries = searchQuery
        .toLowerCase()
        .split(/\s+/)
        .filter(q => q.length > 0);
      filtered = paymentMessagesWithCounts.filter(message => {
        const content = message.message_content.toLowerCase();
        const date = (message.transaction_date || '').toLowerCase();

        // Match ALL words in the query (in any order)
        return queries.every(q => content.includes(q) || date.includes(q));
      });
    }

    // Sort messages: selected messages first, then newest transaction first
    const selectedIdsSet = new Set(selectedMessageIds);
    return [...filtered].sort((a, b) => {
      const aSelected = selectedIdsSet.has(String(a.id));
      const bSelected = selectedIdsSet.has(String(b.id));

      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;

      // If both or neither are selected, sort by date (newest first)
      const dateA = a.transaction_date || '';
      const dateB = b.transaction_date || '';
      if (dateA > dateB) return -1;
      if (dateA < dateB) return 1;

      return 0; // identical dates
    });
  }, [paymentMessagesWithCounts, searchQuery, selectedMessageIds]);

  // Handle search query change
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  const handleSubmit = async () => {
    if (!validateForm() || !requireBusiness()) return;

    setSaving(true);
    try {
      if (!user) throw new Error('User not authenticated');

      // Update receipt via local-lite
      await update('receipts', id, {
        ...form,
        amount: parseFloat(form.amount),
        payment_date: form.payment_date || undefined,
        business_id: selectedBusiness?.id || '',
        user_id: user.id,
      });

      // Handle payment message linking/unlinking using junction table
      const currentLinkedIds = linkedPaymentMessages.map(msg => String(msg.id));
      const selectedIds = selectedMessageIds.map(id => String(id));

      // Map selected IDs back to full messages for linking logic
      const selectedFullMessages = paymentMessagesWithCounts.filter(msg =>
        selectedIds.includes(String(msg.id)),
      );

      // Find messages to link (selected but not currently linked)
      const toLink = selectedFullMessages.filter(
        msg => !currentLinkedIds.includes(String(msg.id)),
      );

      // Find messages to unlink (currently linked but not selected)
      const toUnlink = linkedPaymentMessages.filter(
        msg => !selectedIds.includes(String(msg.id)),
      );

      // Link/unlink messages using local-lite
      if (toLink.length > 0) {
        for (const msg of toLink) {
          const junctionId = `${msg.id}_${id}`; // Create composite key
          await insert('payment_message_receipts', {
            id: junctionId,
            payment_message_id: msg.id,
            receipt_id: id,
            business_id: selectedBusiness?.id || '',
            user_id: user.id,
          });
        }
      }

      if (toUnlink.length > 0) {
        for (const msg of toUnlink) {
          // Find the actual junction record ID
          const junction = rawPaymentMessageReceipts.find(
            pmr => pmr.payment_message_id === msg.id && pmr.receipt_id === id,
          );

          if (junction) {
            await deleteRecord('payment_message_receipts', junction.id);
          }
        }
      }

      showSnackbar('Receipt updated successfully!', 'success');
      setSelectedMessageIds([]);
      setSearchQuery('');
      router.push('/receipts');
    } catch (error: any) {
      console.error('Error updating receipt:', error);
      showSnackbar('Failed to update receipt', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMessageCreated = (newMessage: PaymentMessage) => {
    setSelectedMessageIds(prev => [...prev, String(newMessage.id)]);
  };

  if (loading) {
    return <LoadingCard iconName="receipt" text="Loading receipt data..." />;
  }

  if (initError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{initError}</Text>
        <Button mode="contained" onPress={fetchInitialData} style={styles.retryButton}>
          Retry
        </Button>
      </View>
    );
  }

  return (
    <AccessGuard action="edit" resource="receipt">
      <KeyboardScroll
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <Surface
          style={[
            styles.contractInfo,
            { backgroundColor: colors.surface, borderColor: colors.outlineVariant },
          ]}
          elevation={0}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar.Icon
              size={40}
              icon="briefcase"
              style={{ backgroundColor: colors.primaryContainer, marginRight: 12 }}
              color={colors.onPrimaryContainer}
            />
            <View style={{ flex: 1 }}>
              <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                {contractDetails.tenant}
              </Text>
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {contractDetails.property} • House {contractDetails.house}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                {form.type === 'deposit' ? 'Target Deposit' : 'Target Rent'}
              </Text>
              <Text
                variant="titleSmall"
                style={{ color: colors.primary, fontWeight: 'bold' }}
              >
                {formatWithCurrency(effectiveRentAmount, defaultCurrency as any)}
              </Text>
              {isRentWaived && (
                <Text variant="labelSmall" style={{ color: colors.primary }}>
                  (Waived)
                </Text>
              )}
            </View>
          </View>
        </Surface>

        <TextInput
          label={`Amount (${defaultCurrency?.symbol || '$'})`}
          value={form.amount}
          onChangeText={handleAmountChange}
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

        <Text variant="bodyMedium" style={styles.label}>
          Receipt Date
        </Text>
        <DatePicker
          label="Select Receipt Date"
          value={form.payment_date || ''}
          onChange={date => setForm(prev => ({ ...prev, payment_date: date }))}
          style={styles.input}
        />
        {errors.payment_date && (
          <HelperText type="error">{errors.payment_date}</HelperText>
        )}

        <DatePicker
          label="Payment Period"
          mode="month"
          value={formatDateForDB(
            new Date(form.payment_period.year, form.payment_period.month - 1, 1),
          )}
          onChange={date => {
            if (date) {
              const d = parseLocalDate(date);
              setForm(prev => ({
                ...prev,
                payment_period: {
                  month: d.getMonth() + 1,
                  year: d.getFullYear(),
                },
              }));
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
          onValueChange={value => setForm(prev => ({ ...prev, status: value }))}
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
          onValueChange={value =>
            setForm(prev => ({
              ...prev,
              type: value,
              status: value === 'others' ? 'paid' : prev.status,
            }))
          }
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
          onValueChange={value => setForm(prev => ({ ...prev, payment_method: value }))}
          buttons={[
            { value: 'cash', label: 'Cash' },
            { value: 'bank', label: 'Bank' },
            { value: 'mpesa', label: 'M-Pesa' },
            { value: 'other', label: 'Other' },
          ]}
          style={styles.segmentedButton}
        />

        <TextInput
          label="Notes"
          value={form.notes}
          onChangeText={text => setForm(prev => ({ ...prev, notes: text }))}
          multiline
          numberOfLines={5}
          style={styles.input}
        />

        {/* Payment Messages Section */}
        <LinkedMessages
          messages={filteredMessages}
          selectedMessageIds={selectedMessageIds}
          linkedMessages={linkedPaymentMessages}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onMessageToggle={(message: PaymentMessage) => {
            const msgId = String(message.id);
            setSelectedMessageIds(prev => {
              const isSelected = prev.includes(msgId);
              if (isSelected) {
                return prev.filter(id => id !== msgId);
              } else {
                return [...prev, msgId];
              }
            });
          }}
          onShow={() => setLinkModalVisible(true)}
          visible={linkModalVisible}
          onDismiss={() => setLinkModalVisible(false)}
          onCreateNew={() => setMessagesListModalVisible(true)}
          onClearSelection={() => setSelectedMessageIds([])}
        />

        <Divider style={styles.divider} />

        <Button
          mode="contained"
          onPress={handleSubmit}
          style={styles.button}
          icon="check"
          loading={saving}
          disabled={saving}
        >
          Update Receipt
        </Button>
        <PaymentMessagesListModal
          visible={messagesListModalVisible}
          onDismiss={() => setMessagesListModalVisible(false)}
          mode="selection"
          onSelect={msg => {
            setMessagesListModalVisible(false);
            handleMessageCreated(msg as any);
          }}
        />
        <PaymentMessageModal
          visible={createMessageModalVisible}
          onDismiss={() => setCreateMessageModalVisible(false)}
          onMessageCreated={handleMessageCreated}
          businessId={selectedBusiness?.id || ''}
          existingMessages={paymentMessagesWithCounts as any}
        />
      </KeyboardScroll>
    </AccessGuard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    marginBottom: 8,
  },
  contractInfo: {
    padding: 12,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  label: {
    marginTop: 8,
    marginBottom: 8,
  },
  segmentedButton: {
    marginBottom: 16,
  },
  button: {
    marginTop: 20,
    marginBottom: 40,
  },
  errorText: {
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    marginTop: 8,
  },

  divider: {
    marginVertical: 12,
  },
});
