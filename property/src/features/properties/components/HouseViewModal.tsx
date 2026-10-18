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
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Chip,
  Divider,
  IconButton,
  Menu,
  Portal,
  Text,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import AccessGuard from '@/shared/components/AccessGuard';
import BaseModal from '@/shared/components/BaseModal';
import HistoryModal from '@/shared/components/HistoryModal';
import StatusUpdateModal from '@/shared/components/StatusUpdateModal';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useCurrency } from '@/shared/hooks/useCurrency';
import { useHistoryTargets } from '@/shared/hooks/useHistoryTargets';
import {
  useContractsByHouseId,
  useCoreMutations,
  useHousesById,
  usePropertiesById,
  useTenantsById,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateRange, formatWithCurrency } from '@/shared/utils/formatters';
import { properCase, snakeCaseToTitleCase } from '@/shared/utils/helper';
import {
  buildHouseStatusMenuItems,
  canTransitionHouseStatus,
  getHouseDisplayStatus,
  isActiveContractStatus,
} from '@/shared/utils/statusHelper';
import { setUIField, type UIState } from '@/stores/uiStore';

interface House {
  id: string;
  house_number: string;
  type: string;
  status: string;
  monthly_rent: number;
  amenities?: string[];
  property: { name: string };
  contracts?: {
    id: string;
    status?: string;
    start_date: string;
    end_date: string;
    rent_amount: number;
    tenant: { name: string; phone?: string; email?: string };
  }[];
  metadata?: any;
  property_id: string;
}

interface HouseViewModalProps {
  visible: boolean;
  onDismiss: () => void;
  houseId?: string | null;
}

