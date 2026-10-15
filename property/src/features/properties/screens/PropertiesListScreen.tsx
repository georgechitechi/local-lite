const setPropertyFormModalVisible = (value: UIState['propertyFormModalVisible']) =>
  setUIField('propertyFormModalVisible', value);
const setPropertyFormPropertyId = (value: UIState['propertyFormPropertyId']) =>
  setUIField('propertyFormPropertyId', value);
const setHouseFormModalVisible = (value: UIState['houseFormModalVisible']) =>
  setUIField('houseFormModalVisible', value);
const setHouseFormHouseId = (value: UIState['houseFormHouseId']) =>
  setUIField('houseFormHouseId', value);
const setHouseFormPropertyId = (value: UIState['houseFormPropertyId']) =>
  setUIField('houseFormPropertyId', value);
const setHouseFormPropertyName = (value: UIState['houseFormPropertyName']) =>
  setUIField('houseFormPropertyName', value);

import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import type { BatchMutation } from 'local-lite';
import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Linking, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Divider, IconButton, Menu, Portal, Surface, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import AccessGuard from '@/shared/components/AccessGuard';
import BaseModal from '@/shared/components/BaseModal';
import BaseSearch from '@/shared/components/BaseSearch';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import LoadingCard from '@/shared/components/LoadingCard';
import SectionGroup from '@/shared/components/SectionGroup';
import SPressable from '@/shared/components/SlightPressable';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useCurrency } from '@/shared/hooks/useCurrency';
import {
  useContracts,
  useContractsByHouseId,
  useCoreMutations,
  useHouses,
  useHousesByPropertyId,
  useProperties,
  useStoreRefresh,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateForDB, formatWithCurrency } from '@/shared/utils/formatters';
import { properCase, snakeCaseToTitleCase, toLowerCase } from '@/shared/utils/helper';
import {
  isActiveContractStatus,
  resolveHouseStatusFromContracts,
} from '@/shared/utils/statusHelper';
import { setUIField, type UIState } from '@/stores/uiStore';

interface Property {
  id: string;
  name: string;
  location?: string | null;
  status?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  metadata?: any;
}

interface PropertySection {
  title: string;
  data: Property[];
  count: number;
}

