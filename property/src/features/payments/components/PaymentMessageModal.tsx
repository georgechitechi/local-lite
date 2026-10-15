import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, IconButton, Text, TextInput } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { isRawFormat } from '@/features/tenants/utils/bulkMessageParser';
import { MessageDuplicateChecker } from '@/features/tenants/utils/MessageDuplicateChecker';
import {
  findSuggestedTenants,
  type MatchResult,
} from '@/features/tenants/utils/tenantMatcher';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { useCoreMutations } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { Contract, PaymentMessage, Tenant } from '@/shared/types/types';
import { formatDateForDB } from '@/shared/utils/formatters';
import { generateUUID } from '@/shared/utils/helper';
import { transformBankMessage } from '@/shared/utils/messageFormatter';

interface PaymentMessageModalProps {
  visible: boolean;
  onDismiss: () => void;
  businessId: string;
  existingMessages: PaymentMessage[];
  onMessageCreated?: (message: PaymentMessage) => void;
  onMessageUpdated?: (message: PaymentMessage) => void;
  store?: any;
  messageToEdit?: PaymentMessage | null;
  tenants?: Tenant[];
  contracts?: Contract[];
  paymentMessageReceipts?: any[];
  receipts?: any[];
}

// Local sub-component to isolate text input state and prevent modal-wide re-renders during typing
const MessageInput = React.memo(
  ({
    initialValue,
    onValueChange,
    error,
    colors,
    originalValue,
    showOriginal,
    onFixFormat,
    onRevert,
    onToggleOriginal,
    matchResult,
  }: {
    initialValue: string;
    onValueChange: (text: string) => void;
    error: string;
    colors: any;
    originalValue: string | null;
    showOriginal: boolean;
    onFixFormat: () => void;
    onRevert: () => void;
    onToggleOriginal: (visible: boolean) => void;
    matchResult?: MatchResult | null;
  }) => {
    const [localValue, setLocalValue] = useState(initialValue);

    // Sync with local state only when initialValue changes from parent (e.g. loading a message)
    React.useEffect(() => {
      setLocalValue(initialValue);
    }, [initialValue]);

    const handleChangeText = (text: string) => {
      setLocalValue(text);
      onValueChange(text);
    };

    const showFixFormat = isRawFormat(localValue);

    return (
      <View style={styles.inputContainer}>
        {matchResult && !error && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 8,
              paddingHorizontal: 4,
            }}
          >
            <MaterialCommunityIcons
              name="auto-fix"
              size={14}
              color={colors.primary}
              style={{ marginRight: 4 }}
            />
            <Text
              variant="labelSmall"
              style={{ color: colors.primary, fontWeight: 'bold' }}
            >
              Suggested: {matchResult.reason}
              {matchResult.matchedValue && ` (${matchResult.matchedValue})`}
            </Text>
          </View>
        )}
        <TextInput
          label="Message Content"
          value={localValue}
          onChangeText={handleChangeText}
          multiline
          numberOfLines={12}
          style={{ backgroundColor: colors.surface, height: 260 }}
          placeholder="Paste the exact content of the payment message..."
          mode="outlined"
          error={!!error}
        />
        {originalValue && showOriginal && (
          <View
            style={[styles.originalPreview, { backgroundColor: colors.surfaceVariant }]}
          >
            <View style={styles.previewHeader}>
              <Text
                variant="labelSmall"
                style={{ color: colors.primary, fontWeight: 'bold' }}
              >
                RAW ORIGINAL DATA
              </Text>
              <IconButton
                icon="close-circle-outline"
                size={16}
                onPress={() => onToggleOriginal(false)}
                style={{ margin: 0 }}
              />
            </View>
            <Text
              variant="bodySmall"
              style={{ color: colors.onSurfaceVariant, fontSize: 11 }}
            >
              {originalValue}
            </Text>
          </View>
        )}
        <View style={styles.inputFooter}>
          <View style={{ flex: 1 }}>
            {showFixFormat && (
              <Button
                mode="text"
                compact
                icon="auto-fix"
                onPress={onFixFormat}
                style={{ alignSelf: 'flex-start' }}
                labelStyle={{ fontSize: 12 }}
              >
                Fix Format
              </Button>
            )}
            {originalValue !== null && !showFixFormat && (
              <Button
                mode="text"
                compact
                icon={showOriginal ? 'eye-off' : 'eye'}
                onPress={() => onToggleOriginal(!showOriginal)}
                style={{ alignSelf: 'flex-start' }}
                labelStyle={{ fontSize: 12 }}
              >
                {showOriginal ? 'Hide Original' : 'View Original'}
              </Button>
            )}
            {error ? (
              <HelperText type="error" visible={!!error} style={styles.helperText}>
                {error}
              </HelperText>
            ) : null}
          </View>
          {originalValue && (
            <Button
              mode="text"
              compact
              icon="undo"
              onPress={onRevert}
              labelStyle={{ fontSize: 11 }}
              style={{ marginTop: 4 }}
            >
              Revert Original
            </Button>
          )}
        </View>
      </View>
    );
  },
);

MessageInput.displayName = 'MessageInput';