export default function HouseViewModal({
  visible,
  onDismiss,
  houseId,
}: HouseViewModalProps) {
  const router = useRouter();
  const { selectedBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const { can } = useAccessControl();
  const colors = useThemeColors() as any;
  const historyTargets = useHistoryTargets('houses', houseId);

  const housesById = useHousesById(selectedBusiness?.id);
  const propertiesById = usePropertiesById(selectedBusiness?.id);
  const tenantsById = useTenantsById(selectedBusiness?.id);
  const contractsByHouseId = useContractsByHouseId(selectedBusiness?.id);

  const [menuVisible, setMenuVisible] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);

  const { defaultCurrency } = useCurrency(selectedBusiness?.id);

  const house = useMemo((): House | null => {
    if (!houseId) return null;
    const h = housesById.get(houseId as string);
    if (!h) return null;

    const property = h ? propertiesById.get(h.property_id as string) : undefined;
    const houseContracts = (contractsByHouseId.get(h.id as string) || [])
      .filter(c => isActiveContractStatus(c.status))
      .map(c => {
        const tenant = tenantsById.get(c.tenant_id as string);
        return {
          ...c,
          tenant: tenant
            ? { name: tenant.name, phone: tenant.phone, email: tenant.email }
            : { name: 'Unknown' },
        };
      });

    return {
      ...h,
      monthly_rent: Number(h.monthly_rent),
      property: property ? { name: property.name } : { name: 'Unknown' },
      contracts: houseContracts,
    } as House;
  }, [houseId, housesById, propertiesById, contractsByHouseId, tenantsById]);

  const statusItems = useMemo(() => {
    if (!house) return [];
    return buildHouseStatusMenuItems({ house, colors });
  }, [house, colors]);

  const { update } = useCoreMutations();

  const handleUpdateStatus = async (newStatus: string) => {
    if (!house) return;
    const isOccupied = (house.contracts?.length ?? 0) > 0;
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
      await update('houses', house.id, { status: newStatus as any });
      showSnackbar('House status updated successfully', 'success');
    } catch (error: any) {
      showSnackbar(`Failed to update house status: ${error.message}`, 'error');
    }
  };

  const handleDelete = async () => {
    if (!house) return;
    const linkedContracts = contractsByHouseId.get(house.id as string) || [];
    if (linkedContracts.length > 0) {
      showSnackbar('Cannot delete a house with linked contracts', 'error');
      setShowDeleteModal(false);
      return;
    }
    await update('houses', house.id, { deleted: true });
    setShowDeleteModal(false);
    onDismiss();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available':
        return { color: colors.success, bgColor: colors.successContainer };
      case 'occupied':
        return { color: colors.primary, bgColor: colors.primaryContainer };
      case 'maintenance':
        return { color: colors.warning, bgColor: colors.warningContainer };
      case 'closed':
        return { color: colors.error, bgColor: colors.errorContainer };
      default:
        return { color: colors.onSurfaceVariant, bgColor: colors.surfaceVariant };
    }
  };

  const displayStatus = house ? getHouseDisplayStatus(house) : 'available';
  const statusStyle = getStatusColor(displayStatus);

  const canShowMenu =
    can('edit', 'house') || can('delete', 'house') || can('create', 'contract');
  const headerRight =
    house && canShowMenu ? (
      <Menu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        anchor={
          <IconButton
            icon="dots-vertical"
            size={20}
            onPress={() => setMenuVisible(true)}
            style={{ margin: -4 }}
          />
        }
      >
        <AccessGuard action="edit" resource="house" fallback={null}>
          <Menu.Item
            onPress={() => {
              setMenuVisible(false);
              setHouseFormHouseId(house.id);
              setHouseFormPropertyId(house.property_id);
              setHouseFormPropertyName(house.property.name);
              setHouseFormModalVisible(true);
            }}
            title="Edit House"
            leadingIcon="pencil"
          />
        </AccessGuard>
        {(!house.contracts || house.contracts.length === 0) && (
          <AccessGuard action="create" resource="contract" fallback={null}>
            <Menu.Item
              onPress={() => {
                setMenuVisible(false);
                onDismiss();
                router.push({
                  pathname: '/contracts/create',
                  params: {
                    houseId: house.id,
                    propertyId: house.property_id,
                    propertyName: house.property.name,
                    houseNumber: house.house_number,
                  },
                });
              }}
              title="Create Contract"
              leadingIcon="file-document-edit"
            />
          </AccessGuard>
        )}
        <AccessGuard action="edit" resource="house" fallback={null}>
          <Menu.Item
            onPress={() => {
              setMenuVisible(false);
              setStatusModalVisible(true);
            }}
            title="Update Status"
            leadingIcon="list-status"
          />
        </AccessGuard>
        <AccessGuard action="delete" resource="house" fallback={null}>
          <Divider />
          <Menu.Item
            onPress={() => {
              setMenuVisible(false);
              setShowDeleteModal(true);
            }}
            title="Delete House"
            leadingIcon="delete"
            titleStyle={{ color: colors.error }}
          />
        </AccessGuard>
      </Menu>
    ) : null;

  if (!visible) return null;

  return (
    <AccessGuard action="view" resource="house" fallback={null}>
      <Portal>
        <BaseModal
          visible={visible}
          onDismiss={onDismiss}
          title={house?.house_number ?? 'House Details'}
          subtitle={house?.property.name}
          scrollable
          maxHeight="85%"
          headerRight={headerRight}
        >
          {!house ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <View style={styles.content}>
              {/* Status badge */}
              <View style={styles.statusRow}>
                <Chip
                  style={[styles.statusChip, { backgroundColor: statusStyle.bgColor }]}
                  textStyle={{ color: statusStyle.color, fontWeight: '600' }}
                >
                  {properCase(displayStatus)}
                </Chip>
              </View>

              <Divider style={styles.divider} />

              {/* Details */}
              <Text
                variant="titleSmall"
                style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}
              >
                DETAILS
              </Text>
              <View style={styles.detailsGrid}>
                <View style={styles.detailItem}>
                  <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                    Type
                  </Text>
                  <Text variant="bodyMedium" style={styles.value}>
                    {house.type}
                  </Text>
                </View>
                <View style={styles.detailItem}>
                  <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                    Monthly Rent
                  </Text>
                  <Text variant="bodyMedium" style={styles.value}>
                    {defaultCurrency
                      ? formatWithCurrency(house.monthly_rent, defaultCurrency)
                      : `${house.monthly_rent}`}
                  </Text>
                </View>
              </View>

              {/* Amenities */}
              {house.amenities && house.amenities.length > 0 && (
                <>
                  <Divider style={styles.divider} />
                  <Text
                    variant="titleSmall"
                    style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}
                  >
                    AMENITIES
                  </Text>
                  <View style={styles.amenitiesRow}>
                    {house.amenities.map((amenity, i) => (
                      <Chip key={i} compact style={{ marginRight: 6, marginBottom: 6 }}>
                        {snakeCaseToTitleCase(amenity)}
                      </Chip>
                    ))}
                  </View>
                </>
              )}

              <Divider style={styles.divider} />

              {/* Current Tenant */}
              <Text
                variant="titleSmall"
                style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}
              >
                CURRENT TENANT
              </Text>
              {house.contracts && house.contracts.length > 0 ? (
                <View style={styles.tenantSection}>
                  <View style={styles.tenantRow}>
                    <MaterialCommunityIcons
                      name="account"
                      size={16}
                      color={colors.onSurfaceVariant}
                    />
                    <Text variant="bodyMedium" style={styles.tenantText}>
                      {house.contracts[0].tenant.name}
                    </Text>
                  </View>
                  {house.contracts[0].tenant.phone && (
                    <View style={styles.tenantRow}>
                      <MaterialCommunityIcons
                        name="phone"
                        size={16}
                        color={colors.onSurfaceVariant}
                      />
                      <Text variant="bodySmall" style={styles.tenantText}>
                        {house.contracts[0].tenant.phone}
                      </Text>
                    </View>
                  )}
                  {house.contracts[0].tenant.email && (
                    <View style={styles.tenantRow}>
                      <MaterialCommunityIcons
                        name="email"
                        size={16}
                        color={colors.onSurfaceVariant}
                      />
                      <Text variant="bodySmall" style={styles.tenantText}>
                        {house.contracts[0].tenant.email}
                      </Text>
                    </View>
                  )}
                  <Divider style={{ marginVertical: 8 }} />
                  <View style={styles.tenantRow}>
                    <MaterialCommunityIcons
                      name="calendar-range"
                      size={16}
                      color={colors.onSurfaceVariant}
                    />
                    <Text variant="bodySmall" style={styles.tenantText}>
                      {formatDateRange(
                        house.contracts[0].start_date,
                        house.contracts[0].end_date,
                      )}
                    </Text>
                  </View>
                  <View style={styles.tenantRow}>
                    <MaterialCommunityIcons
                      name="cash"
                      size={16}
                      color={colors.onSurfaceVariant}
                    />
                    <Text variant="bodySmall" style={styles.tenantText}>
                      {defaultCurrency
                        ? formatWithCurrency(
                            house.contracts[0].rent_amount,
                            defaultCurrency,
                          )
                        : `${house.contracts[0].rent_amount}`}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.noTenantRow}>
                  <MaterialCommunityIcons
                    name="account-off-outline"
                    size={18}
                    color={colors.onSurfaceVariant}
                  />
                  <Text
                    variant="bodyMedium"
                    style={{
                      color: colors.onSurfaceVariant,
                      marginLeft: 6,
                      fontStyle: 'italic',
                    }}
                  >
                    No active tenant
                  </Text>
                </View>
              )}

              {/* History */}
              <Divider style={styles.divider} />
              <HistoryModal
                entityType="houses"
                entityId={house?.id}
                targets={historyTargets}
                containerStyle={{ marginTop: 0 }}
              />
            </View>
          )}
        </BaseModal>

        {/* Delete confirmation */}
        <BaseModal
          visible={showDeleteModal}
          onDismiss={() => setShowDeleteModal(false)}
          mode="confirm"
          title="Delete House"
          message="Are you sure you want to delete this house? This action cannot be undone."
          confirmText="Delete"
          destructive
          onConfirm={handleDelete}
          zIndex={1100}
        />

        {/* Status update */}
        {house && (
          <StatusUpdateModal
            visible={statusModalVisible}
            onDismiss={() => setStatusModalVisible(false)}
            title="Update House Status"
            subtitle={`House: ${house.house_number}`}
            items={statusItems}
            onSelect={status => {
              handleUpdateStatus(status);
              setStatusModalVisible(false);
            }}
          />
        )}
      </Portal>
    </AccessGuard>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  content: {
    paddingBottom: 16,
  },
  statusRow: {
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  statusChip: {
    alignSelf: 'flex-start',
  },
  divider: {
    marginVertical: 12,
  },
  sectionTitle: {
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  detailItem: {
    flex: 1,
    minWidth: '45%',
    gap: 2,
  },
  value: {
    fontWeight: '600',
  },
  amenitiesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tenantSection: {
    gap: 6,
  },
  tenantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tenantText: {
    flex: 1,
  },
  noTenantRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
