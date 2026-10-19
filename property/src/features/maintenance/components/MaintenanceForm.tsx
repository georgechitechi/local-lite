import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import BaseSearch from '@/shared/components/BaseSearch';
import DatePicker from '@/shared/components/DatePicker';
import { formatDateForDB, parseLocalDate } from '@/shared/utils/formatters';

export interface MaintenanceFormData {
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  scope: 'property' | 'multi_house' | 'single_house';
  property_id: string;
  house_id: string;
  affected_houses: string[];
  tenant_id: string;
  images: string[];
  event_date: Date;
  status?: string;
}

export function validateMaintenanceForm(form: MaintenanceFormData): string | null {
  if (!form.description?.trim()) {
    return 'Description is required';
  }
  if (form.scope === 'property' && !form.property_id) {
    return 'Property is required for property-wide maintenance';
  }
  if (form.scope === 'single_house' && !form.house_id) {
    return 'House is required for single house maintenance';
  }
  if (form.scope === 'multi_house' && form.affected_houses.length === 0) {
    return 'Please select at least one house for multi-house maintenance';
  }
  return null;
}

export interface MaintenanceFormProps {
  form: MaintenanceFormData;
  setForm: React.Dispatch<React.SetStateAction<MaintenanceFormData>>;
  isTenant: boolean;
  tenantId?: string | null;
  storeProperties: any[];
  houses: any[];
  getTenantName: (houseId: string) => string | null;
  selectedHouse?: any;
  handleImageUpload: () => void;
  removeImage: (index: number) => void;
  colors: any;

  // Optional controlled props for backward compatibility
  showHouseModal?: boolean;
  setShowHouseModal?: (v: boolean) => void;
  showPropertyModal?: boolean;
  setShowPropertyModal?: (v: boolean) => void;
  showMultiHouseModal?: boolean;
  setShowMultiHouseModal?: (v: boolean) => void;
  houseSearch?: string;
  setHouseSearch?: (v: string) => void;
  propertySearch?: string;
  setPropertySearch?: (v: string) => void;
  multiHouseSearch?: string;
  setMultiHouseSearch?: (v: string) => void;
}

