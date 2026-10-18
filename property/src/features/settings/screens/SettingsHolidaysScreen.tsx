import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, SectionList, StyleSheet, View } from 'react-native';
import {
  Avatar,
  Button,
  Checkbox,
  Divider,
  IconButton,
  Menu,
  Portal,
  Surface,
  Text,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import BaseSearch from '@/shared/components/BaseSearch';
import FilterButtons from '@/shared/components/FilterButtons';
import HolidayBreakActionModal from '@/shared/components/HolidayBreakActionModal';
import LoadingCard from '@/shared/components/LoadingCard';
import SectionGroup from '@/shared/components/SectionGroup';
import SPressable from '@/shared/components/SlightPressable';
import {
  useContracts,
  useCoreMutations,
  useHouses,
  useProperties,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { HolidayBreakItem } from '@/shared/types/types';
import { formatDateForDB, formatDateTime } from '@/shared/utils/formatters';
import { addOpacity, parseMetadata, properCase } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';

interface HolidaySection {
  title: string;
  data: HolidayBreakItem[];
}

export default function HolidayBreaks() {
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const rawTenants = useTenants(selectedBusiness?.id);
  const contracts = useContracts(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const properties = useProperties(selectedBusiness?.id);
  const { update: updateContract, updateMany } = useCoreMutations();
  const { showSnackbar } = useSnackbar();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalSearchQuery, setModalSearchQuery] = useState('');
  const [selectedContractIds, setSelectedContractIds] = useState<Set<string>>(new Set());
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [breakModalVisible, setBreakModalVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [editingBreak, setEditingBreak] = useState<any | null>(null);
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(
    new Set(['ongoing', 'upcoming']),
  );
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [modalSelectedPropertyId, setModalSelectedPropertyId] = useState<string | null>(
    null,
  );
  const [showModalSearch, setShowModalSearch] = useState(false);
  const [selectedBreaks, setSelectedBreaks] = useState<Set<string>>(new Set());
  const [showBulkRemoveConfirm, setShowBulkRemoveConfirm] = useState(false);
  const [viewModalVisible, setViewModalVisible] = useState(false);
  const [viewingBreak, setViewingBreak] = useState<HolidayBreakItem | null>(null);

  useEffect(() => {
    if (contracts !== undefined) setLoading(false);
  }, [contracts]);

  const activeContractsList = useMemo(() => {
    return contracts
      .filter(c => isActiveContractStatus(c.status))
      .map(contract => {
        const tenant = rawTenants.find(t => t.id === contract.tenant_id);
        const house = houses.find(h => h.id === contract.house_id);
        const property = house
          ? properties.find(p => p.id === house.property_id)
          : undefined;
        return {
          ...contract,
          tenantName: tenant?.name || 'Unknown',
          houseNumber: house?.house_number || 'N/A',
          propertyName: property?.name || 'Unknown',
          propertyId: property?.id,
        };
      })
      .sort((a, b) => (a.tenantName || '').localeCompare(b.tenantName || ''));
  }, [rawTenants, contracts, houses, properties]);

  const filteredContracts = useMemo(() => {
    let filtered = activeContractsList;

    if (modalSearchQuery) {
      const lowerQuery = modalSearchQuery.toLowerCase();
      filtered = filtered.filter(
        c =>
          c.tenantName?.toLowerCase().includes(lowerQuery) ||
          c.houseNumber?.toLowerCase().includes(lowerQuery),
      );
    }

    if (modalSelectedPropertyId) {
      filtered = filtered.filter(c => c.propertyId === modalSelectedPropertyId);
    }

    return filtered;
  }, [activeContractsList, modalSearchQuery, modalSelectedPropertyId]);

  const getBreakStatus = useCallback((startDate: string, endDate: string) => {
    const today = formatDateForDB(new Date());
    if (today < startDate) return 'upcoming';
    if (today > endDate) return 'past';
    return 'ongoing';
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ongoing':
        return colors.success;
      case 'upcoming':
        return colors.primary;
      case 'past':
        return colors.onSurfaceVariant;
      default:
        return colors.onSurfaceVariant;
    }
  };

  const holidaySections = useMemo(() => {
    const list: HolidayBreakItem[] = [];
    contracts.forEach(c => {
      const metadata = parseMetadata(c.metadata);
      const breaks = metadata.breaks || [];
      if (breaks.length > 0) {
        const tenant = rawTenants.find(t => t.id === c.tenant_id);
        const house = houses.find(h => h.id === c.house_id);
        const property = house
          ? properties.find(p => p.id === house.property_id)
          : undefined;

        breaks.forEach((b: any) => {
          const status = getBreakStatus(b.start_date, b.end_date);
          list.push({
            ...b,
            contractId: c.id,
            tenantName: tenant?.name || 'Unknown',
            propertyName: property?.name || 'Unknown',
            houseNumber: house?.house_number || 'N/A',
            status,
            propertyId: property?.id,
          });
        });
      }
    });

    const filteredList = list.filter(item => {
      if (selectedPropertyId && item.propertyId !== selectedPropertyId) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        return (
          item.tenantName?.toLowerCase().includes(q) ||
          item.houseNumber?.toLowerCase().includes(q) ||
          item.propertyName?.toLowerCase().includes(q) ||
          item.reason?.toLowerCase().includes(q) ||
          item.start_date?.toLowerCase().includes(q) ||
          item.end_date?.toLowerCase().includes(q)
        );
      }
      return true;
    });

    const groups = filteredList.reduce(
      (acc: Record<string, HolidayBreakItem[]>, item) => {
        if (!acc[item.status]) acc[item.status] = [];
        acc[item.status].push(item);
        return acc;
      },
      {},
    );

    const order = ['ongoing', 'upcoming', 'past'];
    return order
      .map(status => ({
        title: status,
        data: (groups[status] || []).sort(
          (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
        ),
      }))
      .filter(section => section.data.length > 0);
  }, [
    contracts,
    rawTenants,
    houses,
    properties,
    selectedPropertyId,
    searchQuery,
    getBreakStatus,
  ]);

  const handleToggleStatus = (status: string) => {
    setExpandedStatuses(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const allVisibleBreaks = useMemo(() => {
    return holidaySections.flatMap(section => section.data);
  }, [holidaySections]);

  const handleSelectAllBreaks = () => {
    const visibleKeys = allVisibleBreaks.map(b => `${b.contractId}:${b.id}`);
    const allSelected =
      visibleKeys.length > 0 && visibleKeys.every(key => selectedBreaks.has(key));

    if (allSelected) {
      setSelectedBreaks(prev => {
        const next = new Set(prev);
        for (const key of visibleKeys) next.delete(key);
        return next;
      });
    } else {
      setSelectedBreaks(prev => {
        const next = new Set(prev);
        for (const key of visibleKeys) next.add(key);
        return next;
      });
    }
  };

  const handleToggleContract = (id: string) => {
    setSelectedContractIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    const filteredIds = filteredContracts.map(c => c.id);
    const allFilteredSelected =
      filteredIds.length > 0 && filteredIds.every(id => selectedContractIds.has(id));

    if (allFilteredSelected) {
      setSelectedContractIds(prev => {
        const next = new Set(prev);
        for (const id of filteredIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedContractIds(prev => {
        const next = new Set(prev);
        for (const id of filteredIds) next.add(id);
        return next;
      });
    }
  };

  const handleRemoveBreak = (contractId: string, breakId: string) => {
    setRemoveBreakParams({ contractId, breakId });
    setShowRemoveConfirm(true);
  };

  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [removeBreakParams, setRemoveBreakParams] = useState<any>(null);

  const handleEditBreak = (b: any) => {
    setEditingBreak(b);
    setMenuVisible(null);
    setBreakModalVisible(true);
  };

  const handleViewBreak = (b: HolidayBreakItem) => {
    setViewingBreak(b);
    setMenuVisible(null);
    setViewModalVisible(true);
  };

  const handleBulkRemove = async () => {
    if (selectedBreaks.size === 0) return;

    setSaving(true);
    try {
      const itemsToRemove = Array.from(selectedBreaks).map(key => {
        const [contractId, breakId] = key.split(':');
        return { contractId, breakId };
      });

      const grouped = itemsToRemove.reduce(
        (acc, item) => {
          if (!acc[item.contractId]) acc[item.contractId] = [];
          acc[item.contractId].push(item.breakId);
          return acc;
        },
        {} as Record<string, string[]>,
      );

      const updates = [];
      for (const contractId in grouped) {
        const contract = contracts.find(c => c.id === contractId);
        if (contract) {
          const metadata = parseMetadata(contract.metadata);
          const breaks = metadata.breaks || [];
          const breakIdsToRemove = grouped[contractId];

          updates.push({
            id: contractId,
            payload: {
              metadata: {
                ...metadata,
                breaks: breaks.filter((b: any) => !breakIdsToRemove.includes(b.id)),
              },
            },
          });
        }
      }

      if (updates.length > 0) {
        await updateMany('contracts', updates);
      }

      showSnackbar(
        `Successfully removed ${selectedBreaks.size} holiday breaks`,
        'success',
      );
      setSelectedBreaks(new Set());
    } catch (error) {
      console.error('Error removing holiday breaks:', error);
      showSnackbar('Failed to remove some holiday breaks', 'error');
    } finally {
      setSaving(false);
      setShowBulkRemoveConfirm(false);
    }
  };

  const renderBreakItem = ({ item }: { item: HolidayBreakItem }) => {
    const statusColor = getStatusColor(item.status);
    const itemKey = `${item.contractId}:${item.id}`;
    const isSelected = selectedBreaks.has(itemKey);

    return (
      <Surface
        style={[
          styles.breakCard,
          {
            borderColor: isSelected ? colors.primary : statusColor,
            borderLeftWidth: 4,
            backgroundColor: isSelected
              ? addOpacity(colors.primaryContainer, 0.15)
              : colors.surface,
          },
        ]}
      >
        <SPressable
          onPress={() => {
            setSelectedBreaks(prev => {
              const next = new Set(prev);
              if (next.has(itemKey)) next.delete(itemKey);
              else next.add(itemKey);
              return next;
            });
          }}
        >
          <View
            style={[styles.cardHeader, { paddingVertical: 12, paddingHorizontal: 12 }]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                {item.tenantName}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <IconButton
                  icon="office-building"
                  size={14}
                  style={{ margin: 0, padding: 0, width: 20, height: 20 }}
                />
                <Text
                  variant="bodyMedium"
                  style={{ color: colors.onSurfaceVariant, marginLeft: 4 }}
                >
                  {item.propertyName} • Room {item.houseNumber}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: 6,
                }}
              >
                <IconButton
                  icon="calendar-range"
                  size={16}
                  style={{ margin: 0, padding: 0, width: 24, height: 24 }}
                  iconColor={statusColor}
                />
                <Text
                  variant="bodyMedium"
                  style={{ color: statusColor, fontWeight: 'bold', marginLeft: 4 }}
                >
                  {new Date(item.start_date).toLocaleDateString()} -{' '}
                  {new Date(item.end_date).toLocaleDateString()}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: 4,
                }}
              >
                <IconButton
                  icon="information-outline"
                  size={14}
                  style={{ margin: 0, padding: 0, width: 20, height: 20 }}
                />
                <Text
                  variant="bodySmall"
                  style={{
                    fontStyle: 'italic',
                    marginLeft: 4,
                    color: colors.onSurfaceVariant,
                  }}
                  numberOfLines={1}
                >
                  Reason: {item.reason}
                  {item.is_partial ? ' (Partial Waiver)' : ''}
                </Text>
              </View>
              {(item.updated_at || item.created_at) && (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginTop: 2,
                  }}
                >
                  <IconButton
                    icon={item.updated_at ? 'update' : 'calendar-plus'}
                    size={14}
                    style={{ margin: 0, padding: 0, width: 20, height: 20 }}
                  />
                  <Text
                    variant="labelSmall"
                    style={{
                      fontStyle: 'italic',
                      marginLeft: 4,
                      color: colors.onSurfaceDisabled,
                    }}
                  >
                    Last Updated: {formatDateTime(item.updated_at || item.created_at)}
                  </Text>
                </View>
              )}
            </View>

            <View style={{ alignItems: 'center' }}>
              <Menu
                visible={menuVisible === item.id}
                onDismiss={() => setMenuVisible(null)}
                anchor={
                  <IconButton
                    icon="dots-vertical"
                    size={24}
                    onPress={() => setMenuVisible(item.id)}
                    style={{ margin: 0 }}
                  />
                }
              >
                <Menu.Item
                  onPress={() => handleViewBreak(item)}
                  title="View Details"
                  leadingIcon="eye"
                />
                <Menu.Item
                  onPress={() => handleEditBreak(item)}
                  title="Edit Break"
                  leadingIcon="pencil"
                />
                <Menu.Item
                  onPress={() => {
                    setMenuVisible(null);
                    handleRemoveBreak(item.contractId, item.id);
                  }}
                  title="Remove Break"
                  leadingIcon="delete"
                  titleStyle={{ color: colors.error }}
                />
              </Menu>
              {isSelected && (
                <IconButton
                  icon="check-circle"
                  iconColor={colors.primary}
                  size={20}
                  style={{ margin: 0, marginTop: 8 }}
                />
              )}
            </View>
          </View>
        </SPressable>
      </Surface>
    );
  };

  const renderSectionHeader = ({ section }: { section: HolidaySection }) => (
    <SectionGroup
      title={`${properCase(section.title)} Breaks`}
      subtitle={`Total: ${section.data.length} ${section.data.length === 1 ? 'record' : 'records'}`}
      isExpanded={expandedStatuses.has(section.title)}
      onToggle={() => handleToggleStatus(section.title)}
    />
  );

  if (loading) {
    return <LoadingCard iconName="calendar-clock" text="Loading holiday breaks..." />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={{ flex: 1 }}>
        <View style={[styles.headerRow, { backgroundColor: colors.surface }]}>
          <View style={{ flex: 1 }}>
            <Text variant="headlineSmall" style={{ fontWeight: 'bold' }}>
              Holiday Waivers
            </Text>
            {selectedBreaks.size > 0 ? (
              <Text
                variant="bodySmall"
                style={{ color: colors.error, fontWeight: 'bold' }}
              >
                {selectedBreaks.size} selected for deletion
              </Text>
            ) : (
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                Manage tenants&apos; holiday waivers
              </Text>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {selectedBreaks.size > 0 ? (
              <Button
                mode="contained"
                icon="delete"
                buttonColor={colors.error}
                textColor={colors.onError}
                onPress={() => setShowBulkRemoveConfirm(true)}
              >
                Delete
              </Button>
            ) : (
              <Button
                mode="contained"
                icon="plus"
                onPress={() => {
                  setEditingBreak(null);
                  setBreakModalVisible(true);
                }}
              >
                Create
              </Button>
            )}
          </View>
        </View>

        <BaseSearch
          placeholder="Search holiday breaks, tenants, houses..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          onClear={() => setSearchQuery('')}
        />

        <FilterButtons
          options={[
            { label: 'All Properties', value: null },
            ...properties.map(p => ({ label: p.name || 'Unknown', value: p.id })),
          ]}
          selectedValue={selectedPropertyId}
          onValueChange={setSelectedPropertyId}
          selectButton={
            allVisibleBreaks.length > 0
              ? {
                  label: allVisibleBreaks.every(b =>
                    selectedBreaks.has(`${b.contractId}:${b.id}`),
                  )
                    ? 'Deselect All'
                    : 'Select All',
                  onPress: handleSelectAllBreaks,
                }
              : undefined
          }
        />

        <SectionList
          sections={holidaySections}
          keyExtractor={item => item.id}
          renderItem={({ item, section }) =>
            expandedStatuses.has(section.title) ? renderBreakItem({ item }) : null
          }
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={true}
          extraData={{
            expandedStatuses,
            selectedBreaks,
            menuVisible,
            holidaySections,
          }}
          ListEmptyComponent={
            <View style={{ padding: 40, alignItems: 'center' }}>
              <Avatar.Icon size={48} icon="calendar-clock" />
              <Text variant="bodyLarge" style={{ opacity: 0.6, marginTop: 10 }}>
                {searchQuery.trim()
                  ? `No holiday breaks match "${searchQuery.trim()}"`
                  : 'No holiday breaks recorded'}
              </Text>
            </View>
          }
        />
      </View>

      <Portal>
        <HolidayBreakActionModal
          visible={breakModalVisible}
          onDismiss={() => {
            setBreakModalVisible(false);
            setEditingBreak(null);
          }}
          editingBreak={editingBreak}
          targetContractIds={Array.from(selectedContractIds)}
          selectedContractsCount={selectedContractIds.size}
          onSelectContracts={() => setShowSelectionModal(true)}
          onSuccess={() => {
            setSelectedContractIds(new Set());
          }}
        />

        <BaseModal
          visible={showSelectionModal}
          onDismiss={() => setShowSelectionModal(false)}
          title="Select Contracts"
          subtitle="Choose contracts to assign holiday break"
          maxHeight="85%"
          headerRight={
            <IconButton
              icon="magnify"
              onPress={() => setShowModalSearch(!showModalSearch)}
              iconColor={showModalSearch ? colors.primary : colors.onSurfaceVariant}
              style={{ marginRight: 0 }}
            />
          }
          actions={[
            {
              label: 'Done',
              onPress: () => setShowSelectionModal(false),
              mode: 'contained',
            },
          ]}
        >
          {showModalSearch && (
            <BaseSearch
              placeholder="Search contracts/tenants..."
              value={modalSearchQuery}
              onChangeText={setModalSearchQuery}
              onClear={() => setModalSearchQuery('')}
              containerStyle={{ marginBottom: 0 }}
            />
          )}

          <FilterButtons
            options={[
              { label: 'All', value: null },
              ...properties.map(p => ({ label: p.name || 'Unknown', value: p.id })),
            ]}
            selectedValue={modalSelectedPropertyId}
            onValueChange={setModalSelectedPropertyId}
            selectButton={
              filteredContracts.length > 0
                ? {
                    label: filteredContracts.every(c => selectedContractIds.has(c.id))
                      ? 'Deselect All'
                      : 'Select All',
                    onPress: handleSelectAll,
                  }
                : undefined
            }
          />

          <ScrollView>
            {filteredContracts.map((contract, index) => (
              <React.Fragment key={contract.id}>
                <SPressable
                  style={styles.tenantItem}
                  onPress={() => handleToggleContract(contract.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyLarge">{contract.tenantName}</Text>
                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                      {contract.houseNumber} - {contract.propertyName} ({contract.status})
                    </Text>
                  </View>
                  <Checkbox.Android
                    status={
                      selectedContractIds.has(contract.id) ? 'checked' : 'unchecked'
                    }
                  />
                </SPressable>
                {index < filteredContracts.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </ScrollView>
        </BaseModal>

        <BaseModal
          mode="confirm"
          visible={showRemoveConfirm}
          onDismiss={() => {
            setShowRemoveConfirm(false);
            setRemoveBreakParams(null);
          }}
          onConfirm={async () => {
            if (!removeBreakParams) return;
            const { contractId, breakId } = removeBreakParams;
            try {
              const contract = contracts.find(c => c.id === contractId);
              if (contract) {
                const metadata = parseMetadata(contract.metadata);
                const breaks = metadata.breaks || [];
                if (updateContract) {
                  await updateContract('contracts', contractId, {
                    metadata: {
                      ...metadata,
                      breaks: breaks.filter((b: any) => b.id !== breakId),
                    },
                  });
                }
                showSnackbar('Holiday break removed successfully', 'success');
              }
            } catch (error) {
              console.error('Error removing holiday break:', error);
              showSnackbar('Failed to remove holiday break', 'error');
            } finally {
              setShowRemoveConfirm(false);
              setRemoveBreakParams(null);
            }
          }}
          title="Remove Break"
          message="Are you sure you want to remove this holiday break?"
          confirmText="Remove"
          destructive={true}
        />

        <BaseModal
          mode="confirm"
          visible={showBulkRemoveConfirm}
          onDismiss={() => setShowBulkRemoveConfirm(false)}
          onConfirm={handleBulkRemove}
          title="Bulk Remove Breaks"
          message={`Are you sure you want to remove ${selectedBreaks.size} selected holiday breaks? This action cannot be undone.`}
          confirmText="Remove All"
          destructive={true}
          loading={saving}
        />

        <BaseModal
          visible={viewModalVisible}
          onDismiss={() => setViewModalVisible(false)}
          title="Holiday Waiver"
          subtitle="Review waiver details and status"
          actions={[
            {
              label: 'Close',
              onPress: () => setViewModalVisible(false),
              mode: 'contained',
              style: { borderRadius: 8 },
            },
          ]}
        >
          {viewingBreak && (
            <View style={{ gap: 16, paddingVertical: 8 }}>
              {/* Header Profile Section */}
              <View style={{ alignItems: 'center', marginBottom: 8 }}>
                <Text
                  variant="headlineSmall"
                  style={{ marginTop: 4, fontWeight: 'bold', textAlign: 'center' }}
                >
                  {viewingBreak.tenantName}
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    marginTop: 4,
                  }}
                >
                  <IconButton
                    icon="office-building"
                    size={16}
                    style={{ margin: 0, padding: 0, width: 20, height: 20 }}
                  />
                  <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                    {viewingBreak.propertyName} • Room {viewingBreak.houseNumber}
                  </Text>
                </View>
              </View>

              <Divider style={{ opacity: 0.5 }} />

              {/* Duration Card */}
              <Surface
                style={{
                  padding: 16,
                  borderRadius: 16,
                  backgroundColor: colors.surface,
                  elevation: 1,
                  borderWidth: 1,
                  borderColor: colors.outlineVariant,
                }}
              >
                <Text
                  variant="labelMedium"
                  style={{
                    color: colors.onSurfaceVariant,
                    marginBottom: 12,
                    textTransform: 'uppercase',
                    letterSpacing: 1,
                    fontWeight: 'bold',
                    textAlign: 'center',
                  }}
                >
                  Waiver Period
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                      Starts
                    </Text>
                    <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                      {new Date(viewingBreak.start_date).toLocaleDateString()}
                    </Text>
                  </View>
                  <Avatar.Icon
                    size={32}
                    icon="arrow-right-thin"
                    style={{ backgroundColor: 'transparent' }}
                    color={colors.primary}
                  />
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                      Ends
                    </Text>
                    <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                      {new Date(viewingBreak.end_date).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
              </Surface>

              {/* Info Rows */}
              <View style={{ gap: 16 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 4,
                  }}
                >
                  <Avatar.Icon
                    size={40}
                    icon="information-outline"
                    style={{ backgroundColor: colors.surfaceVariant }}
                    color={colors.onSurfaceVariant}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                      Reason for Break
                    </Text>
                    <Text variant="bodyLarge">{viewingBreak.reason}</Text>
                  </View>
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 4,
                  }}
                >
                  <Avatar.Icon
                    size={40}
                    icon={viewingBreak.is_partial ? 'star-half-full' : 'star'}
                    style={{ backgroundColor: colors.primaryContainer }}
                    color={colors.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                      Waiver Policy
                    </Text>
                    <Text
                      variant="bodyLarge"
                      style={{ fontWeight: '700', color: colors.primary }}
                    >
                      {viewingBreak.is_partial ? 'Partial Waiver' : 'Full Waiver'}
                    </Text>
                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                      {viewingBreak.is_partial
                        ? 'Rent is payable for occupied days in the month'
                        : 'No rent is charged for the entire specified period'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          )}
        </BaseModal>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  breakCard: {
    borderRadius: 0,
    overflow: 'hidden',
    position: 'relative',
    elevation: 0,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  tenantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
});