const PropertyCardBase = ({
  property,
  housesByPropertyId,
  contractsByHouseId,
  colors,
  isMenuVisible,
  can,
  router,
  syncingHouses,
  defaultCurrency,
  getStatusColor,
  handleSyncHouseStatuses,
  setPropertyFormModalVisible,
  setPropertyFormPropertyId,
  setHouseFormModalVisible,
  setHouseFormHouseId,
  setHouseFormPropertyId,
  setHouseFormPropertyName,
  setMenuVisible,
  setSelectedProperty,
  setDeleteDialogVisible,
}: any) => {
  const stats = useMemo(() => {
    const p_houses = housesByPropertyId.get(property.id) || [];
    let occupiedCount = 0;
    let maintenanceCount = 0;
    let availableCount = 0;
    let totalRent = 0;

    p_houses.forEach((h: any) => {
      const houseStatus = h.status;
      const houseRent = h.monthly_rent;

      const hContracts = contractsByHouseId.get(h.id) || [];
      const isOccupied = hContracts.some((c: any) => isActiveContractStatus(c.status));

      if (isOccupied) {
        occupiedCount++;
      } else if (houseStatus === 'maintenance') {
        maintenanceCount++;
      } else if (houseStatus === 'closed') {
        // closed doesn't count towards available
      } else {
        availableCount++;
      }
      totalRent += Number.parseFloat(String(houseRent || '0')) || 0;
    });

    return {
      total: p_houses.length,
      available: availableCount,
      occupied: occupiedCount,
      maintenance: maintenanceCount,
      totalRent,
    };
  }, [property.id, housesByPropertyId, contractsByHouseId]);

  const statusColor = getStatusColor(property.status || '');

  return (
    <Surface style={[styles.propertyCard, { borderColor: statusColor, borderWidth: 1 }]}>
      <SPressable
        onPress={() => router.push(`/properties/view/${property.id}`)}
        style={{ flex: 1 }}
      >
        <View>
          <View key={`property-${property.id}`} style={styles.propertyHeader}>
            <View style={styles.propertyInfo}>
              <View style={styles.nameContainer}>
                <MaterialCommunityIcons
                  name="home-city"
                  size={20}
                  color={colors.onSurfaceVariant}
                />
                <Text variant="titleMedium" style={styles.nameText}>
                  {property.name}
                </Text>
              </View>
              <SPressable
                style={styles.locationContainer}
                onPress={() => {
                  if (property.latitude != null && property.longitude != null) {
                    const url = `https://www.google.com/maps?q=${property.latitude},${property.longitude}`;
                    Linking.openURL(url);
                  } else if (property.location) {
                    const url = `https://www.google.com/maps?q=${encodeURIComponent(property.location)}`;
                    Linking.openURL(url);
                  }
                }}
                disabled={
                  !property.location &&
                  (property.latitude == null || property.longitude == null)
                }
              >
                <MaterialCommunityIcons
                  name="map-marker"
                  size={16}
                  color={
                    (property.latitude != null && property.longitude != null) ||
                    property.location
                      ? colors.primary
                      : colors.onSurfaceVariant
                  }
                />
                <Text
                  variant="bodySmall"
                  style={[
                    styles.locationText,
                    (property.latitude != null && property.longitude != null) ||
                    property.location
                      ? { color: colors.primary }
                      : undefined,
                  ]}
                >
                  {property.location ||
                    (property.latitude != null && property.longitude != null
                      ? 'Location coordinates available'
                      : 'No location specified')}
                </Text>
              </SPressable>
              {property.metadata?.effective_date && (
                <View style={[styles.locationContainer, { marginTop: 4 }]}>
                  <MaterialCommunityIcons
                    name="calendar-check"
                    size={16}
                    color={colors.onSurfaceVariant}
                  />
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    Commissioned:{' '}
                    {new Date(property.metadata.effective_date).toLocaleDateString()}
                  </Text>
                </View>
              )}
              <View style={styles.statsContainer}>
                <View style={styles.statItem}>
                  <MaterialCommunityIcons
                    name="home-group"
                    size={16}
                    color={colors.onSurfaceVariant}
                  />
                  <Text variant="bodySmall">Total: {stats.total}</Text>
                </View>
                <View style={styles.statItem}>
                  <MaterialCommunityIcons
                    name="home-assistant"
                    size={16}
                    color={(colors as any).success}
                  />
                  <Text variant="bodySmall" style={{ color: (colors as any).success }}>
                    Available: {stats.available}
                  </Text>
                </View>
                <View style={styles.statItem}>
                  <MaterialCommunityIcons
                    name="wrench"
                    size={16}
                    color={(colors as any).warning}
                  />
                  <Text variant="bodySmall" style={{ color: (colors as any).warning }}>
                    Maintenance: {stats.maintenance}
                  </Text>
                </View>
              </View>
              <View style={styles.rentContainer}>
                <MaterialCommunityIcons
                  name="cash"
                  size={16}
                  color={colors.onSurfaceVariant}
                />
                <Text variant="bodySmall" style={styles.rentText}>
                  Total Monthly Rent:{' '}
                  {defaultCurrency
                    ? formatWithCurrency(stats.totalRent, defaultCurrency)
                    : stats.totalRent.toString()}
                </Text>
              </View>
            </View>
            <View style={styles.propertyActions}>
              <Menu
                visible={isMenuVisible}
                onDismiss={() => setMenuVisible(null)}
                anchor={
                  <IconButton
                    icon="dots-vertical"
                    size={20}
                    onPress={() => setMenuVisible(property.id)}
                  />
                }
              >
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    router.push(`/properties/view/${property.id}`);
                  }}
                  title="View Property"
                  leadingIcon="eye"
                />
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    setPropertyFormPropertyId(property.id);
                    setPropertyFormModalVisible(true);
                  }}
                  title="Edit Property"
                  leadingIcon="pencil"
                />
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    setHouseFormHouseId(null);
                    setHouseFormPropertyId(property.id);
                    setHouseFormPropertyName(property.name);
                    setHouseFormModalVisible(true);
                  }}
                  title="Add House"
                  leadingIcon="home-plus"
                />

                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    handleSyncHouseStatuses();
                  }}
                  title="Sync Houses"
                  leadingIcon="sync"
                  disabled={syncingHouses}
                />
                {can('delete', 'property') && (
                  <>
                    <Divider />
                    <Menu.Item
                      onPress={() => {
                        setMenuVisible(null);
                        setSelectedProperty(property);
                        setDeleteDialogVisible(true);
                      }}
                      title="Delete Property"
                      leadingIcon="delete"
                      titleStyle={{ color: colors.error }}
                    />
                  </>
                )}
              </Menu>
            </View>
          </View>
        </View>
      </SPressable>
    </Surface>
  );
};

const PropertyCard = memo(PropertyCardBase);