function PaymentMessageModalComponent({
  visible,
  onDismiss,
  businessId,
  existingMessages,
  onMessageCreated,
  onMessageUpdated,
  store,
  messageToEdit,
  tenants = [],
  contracts = [],
  paymentMessageReceipts = [],
  receipts = [],
}: PaymentMessageModalProps) {
  const { user } = useAuth();
  const { insert, update } = useCoreMutations();
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const [messageContent, setMessageContent] = useState('');
  const [originalValue, setOriginalValue] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [transactionDate, setTransactionDate] = useState(formatDateForDB(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [initializedKey, setInitializedKey] = React.useState<string | null>(null);

  // Initialize state when modal opens or messageToEdit changes (once per open)
  React.useEffect(() => {
    if (!visible) return;

    const targetKey = messageToEdit?.id ?? 'create';
    if (initializedKey === targetKey) return;

    setError('');
    setOriginalValue(null);
    setShowOriginal(false);
    if (messageToEdit) {
      setMessageContent(messageToEdit.message_content);
      setTransactionDate(
        formatDateForDB(messageToEdit.transaction_date) || formatDateForDB(new Date()),
      );
      setMatchResult(null);
    } else {
      setMessageContent('');
      setTransactionDate(formatDateForDB(new Date()));
      setMatchResult(null);
    }
    setInitializedKey(targetKey);
  }, [visible, messageToEdit, initializedKey]);

  const resetForm = () => {
    setMessageContent('');
    setOriginalValue(null);
    setShowOriginal(false);
    setTransactionDate(formatDateForDB(new Date()));
    setError('');
    setMatchResult(null);
  };

  const handleDismiss = () => {
    resetForm();
    setInitializedKey(null);
    onDismiss();
  };

  const handleSave = async () => {
    if (!messageContent.trim()) {
      setError('Please enter message content');
      return;
    }

    if (!businessId) {
      showSnackbar('No business selected', 'error');
      return;
    }

    // Check for duplicate message content
    const hasContentChanged =
      !messageToEdit ||
      messageContent.toLowerCase().trim() !==
        messageToEdit.message_content?.toLowerCase().trim();

    if (hasContentChanged) {
      // Use fresh data from store if available, else existingMessages
      const latestMessagesMap = store?.paymentMessages$?.get() || {};
      const latestMessages = (
        Object.keys(latestMessagesMap).length > 0
          ? Object.values(latestMessagesMap)
          : existingMessages
      ) as PaymentMessage[];

      const duplicateChecker = new MessageDuplicateChecker(
        latestMessages,
        messageToEdit?.id,
      );
      const existingMsg = duplicateChecker.checkDuplicate(messageContent);

      if (existingMsg) {
        showSnackbar('Message already exists. Using existing record.', 'info');
        if (onMessageCreated) {
          onMessageCreated(existingMsg);
        }
        handleDismiss();
        return;
      }
    }

    setError('');
    setSaving(true);
    try {
      if (messageToEdit) {
        // Update existing message
        await update('payment_messages', messageToEdit.id, {
          message_content: messageContent.trim(),
          transaction_date: transactionDate,
        });

        if (onMessageUpdated) {
          onMessageUpdated({
            ...messageToEdit,
            message_content: messageContent.trim(),
            transaction_date: transactionDate,
          });
        }
        showSnackbar('Message updated successfully', 'success');
        handleDismiss();
      } else {
        // Create new message
        if (!user) throw new Error('User not authenticated');

        const newId = generateUUID();
        const newMessage: PaymentMessage = {
          id: newId,
          message_content: messageContent.trim(),
          transaction_date: transactionDate,
          business_id: businessId,
          user_id: user.id,
        } as any;

        await insert('payment_messages', newMessage);

        if (onMessageCreated) {
          onMessageCreated(newMessage);
        }
      }

      handleDismiss();
    } catch (error: any) {
      console.error('Error saving payment message:', error);
      showSnackbar(
        `Failed to ${messageToEdit ? 'update' : 'create'} payment message`,
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const isSaveDisabled = saving || !messageContent.trim();

  return (
    <BaseModal
      visible={visible}
      onDismiss={handleDismiss}
      scrollable={true}
      title={messageToEdit ? 'Edit Payment Message' : 'New Payment Message'}
      subtitle={
        messageToEdit
          ? 'Modify message details below'
          : 'Enter the payment message details'
      }
      actions={[
        {
          label: 'Cancel',
          onPress: handleDismiss,
          mode: 'outlined',
          disabled: saving,
        },
        {
          label: messageToEdit ? 'Update Message' : 'Save Message',
          onPress: handleSave,
          mode: 'contained',
          loading: saving,
          disabled: isSaveDisabled,
          icon: messageToEdit ? 'content-save-edit' : 'content-save-plus',
        },
      ]}
    >
      <View style={styles.container}>
        <MessageInput
          initialValue={messageContent}
          onValueChange={text => {
            setMessageContent(text);
            if (error) setError('');

            // Intelligent Matching
            if (text.length > 20 && tenants.length > 0) {
              const suggestions = findSuggestedTenants(
                text,
                tenants,
                contracts as any,
                existingMessages,
                paymentMessageReceipts,
                receipts,
              );
              if (suggestions.length > 0 && suggestions[0].confidence > 0.6) {
                setMatchResult(suggestions[0]);
              } else {
                setMatchResult(null);
              }
            } else {
              setMatchResult(null);
            }
          }}
          error={error}
          colors={colors}
          originalValue={originalValue}
          showOriginal={showOriginal}
          onFixFormat={() => {
            setOriginalValue(messageContent);
            const fixed = transformBankMessage(messageContent, transactionDate);
            setMessageContent(fixed);
          }}
          onRevert={() => {
            if (originalValue) {
              setMessageContent(originalValue);
              setOriginalValue(null);
            }
          }}
          onToggleOriginal={setShowOriginal}
          matchResult={matchResult}
        />

        <DatePicker
          label="Transaction Date"
          value={transactionDate}
          onChange={date => setTransactionDate(date || formatDateForDB(new Date()))}
        />
      </View>
    </BaseModal>
  );
}

const PaymentMessageModal = React.memo(PaymentMessageModalComponent);
export default PaymentMessageModal;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inputContainer: {
    marginBottom: 10,
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  helperText: {
    flex: 1,
    paddingLeft: 0, // Align with input
  },
  originalPreview: {
    marginTop: 8,
    padding: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
});