export default function MaintenanceForm({
  form,
  setForm,
  isTenant,
  storeProperties,
  houses,
  getTenantName,
  selectedHouse: controlledSelectedHouse,
  handleImageUpload,
  removeImage,
  colors,
  showHouseModal: controlledShowHouseModal,
  setShowHouseModal: controlledSetShowHouseModal,
  showPropertyModal: controlledShowPropertyModal,
  setShowPropertyModal: controlledSetShowPropertyModal,
  showMultiHouseModal: controlledShowMultiHouseModal,
  setShowMultiHouseModal: controlledSetShowMultiHouseModal,
  houseSearch: controlledHouseSearch,
  setHouseSearch: controlledSetHouseSearch,
  propertySearch: controlledPropertySearch,
  setPropertySearch: controlledSetPropertySearch,
  multiHouseSearch: controlledMultiHouseSearch,
  setMultiHouseSearch: controlledSetMultiHouseSearch,
}: MaintenanceFormProps) {
  // Internal state when not controlled
  const [internalShowHouse, setInternalShowHouse] = useState(false);
  const [internalShowProperty, setInternalShowProperty] = useState(false);
  const [internalShowMultiHouse, setInternalShowMultiHouse] = useState(false);
  const [internalHouseSearch, setInternalHouseSearch] = useState('');
  const [internalPropertySearch, setInternalPropertySearch] = useState('');
  const [internalMultiHouseSearch, setInternalMultiHouseSearch] = useState('');

  const showHouseModal = controlledShowHouseModal ?? internalShowHouse;
  const setShowHouseModal = controlledSetShowHouseModal ?? setInternalShowHouse;
  const showPropertyModal = controlledShowPropertyModal ?? internalShowProperty;
  const setShowPropertyModal = controlledSetShowPropertyModal ?? setInternalShowProperty;
  const showMultiHouseModal = controlledShowMultiHouseModal ?? internalShowMultiHouse;
  const setShowMultiHouseModal =
    controlledSetShowMultiHouseModal ?? setInternalShowMultiHouse;

  const houseSearch = controlledHouseSearch ?? internalHouseSearch;
  const setHouseSearch = controlledSetHouseSearch ?? setInternalHouseSearch;
  const propertySearch = controlledPropertySearch ?? internalPropertySearch;
  const setPropertySearch = controlledSetPropertySearch ?? setInternalPropertySearch;
  const multiHouseSearch = controlledMultiHouseSearch ?? internalMultiHouseSearch;
  const setMultiHouseSearch =
    controlledSetMultiHouseSearch ?? setInternalMultiHouseSearch;

  const selectedHouse =
    controlledSelectedHouse ?? houses.find(h => h.id === form.house_id);

  const handleHouseSelect = (house: any) => {
    setForm(f => ({ ...f, house_id: house.id }));
    setShowHouseModal(false);
    setHouseSearch('');
  };

  return (
    <View>
      <Text variant="titleMedium" style={styles.label}>
        Scope
      </Text>
      <SegmentedButtons
        value={form.scope}
        onValueChange={v => {
          setForm(f => ({
            ...f,
            scope: v as any,
            property_id: '',
            affected_houses: [],
            house_id: '',
          }));
        }}
        buttons={[
          { value: 'single_house', label: 'Single House' },
          { value: 'multi_house', label: 'Multi House' },
          { value: 'property', label: 'Property-wide' },
        ]}
        style={styles.input}
      />

      <DatePicker
        label="Event Date"
        value={formatDateForDB(form.event_date)}
        onChange={date =>
          setForm(f => ({ ...f, event_date: date ? parseLocalDate(date) : new Date() }))
        }
        style={styles.input}
      />

      {/* Scope: Single House */}
      {form.scope === 'single_house' && (
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.label}>
            Select House
          </Text>
          <Button
            mode="outlined"
            onPress={() => setShowHouseModal(true)}
            style={styles.input}
            disabled={isTenant}
          >
            {selectedHouse
              ? `House ${selectedHouse.house_number}${
                  selectedHouse.property ? ` (${selectedHouse.property.name})` : ''
                }`
              : 'Choose a House'}
          </Button>

          {selectedHouse && (
            <View style={{ marginBottom: 16 }}>
              <Chip icon="home" style={{ alignSelf: 'flex-start' }}>
                House {selectedHouse.house_number}
                {getTenantName(selectedHouse.id)
                  ? ` • ${getTenantName(selectedHouse.id)}`
                  : ' • Vacant'}
              </Chip>
            </View>
          )}
        </View>
      )}

      {/* Scope: Property-wide */}
      {form.scope === 'property' && (
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.label}>
            Select Property
          </Text>
          <Button
            mode="outlined"
            onPress={() => setShowPropertyModal(true)}
            style={styles.input}
          >
            {form.property_id
              ? storeProperties.find(p => p.id === form.property_id)?.name ||
                'Choose a Property'
              : 'Choose a Property'}
          </Button>
        </View>
      )}

      {/* Scope: Multi House */}
      {form.scope === 'multi_house' && (
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.label}>
            Select Affected Houses
          </Text>
          <Button
            mode="outlined"
            onPress={() => setShowMultiHouseModal(true)}
            style={styles.input}
          >
            {form.affected_houses.length > 0
              ? `${form.affected_houses.length} Houses Selected`
              : 'Choose Houses'}
          </Button>

          {form.affected_houses.length > 0 && (
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 16,
              }}
            >
              {form.affected_houses.map(id => {
                const h = houses.find(house => house.id === id);
                if (!h) return null;
                return (
                  <Chip
                    key={id}
                    onClose={() =>
                      setForm(f => ({
                        ...f,
                        affected_houses: f.affected_houses.filter(hid => hid !== id),
                      }))
                    }
                  >
                    House {h.house_number}
                  </Chip>
                );
              })}
            </View>
          )}
        </View>
      )}

      <Text variant="titleMedium" style={styles.label}>
        Priority
      </Text>
      <SegmentedButtons
        value={form.priority}
        onValueChange={v => setForm(f => ({ ...f, priority: v as any }))}
        buttons={[
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'urgent', label: 'Urgent' },
        ]}
        style={styles.input}
      />

      <TextInput
        label="Description"
        value={form.description}
        onChangeText={t => setForm(f => ({ ...f, description: t }))}
        multiline
        numberOfLines={4}
        style={[styles.input, styles.textArea]}
      />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text variant="titleMedium">Photos</Text>
          <Button icon="camera" mode="text" onPress={handleImageUpload}>
            Add Photo
          </Button>
        </View>

        {form.images.length > 0 && (
          <ScrollView horizontal style={styles.imageList}>
            {form.images.map((uri, index) => (
              <View key={index} style={styles.imageContainer}>
                <Image source={{ uri }} style={styles.imageThumbnail} />
                <IconButton
                  icon="close-circle"
                  size={20}
                  style={styles.removeImageBtn}
                  onPress={() => removeImage(index)}
                />
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* House Selection Modal */}
      <BaseModal
        title="Select House"
        subtitle="Manage your properties"
        visible={showHouseModal}
        edgeToEdge
        scrollable={false}
        onDismiss={() => setShowHouseModal(false)}
      >
        <BaseSearch
          placeholder="Search houses..."
          value={houseSearch}
          onChangeText={setHouseSearch}
          leftIcon="magnify"
          rightIcon="close"
          onClear={() => setHouseSearch('')}
          style={styles.searchInput}
        />
        <ScrollView>
          {houses
            .filter(h => {
              const searchStr = houseSearch.toLowerCase();
              const houseNum = h.house_number.toLowerCase();
              const property = storeProperties.find(p => p.id === h.property_id);
              const propertyName = property?.name.toLowerCase() || '';
              return houseNum.includes(searchStr) || propertyName.includes(searchStr);
            })
            .map(h => {
              const property = storeProperties.find(p => p.id === h.property_id);
              return (
                <React.Fragment key={h.id}>
                  <List.Item
                    title={`${property ? `${property.name}: ` : ''}House ${h.house_number}`}
                    description={() => {
                      const tenantName = getTenantName(h.id);
                      return tenantName ? null : (
                        <Text variant="bodySmall" style={{ opacity: 0.7 }}>
                          Vacant
                        </Text>
                      );
                    }}
                    onPress={() => handleHouseSelect(h)}
                  />
                  <Divider />
                </React.Fragment>
              );
            })}
        </ScrollView>
      </BaseModal>

      {/* Property Selection Modal */}
      <BaseModal
        title="Select Property"
        subtitle="Manage your properties"
        visible={showPropertyModal}
        edgeToEdge
        scrollable={false}
        onDismiss={() => setShowPropertyModal(false)}
      >
        <BaseSearch
          placeholder="Search properties..."
          value={propertySearch}
          onChangeText={setPropertySearch}
          leftIcon="magnify"
          rightIcon="close"
          onClear={() => setPropertySearch('')}
          style={styles.searchInput}
        />
        <ScrollView>
          {storeProperties
            .filter(p => p.name.toLowerCase().includes(propertySearch.toLowerCase()))
            .map(property => (
              <React.Fragment key={property.id}>
                <List.Item
                  title={property.name}
                  description={property.location || 'No location'}
                  onPress={() => {
                    setForm(f => ({ ...f, property_id: property.id }));
                    setShowPropertyModal(false);
                    setPropertySearch('');
                  }}
                />
                <Divider />
              </React.Fragment>
            ))}
        </ScrollView>
      </BaseModal>

      {/* Multi-House Selection Modal */}
      <BaseModal
        title="Select Houses"
        subtitle="Manage your properties"
        visible={showMultiHouseModal}
        edgeToEdge
        scrollable={false}
        onDismiss={() => setShowMultiHouseModal(false)}
      >
        <BaseSearch
          placeholder="Search houses..."
          value={multiHouseSearch}
          onChangeText={setMultiHouseSearch}
          leftIcon="magnify"
          rightIcon="close"
          onClear={() => setMultiHouseSearch('')}
          style={styles.searchInput}
        />
        <ScrollView>
          {houses
            .filter(h => {
              const searchStr = multiHouseSearch.toLowerCase();
              const houseNum = h.house_number.toLowerCase();
              const property = storeProperties.find(p => p.id === h.property_id);
              const propertyName = property?.name.toLowerCase() || '';
              return houseNum.includes(searchStr) || propertyName.includes(searchStr);
            })
            .map(house => {
              const property = storeProperties.find(p => p.id === house.property_id);
              const isSelected = form.affected_houses.includes(house.id);
              const tenantName = getTenantName(house.id);

              return (
                <React.Fragment key={house.id}>
                  <List.Item
                    title={`${property ? `${property.name}: ` : ''}House ${house.house_number}`}
                    description={
                      tenantName ? null : (
                        <Text variant="bodySmall" style={{ opacity: 0.7 }}>
                          Vacant
                        </Text>
                      )
                    }
                    style={{
                      backgroundColor: isSelected ? colors.surfaceVariant : 'transparent',
                    }}
                    onPress={() => {
                      setForm(f => ({
                        ...f,
                        affected_houses: isSelected
                          ? f.affected_houses.filter(id => id !== house.id)
                          : [...f.affected_houses, house.id],
                      }));
                    }}
                  />
                  <Divider />
                </React.Fragment>
              );
            })}
        </ScrollView>
        <Button
          mode="contained"
          onPress={() => {
            setShowMultiHouseModal(false);
            setMultiHouseSearch('');
          }}
          style={{ marginTop: 16 }}
        >
          Done ({form.affected_houses.length} selected)
        </Button>
      </BaseModal>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    marginBottom: 16,
  },
  textArea: {
    height: 100,
  },
  label: {
    marginBottom: 8,
  },
  searchInput: {
    marginBottom: 16,
  },
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  imageList: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  imageContainer: {
    marginRight: 12,
    position: 'relative',
  },
  imageThumbnail: {
    width: 150,
    height: 150,
    borderRadius: 8,
  },
  removeImageBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    margin: 0,
  },
});
