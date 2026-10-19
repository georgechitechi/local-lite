import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Button,
  HelperText,
  IconButton,
  SegmentedButtons,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import BaseModal from '@/shared/components/BaseModal';
import ContactPicker from '@/shared/components/ContactPicker';
import Select from '@/shared/components/Select';
import { useBusinesses, useCoreMutations } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import {
  sendAdminNotification,
  sendBookingConfirmationEmail,
} from '@/shared/services/emailService';
import { pickDocument, uploadBookingDocument } from '@/shared/services/fileUpload';
import type { NextOfKin } from '@/shared/types/types';
import {
  capitalizeEachWord,
  generateUUID,
  normalizePhoneNumber,
} from '@/shared/utils/helper';
import { validateFields, validations } from '@/shared/utils/validations';

interface FormData {
  name: string;
  phone: string;
  email: string;
  address: string;
  gender: string;
  marital_status: string;
  nationality: string;
  next_of_kin: NextOfKin[];
}

interface Document {
  uri?: string;
  name?: string;
  size?: number;
  documentType?: string;
  url?: string;
}

interface BookingModalProps {
  visible: boolean;
  onDismiss: () => void;
  bookingToEdit?: any;
  businessId?: string;
}

export default function BookingModal({
  visible,
  onDismiss,
  bookingToEdit,
  businessId,
}: BookingModalProps) {
  const { user } = useAuth();

  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();
  const businesses = useBusinesses();

  const [formData, setFormData] = useState<FormData>({
    name: '',
    phone: '',
    email: '',
    address: '',
    gender: 'male',
    marital_status: 'single',
    nationality: 'Kenyan',
    next_of_kin: [],
  });

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [documents, setDocuments] = useState<Document[]>([]);

  const activeBusinessId =
    businessId || (businesses.length === 1 ? businesses[0]?.id : undefined);
  const { insert, update } = useCoreMutations();

  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const handleDismiss = () => {
    setFormData({
      name: '',
      phone: '',
      email: '',
      address: '',
      gender: 'male',
      marital_status: 'single',
      nationality: 'Kenyan',
      next_of_kin: [],
    });
    setDocuments([]);
    setErrors({});
    setInitializedKey(null);
    onDismiss();
  };

  useEffect(() => {
    if (!visible) return;

    const targetKey = bookingToEdit?.id ?? 'create';
    if (initializedKey === targetKey) return;

    if (bookingToEdit) {
      let parsedKin = [];
      try {
        parsedKin =
          typeof bookingToEdit.next_of_kin === 'string'
            ? JSON.parse(bookingToEdit.next_of_kin)
            : bookingToEdit.next_of_kin;
      } catch (_e) {}
      if (!Array.isArray(parsedKin)) parsedKin = [];

      let parsedDocs = [];
      try {
        parsedDocs =
          typeof bookingToEdit.documents === 'string'
            ? JSON.parse(bookingToEdit.documents)
            : bookingToEdit.documents;
      } catch (_e) {}

      setFormData({
        name: bookingToEdit.name || '',
        phone: bookingToEdit.phone || '',
        email: bookingToEdit.email || '',
        address: bookingToEdit.address || '',
        gender: bookingToEdit.gender || 'male',
        marital_status: bookingToEdit.marital_status || 'single',
        nationality: bookingToEdit.nationality || 'Kenyan',
        next_of_kin: parsedKin.map((kin: any) => ({
          ...kin,
          is_primary: kin.isPrimary || kin.is_primary || false,
        })),
      });

      setDocuments(Array.isArray(parsedDocs) ? parsedDocs : []);
    } else {
      setFormData({
        name: '',
        phone: '',
        email: '',
        address: '',
        gender: 'male',
        marital_status: 'single',
        nationality: 'Kenyan',
        next_of_kin: [],
      });
      setDocuments([]);
    }
    setInitializedKey(targetKey);
  }, [bookingToEdit, visible, initializedKey]);

  const updateForm = (field: keyof FormData, value: string | NextOfKin[]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const addNextOfKin = () => {
    setFormData(prev => ({
      ...prev,
      next_of_kin: [
        ...prev.next_of_kin,
        { name: '', relationship: '', phone: '', is_primary: false },
      ],
    }));
  };

  const removeNextOfKin = (index: number) => {
    setFormData(prev => ({
      ...prev,
      next_of_kin: prev.next_of_kin.filter((_, i) => i !== index),
    }));
  };

  const updateNextOfKin = (index: number, field: keyof NextOfKin, value: any) => {
    setFormData(prev => {
      const updatedKin = prev.next_of_kin.map((kin, i) => {
        if (i === index) {
          return { ...kin, [field]: value };
        }
        if (field === 'is_primary' && value === true) {
          return { ...kin, is_primary: false };
        }
        return kin;
      });
      return { ...prev, next_of_kin: updatedKin };
    });
  };

  const takePicture = async () => {
    pauseAutoLock();
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setDocuments(prev => [...prev, result.assets[0] as Document]);
      }
    } catch (error) {
      console.error('Error taking picture:', error);
      showSnackbar('Failed to take picture', 'error');
    } finally {
      resumeAutoLock();
    }
  };

  const handleDocumentUpload = async () => {
    try {
      pauseAutoLock();
      const file = await pickDocument();
      if (!file) return;
      setDocuments(prev => [...prev, file as Document]);
    } catch (error) {
      console.error('Error picking document:', error);
      showSnackbar('Failed to pick document', 'error');
    } finally {
      resumeAutoLock();
    }
  };

  const removeDocument = (index: number) => {
    setDocuments(prev => prev.filter((_, i) => i !== index));
  };

  const validateForm = (): boolean => {
    const result = validateFields(formData, {
      name: validations.required,
      phone: validations.combine(validations.required, validations.phone),
      email: validations.combine(validations.required, validations.email),
    });
    const newErrors = { ...result.errors };
    if (!activeBusinessId) newErrors.business = 'Business context required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    try {
      setSubmitting(true);
      pauseAutoLock();

      const bookingId = bookingToEdit?.id || generateUUID();
      const documentObjects: any[] = [];

      for (const doc of documents) {
        if (doc.url) {
          documentObjects.push(doc);
          continue;
        }
        try {
          if (doc.uri) {
            const { publicUrl } = await uploadBookingDocument(
              bookingId,
              {
                uri: doc.uri,
                name: doc.name || 'document',
                mimeType: (doc as any).mimeType,
                size: doc.size,
              },
              { offlineSupport: true },
            );
            documentObjects.push({
              id: generateUUID(),
              url: publicUrl,
              name: doc.name || `Document ${documentObjects.length + 1}`,
              path: publicUrl.split('/').slice(-2).join('/'),
              size: doc.size || 0,
              type: (doc as any).documentType || 'other',
              uploadedAt: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error('Error uploading document:', error);
        }
      }

      const filteredKin = formData.next_of_kin
        .filter(kin => kin.name || kin.phone || kin.relationship)
        .map(({ name, relationship, phone, is_primary }) => ({
          id: generateUUID(),
          name: capitalizeEachWord(name),
          phone: normalizePhoneNumber(phone),
          isPrimary: is_primary || false,
          relationship: capitalizeEachWord(relationship),
        }));

      if (!user) throw new Error('User not authenticated');

      const bookingData = {
        id: bookingId,
        ...formData,
        name: capitalizeEachWord(formData.name),
        phone: normalizePhoneNumber(formData.phone),
        email: formData.email.toLowerCase(),
        next_of_kin: filteredKin,
        documents: documentObjects,
        business_id: activeBusinessId,
        user_id: user.id,
        status: bookingToEdit?.status || 'pending',
        metadata: bookingToEdit?.metadata || {},
        updated_at: new Date().toISOString(),
        created_at: bookingToEdit?.created_at || new Date().toISOString(),
      };

      if (bookingToEdit) {
        await update('bookings', bookingId, bookingData);
      } else {
        await insert('bookings', bookingData);
      }

      if (!bookingToEdit) {
        try {
          const businessInfo = businesses.find(b => b.id === activeBusinessId);
          if (businessInfo && bookingData.email) {
            await sendBookingConfirmationEmail(
              {
                id: bookingData.id,
                name: bookingData.name,
                email: bookingData.email,
                phone: bookingData.phone,
              },
              businessInfo as any,
            );
            await sendAdminNotification(
              {
                id: bookingData.id,
                name: bookingData.name,
                email: bookingData.email,
                phone: bookingData.phone,
              },
              businessInfo as any,
            );
          }
        } catch (e) {
          console.warn('Failed to send emails', e);
        }
      }

      showSnackbar(
        bookingToEdit ? 'Booking updated successfully' : 'Booking created successfully',
        'success',
      );
      handleDismiss();
    } catch (error: any) {
      console.error('Error saving booking:', error);
      showSnackbar(error.message || 'Failed to save booking', 'error');
    } finally {
      setSubmitting(false);
      resumeAutoLock();
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={handleDismiss}
      title={bookingToEdit ? 'Edit Booking' : 'New Booking'}
      subtitle="Manage your properties"
      maxHeight="90%"
      scrollable={true}
      actions={[
        {
          label: 'Cancel',
          onPress: handleDismiss,
          mode: 'outlined',
          disabled: submitting,
        },
        {
          label: bookingToEdit ? 'Update Booking' : 'Save Booking',
          onPress: handleSubmit,
          mode: 'contained',
          loading: submitting,
          disabled: submitting,
        },
      ]}
    >
      <View style={styles.container}>
        <Text variant="titleSmall" style={styles.sectionTitle}>
          Personal Information
        </Text>
        <TextInput
          label="Full Name"
          value={formData.name}
          onChangeText={text => updateForm('name', text)}
          style={styles.input}
          error={!!errors.name}
          mode="outlined"
        />
        {errors.name && <HelperText type="error">{errors.name}</HelperText>}

        <ContactPicker
          value={formData.phone}
          onChangeText={text => updateForm('phone', text)}
          onNameChange={nameData => {
            const fullName = `${nameData.firstName} ${nameData.lastName}`;
            setFormData(prev => ({
              ...prev,
              name: capitalizeEachWord(fullName) || prev.name || '',
            }));
          }}
          onEmailChange={email => {
            setFormData(prev => ({
              ...prev,
              email: email.toLowerCase(),
            }));
          }}
          error={!!errors.phone}
          errorText={errors.phone}
          style={styles.input}
        />

        <TextInput
          label="Email Address"
          value={formData.email}
          onChangeText={text => updateForm('email', text)}
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.input}
          error={!!errors.email}
          mode="outlined"
        />
        {errors.email && <HelperText type="error">{errors.email}</HelperText>}

        <TextInput
          label="Address"
          value={formData.address}
          onChangeText={text => updateForm('address', text)}
          multiline
          numberOfLines={2}
          style={styles.input}
          mode="outlined"
        />

        <Text variant="bodySmall" style={styles.label}>
          Gender
        </Text>
        <SegmentedButtons
          value={formData.gender}
          onValueChange={value => updateForm('gender', value)}
          buttons={[
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
            { value: 'other', label: 'Other' },
          ]}
          style={styles.segmented}
        />

        <Text variant="bodySmall" style={styles.label}>
          Marital Status
        </Text>
        <SegmentedButtons
          value={formData.marital_status}
          onValueChange={value => updateForm('marital_status', value)}
          buttons={[
            { value: 'single', label: 'Single' },
            { value: 'married', label: 'Married' },
            { value: 'other', label: 'Other' },
          ]}
          style={styles.segmented}
        />

        <Select
          label="Nationality"
          value={formData.nationality}
          onValueChange={value => updateForm('nationality', String(value))}
          options={[
            { value: 'Kenyan', label: 'Kenyan' },
            { value: 'Ugandan', label: 'Ugandan' },
            { value: 'Tanzanian', label: 'Tanzanian' },
            { value: 'Other', label: 'Other' },
          ]}
          style={styles.input}
        />

        <View style={styles.sectionHeader}>
          <Text variant="titleSmall">Next of Kin</Text>
          <Button icon="plus" onPress={addNextOfKin} compact>
            Add
          </Button>
        </View>

        {formData.next_of_kin.map((kin, idx) => (
          <View
            key={idx}
            style={[styles.kinCard, { borderColor: colors.outlineVariant }]}
          >
            <View style={styles.kinHeader}>
              <Text variant="labelMedium">Kin #{idx + 1}</Text>
              <View style={styles.row}>
                <Text variant="labelSmall">Primary</Text>
                <Switch
                  value={kin.is_primary}
                  onValueChange={v => updateNextOfKin(idx, 'is_primary', v)}
                />
                <IconButton
                  icon="delete-outline"
                  size={20}
                  onPress={() => removeNextOfKin(idx)}
                />
              </View>
            </View>
            <TextInput
              label="Name"
              value={kin.name}
              onChangeText={t => updateNextOfKin(idx, 'name', t)}
              style={styles.kinInput}
              mode="outlined"
              dense
            />
            <TextInput
              label="Relationship"
              value={kin.relationship}
              onChangeText={t => updateNextOfKin(idx, 'relationship', t)}
              style={styles.kinInput}
              mode="outlined"
              dense
            />
            <ContactPicker
              value={kin.phone || ''}
              onChangeText={t => updateNextOfKin(idx, 'phone', t)}
              label="Phone"
            />
          </View>
        ))}

        <View style={styles.sectionHeader}>
          <Text variant="titleSmall">Documents</Text>
          <View style={styles.row}>
            <IconButton icon="camera" onPress={takePicture} />
            <IconButton icon="file-upload" onPress={handleDocumentUpload} />
          </View>
        </View>

        {documents.map((doc, idx) => (
          <View
            key={idx}
            style={[styles.docItem, { borderColor: colors.outlineVariant }]}
          >
            <Text variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
              {doc.name || `Document ${idx + 1}`}
            </Text>
            <IconButton icon="close" size={16} onPress={() => removeDocument(idx)} />
          </View>
        ))}
      </View>
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
  input: {
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    marginBottom: 4,
  },
  segmented: {
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
  },
  kinCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  kinHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  kinInput: {
    marginBottom: 8,
  },
  docItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    paddingLeft: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    marginBottom: 4,
  },
});
