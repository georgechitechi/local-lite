import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Divider,
  HelperText,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import {
  checkExpenseDuplicate,
  type DuplicateCheckResult,
  EXPENSE_CATEGORY,
  extractTokenNumber,
} from '@/features/expenses/utils/expenseUtils';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useCurrency } from '@/shared/hooks/useCurrency';
import { useCoreMutations, useExpenses } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateForDB } from '@/shared/utils/formatters';
import { generateUUID } from '@/shared/utils/helper';
import { validateFields, validations } from '@/shared/utils/validations';

interface ExpenseModalProps {
  visible: boolean;
  onDismiss: () => void;
  expenseId?: string | null;
  onSuccess?: (id: string) => void;
  initialData?: {
    category?: string;
    description?: string;
    amount?: string;
    date?: string;
    maintenanceId?: string;
    houseId?: string;
    propertyId?: string;
  };
}

interface FormData {
  category: string;
  amount: string;
  date: string;
  remarks: string;
}

interface FormErrors {
  amount?: string;
  date?: string;
  category?: string;
  remarks?: string;
  [key: string]: string | undefined;
}

export default function ExpenseModal({
  visible,
  onDismiss,
  expenseId,
  onSuccess,
  initialData,
}: ExpenseModalProps) {
  const colors = useThemeColors();
  const { user } = useAuth();
  const { showSnackbar } = useSnackbar();
  const { selectedBusiness, requireBusiness } = useBusiness();
  const { insert, update } = useCoreMutations();
  const storeExpenses = useExpenses(selectedBusiness?.id);
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);
  const { can } = useAccessControl();

  const canEdit = can('edit', 'expense');
  const canCreate = can('create', 'expense');
  const hasPermission = expenseId ? canEdit : canCreate;

  const [formData, setFormData] = useState<FormData>({
    category: '',
    amount: '',
    date: formatDateForDB(new Date()),
    remarks: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateCheckResult | null>(
    null,
  );
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [originalData, setOriginalData] = useState<FormData | null>(null);

  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const handleDismiss = () => {
    setFormData({
      category: '',
      amount: '',
      date: formatDateForDB(new Date()),
      remarks: '',
    });
    setErrors({});
    setSubmitting(false);
    setShowDiscardModal(false);
    setDuplicateWarning(null);
    setShowDuplicateModal(false);
    setOriginalData(null);
    setInitializedKey(null);
    onDismiss();
  };

  useEffect(() => {
    if (!visible) return;

    const targetKey = expenseId ?? 'create';
    if (initializedKey === targetKey) return;

    if (expenseId) {
      const expense = storeExpenses.find(e => e.id === expenseId);
      if (expense) {
        const data = {
          category: expense.category,
          amount: expense.amount.toString(),
          date: expense.date,
          remarks: expense.remarks || '',
        };
        setFormData(data);
        setOriginalData(data);
      }
    } else if (initialData) {
      const data = {
        category:
          initialData.category || (initialData.maintenanceId ? 'Maintenance' : ''),
        amount: initialData.amount || '',
        date: initialData.date || formatDateForDB(new Date()),
        remarks: initialData.description || '',
      };
      setFormData(data);
      setOriginalData(null);
    } else {
      const data = {
        category: '',
        amount: '',
        date: formatDateForDB(new Date()),
        remarks: '',
      };
      setFormData(data);
      setOriginalData(null);
    }
    setErrors({});
    setInitializedKey(targetKey);
  }, [visible, expenseId, initialData, storeExpenses, initializedKey]);

  const validationRules = {
    category: validations.required,
    amount: validations.combine(validations.required, validations.amount),
    date: validations.combine(validations.required, validations.date),
    remarks: validations.required,
  };

  const validateForm = (): boolean => {
    const { isValid, errors: validationErrors } = validateFields(
      formData,
      validationRules,
    );
    setErrors(validationErrors);
    return isValid;
  };

  const hasChanges = (): boolean => {
    if (!originalData) {
      return (
        formData.category !== '' ||
        formData.amount !== '' ||
        formData.remarks !== '' ||
        formData.date !== formatDateForDB(new Date())
      );
    }
    return JSON.stringify(formData) !== JSON.stringify(originalData);
  };

  const saveExpense = async () => {
    try {
      setSubmitting(true);

      if (!user) throw new Error('User not found');

      const id = expenseId || generateUUID();
      const amountValue = formData.amount.replace(/,/g, '');
      const expenseData = {
        id,
        business_id: selectedBusiness?.id,
        user_id: user.id,
        category: formData.category,
        amount: Number.parseFloat(amountValue),
        date: formData.date,
        remarks: formData.remarks,
      };

      if (expenseId) {
        await update('expenses', expenseId, expenseData);
      } else {
        await insert('expenses', expenseData);

        // Link to maintenance if provided
        if (initialData?.maintenanceId) {
          await update('maintenance_requests', initialData.maintenanceId, {
            expense_id: id,
          });
        }
      }

      showSnackbar(
        `Expense ${expenseId ? 'updated' : 'created'} successfully!`,
        'success',
      );
      onSuccess?.(id);
      handleDismiss();
    } catch (error) {
      console.error('Error saving expense:', error);
      showSnackbar('Failed to save expense. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!validateForm() || !requireBusiness() || !selectedBusiness?.id) return;

    const amountValue = formData.amount.replace(/,/g, '');
    const amountNumber = Number.parseFloat(amountValue);

    const duplicateResult = checkExpenseDuplicate(
      {
        id: expenseId,
        amount: amountNumber,
        category: formData.category,
        date: formData.date,
        remarks: formData.remarks,
      },
      storeExpenses,
    );

    if (duplicateResult.isDuplicate) {
      setDuplicateWarning(duplicateResult);
      setShowDuplicateModal(true);
      showSnackbar(
        duplicateResult.message ||
          'Duplicate expense detected. Saving duplicates is not allowed.',
        'error',
      );
      return;
    }

    await saveExpense();
  };

  const handleCancel = () => {
    if (hasChanges()) {
      setShowDiscardModal(true);
    } else {
      handleDismiss();
    }
  };

  const detectedToken = extractTokenNumber(formData.remarks);
  const isDuplicateToken = useMemo(() => {
    if (!detectedToken) return null;
    return storeExpenses.find(
      e =>
        !e.deleted &&
        e.id !== expenseId &&
        extractTokenNumber(e.remarks) === detectedToken,
    );
  }, [detectedToken, storeExpenses, expenseId]);

  return (
    <BaseModal
      visible={visible}
      onDismiss={handleCancel}
      title={expenseId ? 'Edit Expense' : 'Create Expense'}
      subtitle={
        initialData?.maintenanceId
          ? `Linked to Maintenance Request ${initialData.maintenanceId.substring(0, 8)}...`
          : 'Enter expense details'
      }
      maxHeight="85%"
      scrollable={true}
      actions={[
        {
          label: hasPermission ? 'Cancel' : 'Close',
          onPress: handleCancel,
          mode: 'outlined',
          disabled: submitting,
        },
        ...(hasPermission
          ? [
              {
                label: expenseId ? 'Update Expense' : 'Save Expense',
                onPress: handleSubmit,
                mode: 'contained' as const,
                loading: submitting,
                disabled:
                  submitting || !!(expenseId && !hasChanges()) || !!isDuplicateToken,
              },
            ]
          : []),
      ]}
    >
      <View style={styles.container}>
        <Text variant="titleSmall" style={styles.sectionTitle}>
          Expense Category
        </Text>
        <SegmentedButtons
          value={formData.category}
          onValueChange={value => setFormData(prev => ({ ...prev, category: value }))}
          buttons={EXPENSE_CATEGORY.map(details => ({
            value: details.key,
            label: details.label,
            icon: details.icon as any,
          }))}
          style={styles.segmentedButtons}
        />
        {errors.category && (
          <HelperText type="error" visible={true}>
            {errors.category}
          </HelperText>
        )}

        <Divider style={styles.divider} />

        <TextInput
          value={formData.amount}
          onChangeText={text => setFormData(prev => ({ ...prev, amount: text }))}
          keyboardType="decimal-pad"
          style={styles.input}
          placeholder={`Enter amount in ${defaultCurrency?.symbol || ''}`}
          left={<TextInput.Icon icon="currency-usd" />}
          right={<TextInput.Affix text={defaultCurrency?.code || ''} />}
          mode="outlined"
          label={`Amount (${defaultCurrency?.symbol || '$'})`}
          error={!!errors.amount}
        />
        {errors.amount && (
          <HelperText type="error" visible={true}>
            {errors.amount}
          </HelperText>
        )}

        <Text variant="bodySmall" style={styles.label}>
          Expense Date
        </Text>
        <DatePicker
          label="Select Date"
          value={formData.date}
          onChange={date =>
            setFormData(prev => ({
              ...prev,
              date: date || formatDateForDB(new Date()),
            }))
          }
          style={styles.input}
        />
        {errors.date && (
          <HelperText type="error" visible={true}>
            {errors.date}
          </HelperText>
        )}

        <TextInput
          value={formData.remarks}
          onChangeText={text => setFormData(prev => ({ ...prev, remarks: text }))}
          style={[styles.input, styles.descriptionInput]}
          placeholder="Describe what this expense was for"
          multiline
          numberOfLines={5}
          mode="outlined"
          label="Description"
          error={!!errors.remarks || !!isDuplicateToken}
        />
        {errors.remarks && (
          <HelperText type="error" visible={true}>
            {errors.remarks}
          </HelperText>
        )}
        {detectedToken && isDuplicateToken && (
          <HelperText type="error" visible={true}>
            Duplicate token: #{detectedToken.replace(/(.{4})/g, '$1-').replace(/-$/, '')}{' '}
            already recorded on {isDuplicateToken.date} ({isDuplicateToken.amount})
          </HelperText>
        )}
        {detectedToken && !isDuplicateToken && (
          <HelperText type="info" visible={true} style={{ color: colors.primary }}>
            Token detected: {detectedToken.replace(/(.{4})/g, '$1-').replace(/-$/, '')}
          </HelperText>
        )}
      </View>

      <BaseModal
        visible={showDiscardModal}
        onDismiss={() => setShowDiscardModal(false)}
        mode="confirm"
        title="Discard Changes?"
        message="You have unsaved changes. Are you sure you want to discard them?"
        confirmText="Discard"
        destructive
        onConfirm={() => {
          setShowDiscardModal(false);
          handleDismiss();
        }}
      />

      <BaseModal
        visible={showDuplicateModal}
        onDismiss={() => setShowDuplicateModal(false)}
        mode="info"
        title="Duplicate Expense Detected"
        message={`${duplicateWarning?.message || 'An expense matching this record already exists.'}\n\nSaving duplicate expenses is not allowed. Please verify the token number or expense details.`}
        confirmText="Close"
        onConfirm={() => setShowDuplicateModal(false)}
      />
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  label: {
    marginBottom: 4,
  },
  input: {
    marginBottom: 12,
  },
  descriptionInput: {
    minHeight: 120,
  },
  segmentedButtons: {
    marginBottom: 12,
  },
  divider: {
    marginVertical: 16,
    opacity: 0.5,
  },
});
