import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Button,
  Chip,
  HelperText,
  List,
  Menu,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import SelectTenantModal from '@/features/tenants/components/SelectTenantModal';
import {
  findSuggestedTenants,
  type MatchResult,
} from '@/features/tenants/utils/tenantMatcher';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import LoadingOverlay from '@/shared/components/LoadingOverlay';
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
import type { PaymentMessage, Contract as StoreContract } from '@/shared/types/types';
import {
  formatDateForDB,
  formatWithCurrency,
  MONTHS,
  parseLocalDate,
  parsePeriod,
  YEARS,
} from '@/shared/utils/formatters';
import { generateUUID } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';

interface ExtendedContract extends StoreContract {
  tenant?: {
    name?: string | null;
  } | null;
  house?: {
    house_number?: string | null;
    property?: {
      name?: string | null;
    } | null;
  } | null;
}

interface CreateReceiptsFromMessageModalProps {
  visible: boolean;
  onDismiss: () => void;
  message: PaymentMessage | null;
  businessId: string;
}

export default function ReceiptsFromMessageModal({
  visible,
  onDismiss,
  message,
  businessId,
}: CreateReceiptsFromMessageModalProps) {
  const { user } = useAuth();

  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const { defaultCurrency } = useCurrency(businessId);
  const storeContracts = useContracts(businessId);
  const storeTenants = useTenants(businessId);
  const storeHouses = useHouses(businessId);
  const storeProperties = useProperties(businessId);
  const paymentMessages = usePaymentMessages(businessId);
  const paymentMessageReceipts = usePaymentMessageReceipts(businessId);
  const receipts = useReceipts(businessId);
  const { insertMany } = useCoreMutations();

  const [saving, setSaving] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [selectedContract, setSelectedContract] = useState<ExtendedContract | null>(null);
  const [isAutoMatched, setIsAutoMatched] = useState<MatchResult | null>(null);

  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(formatDateForDB(new Date()));
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [showYearMenu, setShowYearMenu] = useState(false);
  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  // Compute existing receipts for the selected contract and year to avoid duplicates
  const existingReceiptsForYear = React.useMemo(() => {
    if (!selectedContract || !selectedYear) return [];
    return receipts.filter(r => {
      if (r.contract_id !== selectedContract.id || r.is_refunded) return false;
      const period = parsePeriod(r.payment_period);
      return period?.year === selectedYear;
    });
  }, [receipts, selectedContract, selectedYear]);

  const conflictingMonths = existingReceiptsForYear
    .map(r => parsePeriod(r.payment_period)?.month)
    .filter((m): m is number => typeof m === 'number');
  const selectedConflicts = selectedMonths.filter(m => conflictingMonths.includes(m));

  // Compute active contracts with joined data (O(1) Map lookups)
  const activeContracts = React.useMemo(() => {
    if (!businessId) return [];
    const tenantMap = new Map(storeTenants.map((t: any) => [t.id, t]));
    const houseMap = new Map(storeHouses.map((h: any) => [h.id, h]));
    const propertyMap = new Map(storeProperties.map((p: any) => [p.id, p]));

    return storeContracts
      .filter((c: any) => isActiveContractStatus(c.status))
      .map((c: any) => {
        const tenant = tenantMap.get(c.tenant_id);
        const house = houseMap.get(c.house_id);
        const property = house ? propertyMap.get(house.property_id) : undefined;

        return {
          ...c,
          tenant: tenant
            ? {
                name: tenant.name,
              }
            : undefined,
          house: house
            ? {
                house_number: house.house_number,
                property: property ? { name: property.name } : undefined,
              }
            : undefined,
        } as ExtendedContract;
      });
  }, [storeContracts, storeTenants, storeHouses, storeProperties, businessId]);

  // Initialize and reset form when modal opens or message changes (once per open/message)
  useEffect(() => {
    if (!visible || !message) return;

    const targetKey = message.id;
    if (initializedKey === targetKey) return;

    // Initialize dates from message
    if (message.transaction_date) {
      const newPaymentDate = formatDateForDB(message.transaction_date);
      setPaymentDate(newPaymentDate);

      const msgDate = parseLocalDate(newPaymentDate);
      const msgMonth = msgDate.getMonth() + 1;
      const msgYear = msgDate.getFullYear();

      setSelectedMonths([msgMonth]);
      setSelectedYear(msgYear);
    } else {
      const today = formatDateForDB(new Date());
      const thisMonth = new Date().getMonth() + 1;
      const thisYear = new Date().getFullYear();

      setPaymentDate(today);
      setSelectedMonths([thisMonth]);
      setSelectedYear(thisYear);
    }

    // Reset selection state when message changes
    setSelectedContract(null);
    setIsAutoMatched(null);
    setAmount('');
    setInitializedKey(targetKey);
  }, [visible, message, initializedKey]);

  // Auto-match tenant when message or active contracts change
  useEffect(() => {
    if (visible && message && activeContracts.length > 0) {
      const suggestions = findSuggestedTenants(
        message.message_content || '',
        storeTenants,
        storeContracts,
        paymentMessages,
        paymentMessageReceipts,
        receipts,
      );

      if (suggestions.length > 0 && suggestions[0].confidence > 0.7) {
        const bestMatch = suggestions[0];
        const contract = activeContracts.find(c => c.tenant_id === bestMatch.tenantId);
        if (contract) {
          // Only auto-select if no contract is selected OR it was already an auto-match
          if (!selectedContract || isAutoMatched) {
            if (selectedContract?.id !== contract.id) {
              setSelectedContract(contract);
              setAmount(contract.rent_amount ? contract.rent_amount.toString() : '');
            }
            if (JSON.stringify(isAutoMatched) !== JSON.stringify(bestMatch)) {
              setIsAutoMatched(bestMatch);
            }
          }
        }
      } else {
        // Clear auto-match if confidence is low, but ONLY if it WAS an auto-match
        if (isAutoMatched) {
          setSelectedContract(null);
          setIsAutoMatched(null);
        }
      }
    }
  }, [
    visible,
    message,
    activeContracts,
    storeTenants,
    storeContracts,
    paymentMessages,
    paymentMessageReceipts,
    receipts,
    isAutoMatched,
    selectedContract,
  ]);

  const handleSelectContract = (tenantId: string) => {
    const contract = activeContracts.find(
      (c: ExtendedContract) => c.tenant_id === tenantId,
    );
    if (contract) {
      setSelectedContract(contract);
      setAmount(contract.rent_amount ? contract.rent_amount.toString() : '');
      setIsAutoMatched(null); // Clear auto-match once user manually selects
    }
    setShowContractModal(false);
  };

  const toggleMonth = (monthValue: number) => {
    if (selectedMonths.includes(monthValue)) {
      setSelectedMonths(selectedMonths.filter((m: number) => m !== monthValue));
    } else {
      setSelectedMonths(
        [...selectedMonths, monthValue].sort((a: number, b: number) => a - b),
      );
    }
  };

  const handleSave = async () => {
    if (!message || !businessId) return;

    if (!selectedContract) {
      showSnackbar('Please select a contract.', 'error');
      return;
    }

    if (!amount || Number.isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      showSnackbar('Please enter a valid amount.', 'error');
      return;
    }

    if (selectedMonths.length === 0) {
      showSnackbar('Please select at least one month.', 'error');
      return;
    }

    const numericAmount = parseFloat(amount);

    try {
      setSaving(true);

      if (!user?.id) {
        showSnackbar('User not authenticated', 'error');
        return;
      }

      // Build receipt records for local-lite
      let generatedReceiptCount = 0;
      const createdReceipts: string[] = [];
      const newReceipts = [];
      for (const month of selectedMonths) {
        const receiptId = generateUUID();
        createdReceipts.push(receiptId);

        // Ensure the status is determined nicely
        const status = numericAmount >= selectedContract.rent_amount ? 'paid' : 'partial';

        const newReceipt = {
          id: receiptId,
          contract_id: selectedContract.id,
          tenant_id: selectedContract.tenant_id,
          amount: numericAmount,
          payment_method: 'bank', // typical for messages
          payment_date: formatDateForDB(paymentDate),
          type: 'rent',
          status: status,
          notes: message.message_content || '',
          payment_period: { month, year: selectedYear },
          business_id: businessId,
          user_id: user.id,
          is_refunded: false,
          refunded_amount: 0,
        };

        newReceipts.push(newReceipt);
        generatedReceiptCount++;
      }

      // Save receipts via local-lite
      await insertMany('receipts', newReceipts);

      const junctions = createdReceipts.map(receiptId => ({
        id: generateUUID(),
        payment_message_id: message.id,
        receipt_id: receiptId,
        business_id: businessId,
        user_id: user.id,
      }));
      await insertMany('payment_message_receipts', junctions);

      showSnackbar(
        `Successfully created and linked ${generatedReceiptCount} receipt(s).`,
        'success',
      );
      handleDismiss();
    } catch (error) {
      console.error('Error generating receipts:', error);
      showSnackbar('Failed to generate receipts. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const getYearLabel = useCallback((year: number): string => {
    return year?.toString() || 'Select Year';
  }, []);

  const handleDismiss = () => {
    setInitializedKey(null);
    setSelectedContract(null);
    setIsAutoMatched(null);
    setAmount('');
    onDismiss();
  };

  return (
    <>
      <BaseModal
        visible={visible && !showContractModal}
        onDismiss={handleDismiss}
        title="Create Receipt"
        subtitle="Manage payments and receipts"
        scrollable={true}
        actions={[
          {
            label: 'Cancel',
            onPress: handleDismiss,
            mode: 'outlined',
            disabled: saving,
          },
          {
            label: saving ? 'Creating...' : 'Create',
            onPress: handleSave,
            mode: 'contained',
            loading: saving,
            disabled:
              saving ||
              selectedConflicts.length > 0 ||
              !selectedContract ||
              selectedMonths.length === 0,
          },
        ]}
      >
        <LoadingOverlay visible={saving} message="Saving Receipts..." />
        {message && (
          <Surface
            style={[
              styles.messagePreview,
              { backgroundColor: colors.primaryContainer, borderColor: colors.primary },
            ]}
            elevation={0}
          >
            <View style={styles.messageHeader}>
              <MaterialCommunityIcons
                name="email-outline"
                size={18}
                color={colors.onPrimaryContainer}
                style={styles.messageIcon}
              />
              <Text
                variant="labelLarge"
                style={{ color: colors.onPrimaryContainer, fontWeight: 'bold' }}
              >
                PAYMENT MESSAGE
              </Text>
            </View>
            <Text
              variant="bodyMedium"
              style={[styles.messageText, { color: colors.onPrimaryContainer }]}
            >
              {message.message_content || 'No message content'}
            </Text>
          </Surface>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons
              name="account-outline"
              size={20}
              color={colors.primary}
            />
            <Text
              variant="titleMedium"
              style={[styles.sectionTitle, { color: colors.primary }]}
            >
              Tenant & Contract
            </Text>
          </View>

          {selectedContract ? (
            <Surface
              style={[
                styles.contractCard,
                { borderColor: colors.outlineVariant, backgroundColor: colors.surface },
              ]}
              elevation={1}
            >
              <List.Item
                title={selectedContract.tenant?.name || 'Unknown'}
                titleStyle={{ fontWeight: 'bold', fontSize: 16 }}
                description={`${selectedContract.house?.property?.name || 'Unknown'} • House ${selectedContract.house?.house_number || 'Unknown'}`}
                descriptionStyle={{ color: colors.onSurfaceVariant }}
                right={_props => (
                  <View style={styles.contractRight}>
                    <Text
                      variant="labelSmall"
                      style={{
                        color: colors.onSurfaceVariant,
                        textTransform: 'uppercase',
                      }}
                    >
                      Monthly Rent
                    </Text>
                    <Text
                      variant="titleMedium"
                      style={{ color: colors.primary, fontWeight: 'bold' }}
                    >
                      {defaultCurrency
                        ? formatWithCurrency(
                            selectedContract.rent_amount,
                            defaultCurrency,
                          )
                        : formatWithCurrency(
                            selectedContract.rent_amount,
                            defaultCurrency as any,
                          )}
                    </Text>
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
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons name="cash" size={20} color={colors.primary} />
            <Text
              variant="titleMedium"
              style={[styles.sectionTitle, { color: colors.primary }]}
            >
              Receipt Details
            </Text>
          </View>
          <View style={styles.formRow}>
            <TextInput
              label="Amount per Receipt"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              mode="outlined"
              style={[styles.input, { flex: 1 }]}
              disabled={!selectedContract}
              left={
                defaultCurrency?.symbol ? (
                  <TextInput.Affix text={`${defaultCurrency.symbol} `} />
                ) : null
              }
            />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons
              name="calendar-outline"
              size={20}
              color={colors.primary}
            />
            <Text
              variant="titleMedium"
              style={[styles.sectionTitle, { color: colors.primary }]}
            >
              Payment Date
            </Text>
          </View>
          <DatePicker
            label="Payment Date"
            value={paymentDate}
            onChange={date => setPaymentDate(date || formatDateForDB(new Date()))}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons
              name="clock-outline"
              size={20}
              color={colors.primary}
            />
            <View style={[styles.row, { flex: 1, marginBottom: 0 }]}>
              <Text
                variant="titleMedium"
                style={[styles.sectionTitle, { color: colors.primary, marginBottom: 0 }]}
              >
                Select Period(s)
              </Text>
              <Menu
                visible={showYearMenu}
                onDismiss={() => setShowYearMenu(false)}
                anchor={
                  <Button
                    mode="text"
                    onPress={() => setShowYearMenu(true)}
                    compact
                    icon="chevron-down"
                    contentStyle={{ flexDirection: 'row-reverse' }}
                  >
                    {getYearLabel(selectedYear)}
                  </Button>
                }
              >
                {YEARS.map(year => (
                  <Menu.Item
                    key={year.value}
                    onPress={() => {
                      setSelectedYear(year.value);
                      setShowYearMenu(false);
                    }}
                    title={year.label}
                  />
                ))}
              </Menu>
            </View>
          </View>
          <View style={styles.chipGroup}>
            {MONTHS.map(month => {
              const isConflicting = conflictingMonths.includes(month.value);
              return (
                <Chip
                  key={month.value}
                  selected={selectedMonths.includes(month.value)}
                  onPress={() => toggleMonth(month.value)}
                  style={[
                    styles.chip,
                    isConflicting && {
                      borderColor: colors.error,
                      borderStyle: 'dashed',
                      opacity: 0.8,
                    },
                  ]}
                  mode="outlined"
                  showSelectedOverlay={true}
                  disabled={saving}
                >
                  {month.label.substring(0, 3)}
                </Chip>
              );
            })}
          </View>
          {selectedConflicts.length > 0 ? (
            <HelperText type="error" padding="none" style={{ marginTop: 8 }}>
              <MaterialCommunityIcons
                name="alert-circle"
                size={14}
                color={colors.error}
              />{' '}
              Existing receipts found for{' '}
              {selectedConflicts
                .map(m => MONTHS.find(mon => mon.value === m)?.label)
                .join(', ')}{' '}
              in {selectedYear}. Please edit the existing receipts instead.
            </HelperText>
          ) : (
            <HelperText type="info" padding="none" style={{ marginTop: 4 }}>
              Select multiple months to generate bulk receipts. One receipt per month will
              be created.
            </HelperText>
          )}
        </View>
      </BaseModal>

      {/* Contract Selection Modal */}
      {showContractModal && (
        <SelectTenantModal
          visible={true}
          onDismiss={() => setShowContractModal(false)}
          tenants={storeTenants}
          contracts={storeContracts}
          houses={storeHouses}
          properties={storeProperties}
          onSelect={selection => {
            if (Array.isArray(selection)) return;
            handleSelectContract(selection.id);
          }}
          selectedId={selectedContract?.tenant_id || undefined}
          title="Select Contract"
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  messagePreview: {
    marginVertical: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  messageIcon: {
    marginRight: 8,
  },
  messageText: {
    lineHeight: 20,
    opacity: 0.9,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontWeight: 'bold',
  },
  contractCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  contractRight: {
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  selectorButton: {
    borderRadius: 12,
    borderWidth: 1.5,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  input: {
    backgroundColor: 'transparent',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  chipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    borderRadius: 10,
    width: '30%',
  },
});
