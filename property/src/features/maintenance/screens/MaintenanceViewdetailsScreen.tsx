const setExpenseModalVisible = (value: UIState['expenseModalVisible']) =>
  setUIField('expenseModalVisible', value);
const setExpenseModalInitialData = (value: UIState['expenseModalInitialData']) =>
  setUIField('expenseModalInitialData', value);

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Dimensions, Image, ScrollView, StyleSheet, View } from 'react-native';
import { Chip, Divider, IconButton, Menu, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import HistoryModal from '@/shared/components/HistoryModal';
import LoadingCard from '@/shared/components/LoadingCard';
import SPressable from '@/shared/components/SlightPressable';
import StatusUpdateModal from '@/shared/components/StatusUpdateModal';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import {
  useContracts,
  useCoreMutations,
  useHouses,
  useMaintenanceRequests,
  useProfiles,
  useProperties,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { sendNotification } from '@/shared/services/notifications';
import { addOpacity, snakeCaseToTitleCase } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import { setUIField, type UIState } from '@/stores/uiStore';

export default function ViewMaintenanceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const colors = useThemeColors();
  const screenWidth = Dimensions.get('window').width;
  const { selectedBusiness } = useBusiness();
  const { userRoles, tenantId, loading: accessLoading, isOwner } = useAccessControl();
  const isStaff = userRoles.includes('staff');
  const isTenant = userRoles.includes('tenant') && !isStaff;

  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [menuVisible, setMenuVisible] = useState(false);

  const { update } = useCoreMutations();
  const maintenanceRequests = useMaintenanceRequests(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const properties = useProperties(selectedBusiness?.id);
  const contracts = useContracts(selectedBusiness?.id);
  const profiles = useProfiles();

  const request = useMemo(() => {
    if (!maintenanceRequests || accessLoading) return null;
    const req = maintenanceRequests.find(r => r.id === id);
    if (!req) return null;

    // Visibility check for tenants
    if (isTenant) {
      if (!tenantId) return null; // Security: Deny if no tenant ID

      const tenantContract = contracts.find(
        c => c.tenant_id === tenantId && isActiveContractStatus(c.status),
      );
      const tenantHouseId = tenantContract?.house_id;
      const tenantPropertyId = houses.find(h => h.id === tenantHouseId)?.property_id;

      let isVisible = false;
      if (req.tenant_id === tenantId) isVisible = true;
      else if (tenantPropertyId && req.property_id === tenantPropertyId) {
        const isPropertyWide =
          !req.house_id && (!req.affected_houses || req.affected_houses.length === 0);
        if (isPropertyWide) isVisible = true;
      }

      if (!isVisible) return null;
    }

    const house = houses.find(h => h.id === req.house_id);
    const property = properties.find(p => p.id === req.property_id);
    const reporter = profiles.find(p => p.user_id === req.user_id);

    // Get affected houses for multi-house maintenance
    const affectedHousesList = req.affected_houses
      ? req.affected_houses
          .map((houseId: string) => houses.find(h => h.id === houseId))
          .filter((h: any) => h !== undefined)
      : [];

    return {
      ...req,
      houseNumber: house?.house_number || 'N/A',
      propertyName: property?.name || 'N/A',
      propertyLocation: property?.location || '',
      reporterName: reporter?.name || 'System',
      affectedHousesData: affectedHousesList,
    };
  }, [
    maintenanceRequests,
    houses,
    properties,
    id,
    accessLoading,
    isTenant,
    tenantId,
    contracts,
    profiles,
  ]);

  const statusItems = useMemo(
    () => [
      {
        id: 'pending',
        title: 'Pending',
        color: (colors as any).warning,
        disabled: request?.status === 'pending',
      },
      {
        id: 'in_progress',
        title: 'In Progress',
        color: (colors as any).info,
        disabled: request?.status === 'in_progress',
      },
      {
        id: 'completed',
        title: 'Completed',
        color: (colors as any).success,
        disabled: request?.status === 'completed',
      },
      {
        id: 'cancelled',
        title: 'Cancelled',
        color: colors.error,
        disabled: request?.status === 'cancelled',
      },
    ],
    [request, colors],
  );

  if (!request) {
    if (isTenant && !tenantId) {
      return (
        <EmptyState
          icon="account-lock-outline"
          title="Permission Denied"
          description="You do not have permission to view maintenance requests. Please contact your administrator to be assigned as a tenant."
          style={{ backgroundColor: colors.background }}
        />
      );
    }
    return <LoadingCard iconName="alert-circle" text="Request not found" />;
  }

  const handleUpdateStatus = async (newStatus: string) => {
    if (statusLoading) return;
    setStatusLoading(true);
    try {
      await update('maintenance_requests', request.id, {
        status: newStatus as any,
      });

      sendNotification(
        'Maintenance Request Updated',
        `The status of your maintenance request is now ${snakeCaseToTitleCase(newStatus)}.`,
        { type: 'maintenance', maintenanceId: request.id, status: newStatus },
      );
      setStatusModalVisible(false);
    } catch (_error) {
      showSnackbar('Failed to update status', 'error');
    } finally {
      setStatusLoading(false);
    }
  };

  if (accessLoading) {
    return (
      <LoadingCard iconName="view-dashboard-variant" text="Checking permissions..." />
    );
  }

  const handleConvertToExpense = () => {
    // Build a detailed description for the expense remarks
    const scope = request.property_id
      ? 'Property'
      : request.affected_houses?.length
        ? 'Multi-House'
        : 'Single House';

    let target = request.propertyName !== 'N/A' ? request.propertyName : '';
    if (request.houseNumber !== 'N/A') {
      target += target
        ? ` - House ${request.houseNumber}`
        : `House ${request.houseNumber}`;
    }
    if (request.affected_houses?.length) {
      target += ` (${request.affected_houses.length} houses)`;
    }

    const detailedRemarks = [
      `Maintenance: ${request.description || 'N/A'}`,
      request.description ? `Details: ${request.description}` : null,
      `Scope: ${scope}`,
      target ? `Target: ${target}` : null,
      `Reference: ${request.id}`,
    ]
      .filter(Boolean)
      .join('\n');

    // Open expense modal with pre-filled data
    setExpenseModalInitialData({
      category: 'Maintenance',
      description: detailedRemarks,
      maintenanceId: request.id,
      houseId: request.house_id || undefined,
      propertyId: request.property_id || undefined,
    });
    setExpenseModalVisible(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return (colors as any).success || colors.primary;
      case 'in_progress':
        return (colors as any).info || colors.secondary;
      case 'pending':
        return (colors as any).warning || colors.tertiary;
      case 'cancelled':
        return colors.error;
      default:
        return colors.onSurfaceVariant;
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.section, { backgroundColor: colors.surface, marginTop: 16 }]}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text variant="titleMedium" style={{ flex: 1, marginRight: 8 }}>
            {request.description || 'Request Details'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Chip
              style={{
                backgroundColor: addOpacity(getStatusColor(request.status), 0.15),
              }}
              textStyle={{ color: colors.onSurface }}
            >
              {snakeCaseToTitleCase(request.status)}
            </Chip>
            {isStaff && (
              <Menu
                visible={menuVisible}
                onDismiss={() => setMenuVisible(false)}
                anchor={
                  <IconButton icon="dots-vertical" onPress={() => setMenuVisible(true)} />
                }
              >
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(false);
                    setStatusModalVisible(true);
                  }}
                  title="Change Status"
                  leadingIcon="list-status"
                />
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(false);
                    router.push({
                      pathname: '/maintenance/edit/[id]',
                      params: { id },
                    });
                  }}
                  title="Edit Request"
                  leadingIcon="pencil"
                />
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(false);
                    handleConvertToExpense();
                  }}
                  title="Log Expense"
                  leadingIcon="currency-usd"
                />
              </Menu>
            )}
          </View>
        </View>
        <Divider style={styles.divider} />

        {/* Property-wide maintenance */}
        {request.property_id &&
          !request.house_id &&
          (!request.affected_houses || request.affected_houses.length === 0) && (
            <>
              <View style={styles.row}>
                <Text variant="bodyMedium" style={styles.label}>
                  Scope:
                </Text>
                <Chip icon="office-building">Property-Wide</Chip>
              </View>
              <View style={styles.row}>
                <Text variant="bodyMedium" style={styles.label}>
                  Property:
                </Text>
                <Text variant="bodyMedium">{request.propertyName}</Text>
              </View>
              {request.propertyLocation && (
                <View style={styles.row}>
                  <Text variant="bodyMedium" style={styles.label}>
                    Location:
                  </Text>
                  <Text variant="bodyMedium">{request.propertyLocation}</Text>
                </View>
              )}
            </>
          )}

        {/* Multi-house maintenance */}
        {request.affected_houses && request.affected_houses.length > 0 && (
          <>
            <View style={styles.row}>
              <Text variant="bodyMedium" style={styles.label}>
                Scope:
              </Text>
              <Text style={{ color: colors.onSurfaceVariant }}>Multi-House</Text>
            </View>
            <View style={styles.row}>
              <Text variant="bodyMedium" style={styles.label}>
                Affected Houses:
              </Text>
              <Text variant="bodyMedium">{request.affected_houses.length} houses</Text>
            </View>
            <View style={{ marginLeft: 16, marginTop: 8, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {request.affectedHousesData?.map((house: any) => (
                  <Chip
                    key={house.id}
                    style={{ backgroundColor: colors.surfaceVariant }}
                    textStyle={{ color: colors.onSurfaceVariant }}
                  >
                    House {house.house_number}
                  </Chip>
                ))}
              </View>
            </View>
          </>
        )}

        {/* Single house maintenance */}
        {request.house_id &&
          (!request.affected_houses || request.affected_houses.length === 0) && (
            <>
              <View style={styles.row}>
                <Text variant="bodyMedium" style={styles.label}>
                  Scope:
                </Text>
                <Text style={{ color: colors.onSurfaceVariant }}>Single House</Text>
              </View>
              <View style={styles.row}>
                <Text variant="bodyMedium" style={styles.label}>
                  House:
                </Text>
                <Text variant="bodyMedium">{request.houseNumber}</Text>
              </View>
              {request.propertyName !== 'N/A' && (
                <View style={styles.row}>
                  <Text variant="bodyMedium" style={styles.label}>
                    Property:
                  </Text>
                  <Text variant="bodyMedium">{request.propertyName}</Text>
                </View>
              )}
            </>
          )}

        <View style={styles.row}>
          <Text variant="bodyMedium" style={styles.label}>
            Priority:
          </Text>
          <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
            {snakeCaseToTitleCase(request.priority)}
          </Text>
        </View>
        <View style={styles.row}>
          <Text variant="bodyMedium" style={styles.label}>
            Event Date:
          </Text>
          <Text variant="bodyMedium">
            {request.event_date
              ? new Date(request.event_date).toLocaleString()
              : new Date().toLocaleDateString()}
          </Text>
        </View>
        <View style={styles.row}>
          <Text variant="bodyMedium" style={styles.label}>
            Reported By:
          </Text>
          <Text variant="bodyMedium" style={{ fontWeight: '600' }}>
            {request.reporterName}
          </Text>
        </View>
        <View style={{ marginVertical: 16 }}>
          <Text variant="titleMedium">Description</Text>
          <Divider style={styles.divider} />
          <Text variant="bodyMedium" style={styles.description}>
            {request.description || 'No description provided.'}
          </Text>
        </View>
      </View>

      {request.images && request.images.length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <Text variant="titleMedium">Images</Text>
          <Divider style={styles.divider} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.imageGallery}
          >
            {request.images.map((uri: string, index: number) => (
              <SPressable
                key={index}
                onPress={() => {
                  setSelectedImageIndex(index);
                  setImageViewerVisible(true);
                }}
              >
                <Image source={{ uri }} style={styles.image} resizeMode="cover" />
              </SPressable>
            ))}
          </ScrollView>
        </View>
      )}

      {isOwner && (
        <HistoryModal
          entityType="maintenance_requests"
          entityId={request?.id}
          containerStyle={{ marginHorizontal: 16, marginBottom: 32 }}
        />
      )}

      <StatusUpdateModal
        visible={statusModalVisible}
        onDismiss={() => setStatusModalVisible(false)}
        title="Update Maintenance Status"
        subtitle={
          request ? `Request: ${request.description?.substring(0, 30)}...` : undefined
        }
        items={statusItems}
        onSelect={status => {
          handleUpdateStatus(status);
        }}
      />

      {/* Full-Screen Image Viewer */}
      <BaseModal
        visible={imageViewerVisible}
        onDismiss={() => setImageViewerVisible(false)}
        title={`Image Preview (${selectedImageIndex + 1}/${request.images?.length || 0})`}
        subtitle="Manage your properties"
        edgeToEdge
        maxHeight="100%"
        rounded={false}
      >
        <View style={{ backgroundColor: colors.scrim || '#000', height: '100%' }}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={event => {
              const index = Math.round(
                event.nativeEvent.contentOffset.x /
                  event.nativeEvent.layoutMeasurement.width,
              );
              setSelectedImageIndex(index);
            }}
            contentOffset={{ x: selectedImageIndex * screenWidth, y: 0 }}
          >
            {request.images?.map((uri: string, index: number) => (
              <View
                key={index}
                style={[styles.fullImageContainer, { width: screenWidth }]}
              >
                <Image source={{ uri }} style={styles.fullImage} resizeMode="contain" />
              </View>
            ))}
          </ScrollView>
        </View>
      </BaseModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    margin: 16,
    marginTop: 0,
    padding: 16,
    borderRadius: 12,
    elevation: 1,
  },
  divider: {
    marginVertical: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontWeight: 'bold',
    opacity: 0.7,
  },
  description: {
    lineHeight: 22,
  },
  imageGallery: {
    flexDirection: 'row',
    marginTop: 8,
  },
  image: {
    width: 150,
    height: 150,
    borderRadius: 8,
    marginRight: 12,
  },
  fullImageContainer: {
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
});
