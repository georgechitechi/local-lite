import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Divider, HelperText, List, Portal, Switch, TextInput } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { initializeDefaultSettingsForBusiness } from '@/features/settings/utils/settingsHelper';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import ContactPicker from '@/shared/components/ContactPicker';
import MapLocationModal from '@/shared/components/MapLocationModal';
import { usePermission } from '@/shared/hooks/usePermission';
import { useBusinesses, useCoreMutations } from '@/shared/hooks/useStore';
import type { Errors, NewBusiness } from '@/shared/types/types';
import { generateUUID, normalizePhoneNumber } from '@/shared/utils/helper';
import { validateFields, validations } from '@/shared/utils/validations';

interface ManageBusinessModalProps {
  visible: boolean;
  onDismiss: () => void;
  businessId?: string;
}

export default function ManageBusinessModal({
  visible,
  onDismiss,
  businessId,
}: ManageBusinessModalProps) {
  const { showSnackbar } = useSnackbar();
  const rawBusinesses = useBusinesses();
  const { insert, update } = useCoreMutations();
  const { user } = useAuth();
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [newBusiness, setNewBusiness] = useState<NewBusiness>({
    name: '',
    phone: '',
    email: '',
    address: '',
    latitude: null,
    longitude: null,
    metadata: { api_enabled: false },
  });
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDialog, setConfirmDialog] = useState({
    visible: false,
    title: '',
    message: '',
  });

  const { checkPermission, PermissionModal } = usePermission();

  const handleOpenLocationPicker = async () => {
    const granted = await checkPermission();
    if (granted) {
      setShowLocationPicker(true);
    }
  };

  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const handleDismiss = () => {
    setNewBusiness({
      name: '',
      phone: '',
      email: '',
      address: '',
      latitude: null,
      longitude: null,
      metadata: { api_enabled: false },
    });
    setErrors({});
    setInitializedKey(null);
    onDismiss();
  };

  // Initialize form if editing
  useEffect(() => {
    if (!visible) return;

    const targetKey = businessId ?? 'create';
    if (initializedKey === targetKey) return;

    if (businessId) {
      const business = rawBusinesses.find(b => b.id === businessId);
      if (business) {
        setNewBusiness({
          name: business.name || '',
          phone: (business as any).phone || '',
          email: (business as any).email || '',
          address: (business as any).address || '',
          latitude: (business as any).latitude || null,
          longitude: (business as any).longitude || null,
          metadata: {
            ...((business as any).metadata || {}),
            api_enabled: (business as any).metadata?.api_enabled ?? false,
          },
        });
      }
    } else {
      // Clear form if adding new
      setNewBusiness({
        name: '',
        phone: '',
        email: '',
        address: '',
        latitude: null,
        longitude: null,
        metadata: { api_enabled: false },
      });
    }
    setInitializedKey(targetKey);
  }, [visible, businessId, initializedKey, rawBusinesses]);

  const validateForm = (): boolean => {
    const result = validateFields(newBusiness, {
      name: validations.combine(validations.required, validations.maxLength(25)),
      email: validations.combine(validations.required, validations.email),
      phone: validations.combine(validations.required, validations.phone),
      address: validations.required,
    });
    setErrors(result.errors);
    return result.isValid;
  };

  const handleSaveBusiness = async () => {
    if (!validateForm() || !user?.id) return;

    try {
      // Check for duplicate name locally first (excluding current business if editing)
      const duplicate = rawBusinesses.some(
        b =>
          b.name.toLowerCase() === newBusiness.name.trim().toLowerCase() &&
          b.id !== businessId,
      );
      if (duplicate) {
        setErrors((prev: Errors) => ({
          ...prev,
          name: 'Business name already exists',
        }));
        return;
      }

      if (businessId) {
        // Update existing business via local-lite
        const updatePayload = {
          ...newBusiness,
          phone: normalizePhoneNumber(newBusiness.phone),
          email: newBusiness.email?.toLowerCase(),
        };
        await update('businesses', businessId, updatePayload as any);
      } else {
        // Add new business via local-lite
        const newId = generateUUID();
        const businessData = {
          id: newId,
          ...newBusiness,
          phone: normalizePhoneNumber(newBusiness.phone),
          email: newBusiness.email?.toLowerCase(),
          user_id: user.id,
          is_system: false,
          logo_url: null,
        };

        await insert('businesses', businessData as any);

        // Initialize default settings locally (works offline & queues sync when online)
        initializeDefaultSettingsForBusiness(newId, user.id);
      }

      handleDismiss();
      showSnackbar(
        `Business ${businessId ? 'updated' : 'added'} successfully`,
        'success',
      );
      if (!businessId) {
        setNewBusiness({
          name: '',
          phone: '',
          email: '',
          address: '',
          latitude: null,
          longitude: null,
          metadata: { api_enabled: false },
        });
      }
    } catch (error) {
      console.error('Error saving business:', error);
      showSnackbar(`Failed to ${businessId ? 'update' : 'add'} business`, 'error');
    }
  };

  const handleLocationSelect = (address: string, lat?: number, lng?: number) => {
    setNewBusiness(prev => ({
      ...prev,
      address: address,
      latitude: lat || null,
      longitude: lng || null,
    }));
    setShowLocationPicker(false);
  };

  return (
    <>
      <BaseModal
        visible={visible && !showLocationPicker}
        onDismiss={handleDismiss}
        title={businessId ? 'Edit Business' : 'Add New Business'}
        subtitle="Manage your businesses"
        scrollable={true}
        actions={[
          {
            label: 'Cancel',
            mode: 'outlined',
            onPress: handleDismiss,
            style: { flex: 1 },
          },
          {
            label: businessId ? 'Save' : 'Add',
            mode: 'contained',
            onPress: handleSaveBusiness,
            style: { flex: 1 },
          },
        ]}
      >
        <TextInput
          label="Business Name"
          value={newBusiness.name}
          onChangeText={text => setNewBusiness(prev => ({ ...prev, name: text }))}
          style={styles.input}
          error={!!errors.name}
          maxLength={25}
        />
        <HelperText type="info" style={{ textAlign: 'right', marginTop: -8 }}>
          {newBusiness.name.length}/25
        </HelperText>
        {errors.name && <HelperText type="error">{errors.name}</HelperText>}

        <ContactPicker
          value={newBusiness.phone}
          onChangeText={text => setNewBusiness(prev => ({ ...prev, phone: text }))}
          onNameChange={nameData => {
            setNewBusiness(prev => ({
              ...prev,
              name: `${nameData.firstName} ${nameData.lastName || ''}` || prev.name || '',
            }));
          }}
          onEmailChange={email => {
            setNewBusiness(prev => ({
              ...prev,
              email: email,
            }));
          }}
          error={!!errors.phone}
          errorText={errors.phone}
          style={styles.input}
        />

        <TextInput
          label="Email"
          value={newBusiness.email}
          onChangeText={text => setNewBusiness(prev => ({ ...prev, email: text }))}
          keyboardType="email-address"
          style={styles.input}
          error={!!errors.email}
        />
        {errors.email && <HelperText type="error">{errors.email}</HelperText>}

        <TextInput
          label="Address"
          value={newBusiness.address}
          onChangeText={text => setNewBusiness(prev => ({ ...prev, address: text }))}
          style={styles.input}
          error={!!errors.address}
          right={<TextInput.Icon icon="map-marker" onPress={handleOpenLocationPicker} />}
        />
        {errors.address && <HelperText type="error">{errors.address}</HelperText>}

        <Divider style={{ marginVertical: 12 }} />
        <List.Item
          title="External API Access"
          description="Allow this business to be accessed via the external API"
          right={() => (
            <View style={styles.switchContainer}>
              <Switch
                value={newBusiness.metadata?.api_enabled ?? false}
                onValueChange={value =>
                  setNewBusiness(prev => ({
                    ...prev,
                    metadata: { ...(prev.metadata || {}), api_enabled: value },
                  }))
                }
              />
            </View>
          )}
        />
      </BaseModal>

      <Portal>
        <MapLocationModal
          visible={showLocationPicker}
          onDismiss={() => setShowLocationPicker(false)}
          onSelect={handleLocationSelect}
          title="Pick Location"
          initialLocation={
            newBusiness.latitude && newBusiness.longitude
              ? { latitude: newBusiness.latitude, longitude: newBusiness.longitude }
              : undefined
          }
        />
        <BaseModal
          mode="confirm"
          visible={confirmDialog.visible}
          onDismiss={() => setConfirmDialog(prev => ({ ...prev, visible: false }))}
          onConfirm={() => setConfirmDialog(prev => ({ ...prev, visible: false }))}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText="OK"
          showCancel={false}
          destructive={true}
        />
        <PermissionModal />
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  input: {
    marginBottom: 8,
  },
  switchContainer: {
    justifyContent: 'center',
  },
});
