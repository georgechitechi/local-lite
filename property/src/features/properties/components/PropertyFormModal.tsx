import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  HelperText,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import MapLocationModal from '@/shared/components/MapLocationModal';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { usePermission } from '@/shared/hooks/usePermission';
import { useCoreMutations, useProperties } from '@/shared/hooks/useStore';
import { OFFLINE_USER_ID } from '@/shared/services/auth';
import { generateUUID } from '@/shared/utils/helper';
import { validateFields, validations } from '@/shared/utils/validations';

interface PropertyData {
  name: string;
  location: string;
  status: 'active' | 'coming_soon';
  latitude?: number | null;
  longitude?: number | null;
  effectiveDate?: string | null;
}

interface Errors {
  name?: string;
  location?: string;
}

interface PropertyFormModalProps {
  visible: boolean;
  onDismiss: () => void;
  /** Pass an existing property id to switch into edit mode */
  propertyId?: string | null;
  onSuccess?: (property?: { id: string; name: string }) => void;
}

export default function PropertyFormModal({
  visible,
  onDismiss,
  propertyId,
  onSuccess,
}: PropertyFormModalProps) {
  const { user } = useAuth();

  const isEdit = !!propertyId;

  const { selectedBusiness, requireBusiness } = useBusiness();
  const { insert, update } = useCoreMutations();
  const propertiesList = useProperties(selectedBusiness?.id);
  const { showSnackbar } = useSnackbar();
  const { checkPermission, PermissionModal } = usePermission();
  const { can } = useAccessControl();

  const canEdit = can('edit', 'property');
  const canCreate = can('create', 'property');
  const hasPermission = isEdit ? canEdit : canCreate;

  const [loading, setLoading] = useState(false);
  const [property, setProperty] = useState<PropertyData>({
    name: '',
    location: '',
    status: 'active',
    latitude: null,
    longitude: null,
    effectiveDate: null,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [initializedId, setInitializedId] = useState<string | null>(null);

  // Populate form when editing
  useEffect(() => {
    if (!isEdit) return;
    if (!propertyId || !propertiesList || propertiesList.length === 0) return;
    if (initializedId === propertyId) return;

    const existing = propertiesList.find(p => p.id === propertyId);
    if (existing) {
      setProperty({
        name: existing.name,
        location: existing.location ?? '',
        status: (existing.status as PropertyData['status']) || 'active',
        latitude: existing.latitude as number | null | undefined,
        longitude: existing.longitude as number | null | undefined,
        effectiveDate: (existing.metadata as any)?.effective_date ?? null,
      });
      setInitializedId(propertyId);
    }
  }, [propertyId, propertiesList, initializedId, isEdit]);

  const handleDismiss = () => {
    setErrors({});
    setInitializedId(null);
    setShowLocationPicker(false);
    if (!isEdit) {
      setProperty({
        name: '',
        location: '',
        status: 'active',
        latitude: null,
        longitude: null,
        effectiveDate: null,
      });
    }
    onDismiss();
  };

  const handleOpenLocationPicker = async () => {
    const granted = await checkPermission();
    if (granted) setShowLocationPicker(true);
  };

  const handleLocationSelect = (fullAddress: string, lat?: number, lng?: number) => {
    setProperty(prev => ({
      ...prev,
      location: fullAddress,
      latitude: lat !== undefined ? lat : prev.latitude,
      longitude: lng !== undefined ? lng : prev.longitude,
    }));
  };

  const validate = (): boolean => {
    const result = validateFields(property, {
      name: validations.required,
      location: validations.required,
    });
    setErrors(result.errors);
    return result.isValid;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    if (!selectedBusiness?.id) {
      showSnackbar('Please select an active business first', 'error');
      return;
    }

    setLoading(true);
    try {
      const currentUserId = user?.id || OFFLINE_USER_ID;

      if (isEdit && propertyId) {
        const existing = propertiesList.find(p => p.id === propertyId);
        const oldMeta = (existing?.metadata || {}) as Record<string, any>;
        await update('properties', propertyId, {
          name: property.name,
          location: property.location,
          status: property.status,
          user_id: currentUserId,
          latitude: property.latitude ?? null,
          longitude: property.longitude ?? null,
          metadata: { ...oldMeta, effective_date: property.effectiveDate },
        });
        showSnackbar('Property updated successfully', 'success');
        onSuccess?.({ id: propertyId, name: property.name });
      } else {
        const id = generateUUID();
        await insert('properties', {
          id,
          name: property.name,
          location: property.location,
          status: property.status,
          business_id: selectedBusiness.id,
          user_id: currentUserId,
          latitude: property.latitude ?? null,
          longitude: property.longitude ?? null,
          metadata: { effective_date: property.effectiveDate },
        } as any);
        showSnackbar('Property created successfully', 'success');
        onSuccess?.({ id, name: property.name });
      }

      handleDismiss();
    } catch (error: any) {
      showSnackbar(
        `Failed to ${isEdit ? 'update' : 'create'} property: ${error.message}`,
        'error',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Portal>
      <BaseModal
        visible={visible}
        onDismiss={handleDismiss}
        title={isEdit ? 'Edit Property' : 'New Property'}
        subtitle={isEdit ? 'Update property details' : 'Add a new property'}
        scrollable
        maxHeight="85%"
        actions={[
          {
            label: hasPermission ? 'Cancel' : 'Close',
            onPress: handleDismiss,
            mode: 'outlined',
            disabled: loading,
          },
          ...(hasPermission
            ? [
                {
                  label: isEdit ? 'Update' : 'Create',
                  onPress: handleSubmit,
                  mode: 'contained' as const,
                  loading,
                  disabled: loading,
                },
              ]
            : []),
        ]}
      >
        <View style={styles.formContent}>
          <TextInput
            label="Property Name"
            value={property.name}
            onChangeText={text => setProperty(prev => ({ ...prev, name: text }))}
            mode="outlined"
            error={!!errors.name}
            style={styles.input}
          />
          {errors.name && (
            <HelperText type="error" visible={!!errors.name}>
              {errors.name}
            </HelperText>
          )}

          <TextInput
            label="Location"
            value={property.location}
            onChangeText={text => setProperty(prev => ({ ...prev, location: text }))}
            mode="outlined"
            error={!!errors.location}
            style={styles.input}
            right={
              <TextInput.Icon icon="map-marker" onPress={handleOpenLocationPicker} />
            }
          />
          {errors.location && (
            <HelperText type="error" visible={!!errors.location}>
              {errors.location}
            </HelperText>
          )}

          <Text variant="labelLarge" style={styles.label}>
            Commissioning Date
          </Text>
          <DatePicker
            value={property.effectiveDate ?? null}
            onChange={val => setProperty(prev => ({ ...prev, effectiveDate: val }))}
            mode="date"
            placeholder="Select commissioning date"
          />

          <Text variant="labelLarge" style={styles.label}>
            Status
          </Text>
          <SegmentedButtons
            value={property.status}
            onValueChange={value =>
              setProperty(prev => ({ ...prev, status: value as PropertyData['status'] }))
            }
            buttons={[
              { value: 'active', label: 'Active' },
              { value: 'coming_soon', label: 'Coming Soon' },
            ]}
            style={styles.segmentedButton}
          />
        </View>
      </BaseModal>

      <MapLocationModal
        visible={showLocationPicker}
        onDismiss={() => setShowLocationPicker(false)}
        onSelect={handleLocationSelect}
        title="Pick Location"
        initialLocation={
          property.latitude && property.longitude
            ? { latitude: property.latitude, longitude: property.longitude }
            : undefined
        }
      />
      <PermissionModal />
    </Portal>
  );
}

const styles = StyleSheet.create({
  formContent: {
    paddingBottom: 8,
  },
  input: {
    marginBottom: 16,
  },
  label: {
    marginVertical: 4,
  },
  segmentedButton: {
    marginBottom: 8,
  },
});
