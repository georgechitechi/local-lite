import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import * as Print from 'expo-print';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Avatar,
  Button,
  Divider,
  HelperText,
  List,
  SegmentedButtons,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import PaymentMessageModal from '@/features/payments/components/PaymentMessageModal';
import PaymentMessagesListModal from '@/features/payments/components/PaymentMessagesListModal';
import ReceiptFormFields from '@/features/receipts/components/ReceiptFormFields';
import {
  calculateReceiptTargetRent,
  getAmountAffix,
} from '@/features/receipts/utils/receiptHelper';
import {
  findSuggestedTenants,
  type MatchResult,
} from '@/features/tenants/utils/tenantMatcher';
import { useAuth } from '@/providers/AuthProvider';
import { Protect } from '@/shared/access';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import EmptyState from '@/shared/components/EmptyState';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import { useCurrency } from '@/shared/hooks/useCurrency';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
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
import { sendReceiptEmail } from '@/shared/services/emailService';
import { sendNotification } from '@/shared/services/notifications';
import type {
  Contract as StoreContract,
  PaymentMessage as StorePaymentMessage,
} from '@/shared/types/types';
import {
  formatDateForDB,
  formatWithCurrency,
  MONTHS,
  parseLocalDate,
} from '@/shared/utils/formatters';
import {
  calculateEffectiveRent,
  generateUUID,
  parseMetadata,
} from '@/shared/utils/helper';
import { formatImportedNote } from '@/shared/utils/messageFormatter';
import { extractMessageMetadata } from '@/shared/utils/parsers';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import { validateFields, validations } from '@/shared/utils/validations';
import { generateReceiptHTML } from '@/templates/receiptTemplate';

interface ReceiptForm {
  contract_id: string;
  tenant_id: string | undefined;
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
}

interface ExtendedContract extends StoreContract {
  tenant?: {
    name?: string | null;
    email?: string | null;
    next_of_kin?: { name?: string; phone?: string }[] | null;
  } | null;
  house?: {
    house_number?: string | null;
    property?: {
      name?: string | null;
    } | null;
  } | null;
}

interface ExtendedPaymentMessage extends StorePaymentMessage {
  linked_receipts_count?: number;
}

interface FormErrors {
  contract_id?: string;
  amount?: string;
  payment_method?: string;
  payment_date?: string;
  type?: string;
  month?: string;
  year?: string;
  contract?: string;
  [key: string]: string | undefined;
}

