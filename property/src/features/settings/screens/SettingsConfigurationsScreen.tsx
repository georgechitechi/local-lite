import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Chip,
  DataTable,
  HelperText,
  IconButton,
  SegmentedButtons,
  Surface,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import LoadingCard from '@/shared/components/LoadingCard';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useCoreMutations, useSettings } from '@/shared/hooks/useStore';
import { OFFLINE_USER_ID } from '@/shared/services/auth';
import {
  generateUUID,
  properCase,
  toLowerCase,
} from '@/shared/utils/helper';

interface HouseType {
  id: string;
  value: string;
  label: string;
  amenities: string[];
  active: boolean;
}

interface Amenity {
  id: string;
  label: string;
  value: string;
  active: boolean;
}

interface Settings {
  house_types: HouseType[];
  amenities: Amenity[];
  [key: string]: any;
}

export default function PropertyConfigurations() {
  const { user } = useAuth();

  const theme = useTheme();
  const { selectedBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const { hasAccess } = useAccessControl();

  // Local-Lite SQLite store
  const allSettings = useSettings(selectedBusiness?.id);
  const { insert, update } = useCoreMutations();

  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState('amenities'); // amenities | houseTypes

  const [settings, setSettings] = useState<Settings>({
    house_types: [],
    amenities: [],
  });

  // Form States
  const [newHouseType, setNewHouseType] = useState('');
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [newAmenity, setNewAmenity] = useState('');

  const [houseTypeError, setHouseTypeError] = useState('');
  const [amenityError, setAmenityError] = useState('');

  // Amenities Details Modal
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [selectedHouseTypeAmenities, setSelectedHouseTypeAmenities] = useState<string[]>(
    [],
  );
  const [selectedHouseTypeName, setSelectedHouseTypeName] = useState('');

  // Add Modal
  const [showAddModal, setShowAddModal] = useState(false);

  // Sync store data to local state
  useEffect(() => {
    if (allSettings) {
      const newSettings: Settings = { house_types: [], amenities: [] };
      allSettings.forEach(setting => {
        if (
          setting.setting_key === 'house_types' ||
          setting.setting_key === 'amenities'
        ) {
          let val = setting.setting_value;
          if (typeof val === 'string') {
            try {
              val = JSON.parse(val);
            } catch {
              val = [];
            }
          }
          newSettings[setting.setting_key] = (val as any) || [];
        }
      });
      setSettings(prev => {
        if (JSON.stringify(prev) === JSON.stringify(newSettings)) {
          return prev;
        }
        return newSettings;
      });
    }
  }, [allSettings]);

  const saveSettings = async (settingKey: string, value: any) => {
    if (!selectedBusiness?.id || !user) return;

    try {
      setSaving(true);

      // Find existing setting for this business/user/key
      const existingSetting = allSettings.find(
        s =>
          s.setting_key === settingKey &&
          (s.user_id === user.id || user.id === OFFLINE_USER_ID),
      );

      if (existingSetting) {
        // Update existing
        await update('settings', existingSetting.id, {
          setting_value: value,
        });
      } else {
        // Insert new using a generated ID
        const newId = generateUUID();
        await insert('settings', {
          id: newId,
          business_id: selectedBusiness.id,
          user_id: user.id,
          setting_key: settingKey,
          setting_value: value,
        });
      }
    } catch (error: any) {
      console.error('Error saving settings:', error);
      showSnackbar('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const [showDeleteHouseTypeConfirm, setShowDeleteHouseTypeConfirm] = useState(false);
  const [deleteHouseTypeParams, setDeleteHouseTypeParams] = useState<HouseType | null>(
    null,
  );

  const [showDeleteAmenityConfirm, setShowDeleteAmenityConfirm] = useState(false);
  const [deleteAmenityParams, setDeleteAmenityParams] = useState<Amenity | null>(null);

  const handleAddHouseType = async () => {
    setHouseTypeError('');

    if (!newHouseType.trim()) {
      setHouseTypeError('House type name is required');
      return;
    }

    if (selectedAmenities.length === 0) {
      setHouseTypeError('Please select at least one amenity');
      return;
    }

    const exists = settings.house_types?.some(
      type => toLowerCase(type.label) === toLowerCase(newHouseType.trim()),
    );

    if (exists) {
      setHouseTypeError('This house type already exists');
      return;
    }

    const newHouseTypeData: HouseType = {
      id: generateUUID(),
      value: toLowerCase(newHouseType.trim()).replace(/\s+/g, '-'),
      label: properCase(newHouseType.trim().replace(/\s+/g, ' ')),
      amenities: selectedAmenities,
      active: true,
    };

    const newHouseTypes = [...(settings.house_types || []), newHouseTypeData];
    await saveSettings('house_types', newHouseTypes);
    setNewHouseType('');
    setSelectedAmenities([]);
    setShowAddModal(false);
  };

  const handleDeleteHouseType = async (type: HouseType) => {
    if (!hasAccess(['admin'])) {
      showSnackbar('You do not have permission to delete house types', 'error');
      return;
    }

    setDeleteHouseTypeParams(type);
    setShowDeleteHouseTypeConfirm(true);
  };

  const handleAddAmenity = async () => {
    setAmenityError('');
    if (!newAmenity.trim()) {
      setAmenityError('Amenity name is required');
      return;
    }

    const exists = settings.amenities?.some(
      amenity => toLowerCase(amenity.label) === toLowerCase(newAmenity.trim()),
    );

    if (exists) {
      setAmenityError('This amenity already exists');
      return;
    }

    const newAmenities: Amenity[] = [
      ...(settings.amenities || []),
      {
        id: generateUUID(),
        label: properCase(newAmenity.trim()),
        value: toLowerCase(newAmenity.trim()).replace(/\s+/g, '-'),
        active: true,
      },
    ];

    await saveSettings('amenities', newAmenities);
    setNewAmenity('');
    setShowAddModal(false);
  };

  const handleDeleteAmenity = async (amenity: Amenity) => {
    if (!hasAccess(['admin'])) {
      showSnackbar('You do not have permission to delete amenities', 'error');
      return;
    }

    setDeleteAmenityParams(amenity);
    setShowDeleteAmenityConfirm(true);
  };

  const showAmenitiesDetails = (type: HouseType) => {
    setSelectedHouseTypeName(type.label);
    setSelectedHouseTypeAmenities(type.amenities);
    setDetailsModalVisible(true);
  };

  if (!selectedBusiness?.id) {
    return <LoadingCard iconName="cogs" text="Loading configurations..." />;
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Surface style={styles.header} elevation={1}>
        <SegmentedButtons
          value={viewMode}
          onValueChange={setViewMode}
          buttons={[
            {
              value: 'amenities',
              label: 'Amenities',
              icon: 'home-variant',
            },
            {
              value: 'houseTypes',
              label: 'House Types',
              icon: 'home-outline',
            },
          ]}
          style={styles.segmentedButtons}
        />
      </Surface>

      <ScrollView contentContainerStyle={styles.content}>
        {viewMode === 'houseTypes' ? (
          <>
            <View style={styles.sectionHeader}>
              <Text variant="titleMedium" style={styles.sectionTitle}>
                Manage House Types
              </Text>
              <IconButton
                icon="plus"
                mode="contained"
                containerColor={theme.colors.primaryContainer}
                iconColor={theme.colors.primary}
                size={20}
                onPress={() => setShowAddModal(true)}
              />
            </View>
            <Surface style={styles.card} elevation={1}>
              <DataTable>
                <DataTable.Header>
                  <DataTable.Title>Type</DataTable.Title>
                  <DataTable.Title numeric>Amenities</DataTable.Title>
                  <DataTable.Title numeric>Status</DataTable.Title>
                  <DataTable.Title numeric>Actions</DataTable.Title>
                </DataTable.Header>
                {settings.house_types?.map(type => (
                  <DataTable.Row key={type.id} style={styles.row}>
                    <DataTable.Cell style={styles.cellMain}>{type.label}</DataTable.Cell>
                    <DataTable.Cell numeric>
                      <Button
                        mode="text"
                        compact
                        onPress={() => showAmenitiesDetails(type)}
                      >
                        {type.amenities.length}
                      </Button>
                    </DataTable.Cell>
                    <DataTable.Cell numeric>
                      <SwitchButton
                        active={type.active}
                        onToggle={() => {
                          const updatedTypes = settings.house_types.map(t =>
                            t.id === type.id ? { ...t, active: !t.active } : t,
                          );
                          saveSettings('house_types', updatedTypes);
                        }}
                      />
                    </DataTable.Cell>
                    <DataTable.Cell numeric>
                      <IconButton
                        icon="delete"
                        size={20}
                        iconColor={theme.colors.error}
                        onPress={() => handleDeleteHouseType(type)}
                        disabled={!hasAccess(['admin'])}
                      />
                    </DataTable.Cell>
                  </DataTable.Row>
                ))}
              </DataTable>
            </Surface>
          </>
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text variant="titleMedium" style={styles.sectionTitle}>
                Manage Amenities
              </Text>
              <IconButton
                icon="plus"
                mode="contained"
                containerColor={theme.colors.primaryContainer}
                iconColor={theme.colors.primary}
                size={20}
                onPress={() => setShowAddModal(true)}
              />
            </View>
            <Surface style={styles.card} elevation={1}>
              <DataTable>
                <DataTable.Header>
                  <DataTable.Title>Amenity</DataTable.Title>
                  <DataTable.Title numeric>Status</DataTable.Title>
                  <DataTable.Title numeric>Actions</DataTable.Title>
                </DataTable.Header>
                {settings.amenities?.map(amenity => (
                  <DataTable.Row key={amenity.id} style={styles.row}>
                    <DataTable.Cell style={styles.cellMain}>
                      {amenity.label}
                    </DataTable.Cell>
                    <DataTable.Cell numeric>
                      <SwitchButton
                        active={amenity.active}
                        onToggle={() => {
                          const updatedAmenities = settings.amenities.map(a =>
                            a.id === amenity.id ? { ...a, active: !a.active } : a,
                          );
                          saveSettings('amenities', updatedAmenities);
                        }}
                      />
                    </DataTable.Cell>
                    <DataTable.Cell numeric>
                      <IconButton
                        icon="delete"
                        size={20}
                        iconColor={theme.colors.error}
                        onPress={() => handleDeleteAmenity(amenity)}
                        disabled={!hasAccess(['admin'])}
                      />
                    </DataTable.Cell>
                  </DataTable.Row>
                ))}
              </DataTable>
            </Surface>
          </>
        )}
      </ScrollView>

      {/* Amenities Details Modal */}
      <BaseModal
        visible={detailsModalVisible}
        onDismiss={() => setDetailsModalVisible(false)}
        title={`${selectedHouseTypeName} Amenities`}
        subtitle="Manage your properties"
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={{ gap: 12 }}>
            {selectedHouseTypeAmenities.map((amenity, index) => (
              <View key={index} style={styles.amenityItem}>
                <MaterialCommunityIcons
                  name="check-circle-outline"
                  size={20}
                  color={theme.colors.primary}
                />
                <Text variant="bodyLarge">{amenity}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </BaseModal>

      {/* Add Item Modal */}
      <BaseModal
        visible={showAddModal}
        onDismiss={() => setShowAddModal(false)}
        scrollable={true}
        title={viewMode === 'houseTypes' ? 'Add New House Type' : 'Add New Amenity'}
        subtitle="Manage your properties"
        actions={[
          {
            label: 'Cancel',
            mode: 'outlined',
            onPress: () => setShowAddModal(false),
            style: { flex: 1 },
          },
          {
            label: 'Add',
            mode: 'contained',
            onPress: viewMode === 'houseTypes' ? handleAddHouseType : handleAddAmenity,
            loading: saving,
            disabled:
              viewMode === 'houseTypes'
                ? !newHouseType.trim() || selectedAmenities.length === 0
                : !newAmenity.trim(),
            style: { flex: 1 },
          },
        ]}
      >
        <ScrollView>
          {viewMode === 'houseTypes' ? (
            <View style={{ gap: 12 }}>
              <TextInput
                label="House Type Name"
                value={newHouseType}
                onChangeText={text => {
                  setNewHouseType(text);
                  setHouseTypeError('');
                }}
                style={styles.input}
                mode="outlined"
                error={!!houseTypeError}
              />
              {houseTypeError ? (
                <HelperText type="error" visible={!!houseTypeError}>
                  {houseTypeError}
                </HelperText>
              ) : null}

              <Text variant="bodyMedium">Select Included Amenities:</Text>
              <View style={styles.amenitiesSelector}>
                {settings.amenities?.filter(a => a.active).length > 0 ? (
                  settings.amenities
                    .filter(amenity => amenity.active)
                    .map(amenity => (
                      <Chip
                        key={amenity.id}
                        selected={selectedAmenities.includes(amenity.label)}
                        onPress={() => {
                          setSelectedAmenities(prev =>
                            prev.includes(amenity.label)
                              ? prev.filter(a => a !== amenity.label)
                              : [...prev, amenity.label],
                          );
                        }}
                        showSelectedOverlay
                        style={styles.chip}
                        mode="outlined"
                      >
                        {amenity.label}
                      </Chip>
                    ))
                ) : (
                  <Text variant="bodySmall" style={{ color: theme.colors.error }}>
                    No active amenities found. Please add amenities first.
                  </Text>
                )}
              </View>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <TextInput
                label="Amenity Name"
                value={newAmenity}
                onChangeText={text => {
                  setNewAmenity(text);
                  setAmenityError('');
                }}
                style={styles.input}
                mode="outlined"
                error={!!amenityError}
              />
              {amenityError ? (
                <HelperText type="error" visible={!!amenityError}>
                  {amenityError}
                </HelperText>
              ) : null}
            </View>
          )}
        </ScrollView>
      </BaseModal>

      <BaseModal
        mode="confirm"
        visible={showDeleteHouseTypeConfirm}
        onDismiss={() => {
          setShowDeleteHouseTypeConfirm(false);
          setDeleteHouseTypeParams(null);
        }}
        onConfirm={async () => {
          if (!deleteHouseTypeParams) return;
          try {
            const updatedTypes = settings.house_types.filter(
              t => t.id !== deleteHouseTypeParams.id,
            );
            await saveSettings('house_types', updatedTypes);
            showSnackbar('House type deleted successfully', 'success');
          } catch (error) {
            console.error('Error deleting house type:', error);
            showSnackbar('Failed to delete house type', 'error');
          } finally {
            setShowDeleteHouseTypeConfirm(false);
            setDeleteHouseTypeParams(null);
          }
        }}
        title="Delete House Type"
        message="Are you sure you want to delete this house type?"
        confirmText="Delete"
        destructive={true}
      />

      <BaseModal
        mode="confirm"
        visible={showDeleteAmenityConfirm}
        onDismiss={() => {
          setShowDeleteAmenityConfirm(false);
          setDeleteAmenityParams(null);
        }}
        onConfirm={async () => {
          if (!deleteAmenityParams) return;
          try {
            const updatedAmenities = settings.amenities.filter(
              a => a.id !== deleteAmenityParams.id,
            );
            await saveSettings('amenities', updatedAmenities);
            showSnackbar('Amenity deleted successfully', 'success');
          } catch (error) {
            console.error('Error deleting amenity:', error);
            showSnackbar('Failed to delete amenity', 'error');
          } finally {
            setShowDeleteAmenityConfirm(false);
            setDeleteAmenityParams(null);
          }
        }}
        title="Delete Amenity"
        message="Are you sure you want to delete this amenity?"
        confirmText="Delete"
        destructive={true}
      />
    </View>
  );
}

// Mini component for status switch to keep the main render cleaner
function SwitchButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const theme = useTheme();
  return (
    <IconButton
      icon={active ? 'check-circle' : 'circle-off-outline'}
      iconColor={active ? theme.colors.primary : theme.colors.onSurfaceDisabled}
      size={24}
      onPress={onToggle}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 10,
  },
  segmentedButtons: {
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  content: {
    padding: 10,
    paddingTop: 10,
  },
  sectionTitle: {
    fontWeight: 'bold',
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginLeft: 4,
    marginRight: 4,
  },
  card: {
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 24,
  },
  row: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  cellMain: {
    flex: 2,
  },
  input: {
    backgroundColor: 'transparent',
    marginBottom: 4,
  },
  amenitiesSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    margin: 2,
  },
  amenityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: 8,
  },
});