export default function PropertiesScreen() {
  const router = useRouter();
  const { selectedBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const { loading: accessLoading, can } = useAccessControl();
  const colors = useThemeColors();

  // Local-Lite Live Queries & Core Mutations
  const properties = useProperties(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const contracts = useContracts(selectedBusiness?.id);
  const { batch } = useCoreMutations();
  const { refreshing, onRefresh } = useStoreRefresh();
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);

  const housesByPropertyId = useHousesByPropertyId(selectedBusiness?.id);
  const contractsByHouseId = useContractsByHouseId(selectedBusiness?.id);

  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(
    () => new Set<string>(['active', 'coming_soon', 'unknown']),
  );
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [syncingHouses, setSyncingHouses] = useState(false);

  const handleDelete = async () => {
    if (!can('delete', 'property')) {
      showSnackbar('You do not have permission to delete properties', 'error');
      return;
    }

    if (!selectedProperty || !selectedBusiness) return;

    try {
      setDeleteLoading(true);

      // Step 1: Get all house IDs first
      const houseIds = houses
        .filter(h => h.property_id === selectedProperty.id)
        .map(h => h.id);

      // Step 2: Terminate active contracts
      const currentContracts = contracts.filter(
        c => houseIds.includes(c.house_id || '') && isActiveContractStatus(c.status),
      );

      const mutations: BatchMutation[] = [];

      currentContracts.forEach(c => {
        mutations.push({
          tableName: 'contracts',
          operation: 'UPDATE',
          payload: {
            status: 'terminated',
            end_date: formatDateForDB(new Date()),
            deleted: true,
          },
          rowId: c.id,
        });
      });

      // Step 3: Delete houses (soft delete)
      houseIds.forEach(houseId => {
        mutations.push({
          tableName: 'houses',
          operation: 'UPDATE',
          payload: {
            status: 'property_deleted',
            deleted: true,
          },
          rowId: houseId,
        });
      });

      // Step 4: Delete property (soft delete)
      mutations.push({
        tableName: 'properties',
        operation: 'UPDATE',
        payload: {
          status: 'deleted',
          deleted: true,
        },
        rowId: selectedProperty.id,
      });

      await batch(mutations);

      setDeleteDialogVisible(false);
      setSelectedProperty(null);
      showSnackbar('Property deleted successfully', 'success');
    } catch (error) {
      console.error('Delete property error:', error);
      showSnackbar('Failed to delete property', 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSyncHouseStatuses = useCallback(async () => {
    if (!selectedBusiness) return;

    try {
      setSyncingHouses(true);

      const allHouses = houses;
      const mutations: BatchMutation[] = [];

      allHouses.forEach(house => {
        if (house.status === 'deleted' || house.status === 'property_deleted') return;

        const houseContracts = contractsByHouseId.get(house.id as string) || [];

        const newStatus = resolveHouseStatusFromContracts(
          house.status,
          houseContracts,
          house.id,
        );

        if (newStatus !== house.status) {
          mutations.push({
            tableName: 'houses',
            operation: 'UPDATE',
            payload: {
              ...house,
              status: newStatus,
            },
            rowId: house.id,
          });
        }
      });

      if (mutations.length > 0) {
        await batch(mutations);
      }

      showSnackbar(
        `Successfully synchronized ${mutations.length} house statuses`,
        'success',
      );
    } catch (error) {
      console.error('Error synchronizing house statuses:', error);
      showSnackbar('Failed to synchronize house statuses.', 'error');
    } finally {
      setSyncingHouses(false);
    }
  }, [selectedBusiness, batch, houses, showSnackbar, contractsByHouseId]);

  const getStatusColor = useCallback(
    (status: string): string => {
      switch (status) {
        case 'active':
          return (colors as any).success;
        case 'coming_soon':
          return (colors as any).warning;

        default:
          return colors.onSurfaceVariant;
      }
    },
    [colors],
  );

  // Memoized sections: filter + group in one pass, not called inline in JSX
  const sections = useMemo(() => {
    const filtered = properties
      .filter(property => {
        const matchesSearch =
          toLowerCase(property.name).includes(toLowerCase(deferredSearchQuery)) ||
          (property.location &&
            toLowerCase(property.location).includes(toLowerCase(deferredSearchQuery)));
        const matchesStatus =
          selectedStatus === 'all' ||
          toLowerCase(property.status || '') === toLowerCase(selectedStatus);
        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const groups = filtered.reduce((acc: Record<string, PropertySection>, property) => {
      const status = property.status || 'unknown';
      if (!acc[status]) {
        acc[status] = { title: properCase(status), data: [], count: 0 };
      }
      acc[status].data.push(property);
      acc[status].count++;
      return acc;
    }, {});

    const statusOrder = ['active', 'coming_soon'];
    return Object.entries(groups)
      .sort((a, b) => statusOrder.indexOf(a[0]) - statusOrder.indexOf(b[0]))
      .map(([_, group]) => group);
  }, [properties, deferredSearchQuery, selectedStatus]);

  const renderStatusHeader = useCallback(
    ({ section }: { section: PropertySection }) => (
      <SectionGroup
        title={snakeCaseToTitleCase(section.title)}
        subtitle={`Total Properties: ${section.count}`}
        isExpanded={expandedStatuses.has(section.title.toLowerCase())}
        onToggle={() => {
          setExpandedStatuses(prev => {
            const next = new Set(prev);
            if (next.has(section.title.toLowerCase())) {
              next.delete(section.title.toLowerCase());
            } else {
              next.add(section.title.toLowerCase());
            }
            return next;
          });
        }}
      />
    ),
    [expandedStatuses],
  );

  const renderProperty = useCallback(
    ({ item: property }: { item: Property }) => {
      return (
        <PropertyCard
          property={property}
          housesByPropertyId={housesByPropertyId}
          contractsByHouseId={contractsByHouseId}
          colors={colors}
          isMenuVisible={menuVisible === property.id}
          can={can}
          router={router}
          syncingHouses={syncingHouses}
          defaultCurrency={defaultCurrency}
          getStatusColor={getStatusColor}
          handleSyncHouseStatuses={handleSyncHouseStatuses}
          setPropertyFormModalVisible={setPropertyFormModalVisible}
          setPropertyFormPropertyId={setPropertyFormPropertyId}
          setHouseFormModalVisible={setHouseFormModalVisible}
          setHouseFormHouseId={setHouseFormHouseId}
          setHouseFormPropertyId={setHouseFormPropertyId}
          setHouseFormPropertyName={setHouseFormPropertyName}
          setMenuVisible={setMenuVisible}
          setSelectedProperty={setSelectedProperty}
          setDeleteDialogVisible={setDeleteDialogVisible}
        />
      );
    },
    [
      housesByPropertyId,
      contractsByHouseId,
      colors,
      menuVisible,
      can,
      router,
      syncingHouses,
      defaultCurrency,
      getStatusColor,
      handleSyncHouseStatuses,
    ],
  );

  if (accessLoading) {
    return <LoadingCard iconName="home-city" text="Loading properties..." />;
  }

  return (
    <AccessGuard roles={['admin']}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <BaseSearch
          placeholder="Search properties"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onClear={() => setSearchQuery('')}
          leftIcon="magnify"
          rightIcon="close-circle"
        />

        <View style={styles.filterContainer}>
          <FilterButtons
            options={[
              { label: 'All', value: 'all', icon: 'layers-outline' },
              { label: 'Active', value: 'active', icon: 'check-circle' },
              { label: 'Coming Soon', value: 'coming_soon', icon: 'clock' },
            ]}
            selectedValue={selectedStatus}
            onValueChange={val => setSelectedStatus(val || 'all')}
          />
        </View>

        <SectionList
          style={{ flex: 1 }}
          sections={sections}
          extraData={{ houses, contracts, expandedStatuses }}
          keyExtractor={item => item.id}
          contentContainerStyle={[
            styles.listContent,
            sections.length === 0 && styles.emptyContainer,
          ]}
          renderItem={({ item, section }) =>
            expandedStatuses.has(section.title.toLowerCase())
              ? renderProperty({ item })
              : null
          }
          renderSectionHeader={renderStatusHeader}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={10}
          removeClippedSubviews={false}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <EmptyState icon="home-city-outline" title="No properties found" />
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />

        <Portal>
          <BaseModal
            mode="confirm"
            visible={deleteDialogVisible}
            onDismiss={() => setDeleteDialogVisible(false)}
            onConfirm={handleDelete}
            title="Delete Property"
            message={`Are you sure you want to delete ${selectedProperty?.name}? This will:\n\n• Mark all houses as deleted\n• Terminate all active contracts\n• Remove the property permanently`}
            confirmText="Delete"
            cancelText="Cancel"
            loading={deleteLoading}
            destructive={true}
          />
        </Portal>
      </View>
    </AccessGuard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  propertyCard: {
    margin: 8,
    padding: 12,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  propertyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  propertyInfo: {
    flex: 1,
    marginRight: 16,
  },
  propertyActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  nameText: {
    flex: 1,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  locationText: {
    flex: 1,
  },
  statsContainer: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  rentText: {
    fontStyle: 'italic',
  },
  filterContainer: {
    paddingHorizontal: 2,
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyContainer: {
    flexGrow: 1,
  },
});