export default function CreateReceiptScreen() {
  const { user } = useAuth();

  const router = useRouter();
  const params = useLocalSearchParams();
  const { selectedBusiness, requireBusiness } = useBusiness();
  const { checkOnline } = useOfflineCheck();
  const { insert, update } = useCoreMutations();
  const storeContracts = useContracts(selectedBusiness?.id);
  const storeTenants = useTenants(selectedBusiness?.id);
  const storeHouses = useHouses(selectedBusiness?.id);
  const storeProperties = useProperties(selectedBusiness?.id);
  const storeReceipts = useReceipts(selectedBusiness?.id);
  const storePaymentMessages = usePaymentMessages(selectedBusiness?.id);
  const paymentMessageReceipts = usePaymentMessageReceipts(selectedBusiness?.id);

  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const [submitting, setSubmitting] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);
  const [contractSearch, setContractSearch] = useState('');
  const [selectedBankMessages, setSelectedBankMessages] = useState<
    ExtendedPaymentMessage[]
  >([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [emailReceiptsEnabled, setEmailReceiptsEnabled] = useState(true);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [createMessageModalVisible, setCreateMessageModalVisible] = useState(false);
  const [messagesListModalVisible, setMessagesListModalVisible] = useState(false);
  const [linkModalVisible, setLinkModalVisible] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState<string | undefined>(undefined);
  const [isAutoMatched, setIsAutoMatched] = useState<MatchResult | null>(null);
  const [existingReceiptInfo, setExistingReceiptInfo] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [justCreatedReceipt, setJustCreatedReceipt] = useState<any>(null);

  const [form, setForm] = useState<ReceiptForm>({
    contract_id: (params.contractId as string) || '',
    tenant_id: '',
    amount: '',
    payment_method: 'bank',
    payment_date: formatDateForDB(new Date()),
    type: 'rent',
    status: 'paid',
    notes: '',
    payment_period: {
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    },
  });

  const [errors, setErrors] = useState<FormErrors>({});

  // Derived Contracts List
  const processedContracts = useMemo(() => {
    return storeContracts
      .filter(c => isActiveContractStatus(c.status))
      .map(c => {
        const tenant = storeTenants.find(t => t.id === c.tenant_id);
        const house = storeHouses.find(h => h.id === c.house_id);
        const property = house
          ? storeProperties.find(p => p.id === house.property_id)
          : undefined;
        return {
          ...c,
          tenant: tenant
            ? { name: tenant.name, email: tenant.email, next_of_kin: tenant.next_of_kin }
            : undefined,
          house: house
            ? {
                house_number: house.house_number,
                property: property ? { name: property.name } : undefined,
              }
            : undefined,
        } as ExtendedContract;
      });
  }, [storeContracts, storeTenants, storeHouses, storeProperties]);

  const filteredContracts = useMemo(() => {
    if (!contractSearch.trim()) return processedContracts;
    const search = contractSearch.toLowerCase();
    return processedContracts.filter(
      c =>
        c.tenant?.name?.toLowerCase().includes(search) ||
        c.house?.house_number?.toLowerCase().includes(search),
    );
  }, [processedContracts, contractSearch]);

  const contractDetails = useMemo(() => {
    const c = processedContracts.find(c => c.id === form.contract_id);
    return {
      tenant: c?.tenant?.name || '',
      property: c?.house?.property?.name || '',
      house: c?.house?.house_number || '',
      rent_amount: c?.rent_amount || 0,
    };
  }, [form.contract_id, processedContracts]);

  // Derived Messages List
  const bankMessages = useMemo(() => {
    return storePaymentMessages
      .map(msg => ({
        ...msg,
        linked_receipts_count: paymentMessageReceipts.filter(
          pmr => pmr.payment_message_id === msg.id,
        ).length,
      }))
      .sort(
        (a, b) =>
          new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime(),
      );
  }, [storePaymentMessages, paymentMessageReceipts]);

  const filteredMessages = useMemo(() => {
    if (!searchQuery.trim()) return bankMessages;
    const search = searchQuery.toLowerCase();
    return bankMessages.filter(msg => msg.message_content.toLowerCase().includes(search));
  }, [bankMessages, searchQuery]);

  // Handle search query change
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  const resetForm = useCallback(() => {
    setForm({
      contract_id: '',
      tenant_id: '',
      amount: '',
      payment_method: 'cash',
      payment_date: formatDateForDB(new Date()),
      type: 'rent',
      status: 'paid',
      notes: '',
      payment_period: {
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
      },
    });
    setErrors({});
    setSelectedBankMessages([]);
    setActiveMessageId(undefined);
  }, []);

  const selectContract = useCallback(
    (contract: ExtendedContract) => {
      setIsAutoMatched(null);

      const { effectiveRentAmount } = calculateReceiptTargetRent(
        contract,
        form.payment_period.month,
        form.payment_period.year,
        form.type,
      );

      setForm(prev => ({
        ...prev,
        contract_id: contract.id,
        tenant_id: contract.tenant_id || undefined,
        amount: effectiveRentAmount > 0 ? effectiveRentAmount.toString() : '',
        status: 'paid',
      }));
      setShowContractModal(false);
    },
    [form.payment_period.month, form.payment_period.year, form.type],
  );

  // Stable initialization sequence
  const [hasInitialized, setHasInitialized] = useState(false);
  useEffect(() => {
    // Only run if we have data and it's not already initialized
    if (processedContracts.length > 0 && !hasInitialized) {
      if (!params.contractId && !params.messageId) {
        resetForm();
      } else if (params.contractId) {
        const selected = processedContracts.find(c => c.id === params.contractId);
        if (selected) selectContract(selected);
      }
      setHasInitialized(true);
    }
  }, [
    processedContracts,
    params.contractId,
    params.messageId,
    hasInitialized,
    resetForm,
    selectContract,
  ]);

  const { effectiveRentAmount, isRentWaived } = useMemo(() => {
    if (!form.contract_id) return { effectiveRentAmount: 0, isRentWaived: false };
    const contract = storeContracts.find(c => c.id === form.contract_id);
    return calculateReceiptTargetRent(
      contract,
      form.payment_period.month,
      form.payment_period.year,
      form.type,
    );
  }, [
    form.contract_id,
    form.type,
    form.payment_period.month,
    form.payment_period.year,
    storeContracts,
  ]);

  const amountAffix = useMemo(() => {
    if (form.type === 'others' || !form.contract_id) return null;
    return getAmountAffix(form.amount, effectiveRentAmount, defaultCurrency);
  }, [form.amount, effectiveRentAmount, form.contract_id, form.type, defaultCurrency]);

  // Define validation rules
  const validationRules = {
    contract_id: validations.required,
    amount: validations.combine(validations.required, validations.amount),
    payment_method: validations.required,
    type: validations.required,
    payment_date: validations.combine(validations.required, validations.date),
    'payment_period.month': validations.required,
    'payment_period.year': validations.required,
  };

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

  // Sync amount when period changes and type is rent
  const handlePeriodChange = (month: number, year: number) => {
    const contract = storeContracts.find(c => c.id === form.contract_id);
    if (contract && form.type === 'rent') {
      const { effectiveRentAmount } = calculateReceiptTargetRent(
        contract,
        month,
        year,
        'rent',
      );

      setForm(prev => ({
        ...prev,
        payment_period: { month, year },
        amount: effectiveRentAmount > 0 ? effectiveRentAmount.toString() : '',
        status: 'paid',
      }));
    } else {
      setForm(prev => ({
        ...prev,
        payment_period: { month, year },
      }));
    }
  };

  const handleMessageCreated = (newMessage: any) => {
    setSearchQuery('');

    // Ensure it's selected in the selection list
    setSelectedBankMessages(prev => {
      const exists = prev.some(msg => msg.id === newMessage.id);
      if (exists) return prev;
      return [newMessage, ...prev];
    });

    setActiveMessageId(newMessage.id);

    // Auto-fill form from the new message
    const metadata = extractMessageMetadata(newMessage.message_content);
    if (metadata.amount) {
      handleAmountChange(metadata.amount);
    }

    // Append message to notes using template
    setForm(prev => ({
      ...prev,
      notes: formatImportedNote(prev.notes, newMessage.message_content),
    }));

    // Re-run matching to get the tenant if we don't have it
    const suggestions = findSuggestedTenants(
      newMessage.message_content,
      storeTenants,
      processedContracts as any,
      storePaymentMessages,
      paymentMessageReceipts,
      storeReceipts,
    );

    if (suggestions.length > 0 && suggestions[0].confidence > 0.6) {
      const contract = processedContracts.find(
        c => c.tenant_id === suggestions[0].tenantId,
      );
      if (contract) {
        selectContract(contract);
        setIsAutoMatched(suggestions[0]);
      }
    }

    setLinkModalVisible(true);
  };

  const finalizeCreation = () => {
    resetForm();
    setSelectedBankMessages([]);
    setSearchQuery('');
    router.replace('/(tabs)/receipts');
  };

  const handleSendEmail = async (receipt: any, tenant: any, messages?: any[]) => {
    if (!checkOnline('Send Email')) return;

    setSendingEmail(true);
    try {
      // Prepare full receipt data for PDF generation
      const selectedContract = processedContracts.find(c => c.id === receipt.contract_id);
      const receiptForPdf = {
        ...receipt,
        tenantName: tenant?.name || selectedContract?.tenant?.name,
        tenantPhone: tenant?.phone || '',
        linked_payment_messages: messages || selectedBankMessages,
        contract: {
          rent_amount: selectedContract?.rent_amount,
          house: {
            house_number: selectedContract?.house?.house_number,
          },
        },
      };

      const html = generateReceiptHTML(
        receiptForPdf,
        selectedBusiness as any,
        defaultCurrency as any,
      );

      const { base64 } = await Print.printToFileAsync({ html, base64: true });

      await sendReceiptEmail(receipt, tenant, base64);

      // Update metadata with sent status
      const metadata = {
        ...(receipt.metadata || {}),
        sent_at: new Date().toISOString(),
      };
      await update('receipts', receipt.id, { metadata });

      showSnackbar('Email sent successfully!', 'success');
    } catch (error: any) {
      showSnackbar(`Failed to send email: ${error.message}`, 'error');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSubmit = async () => {
    if (!validateForm() || !requireBusiness() || !selectedBusiness?.id) return;

    try {
      // Check for existing receipt in store
      const existingReceipt = storeReceipts.find(
        r =>
          r.contract_id === form.contract_id &&
          r.type === form.type &&
          form.type !== 'others' &&
          (r.payment_period as any)?.month === form.payment_period.month &&
          (r.payment_period as any)?.year === form.payment_period.year,
      );

      if (existingReceipt) {
        const monthName = MONTHS.find(m => m.value === form.payment_period.month)?.label;
        const typeLabel =
          form.type === 'rent' ? 'Rent' : form.type === 'deposit' ? 'Deposit' : 'Others';
        setExistingReceiptInfo({
          id: existingReceipt.id,
          message: `A ${typeLabel} receipt already exists for ${contractDetails.tenant} for ${monthName} ${form.payment_period.year}. Would you like to edit the existing receipt?`,
        });
        return;
      }

      setSubmitting(true);

      if (!user) throw new Error('User not authenticated');

      // Verify contract exists in store
      const contractExists = storeContracts.some(c => c.id === form.contract_id);
      if (!contractExists) throw new Error('Contract not found');

      const receiptNotes = form.notes || '';
      const receiptId = generateUUID();

      // payment_date is required, ensure it's not null
      if (!form.payment_date) {
        throw new Error('Payment date is required');
      }

      const newReceipt = {
        id: receiptId,
        contract_id: form.contract_id,
        tenant_id:
          form.tenant_id ||
          storeContracts.find(c => c.id === form.contract_id)?.tenant_id,
        amount: parseFloat(form.amount),
        payment_method: form.payment_method,
        payment_date: formatDateForDB(form.payment_date),
        type: form.type,
        status: form.status,
        notes: receiptNotes || null,
        payment_period: form.payment_period,
        business_id: selectedBusiness.id,
        user_id: user.id,
        is_refunded: false,
        refunded_amount: 0,
      };

      // Insert receipt into local SQLite
      await insert('receipts', newReceipt);

      sendNotification(
        'Payment Received',
        `A payment of ${form.amount} has been successfully recorded.`,
        { type: 'payment', paymentId: receiptId },
      ).catch(() => {});

      // Link payment messages
      if (selectedBankMessages.length > 0) {
        for (const msg of selectedBankMessages) {
          const junctionId = generateUUID();
          await insert('payment_message_receipts', {
            id: junctionId,
            payment_message_id: msg.id,
            receipt_id: receiptId,
            business_id: selectedBusiness.id,
            user_id: user.id,
          });
        }
      }

      const successMessage =
        selectedBankMessages.length > 0
          ? `Receipt created successfully with ${selectedBankMessages.length} payment message${selectedBankMessages.length > 1 ? 's' : ''}!`
          : 'Receipt created successfully!';

      // Get selected contract to find tenant details
      const selectedContract = processedContracts.find(c => c.id === form.contract_id);

      if (emailReceiptsEnabled && selectedContract?.tenant?.email) {
        setJustCreatedReceipt(newReceipt);
        setShowSuccessModal(true);
      } else {
        showSnackbar(successMessage, 'success');
        finalizeCreation();
      }
    } catch (error: any) {
      console.error('Error creating receipt:', error);
      showSnackbar(`Failed to create receipt: ${error.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Protect action="create" resource="receipt">
      <KeyboardScroll
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <View style={styles.pageHeader}>
          <View>
            <Text variant="headlineSmall" style={{ fontWeight: 'bold' }}>
              Create Receipt
            </Text>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              Create a new payment receipt
            </Text>
          </View>
          <Button
            mode="contained-tonal"
            icon="message-plus"
            onPress={() => setMessagesListModalVisible(true)}
          >
            Messages
          </Button>
        </View>

        <Text
          variant="titleSmall"
          style={[styles.sectionTitle, { color: colors.primary, marginBottom: 8 }]}
        >
          Select Contract
        </Text>
        {form.contract_id ? (
          <Surface
            style={[
              styles.contractCard,
              { borderColor: colors.outline, backgroundColor: colors.surface },
            ]}
            elevation={0}
          >
            <List.Item
              title={contractDetails.tenant || 'Unknown'}
              titleStyle={{ fontWeight: '600' }}
              description={`${contractDetails.property || 'Unknown'} - House ${contractDetails.house || 'Unknown'}`}
              left={props => <List.Icon {...props} icon="office-building" />}
              right={_props => (
                <View style={styles.contractRight}>
                  <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                    Expected
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
              )}
              onPress={() => setShowContractModal(true)}
            />
          </Surface>
        ) : (
          <Button
            mode="outlined"
            icon="office-building-plus"
            onPress={() => setShowContractModal(true)}
            style={styles.selectorButton}
            contentStyle={{ paddingVertical: 8 }}
          >
            Select Contract / Tenant
          </Button>
        )}

        {isAutoMatched && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: 4,
              paddingHorizontal: 4,
            }}
          >
            <MaterialCommunityIcons
              name="apps"
              size={14}
              color={colors.primary}
              style={{ marginRight: 4 }}
            />
            <Text
              variant="labelSmall"
              style={{ color: colors.primary, fontWeight: 'bold' }}
            >
              Suggested: {isAutoMatched.reason}
            </Text>
            {isAutoMatched.matchedValue && (
              <Text
                variant="labelSmall"
                style={{ color: colors.onSurfaceVariant, marginLeft: 4 }}
              >
                - {isAutoMatched.matchedValue}
              </Text>
            )}
          </View>
        )}
        {errors.contract && <HelperText type="error">{errors.contract}</HelperText>}
        {emailReceiptsEnabled &&
          form.contract_id &&
          !processedContracts.find(c => c.id === form.contract_id)?.tenant?.email && (
            <HelperText
              type="info"
              style={{ color: colors.primary }}
              onPress={() => setEmailReceiptsEnabled(false)}
            >
              Tenant has no email on file. Email receipts will not be sent automatically.
            </HelperText>
          )}

        <ReceiptFormFields
          form={form}
          setForm={setForm}
          errors={errors}
          defaultCurrency={defaultCurrency}
          amountAffix={amountAffix}
          isRentWaived={isRentWaived}
          onAmountChange={handleAmountChange}
          onPeriodChange={handlePeriodChange}
          onTypeChange={value => {
            const contract = storeContracts.find(c => c.id === form.contract_id);
            let newAmount = form.amount;
            if (contract) {
              if (value === 'deposit') {
                newAmount = String((contract as any).deposit_amount || '');
              } else if (value === 'rent') {
                const metadata = parseMetadata(contract.metadata);
                const breaks = metadata.breaks || [];
                const { effectiveRent } = calculateEffectiveRent(
                  Number(contract.rent_amount || 0),
                  form.payment_period.month,
                  form.payment_period.year,
                  breaks,
                );
                newAmount = effectiveRent > 0 ? String(effectiveRent) : '';
              }
            }

            setForm(prev => ({
              ...prev,
              type: value,
              status: value === 'others' ? 'paid' : prev.status,
              amount: newAmount,
            }));
          }}
          messages={filteredMessages as any[]}
          selectedMessageIds={selectedBankMessages.map(msg => msg.id)}
          linkedMessages={[]}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onMessageToggle={(message: any) => {
            const isSelected = selectedBankMessages.some(msg => msg.id === message.id);
            let newSelection: ExtendedPaymentMessage[];
            if (isSelected) {
              newSelection = selectedBankMessages.filter(msg => msg.id !== message.id);
            } else {
              newSelection = [...selectedBankMessages, message];
            }
            setSelectedBankMessages(newSelection);
          }}
          linkModalVisible={linkModalVisible}
          setLinkModalVisible={setLinkModalVisible}
          activeMessageId={activeMessageId}
          setActiveMessageId={setActiveMessageId}
          onCreateNewMessage={() => {
            setLinkModalVisible(false);
            setCreateMessageModalVisible(true);
          }}
          onClearSelection={() => setSelectedBankMessages([])}
        />

        <Divider style={styles.divider} />

        <Button
          mode="contained"
          onPress={handleSubmit}
          style={styles.button}
          icon="check"
          loading={submitting}
          disabled={submitting}
        >
          Create Receipt
        </Button>

        <BaseModal
          visible={showContractModal}
          onDismiss={() => setShowContractModal(false)}
          title="Select Contract"
          subtitle="Manage property contracts"
          maxHeight="85%"
          scrollable={true}
          search={{
            placeholder: 'Search contracts...',
            value: contractSearch,
            onChangeText: setContractSearch,
          }}
          actions={[
            {
              label: 'Close',
              onPress: () => setShowContractModal(false),
              mode: 'outlined',
            },
          ]}
        >
          {filteredContracts.map(contract => (
            <React.Fragment key={contract.id}>
              <List.Item
                title={contract.tenant?.name || 'Unknown Tenant'}
                description={`${contract.house?.property?.name} - House ${contract.house?.house_number}`}
                onPress={() => selectContract(contract)}
                right={() => (
                  <Text style={styles.rentAmount}>
                    {defaultCurrency
                      ? formatWithCurrency(contract.rent_amount, defaultCurrency)
                      : formatWithCurrency(contract.rent_amount, defaultCurrency as any)}
                  </Text>
                )}
                style={styles.contractItem}
              />
              <Divider />
            </React.Fragment>
          ))}
          {filteredContracts.length === 0 && (
            <EmptyState
              icon="file-document-outline"
              title="No contracts found"
              description={
                contractSearch
                  ? 'Try a different search term'
                  : 'No active contracts available'
              }
            />
          )}
        </BaseModal>

        <PaymentMessagesListModal
          visible={messagesListModalVisible}
          onDismiss={() => setMessagesListModalVisible(false)}
          mode="management"
          onSelect={msg => {
            setMessagesListModalVisible(false);
            handleMessageCreated(msg);
          }}
        />

        <PaymentMessageModal
          visible={createMessageModalVisible}
          onDismiss={() => setCreateMessageModalVisible(false)}
          onMessageCreated={handleMessageCreated}
          businessId={selectedBusiness?.id || ''}
          existingMessages={bankMessages as any}
        />

        <BaseModal
          visible={showSuccessModal}
          loading={sendingEmail}
          onDismiss={() => {
            setShowSuccessModal(false);
            finalizeCreation();
          }}
          mode="confirm"
          confirmText="Done"
          cancelText="Email Receipt"
          onConfirm={() => {
            setShowSuccessModal(false);
            finalizeCreation();
          }}
          onCancel={async () => {
            const contract = processedContracts.find(
              c => c.id === justCreatedReceipt?.contract_id,
            );
            const currentMessages = [...selectedBankMessages];
            setShowSuccessModal(false);

            // Trigger email in background without waiting
            handleSendEmail(justCreatedReceipt, contract?.tenant, currentMessages);

            // Navigate immediately
            finalizeCreation();
          }}
          title="Receipt Created"
        >
          <View style={{ gap: 16, padding: 8 }}>
            <View style={{ alignItems: 'center', gap: 8, marginVertical: 8 }}>
              <Avatar.Icon
                size={64}
                icon="check-circle"
                style={{ backgroundColor: colors.primaryContainer }}
                color={colors.primary}
              />
              <Text
                variant="headlineSmall"
                style={{ fontWeight: 'bold', textAlign: 'center' }}
              >
                Success!
              </Text>
              <Text variant="bodyMedium" style={{ textAlign: 'center', opacity: 0.7 }}>
                The receipt for{' '}
                {
                  processedContracts.find(c => c.id === justCreatedReceipt?.contract_id)
                    ?.tenant?.name
                }{' '}
                has been created successfully. Would you like to email it now?
              </Text>
            </View>
          </View>
        </BaseModal>

        <BaseModal
          visible={!!existingReceiptInfo}
          onDismiss={() => setExistingReceiptInfo(null)}
          mode="confirm"
          title="Existing Receipt Found"
          message={existingReceiptInfo?.message || ''}
          confirmText="Edit Existing"
          onConfirm={() => {
            const id = existingReceiptInfo?.id;
            setExistingReceiptInfo(null);
            if (id) router.push(`/receipts/edit/${id}`);
          }}
        />
      </KeyboardScroll>
    </Protect>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  input: {
    marginBottom: 8,
  },
  contractCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    overflow: 'hidden',
  },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  contractRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 8,
  },
  selectorButton: {
    borderRadius: 12,
    marginBottom: 8,
  },
  sectionTitle: {
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  rentAmount: {
    marginTop: 4,
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
  contractItem: {
    paddingVertical: 8,
  },
  divider: {
    marginVertical: 16,
  },
});
