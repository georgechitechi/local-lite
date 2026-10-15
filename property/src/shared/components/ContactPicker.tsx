import {
  Contact,
  ContactField,
  ContactsSortOrder,
  requestPermissionsAsync,
} from 'expo-contacts';
import {
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  TextInput as NativeTextInput,
  StyleSheet,
  type TextStyle,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { HelperText, IconButton, List, Text, useTheme } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { useIdleLock } from '@/providers/LockScreenProvider';
import BaseModal from '@/shared/components/BaseModal';
import SPressable from '@/shared/components/SlightPressable';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { addOpacity } from '@/shared/utils/helper';

interface ContactPickerProps {
  value: string;
  onChangeText: (text: string) => void;
  onNameChange?: (name: { firstName: string; lastName: string }) => void;
  onEmailChange?: (email: string) => void;
  label?: string;
  error?: boolean;
  errorText?: string;
  style?: ViewStyle;
  inputStyle?: TextStyle;
  containerStyle?: ViewStyle;
}

interface PickerContact {
  id: string;
  name?: string;
  phoneNumbers?: { number: string; [key: string]: any }[];
  emails?: { email: string; [key: string]: any }[];
}

const CONTACT_FIELDS = [
  ContactField.FULL_NAME,
  ContactField.GIVEN_NAME,
  ContactField.FAMILY_NAME,
  ContactField.PHONES,
  ContactField.EMAILS,
] as const;

// Get all supported countries from the library
const supportedCountries = getCountries();

const getFlagEmoji = (countryCode: string) => {
  if (countryCode?.length !== 2) return '';
  return countryCode
    .toUpperCase()
    .replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
};

export default function ContactPicker({
  value,
  onChangeText,
  onNameChange,
  onEmailChange,
  label = 'Phone',
  error,
  errorText,
  style,
  inputStyle,
  containerStyle,
}: ContactPickerProps) {
  const colors = useThemeColors();
  const theme = useTheme();
  const { showSnackbar } = useSnackbar();
  const [modalVisible, setModalVisible] = useState(false);
  const [contacts, setContacts] = useState<PickerContact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [countryCode, setCountryCode] = useState('KE');
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState('');
  const [isTouched, setIsTouched] = useState(false);

  // Automatically sync the country code if the parent passes an E.164 number
  useEffect(() => {
    if (value?.startsWith('+')) {
      const parsed = parsePhoneNumberFromString(value);
      if (parsed?.country) {
        setCountryCode(parsed.country);
      }
    }
  }, [value]);

  const displayValue = useMemo(() => {
    if (!value) return '';
    if (value.startsWith('+')) {
      const parsed = parsePhoneNumberFromString(value);
      if (parsed) {
        return parsed.formatNational().replace(/\s+/g, '');
      }
      const callingCode = getCountryCallingCode(countryCode as any);
      const prefix = `+${callingCode}`;
      if (value.startsWith(prefix)) {
        return value.slice(prefix.length);
      }
    }
    return value;
  }, [value, countryCode]);

  const handleTextChange = (text: string) => {
    if (!text) {
      onChangeText('');
      return;
    }

    if (text.startsWith('+')) {
      const parsed = parsePhoneNumberFromString(text);
      if (parsed?.country) {
        setCountryCode(parsed.country);
        onChangeText(parsed.format('E.164'));
        return;
      }
      onChangeText(text.replace(/\s+/g, ''));
      return;
    }

    const parsed = parsePhoneNumberFromString(text, countryCode as any);
    if (parsed?.isValid()) {
      onChangeText(parsed.format('E.164'));
    } else {
      const callingCode = getCountryCallingCode(countryCode as any);
      onChangeText(`+${callingCode}${text.replace(/[^\d+]/g, '')}`);
    }
  };

  const localError = isTouched && value ? !isValidPhoneNumber(value) : false;
  const finalError = error || localError;
  const finalErrorText = localError ? 'Please enter a valid phone number.' : errorText;

  const { pauseAutoLock, resumeAutoLock } = useIdleLock();

  const loadContacts = async () => {
    pauseAutoLock();
    try {
      const { status } = await requestPermissionsAsync();
      if (status === 'granted') {
        const data = await Contact.getAllDetails(CONTACT_FIELDS, {
          sortOrder: ContactsSortOrder.GivenName,
        });

        // Filter out contacts without phone numbers and map to PickerContact type
        const contactsWithPhones: PickerContact[] = data
          .filter(
            contact =>
              contact.phones &&
              contact.phones.length > 0 &&
              contact.phones.some((phone: any) => phone.number),
          )
          .map((contact: any) => ({
            id: contact.id,
            name:
              contact.fullName ||
              `${contact.givenName || ''} ${contact.familyName || ''}`.trim(),
            phoneNumbers: contact.phones
              ?.filter((phone: any) => phone.number)
              .map((phone: any) => ({ number: phone.number || '', ...phone })),
            emails: contact.emails?.map((email: any) => ({
              email: email.address || email.email || '',
              ...email,
            })),
          }));
        setContacts(contactsWithPhones);
      } else {
        showSnackbar('Please grant contacts permission to use this feature', 'error');
      }
    } catch (error) {
      console.error('Error loading contacts:', error);
      showSnackbar('Failed to load contacts', 'error');
    } finally {
      resumeAutoLock();
    }
  };

  const handleContactPress = (contact: PickerContact) => {
    if (contact.phoneNumbers && contact.phoneNumbers.length > 0) {
      const selectedPhone = contact.phoneNumbers[0].number;
      const parsed = parsePhoneNumberFromString(selectedPhone);

      if (parsed?.country) {
        setCountryCode(parsed.country);
        onChangeText(parsed.format('E.164'));
      } else {
        const callingCode = getCountryCallingCode(countryCode as any);
        onChangeText(`+${callingCode}${selectedPhone.replace(/[^\d+]/g, '')}`);
      }

      if (onNameChange && contact.name) {
        const nameParts = contact.name.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        onNameChange({ firstName, lastName });
      }

      if (onEmailChange) {
        if (contact.emails && contact.emails.length > 0) {
          onEmailChange(contact.emails[0].email);
        } else {
          onEmailChange('');
        }
      }

      setModalVisible(false);
    }
  };

  const filteredContacts = contacts.filter(
    contact =>
      contact.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.phoneNumbers?.some(phone => phone.number.includes(searchQuery)),
  );

  const renderContact = ({ item }: { item: PickerContact }) => (
    <SPressable
      style={[styles.contactItem, { borderBottomColor: colors.outline }]}
      onPress={() => handleContactPress(item)}
    >
      <Text style={[styles.contactName, { color: colors.onSurface }]}>{item.name}</Text>
      {item.phoneNumbers && item.phoneNumbers.length > 0 && (
        <Text style={[styles.phoneNumber, { color: colors.onSurfaceVariant }]}>
          {item.phoneNumbers[0].number}
        </Text>
      )}
      {item.emails && item.emails.length > 0 && (
        <Text style={[styles.email, { color: colors.onSurfaceVariant }]}>
          {item.emails[0].email}
        </Text>
      )}
    </SPressable>
  );

  const filteredCountries = supportedCountries.filter((c: string) => {
    const cleanSearch = countrySearchQuery.replace('+', '');
    return (
      c.toLowerCase().includes(cleanSearch.toLowerCase()) ||
      getCountryCallingCode(c as any).includes(cleanSearch)
    );
  });

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <Text
          variant="labelMedium"
          style={{
            marginBottom: 4,
            color: finalError ? theme.colors.error : colors.onSurface,
          }}
        >
          {label}
        </Text>
      )}
      <View
        style={[
          styles.inputContainer,
          style,
          {
            height: 56,
            borderTopLeftRadius: 4,
            borderTopRightRadius: 4,
            backgroundColor: theme.colors.surfaceVariant,
            borderBottomWidth: 1,
            borderBottomColor: finalError
              ? theme.colors.error
              : theme.colors.onSurfaceVariant,
            overflow: 'hidden',
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => setCountryPickerVisible(true)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            height: '100%',
            borderRightWidth: 1,
            borderRightColor: theme.colors.outlineVariant,
            backgroundColor: 'transparent',
          }}
        >
          <Text
            style={{ fontSize: 16, color: theme.colors.onSurface, fontWeight: '500' }}
          >
            {getFlagEmoji(countryCode)} {countryCode}{' '}
            <Text style={{ color: theme.colors.onSurfaceVariant, fontWeight: 'normal' }}>
              (+{getCountryCallingCode(countryCode as any)})
            </Text>
          </Text>
        </TouchableOpacity>

        <NativeTextInput
          value={displayValue}
          onBlur={() => setIsTouched(true)}
          onChangeText={handleTextChange}
          keyboardType="phone-pad"
          style={[
            styles.input,
            inputStyle,
            {
              paddingHorizontal: 4,
              fontSize: 16,
              color: theme.colors.onSurface,
            },
          ]}
          placeholder="e.g. 0712345678"
          placeholderTextColor={theme.colors.onSurfaceVariant}
        />
        <IconButton
          icon="contacts"
          size={24}
          iconColor={theme.colors.primary}
          onPress={() => {
            loadContacts();
            setModalVisible(true);
          }}
          style={{ margin: 0, marginRight: 5 }}
        />
      </View>
      {finalError && finalErrorText && (
        <HelperText type="error" visible={finalError} style={{ paddingHorizontal: 0 }}>
          {finalErrorText}
        </HelperText>
      )}

      <BaseModal
        visible={countryPickerVisible}
        onDismiss={() => setCountryPickerVisible(false)}
        title="Select Country"
        search={{
          value: countrySearchQuery,
          onChangeText: setCountrySearchQuery,
          placeholder: 'Search country or code...',
        }}
        edgeToEdge={true}
        maxHeight="85%"
      >
        <FlatList
          data={filteredCountries}
          keyExtractor={item => item}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          ListEmptyComponent={
            <List.Item
              title="No countries found"
              titleStyle={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
            />
          }
          renderItem={({ item: code }) => {
            return (
              <List.Item
                title={`${getFlagEmoji(code)} ${code} (+${getCountryCallingCode(code as any)})`}
                onPress={() => {
                  setCountryCode(code);
                  setCountryPickerVisible(false);
                  if (displayValue) {
                    const parsed = parsePhoneNumberFromString(displayValue, code as any);
                    if (parsed?.isValid()) {
                      onChangeText(parsed.format('E.164'));
                    } else {
                      const callingCode = getCountryCallingCode(code as any);
                      onChangeText(`+${callingCode}${displayValue}`);
                    }
                  }
                }}
                style={{
                  borderBottomWidth: 1,
                  borderBottomColor: addOpacity(theme.colors.outlineVariant, 0.25),
                }}
              />
            );
          }}
        />
      </BaseModal>

      <BaseModal
        visible={modalVisible}
        onDismiss={() => setModalVisible(false)}
        title="Select Contact"
        subtitle="Manage your properties"
        edgeToEdge
        maxHeight="85%"
        rounded={true}
        search={{
          placeholder: 'Search contacts...',
          value: searchQuery,
          onChangeText: setSearchQuery,
          onClear: () => setSearchQuery(''),
        }}
      >
        <FlatList
          data={filteredContacts}
          renderItem={renderContact}
          keyExtractor={item => item.id}
          style={styles.contactList}
        />
      </BaseModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  input: {
    flex: 1,
  },
  contactList: {
    flex: 1,
  },
  contactItem: {
    padding: 16,
    borderBottomWidth: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '500',
  },
  phoneNumber: {
    fontSize: 14,
    marginTop: 4,
  },
  email: {
    fontSize: 14,
    marginTop: 4,
  },
});
