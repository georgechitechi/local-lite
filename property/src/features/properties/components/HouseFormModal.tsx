import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  HelperText,
  Menu,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { DEFAULT_HOUSE_TYPES } from '@/features/settings/utils/settingsHelper';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import LoadingOverlay from '@/shared/components/LoadingOverlay';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useCurrency } from '@/shared/hooks/useCurrency';
import {
  useCoreMutations,
  useHouses,
  useProperties,
  useSettings,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { generateUUID, getInitial, snakeCaseToTitleCase } from '@/shared/utils/helper';
import { validations } from '@/shared/utils/validations';
import PropertyPickerField from './PropertyPickerField';
import PropertySelectModal, { type SelectedProperty } from './PropertySelectModal';

interface FormData {
  houseNumber: string;
  numberOfHouses: string;
  startingNumber: string;
  type: string;
  monthlyRent: string;
  effectiveDate?: string | null;
}

interface Errors {
  houseNumber?: string;
  numberOfHouses?: string;
  startingNumber?: string;
  monthlyRent?: string;
  type?: string;
  property?: string;
}

interface HouseType {
  id?: string;
  value: string;
  label: string;
  amenities?: string[];
}

interface HouseFormModalProps {
  visible: boolean;
  onDismiss: () => void;
  mode?: 'single' | 'bulk';
  /** Pass to edit an existing house */
  houseId?: string | null;
  /** Required for create mode */
  propertyId?: string | null;
  propertyName?: string | null;
  onSuccess?: () => void;
}

export default function HouseFormModal({
  visible,
  onDismiss,
  mode = 'single',
  houseId,
  propertyId,
  propertyName,
  onSuccess,
}: HouseFormModalProps) {
  const { user } = useAuth();

  const isEdit = !!houseId;
  const [activeMode, setActiveMode] = useState<'single' | 'bulk'>(mode);

  const { selectedBusiness, requireBusiness } = useBusiness();
  const { client, insert, update } = useCoreMutations();
  const housesList = useHouses(selectedBusiness?.id);
  const propertiesList = useProperties(selectedBusiness?.id);
  const allSettings = useSettings(selectedBusiness?.id);
  const { showSnackbar } = useSnackbar();
  const colors = useThemeColors();
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);
  const { can } = useAccessControl();

  const canEdit = can('edit', 'house');
  const canCreate = can('create', 'house');
  const hasPermission = isEdit ? canEdit : canCreate;

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    houseNumber: '',
    numberOfHouses: '',
    startingNumber: '',
    type: '',
    monthlyRent: '',
    effectiveDate: null,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [houseTypes, setHouseTypes] = useState<HouseType[]>([]);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [initializedId, setInitializedId] = useState<string | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [selectedPropertyName, setSelectedPropertyName] = useState<string | null>(null);
  const [showPropertyModal, setShowPropertyModal] = useState(false);

  const handleDismiss = () => {
    setErrors({});
    setInitializedId(null);
    setShowTypeMenu(false);
    setShowPropertyModal(false);
    setFormData({
      houseNumber: '',
      numberOfHouses: '',
      startingNumber: '',
      type: houseTypes[0]?.value ?? '',
      monthlyRent: '',
      effectiveDate: null,
    });
    setSelectedPropertyId(null);
    setSelectedPropertyName(null);
    onDismiss();
  };

  // Load house types and pre-fill form when modal opens
  useEffect(() => {
    if (!visible) return;

    const targetInitId = isEdit && houseId ? houseId : 'create';
    if (initializedId === targetInitId) return;

    if (!isEdit) {
      setSelectedPropertyId(propertyId ?? null);
      setSelectedPropertyName(propertyName ?? null);
      setActiveMode(mode);
    } else {
      setActiveMode('single');
    }

    const load = async () => {
      setInitialLoading(true);
      try {
        let types: HouseType[] = [];
        const setting = allSettings?.find(
          (s: any) => s.setting_key === 'house_types',
        ) as any;
        if (setting?.setting_value) {
          const houseTypesSetting = setting.setting_value as any[];
          types = houseTypesSetting
            .filter((type: any) => type.active)
            .map((type: any) => ({
              id: type.id,
              label: type.label,
              value: type.value,
              amenities: type.amenities,
              active: type.active,
            }));
        }
        if (types.length === 0) {
          types = DEFAULT_HOUSE_TYPES;
        }
        setHouseTypes(types);

        if (isEdit && houseId) {
          const house = housesList.find(h => h.id === houseId);
          if (house) {
            const selectedHouseType = types.find(t => t.value === house.type);
            const prefix = selectedHouseType
              ? `${getInitial(selectedHouseType.label)}-`
              : '';
            const houseNum =
              prefix && String(house.house_number).startsWith(prefix)
                ? String(house.house_number).slice(prefix.length)
                : String(house.house_number);

            setFormData({
              houseNumber: houseNum,
              numberOfHouses: '',
              startingNumber: '',
              type: house.type,
              monthlyRent: String(house.monthly_rent),
              effectiveDate: (house.metadata as any)?.effective_date ?? null,
            });
            setInitializedId(houseId);
            setSelectedPropertyId(house.property_id);
            const property = propertiesList.find(p => p.id === house.property_id);
            if (property) {
              setSelectedPropertyName(property.name);
            }
          }
        } else {
          setFormData({
            houseNumber: '',
            numberOfHouses: '',
            startingNumber: '',
            type: types[0]?.value ?? '',
            monthlyRent: '',
            effectiveDate: null,
          });
          setInitializedId('create');
        }
      } catch (_err) {
        showSnackbar('Failed to load settings', 'error');
      } finally {
        setInitialLoading(false);
      }
    };

    load();
  }, [
    visible,
    initializedId,
    isEdit,
    houseId,
    propertyId,
    propertyName,
    mode,
    housesList,
    propertiesList,
    showSnackbar,
    allSettings,
  ]);

  const getHousePrefix = (selectedType: string): string => {
    if (!selectedType) return '';
    const selectedHouseType = houseTypes.find(t => t.value === selectedType);
    if (!selectedHouseType) return '';
    return `${getInitial(selectedHouseType.label)}-`;
  };

  const formatHouseNumber = (number: string): string => {
    if (!number) return '';
    const prefix = getHousePrefix(formData.type);
    return prefix ? `${prefix}${number.toString().padStart(3, '0')}` : number;
  };

  const validateForm = (): boolean => {
    const newErrors: Errors = {};
    if (activeMode === 'bulk') {
      let validBulk = true;
      if (
        !formData.numberOfHouses ||
        Number.isNaN(Number(formData.numberOfHouses)) ||
        parseInt(formData.numberOfHouses, 10) < 1
      ) {
        newErrors.numberOfHouses = 'Please enter a valid number of houses';
        validBulk = false;
      }
      if (!formData.startingNumber || Number.isNaN(Number(formData.startingNumber))) {
        newErrors.startingNumber = 'Please enter a valid starting number';
        validBulk = false;
      }

      if (validBulk && selectedPropertyId) {
        const startingNumber = parseInt(formData.startingNumber, 10);
        const numberOfHouses = parseInt(formData.numberOfHouses, 10);
        const duplicateHouses: string[] = [];
        for (let i = 0; i < numberOfHouses; i++) {
          const houseNum = formatHouseNumber((startingNumber + i).toString());
          const exists = housesList.some(
            h => h.property_id === selectedPropertyId && h.house_number === houseNum,
          );
          if (exists) {
            duplicateHouses.push(houseNum);
          }
        }
        if (duplicateHouses.length > 0) {
          newErrors.startingNumber = `Existing units found in range: ${duplicateHouses.join(', ')}`;
        }
      }
    } else {
      if (!formData.houseNumber || Number.isNaN(Number(formData.houseNumber))) {
        newErrors.houseNumber = 'Please enter a valid house number';
      } else if (selectedPropertyId) {
        const houseNumFormatted = formatHouseNumber(formData.houseNumber);
        const duplicateExists = housesList.some(
          h =>
            h.property_id === selectedPropertyId &&
            h.house_number === houseNumFormatted &&
            (!isEdit || h.id !== houseId),
        );
        if (duplicateExists) {
          newErrors.houseNumber =
            'A house with this number already exists under this property';
        }
      }
    }
    const rentErr = validations.combine(
      validations.required,
      validations.amount,
    )(formData.monthlyRent);
    if (rentErr) {
      newErrors.monthlyRent = 'Please enter a valid rent amount';
    }
    if (!formData.type) {
      newErrors.type = 'Please select a house type';
    }
    if (!isEdit && !selectedPropertyId) {
      newErrors.property = 'Please select a property';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm() || !requireBusiness()) return;
    setLoading(true);
    try {
      if (!user) throw new Error('User not authenticated');

      if (activeMode === 'bulk') {
        const selectedType = houseTypes.find(t => t.value === formData.type);
        const numberOfHouses = parseInt(formData.numberOfHouses, 10);
        const startingNumber = parseInt(formData.startingNumber, 10);
        const housesToInsert: any[] = [];

        for (let i = 0; i < numberOfHouses; i++) {
          const houseNum = startingNumber + i;
          const newHouseId = generateUUID();

          const houseData = {
            id: newHouseId,
            property_id: selectedPropertyId,
            house_number: formatHouseNumber(houseNum.toString()),
            type: formData.type,
            monthly_rent: parseFloat(formData.monthlyRent),
            status: 'available',
            amenities: selectedType?.amenities || [],
            business_id: selectedBusiness?.id ?? null,
            user_id: user.id ?? null,
            metadata: { effective_date: formData.effectiveDate },
            is_serviceable: true,
            photos: null,
          };

          housesToInsert.push(houseData);
        }

        if (client) {
          await client.insertMany('houses', housesToInsert);
        }

        showSnackbar(`Successfully created ${numberOfHouses} houses`, 'success');
      } else {
        if (isEdit && houseId) {
          const selectedType = houseTypes.find(t => t.value === formData.type);
          const existing = housesList.find(h => h.id === houseId);
          const oldMeta = (existing?.metadata || {}) as Record<string, any>;
          await update('houses', houseId, {
            house_number: formatHouseNumber(formData.houseNumber),
            type: formData.type,
            monthly_rent: parseFloat(formData.monthlyRent),
            amenities: selectedType?.amenities ?? [],
            metadata: { ...oldMeta, effective_date: formData.effectiveDate },
          });
          showSnackbar('House updated successfully', 'success');
        } else {
          const selectedType = houseTypes.find(t => t.value === formData.type);
          const newHouseId = generateUUID();
          await insert('houses', {
            id: newHouseId,
            property_id: selectedPropertyId,
            house_number: formatHouseNumber(formData.houseNumber),
            type: formData.type,
            monthly_rent: parseFloat(formData.monthlyRent),
            status: 'available',
            amenities: selectedType?.amenities ?? [],
            business_id: selectedBusiness?.id ?? null,
            user_id: user.id ?? null,
            metadata: { effective_date: formData.effectiveDate },
            is_serviceable: true,
            photos: null,
          } as any);
          showSnackbar('House created successfully', 'success');
        }
      }

      onSuccess?.();
      handleDismiss();
    } catch (error: any) {
      showSnackbar(
        `Failed to ${isEdit ? 'update' : 'create'} house: ${error.message}`,
        'error',
      );
    } finally {
      setLoading(false);
    }
  };

  const selectedTypeAmenities =
    houseTypes.find(t => t.value === formData.type)?.amenities ?? [];

  const handlePropertySelect = (property: SelectedProperty) => {
    setSelectedPropertyId(property.id);
    setSelectedPropertyName(property.name);
    setErrors(prev => ({ ...prev, property: undefined }));
  };

  return (
    <Portal>
      <BaseModal
        visible={visible}
        onDismiss={handleDismiss}
        title={
          isEdit ? 'Edit House' : activeMode === 'bulk' ? 'Bulk Add Houses' : 'Add House'
        }
        subtitle={isEdit && propertyName ? `Property: ${propertyName}` : undefined}
        scrollable
        maxHeight="85%"
        actions={[
          {
            label: hasPermission ? 'Cancel' : 'Close',
            onPress: handleDismiss,
            mode: 'outlined',
            disabled: loading || initialLoading,
          },
          ...(hasPermission
            ? [
                {
                  label: isEdit
                    ? 'Update'
                    : activeMode === 'bulk'
                      ? 'Create Houses'
                      : 'Create',
                  onPress: handleSubmit,
                  mode: 'contained' as const,
                  loading,
                  disabled: loading || initialLoading,
                },
              ]
            : []),
        ]}
      >
        {initialLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text
              variant="bodyMedium"
              style={{ color: colors.onSurfaceVariant, marginTop: 12 }}
            >
              Loading...
            </Text>
          </View>
        ) : (
          <View style={styles.formContent}>
            {!isEdit && (
              <>
                <SegmentedButtons
                  value={activeMode}
                  onValueChange={val => setActiveMode(val as 'single' | 'bulk')}
                  buttons={[
                    { value: 'single', label: 'Single House' },
                    { value: 'bulk', label: 'Bulk Houses' },
                  ]}
                  style={styles.segmentedButtons}
                />
                <PropertyPickerField
                  selectedName={selectedPropertyName}
                  onPress={() => setShowPropertyModal(true)}
                  error={errors.property}
                />
              </>
            )}

            {/* House Type picker */}
            <Text variant="labelLarge" style={styles.label}>
              House Type
            </Text>
            <Menu
              visible={showTypeMenu}
              onDismiss={() => setShowTypeMenu(false)}
              anchor={
                <Button
                  mode="outlined"
                  onPress={() => setShowTypeMenu(true)}
                  style={[styles.input, errors.type ? { borderColor: colors.error } : {}]}
                  contentStyle={{ justifyContent: 'flex-start' }}
                  icon="chevron-down"
                >
                  {formData.type
                    ? (houseTypes.find(t => t.value === formData.type)?.label ??
                      'Select House Type')
                    : 'Select House Type'}
                </Button>
              }
            >
              {houseTypes.map(ht => (
                <Menu.Item
                  key={ht.value}
                  onPress={() => {
                    setFormData(prev => ({ ...prev, type: ht.value }));
                    setShowTypeMenu(false);
                  }}
                  title={ht.label}
                />
              ))}
            </Menu>
            {errors.type && <HelperText type="error">{errors.type}</HelperText>}

            {/* Conditionally render fields for bulk or single mode */}
            {activeMode === 'bulk' ? (
              <>
                <TextInput
                  label="Number of Houses"
                  value={formData.numberOfHouses}
                  onChangeText={text =>
                    setFormData(prev => ({ ...prev, numberOfHouses: text }))
                  }
                  keyboardType="numeric"
                  style={styles.input}
                  error={!!errors.numberOfHouses}
                />
                {errors.numberOfHouses && (
                  <HelperText type="error">{errors.numberOfHouses}</HelperText>
                )}

                <TextInput
                  label="Starting Number"
                  value={formData.startingNumber}
                  onChangeText={text =>
                    setFormData(prev => ({ ...prev, startingNumber: text }))
                  }
                  keyboardType="numeric"
                  style={styles.input}
                  error={!!errors.startingNumber}
                  left={
                    <TextInput.Affix
                      text={formData.type ? getHousePrefix(formData.type) : ''}
                    />
                  }
                />
                {errors.startingNumber && (
                  <HelperText type="error">{errors.startingNumber}</HelperText>
                )}
              </>
            ) : (
              <>
                {/* House Number */}
                <TextInput
                  label="House Number"
                  value={formData.houseNumber}
                  onChangeText={text =>
                    setFormData(prev => ({ ...prev, houseNumber: text }))
                  }
                  keyboardType="numeric"
                  style={styles.input}
                  error={!!errors.houseNumber}
                  left={
                    <TextInput.Affix
                      text={formData.type ? getHousePrefix(formData.type) : ''}
                    />
                  }
                />
                {errors.houseNumber && (
                  <HelperText type="error">{errors.houseNumber}</HelperText>
                )}
              </>
            )}

            {/* Monthly Rent */}
            <TextInput
              label="Monthly Rent"
              value={formData.monthlyRent}
              onChangeText={text => setFormData(prev => ({ ...prev, monthlyRent: text }))}
              keyboardType="decimal-pad"
              style={styles.input}
              error={!!errors.monthlyRent}
              right={<TextInput.Affix text={defaultCurrency?.symbol ?? '$'} />}
            />
            {errors.monthlyRent && (
              <HelperText type="error">{errors.monthlyRent}</HelperText>
            )}

            <Text variant="labelLarge" style={styles.label}>
              Commissioning Date
            </Text>
            <DatePicker
              value={formData.effectiveDate ?? null}
              onChange={val => setFormData(prev => ({ ...prev, effectiveDate: val }))}
              mode="date"
              placeholder="Select effective date"
            />

            {/* Amenities preview */}
            {selectedTypeAmenities.length > 0 && (
              <View style={styles.amenitiesSection}>
                <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
                  Amenities
                </Text>
                <View style={styles.amenitiesContainer}>
                  {selectedTypeAmenities.map((amenity, index) => (
                    <Text key={index} variant="bodySmall" style={styles.amenityChip}>
                      • {snakeCaseToTitleCase(amenity)}
                    </Text>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}
      </BaseModal>
      <LoadingOverlay visible={loading} message="Saving house details..." />

      <PropertySelectModal
        visible={showPropertyModal}
        onDismiss={() => setShowPropertyModal(false)}
        onSelect={handlePropertySelect}
        selectedId={selectedPropertyId}
      />
    </Portal>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  formContent: {
    paddingBottom: 8,
  },
  label: {
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    marginBottom: 14,
  },
  amenitiesSection: {
    marginTop: 12,
    gap: 8,
  },
  amenitiesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  amenityChip: {
    opacity: 0.7,
  },
  segmentedButtons: {
    marginBottom: 14,
  },
});
