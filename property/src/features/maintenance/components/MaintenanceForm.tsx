import React from 'react';
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

interface MaintenanceFormProps {
  form: MaintenanceFormData;
  setForm: React.Dispatch<React.SetStateAction<MaintenanceFormData>>;
  isTenant: boolean;
  tenantId: string | null;
  storeProperties: any[];
  houses: any[];
  getTenantName: (houseId: string) => string | null;
  selectedHouse: any;
  handleImageUpload: () => void;
  removeImage: (index: number) => void;
  colors: any;
  showHouseModal: boolean;
  setShowHouseModal: (v: boolean) => void;
  showPropertyModal: boolean;
  setShowPropertyModal: (v: boolean) => void;
  showMultiHouseModal: boolean;
  setShowMultiHouseModal: (v: boolean) => void;
  houseSearch: string;
  setHouseSearch: (v: string) => void;
  propertySearch: string;
  setPropertySearch: (v: string) => void;
  multiHouseSearch: string;
  setMultiHouseSearch: (v: string) => void;
}

export default function MaintenanceForm({
  form,
  setForm,
  isTenant,
  storeProperties,
  houses,
  getTenantName,
  selectedHouse,
  handleImageUpload,
  removeImage,
  colors,
  showHouseModal,
  setShowHouseModal,
  showPropertyModal,
  setShowPropertyModal,
  showMultiHouseModal,
  setShowMultiHouseModal,
  houseSearch,
  setHouseSearch,
  propertySearch,
  setPropertySearch,
  multiHouseSearch,
  setMultiHouseSearch,
}: MaintenanceFormProps) {
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
          { value: 'single_house', label: 'Single', icon: 'home' },
          {
            value: 'multi_house',
            label: 'Multi',
            icon: 'home-group',
            disabled: isTenant,
          },
          {
            value: 'property',
            label: 'Property',
            icon: 'office-building',
            disabled: isTenant,
          },
        ]}
        style={styles.input}
      />

      {form.scope === 'property' && (
        <Button
          mode="outlined"
          onPress={() => setShowPropertyModal(true)}
          style={styles.input}
          icon="office-building"
        >
          {form.property_id
            ? storeProperties.find(p => p.id === form.property_id)?.name ||
              'Select Property'
            : 'Select Property'}
        </Button>
      )}

      {form.scope === 'multi_house' && (
        <View style={styles.input}>
          <Button
            mode="outlined"
            onPress={() => setShowMultiHouseModal(true)}
            icon="home-group"
          >
            {form.affected_houses.length > 0
              ? `${form.affected_houses.length} Houses Selected`
              : 'Select Houses'}
          </Button>
          {form.affected_houses.length > 0 && (
            <View
              style={{
                marginTop: 8,
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 4,
              }}
            >
              {form.affected_houses.map(houseId => {
                const house = houses.find(h => h.id === houseId);
                return (
                  <Chip
                    key={houseId}
                    onClose={() => {
                      setForm(f => ({
                        ...f,
                        affected_houses: f.affected_houses.filter(id => id !== houseId),
                      }));
                    }}
                    style={{ marginBottom: 4 }}
                  >
                    House {house?.house_number || 'Unknown'}
                  </Chip>
                );
              })}
            </View>
          )}
        </View>
      )}

      {form.scope === 'single_house' && (
        <Button
          mode="outlined"
          onPress={() => !isTenant && setShowHouseModal(true)}
          style={styles.input}
          disabled={isTenant}
          icon="home-outline"
        >
          {selectedHouse
            ? `${
                storeProperties.find(p => p.id === selectedHouse.property_id)?.name || ''
              }: House ${selectedHouse.house_number}`
            : 'Select House'}
        </Button>
      )}

      <View style={styles.input}>
        <DatePicker
          label="Event Date"
          value={form.event_date.toISOString()}
          onChange={date => {
            if (date) {
              setForm(f => ({ ...f, event_date: new Date(date) }));
            }
          }}
          maximumDate={null}
        />
      </View>

      <TextInput
        label="Description"
        value={form.description}
        onChangeText={t => setForm(f => ({ ...f, description: t }))}
        style={[styles.input, styles.textArea]}
        mode="outlined"
        multiline
        numberOfLines={4}
      />

      <Text variant="titleMedium" style={styles.label}>
        Priority
      </Text>
      <SegmentedButtons
        value={form.priority}
        onValueChange={v => setForm(f => ({ ...f, priority: v as any }))}
        buttons={[
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Med' },
          { value: 'high', label: 'High' },
          { value: 'urgent', label: 'Urgent' },
        ]}
        style={styles.input}
      />

      {/* Images Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text variant="titleMedium">Images</Text>
          <Button mode="text" onPress={handleImageUpload} icon="camera" compact>
            Add Image
          </Button>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.imageList}
        >
          {form.images.map((uri, index) => (
            <View key={index} style={styles.imageContainer}>
              <Image source={{ uri }} style={styles.imageThumbnail} />
              <IconButton
                icon="close-circle"
                size={20}
                style={styles.removeImageBtn}
                iconColor={colors.error}
                onPress={() => removeImage(index)}
              />
            </View>
          ))}
          {form.images.length === 0 && (
            <Text
              variant="bodySmall"
              style={{ fontStyle: 'italic', color: colors.outline }}
            >
              No images added
            </Text>
          )}
        </ScrollView>
      </View>

      <BaseModal
        title="Select House"
        subtitle="Manage your properties"
        visible={showHouseModal}
        edgeToEdge
        scrollable={false}
        onDismiss={() => setShowHouseModal(false)}
      >
        {!isTenant && (
          <BaseSearch
            placeholder="Search houses..."
            value={houseSearch}
            onChangeText={setHouseSearch}
            leftIcon="magnify"
            rightIcon="close"
            onClear={() => setHouseSearch('')}
            style={styles.searchInput}
          />
        )}
        <ScrollView>
          {houses
            .filter(h => {
              if (isTenant) return h.id === form.house_id;
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
