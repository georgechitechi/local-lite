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
const setHouseViewModalVisible = (value: UIState['houseViewModalVisible']) =>
  setUIField('houseViewModalVisible', value);
const setHouseViewHouseId = (value: UIState['houseViewHouseId']) =>
  setUIField('houseViewHouseId', value);

import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import {
  Card,
  Divider,
  IconButton,
  Menu,
  Portal,
  Surface,
  Text,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import AccessGuard from '@/shared/components/AccessGuard';
import BaseSearch from '@/shared/components/BaseSearch';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import HistoryModal from '@/shared/components/HistoryModal';
import LoadingCard from '@/shared/components/LoadingCard';
import StatusUpdateModal from '@/shared/components/StatusUpdateModal';
import { useCurrency } from '@/shared/hooks/useCurrency';
import { useHistoryTargets } from '@/shared/hooks/useHistoryTargets';
import {
  useContracts,
  useCoreMutations,
  useHouses,
  usePropertiesById,
  useSettings,
  useStoreRefresh,
  useTenantsById,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type {
  Contract as StoreContract,
  House as StoreHouse,
  Property as StoreProperty,
} from '@/shared/types/types';
import { formatWithCurrency } from '@/shared/utils/formatters';
import { snakeCaseToTitleCase } from '@/shared/utils/helper';
import {
  buildHouseStatusMenuItems,
  canTransitionHouseStatus,
  compareHouseNumbers,
  getHouseDisplayStatus,
  getHouseOccupancyLabel,
  getPropertyHouseStats,
  isActiveContractStatus,
  isHouseOccupiedByContracts,
} from '@/shared/utils/statusHelper';
import { setUIField, type UIState } from '@/stores/uiStore';

interface Contract extends Omit<StoreContract, 'tenant'> {
  tenant?: {
    name: string;
  };
}

interface House extends Omit<StoreHouse, 'contracts'> {
  contracts?: Contract[];
}

interface Property extends Omit<StoreProperty, 'houses'> {
  houses?: House[];
}

interface MenuPosition {
  x: number;
  y: number;
}

export default function ViewProperty() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors() as any;
  const [menuVisible, setMenuVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'none' | 'status' | 'type'>('none');
  const [filterMenuVisible, setFilterMenuVisible] = useState(false);
  const [selectedHouse, setSelectedHouse] = useState<House | null>(null);
  const [amenitiesMenuVisible, setAmenitiesMenuVisible] = useState(false);
  const [amenitiesMenuPosition, setAmenitiesMenuPosition] = useState<MenuPosition>({
    x: 0,
    y: 0,
  });
  const [amenitiesHouse, setAmenitiesHouse] = useState<House | null>(null);
  const { selectedBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const historyTargets = useHistoryTargets('properties', id);

  const allHouses = useHouses(selectedBusiness?.id);
  const allContracts = useContracts(selectedBusiness?.id);
  const allSettings = useSettings(selectedBusiness?.id);
  const tenantsById = useTenantsById(selectedBusiness?.id);
  const propertiesById = usePropertiesById(selectedBusiness?.id);
  const { update } = useCoreMutations();
  const { refreshing, onRefresh } = useStoreRefresh();

  const houseTypes = useMemo(() => {
    const houseTypesSetting = allSettings.find(s => s.setting_key === 'house_types');
    if (houseTypesSetting && Array.isArray(houseTypesSetting.setting_value)) {
      return (houseTypesSetting.setting_value as any[])
        .filter(t => t.active)
        .map(t => ({
          value: t.value,
          label: t.label,
        }));
    }
    return [
      { value: 'single', label: 'Single Room' },
      { value: 'bedsitter', label: 'Bedsitter' },
      { value: 'other', label: 'Other' },
    ];
  }, [allSettings]);

  const { defaultCurrency } = useCurrency(selectedBusiness?.id);

  const property = useMemo(() => {
    const p = propertiesById.get(id);
    if (!p) return null;

    const houses = allHouses
      .filter(h => h.property_id === id)
      .map(house => {
        const houseContracts = allContracts
          .filter(c => c.house_id === house.id)
          .map(c => ({
            ...c,
            tenant: c.tenant_id ? tenantsById.get(c.tenant_id) : undefined,
          }));

        return {
          ...house,
          contracts: houseContracts,
        };
      })
      .sort((a, b) => compareHouseNumbers(a.house_number, b.house_number));

    return {
      ...p,
      houses,
    } as Property;
  }, [id, propertiesById, allHouses, allContracts, tenantsById]);

  const statusItems = useMemo(() => {
    if (!selectedHouse) return [];
    return buildHouseStatusMenuItems({ house: selectedHouse, colors });
  }, [selectedHouse, colors]);

  const stats = useMemo(() => {
    if (!property?.houses) return { total: 0, occupied: 0, available: 0 };
    return getPropertyHouseStats(property.houses);
  }, [property]);

  const loading = !id || !selectedBusiness || !property;
  const notFound = !!id && !!selectedBusiness && !property;
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'available':
        return (colors as any).success;
      case 'occupied':
        return colors.primary;
      case 'maintenance':
        return (colors as any).warning;
      case 'closed':
        return colors.error;
      default:
        return colors.onSurfaceVariant;
    }
  };

  const handleUpdateStatus = async (house: House, newStatus: string) => {
    const isOccupied = isHouseOccupiedByContracts(house.contracts);
    if (
      !canTransitionHouseStatus(newStatus, { isOccupied, currentStatus: house.status })
    ) {
      showSnackbar(
        'Cannot change to this status while the house has an active contract',
        'error',
      );
      return;
    }
    try {
      await update('houses', house.id, { status: newStatus });
      setShowStatusMenu(false);
      setSelectedHouse(null);
    } catch (error: any) {
      showSnackbar(error.message || 'Failed to update status', 'error');
    }
  };

  const handleOpenMenu = (house: House) => {
    setSelectedHouse(house);
    setShowStatusMenu(true);
  };

  const handleOpenAmenities = (house: House, event: any) => {
    const { pageX, pageY } = event.nativeEvent;
    setAmenitiesMenuPosition({ x: pageX, y: pageY });
    setAmenitiesHouse(house);
    setAmenitiesMenuVisible(true);
  };

  const filteredHouses =
    property?.houses?.filter(house => {
      const matchesSearch =
        (house.house_number || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (house.type || '').toLowerCase().includes(searchQuery.toLowerCase());

      const displayStatus = getHouseDisplayStatus(house);
      const matchesStatus = selectedStatus === 'all' || displayStatus === selectedStatus;

      const matchesType = selectedType === 'all' || house.type === selectedType;
      return matchesSearch && matchesStatus && matchesType;
    }) || [];

  const renderHouse = ({ item: house }: { item: House }) => {
    const displayStatus = getHouseDisplayStatus(house);
    const statusColor = getStatusColor(displayStatus);
    const activeContract = house.contracts?.find(c => isActiveContractStatus(c.status));

    return (
      <Card style={[styles.card, { borderColor: statusColor, borderWidth: 1 }]}>
        <Card.Title
          title={`House ${house.house_number}`}
          subtitle={houseTypes.find(t => t.value === house.type)?.label || house.type}
          right={props => (
            <Menu
              visible={showStatusMenu && selectedHouse?.id === house.id}
              onDismiss={() => {
                setShowStatusMenu(false);
                setSelectedHouse(null);
              }}
              anchor={
                <IconButton
                  {...props}
                  icon="dots-vertical"
                  onPress={() => handleOpenMenu(house)}
                />
              }
            >
              <Menu.Item
                onPress={() => {
                  setShowStatusMenu(false);
                  setHouseViewHouseId(house.id);
                  setHouseViewModalVisible(true);
                }}
                title="View House"
                leadingIcon="eye"
              />
              <Menu.Item
                onPress={() => {
                  setShowStatusMenu(false);
                  setHouseFormHouseId(house.id);
                  setHouseFormPropertyId(id);
                  setHouseFormPropertyName(property?.name ?? '');
                  setHouseFormModalVisible(true);
                }}
                title="Edit House"
                leadingIcon="pencil"
              />
              {(!house.contracts ||
                house.contracts.length === 0 ||
                !house.contracts[0] ||
                !isActiveContractStatus(house.contracts[0].status)) && (
                <Menu.Item
                  onPress={() => {
                    setShowStatusMenu(false);
                    router.push({
                      pathname: '/contracts/create',
                      params: {
                        houseId: house.id,
                        propertyId: id,
                        propertyName: property?.name ?? '',
                        houseNumber: house.house_number,
                      },
                    });
                  }}
                  title="Create Contract"
                  leadingIcon="file-document-edit"
                />
              )}
              <Menu.Item
                onPress={() => {
                  setShowStatusMenu(false);
                  setStatusModalVisible(true);
                }}
                title="Update Status"
                leadingIcon="list-status"
              />
            </Menu>
          )}
        />
        <Card.Content style={{ paddingTop: 0, marginTop: -10 }}>
          <View style={styles.detailsContainer}>
            <View style={styles.row}>
              <Text variant="bodyMedium" style={styles.rentText}>
                {defaultCurrency
                  ? formatWithCurrency(Number(house.monthly_rent || 0), defaultCurrency)
                  : '...'}
                /month{' '}
                <Text
                  style={activeContract?.tenant ? styles.occupiedText : styles.vacantText}
                >
                  {getHouseOccupancyLabel(displayStatus, activeContract?.tenant?.name)}
                </Text>
              </Text>
              <IconButton
                icon="information-outline"
                iconColor={statusColor}
                size={20}
                style={{ margin: 0, padding: 0 }}
                onPress={e => handleOpenAmenities(house, e)}
              />
            </View>
            {(house.metadata as any)?.effective_date && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <MaterialCommunityIcons
                  name="calendar-check"
                  size={14}
                  color={colors.onSurfaceVariant}
                  style={{ marginRight: 4 }}
                />
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  Commissioned:{' '}
                  {new Date((house.metadata as any).effective_date).toLocaleDateString()}
                </Text>
              </View>
            )}
          </View>
        </Card.Content>
      </Card>
    );
  };

  if (loading) {
    return <LoadingCard iconName="home-city" text="Loading houses..." />;
  }

  if (notFound) {
    return (
      <EmptyState
        icon="home-city-outline"
        title="Property not found"
        description="This property may have been deleted or you may not have access."
        style={{ backgroundColor: colors.background }}
      />
    );
  }

  if (!property) {
    return <LoadingCard iconName="home-city" text="Loading property data..." />;
  }

  return (
    <AccessGuard roles={['admin']}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Surface
          style={[styles.header, { backgroundColor: colors.surface }]}
          elevation={2}
        >
          <View style={styles.titleContainer}>
            <Text variant="headlineMedium">{property.name}</Text>
            <Menu
              visible={menuVisible}
              onDismiss={() => setMenuVisible(false)}
              anchor={
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <IconButton
                    icon={showSearch ? 'magnify-close' : 'magnify'}
                    onPress={() => setShowSearch(!showSearch)}
                  />
                  <Menu
                    visible={filterMenuVisible}
                    onDismiss={() => setFilterMenuVisible(false)}
                    anchor={
                      <IconButton
                        icon={
                          activeFilter !== 'none'
                            ? 'filter-variant-minus'
                            : 'filter-variant'
                        }
                        onPress={() => setFilterMenuVisible(true)}
                      />
                    }
                  >
                    <Menu.Item
                      onPress={() => {
                        setActiveFilter('status');
                        setFilterMenuVisible(false);
                      }}
                      title="By Status"
                      leadingIcon="list-status"
                    />
                    <Menu.Item
                      onPress={() => {
                        setActiveFilter('type');
                        setFilterMenuVisible(false);
                      }}
                      title="By Type"
                      leadingIcon="home-variant-outline"
                    />
                    <Divider />
                    <Menu.Item
                      onPress={() => {
                        setActiveFilter('none');
                        setFilterMenuVisible(false);
                        setSelectedStatus('all');
                        setSelectedType('all');
                      }}
                      title="Clear All"
                      leadingIcon="filter-off-outline"
                    />
                  </Menu>
                  <IconButton icon="dots-vertical" onPress={() => setMenuVisible(true)} />
                </View>
              }
            >
              <Menu.Item
                onPress={() => {
                  setMenuVisible(false);
                  setPropertyFormPropertyId(id);
                  setPropertyFormModalVisible(true);
                }}
                title="Edit Property"
                leadingIcon="pencil"
              />
              <Menu.Item
                onPress={() => {
                  setMenuVisible(false);
                  setHouseFormHouseId(null);
                  setHouseFormPropertyId(id);
                  setHouseFormPropertyName(property.name);
                  setHouseFormModalVisible(true);
                }}
                title="Add House"
                leadingIcon="home-plus"
              />
              <Menu.Item
                onPress={() => {
                  setMenuVisible(false);
                  setHistoryModalVisible(true);
                }}
                title="View History"
                leadingIcon="history"
              />
            </Menu>
          </View>

          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text variant="titleMedium">{stats.total}</Text>
              <Text variant="bodySmall">Total</Text>
            </View>
            <View style={styles.statItem}>
              <Text variant="titleMedium" style={{ color: (colors as any).success }}>
                {stats.available}
              </Text>
              <Text variant="bodySmall">Available</Text>
            </View>
            <View style={styles.statItem}>
              <Text variant="titleMedium" style={{ color: colors.primary }}>
                {stats.occupied}
              </Text>
              <Text variant="bodySmall">Occupied</Text>
            </View>
          </View>

          {showSearch && (
            <View style={styles.searchContainer}>
              <BaseSearch
                placeholder="Search houses..."
                onChangeText={setSearchQuery}
                value={searchQuery}
                rightIcon="close"
                onClear={() => {
                  setSearchQuery('');
                  setShowSearch(false);
                }}
              />
            </View>
          )}
          {activeFilter === 'status' && (
            <View style={styles.filterContainer}>
              <FilterButtons
                options={[
                  { label: 'All', value: 'all', icon: 'layers-outline' },
                  { label: 'Available', value: 'available', icon: 'check-circle' },
                  { label: 'Occupied', value: 'occupied', icon: 'account-check' },
                  { label: 'Maintenance', value: 'maintenance', icon: 'tools' },
                  { label: 'Closed', value: 'closed', icon: 'close-circle' },
                ]}
                selectedValue={selectedStatus}
                onValueChange={val => setSelectedStatus((val || 'all') as any)}
              />
            </View>
          )}
          {activeFilter === 'type' && (
            <View style={styles.filterContainer}>
              <FilterButtons
                options={[
                  { label: 'All Types', value: 'all', icon: 'layers-outline' },
                  ...houseTypes,
                ]}
                selectedValue={selectedType}
                onValueChange={val => setSelectedType((val || 'all') as any)}
              />
            </View>
          )}
        </Surface>

        {filteredHouses.length === 0 ? (
          <EmptyState
            icon="home-city-outline"
            title="No houses found"
            description={
              searchQuery
                ? 'Try adjusting your search or filters'
                : 'Add your first house to this property'
            }
          />
        ) : (
          <FlatList
            data={filteredHouses}
            renderItem={renderHouse}
            keyExtractor={item => item.id.toString()}
            contentContainerStyle={styles.listContent}
            extraData={{
              filteredHouses,
              property,
              showStatusMenu,
              selectedHouse,
            }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
          />
        )}

        <Portal>
          <Menu
            visible={amenitiesMenuVisible}
            onDismiss={() => {
              setAmenitiesMenuVisible(false);
              setAmenitiesHouse(null);
            }}
            anchor={amenitiesMenuPosition}
          >
            <Menu.Item
              disabled
              title="Amenities"
              titleStyle={{ fontWeight: 'bold', color: colors.primary }}
            />
            <Divider />
            {amenitiesHouse?.amenities &&
            Array.isArray(amenitiesHouse.amenities) &&
            amenitiesHouse.amenities.length > 0 ? (
              amenitiesHouse.amenities.map((amenity, idx) => (
                <Menu.Item
                  key={idx}
                  title={`• ${snakeCaseToTitleCase(String(amenity))}`}
                  dense
                />
              ))
            ) : (
              <Menu.Item title="No amenities listed" disabled />
            )}
          </Menu>

          <StatusUpdateModal
            visible={statusModalVisible}
            onDismiss={() => setStatusModalVisible(false)}
            title="Update House Status"
            subtitle={selectedHouse ? `House: ${selectedHouse.house_number}` : undefined}
            items={statusItems}
            onSelect={status => {
              if (selectedHouse) handleUpdateStatus(selectedHouse, status);
              setStatusModalVisible(false);
            }}
          />
          <HistoryModal
            entityType="properties"
            entityId={id}
            targets={historyTargets}
            visible={historyModalVisible}
            onDismiss={() => setHistoryModalVisible(false)}
            hideTrigger
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
  header: {
    paddingVertical: 8,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  statItem: {
    alignItems: 'center',
  },
  searchContainer: {
    paddingHorizontal: 0,
    marginBottom: 4,
  },
  card: {
    marginHorizontal: 10,
    marginVertical: 4,
    elevation: 2,
  },
  detailsContainer: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rentText: {
    fontWeight: '500',
  },
  listContent: {
    paddingVertical: 8,
  },
  occupiedText: {},
  vacantText: {},
  filterContainer: {
    paddingHorizontal: 2,
  },
});
