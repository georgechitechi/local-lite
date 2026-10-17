import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Checkbox, Surface, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import BaseSearch from '@/shared/components/BaseSearch';
import EmptyState from '@/shared/components/EmptyState';
import SPressable from '@/shared/components/SlightPressable';
import { useBusinessShares, useProfile } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { isActiveShareStatus } from '@/shared/utils/statusHelper';

interface EmailSelectorProps {
  visible: boolean;
  onDismiss: () => void;
  selectedEmails?: string[];
  onEmailsChange: (emails: string[]) => void;
  title?: string;
  allowCustomEmails?: boolean;
  customEmailPlaceholder?: string;
  showBusinessEmail?: boolean;
}

export default function EmailSelector({
  visible,
  onDismiss,
  selectedEmails = [],
  onEmailsChange,
  title = 'Select Email Recipients',
  allowCustomEmails = false,
  customEmailPlaceholder = 'Enter custom email address',
  showBusinessEmail = true,
}: EmailSelectorProps) {
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const { selectedBusiness } = useBusiness();
  const allShares = useBusinessShares();
  const businessOwner = useProfile(selectedBusiness?.user_id);

  // State
  const [availableEmails, setAvailableEmails] = useState<string[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [customEmail, setCustomEmail] = useState('');

  const normalizeEmail = React.useCallback((email: string | undefined): string => {
    return email?.toLowerCase().trim() || '';
  }, []);

  const orderEmails = React.useCallback(
    (emails: string[]): string[] => {
      // Deduplicate case-insensitively while preserving first occurrence
      const seen = new Set<string>();
      const unique: string[] = [];

      for (const email of emails) {
        const norm = normalizeEmail(email);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        unique.push(email.trim());
      }

      if (!showBusinessEmail || !selectedBusiness?.email) {
        return unique;
      }

      const businessNorm = normalizeEmail(selectedBusiness.email);
      const businessEmailEntry =
        unique.find(e => normalizeEmail(e) === businessNorm) || selectedBusiness.email;

      const rest = unique.filter(e => normalizeEmail(e) !== businessNorm);

      return [businessEmailEntry, ...rest];
    },
    [showBusinessEmail, selectedBusiness?.email, normalizeEmail],
  );

  const fetchAvailableEmails = React.useCallback(async () => {
    if (!selectedBusiness?.id) {
      return;
    }

    try {
      setLoadingEmails(true);

      // Get emails from users who have access to this business through business_shares
      const businessShares = allShares.filter(
        share => share.business_id === selectedBusiness.id && isActiveShareStatus(share),
      );

      const businessEmail = selectedBusiness.email;
      let emails: string[] = [];

      if (businessShares && businessShares.length > 0) {
        // Get emails directly from shared_with column
        const sharedEmails = businessShares
          .map((share: any) => share.shared_with)
          .filter((email: string) => email && email.trim() !== '');

        emails = [...new Set(sharedEmails)].sort();
      }

      // Also include the business owner's email if they have a profile
      if (businessOwner?.email && !emails.includes(businessOwner.email)) {
        emails = [businessOwner.email, ...emails];
      }

      if (
        showBusinessEmail &&
        businessEmail &&
        businessEmail.trim() !== '' &&
        !emails.includes(businessEmail)
      ) {
        emails = [businessEmail, ...emails];
      }

      setAvailableEmails(orderEmails(emails));
    } catch (error) {
      console.error('Error fetching available emails:', error);
      showSnackbar('Failed to load available emails', 'error');
    } finally {
      setLoadingEmails(false);
    }
  }, [
    selectedBusiness,
    allShares,
    showBusinessEmail,
    showSnackbar,
    orderEmails,
    businessOwner?.email,
  ]);

  // Fetch emails when modal opens or business changes
  useEffect(() => {
    if (visible && selectedBusiness?.id) {
      fetchAvailableEmails();
    }
  }, [visible, selectedBusiness?.id, fetchAvailableEmails]);

  const handleEmailsChange = (emails: string[]) => {
    onEmailsChange(orderEmails(emails));
  };

  const handleAddCustomEmail = () => {
    if (customEmail.trim() && !selectedEmails.includes(customEmail.trim())) {
      handleEmailsChange([...selectedEmails, customEmail.trim()]);
      setCustomEmail('');
    }
  };

  const isEmailSelected = (email: string): boolean => {
    if (!selectedEmails || !Array.isArray(selectedEmails)) return false;
    const normalizedEmail = normalizeEmail(email);
    return selectedEmails.some(
      selectedEmail => normalizeEmail(selectedEmail) === normalizedEmail,
    );
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      subtitle="Manage your properties"
      edgeToEdge
      scrollable={true}
      maxHeight="85%"
      actions={[
        {
          label: 'Cancel',
          mode: 'outlined',
          onPress: onDismiss,
          style: styles.cancelButton,
        },
        {
          label: `Done (${selectedEmails?.length || 0} selected)`,
          mode: 'contained',
          onPress: onDismiss,
          disabled: !selectedEmails || selectedEmails.length === 0,
          style: styles.doneButton,
        },
      ]}
    >
      <View style={styles.modalBody}>
        {allowCustomEmails && (
          <BaseSearch
            placeholder={customEmailPlaceholder}
            value={customEmail}
            onChangeText={setCustomEmail}
            rightIcon="check"
            keyboardType="email-address"
            onClear={handleAddCustomEmail}
          />
        )}

        {loadingEmails ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text variant="bodyMedium" style={styles.loadingText}>
              Loading emails...
            </Text>
          </View>
        ) : availableEmails.length === 0 ? (
          <EmptyState icon="email" title="No emails available" />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} style={styles.emailList}>
            {availableEmails.map(email => {
              const isSelected = isEmailSelected(email);
              const isBusinessEmail =
                showBusinessEmail && selectedBusiness?.email === email;

              return (
                <Surface
                  key={email}
                  style={[styles.enhancedEmailItem, { borderColor: colors.outline }]}
                  elevation={0}
                >
                  <SPressable
                    style={styles.emailItemContent}
                    onPress={() => {
                      if (isSelected) {
                        // Remove email using normalized comparison
                        const filteredEmails = selectedEmails.filter(
                          e => normalizeEmail(e) !== normalizeEmail(email),
                        );
                        handleEmailsChange(filteredEmails);
                      } else {
                        handleEmailsChange([...(selectedEmails || []), email]);
                      }
                    }}
                  >
                    <Checkbox
                      status={isSelected ? 'checked' : 'unchecked'}
                      onPress={() => {
                        if (isSelected) {
                          // Remove email using normalized comparison
                          const filteredEmails = selectedEmails.filter(
                            e => normalizeEmail(e) !== normalizeEmail(email),
                          );
                          handleEmailsChange(filteredEmails);
                        } else {
                          handleEmailsChange([...(selectedEmails || []), email]);
                        }
                      }}
                    />
                    <View style={styles.emailInfo}>
                      <Text
                        style={[styles.emailText, isSelected && styles.selectedEmailText]}
                      >
                        {email}
                      </Text>
                      {isBusinessEmail && (
                        <View style={styles.businessBadge}>
                          <MaterialCommunityIcons
                            name="briefcase"
                            size={12}
                            color={colors.primary}
                          />
                          <Text style={styles.businessBadgeText}>Business email</Text>
                        </View>
                      )}
                    </View>
                    {isSelected && (
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={20}
                        color={colors.primary}
                      />
                    )}
                  </SPressable>
                </Surface>
              );
            })}
          </ScrollView>
        )}
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  modalBody: {
    flex: 1,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 12,
  },
  enhancedEmailItem: {
    marginVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  emailItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  emailInfo: {
    flex: 1,
    marginLeft: 8,
  },
  emailText: {
    fontSize: 14,
  },
  selectedEmailText: {
    fontWeight: '500',
  },
  businessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  businessBadgeText: {
    fontSize: 12,
    marginLeft: 4,
    fontWeight: '500',
  },
  cancelButton: {
    flex: 1,
    marginRight: 8,
  },
  doneButton: {
    flex: 1,
    marginLeft: 8,
  },
  emailList: {
    marginVertical: 10,
  },
});
