import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Chip, IconButton, Menu, Surface, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import SwapHouseModal from '@/features/properties/components/SwapHouseModal';
import TransferHouseModal from '@/features/properties/components/TransferHouseModal';
import { StaffOrAdmin } from '@/shared/access';
import HistoryModal from '@/shared/components/HistoryModal';
import LoadingCard from '@/shared/components/LoadingCard';
import SPressable from '@/shared/components/SlightPressable';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useHistoryTargets } from '@/shared/hooks/useHistoryTargets';
import {
  useContractsById,
  useHousesById,
  usePropertiesById,
  useSettings,
  useStoreRefresh,
  useTenantContracts,
  useTenantReceipts,
  useTenantsById,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type {
  NextOfKin,
  Contract as StoreContract,
  House as StoreHouse,
  Receipt as StoreReceipt,
  Tenant as StoreTenant,
} from '@/shared/types/types';
import {
  type Currency,
  formatDate,
  formatDateForDB,
  formatWithCurrency,
} from '@/shared/utils/formatters';
import { addOpacity, getPrimaryNextOfKin, properCase } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import { generateUserData } from '@/templates/basicDataTemplate';

interface Tenant extends Omit<StoreTenant, 'next_of_kin' | 'metadata'> {
  next_of_kin?: NextOfKin[];
  metadata?: any;
}

interface Property {
  name: string;
}

interface House extends Partial<StoreHouse> {
  properties?: Property;
}

interface Contract extends StoreContract {
  houses?: House;
}

interface Receipt extends StoreReceipt {
  tenantName?: string;
  tenantEmail?: string;
  tenantPhone?: string;
  propertyName?: string;
  roomNumber?: string;
}

interface StatusColor {
  color: string;
  opacity: number;
}

interface ContractStatus extends StatusColor {
  status: 'expired' | 'expiring' | 'active';
}

export default function ViewTenantScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isOwner, can } = useAccessControl();
  const { showSnackbar } = useSnackbar();
  const colors = useThemeColors() as any;
  const [tenantMenuVisible, setTenantMenuVisible] = useState(false);
  const [contractMenuVisible, setContractMenuVisible] = useState<string | null>(null);
  const [transferContractId, setTransferContractId] = useState<string | null>(null);
  const [swapContractId, setSwapContractId] = useState<string | null>(null);

  const { selectedBusiness } = useBusiness();
  const historyTargets = useHistoryTargets('tenants', id);
  const tenantsById = useTenantsById(selectedBusiness?.id);
  const housesById = useHousesById(selectedBusiness?.id);
  const propertiesById = usePropertiesById(selectedBusiness?.id);
  const contractsById = useContractsById(selectedBusiness?.id);
  const tenantContracts = useTenantContracts(selectedBusiness?.id, id);
  const tenantReceipts = useTenantReceipts(selectedBusiness?.id, id);
  const allSettings = useSettings(selectedBusiness?.id);
  const { refreshing, onRefresh } = useStoreRefresh();

  const defaultCurrency = useMemo(() => {
    const currencySetting = allSettings.find(s => s.setting_key === 'currency_settings');
    if (currencySetting && Array.isArray(currencySetting.setting_value)) {
      const currencies = currencySetting.setting_value as any[];
      return (currencies.find(c => c.default) || currencies[0]) as Currency | null;
    }
    return null;
  }, [allSettings]);

  const tenant = useMemo(() => {
    const t = tenantsById.get(id as string);
    return (t as unknown as Tenant) || null;
  }, [id, tenantsById]);

  const contracts = useMemo(() => {
    if (!tenant) return [];
    return tenantContracts.map(c => {
      const house = housesById.get(c.house_id as string);
      const property = house?.property_id
        ? propertiesById.get(house.property_id as string)
        : undefined;
      return {
        ...c,
        houses: house
          ? {
              ...house,
              properties: property ? { name: property.name } : undefined,
            }
          : undefined,
      };
    });
  }, [tenant, tenantContracts, propertiesById, housesById]);

  const receipts = useMemo(() => {
    if (!tenant) return [];
    return tenantReceipts.map(r => {
      const contractId = r.contract_id;
      const contract = contractId ? contractsById.get(contractId as string) : undefined;

      let propertyName = 'N/A';
      let roomNumber = 'N/A';

      if (contract) {
        const house = housesById.get(contract.house_id as string);
        if (house) {
          roomNumber = house.house_number || 'N/A';
          const property = propertiesById.get(house.property_id as string);
          if (property) propertyName = property.name || 'N/A';
        }
      }

      return {
        ...r,
        tenantName: tenant?.name || 'N/A',
        tenantEmail: tenant?.email || 'N/A',
        tenantPhone: tenant?.phone || 'N/A',
        propertyName,
        roomNumber,
      };
    });
  }, [tenant, tenantReceipts, housesById, propertiesById, contractsById]);

  const loading = !id || (!tenant && !selectedBusiness);

  // ... rest of component
  const handleSharePersonalData = async () => {
    if (!selectedBusiness || !tenant) {
      showSnackbar('Business or tenant not found', 'error');
      return;
    }
    try {
      const primaryKin = getPrimaryNextOfKin(tenant.next_of_kin || []);
      const userData = {
        fullName: tenant.name,
        email: tenant.email || undefined,
        phone: tenant.phone || undefined,
        gender: tenant.gender || undefined,
        marital_status: tenant.marital_status || undefined,
        nationality: tenant.nationality || undefined,
        address: tenant.address || undefined,
        emergencyName: (primaryKin?.name as string) || '',
        emergencyPhone: (primaryKin?.phone as string) || '',
        emergencyEmail: (primaryKin?.email as string) || '',
        emergencyRelationship: (primaryKin?.relationship as string) || '',
        date: formatDateForDB(new Date()),
      };

      await generateUserData(userData, selectedBusiness);
    } catch (error: any) {
      console.error('Share personal data error:', error);
      showSnackbar(`Failed to generate personal data: ${error.message}`, 'error');
    }
  };

  const makeCall = () => {
    if (tenant?.phone) Linking.openURL(`tel:${tenant.phone}`);
  };

  const sendWhatsApp = () => {
    if (tenant?.phone) Linking.openURL(`whatsapp://send?phone=${tenant.phone}`);
  };

  const sendEmail = () => {
    if (tenant?.email) Linking.openURL(`mailto:${tenant.email}`);
  };

  const getContractStatus = (contract: Contract): ContractStatus => {
    const endDate = new Date(contract.end_date);
    const today = new Date();
    const twoMonths = new Date();
    twoMonths.setMonth(twoMonths.getMonth() + 2);

    if (endDate < today) {
      return { status: 'expired', color: colors.error, opacity: 0.1 };
    } else if (endDate <= twoMonths) {
      return {
        status: 'expiring',
        color: (colors as any).warning,
        opacity: 0.1,
      };
    } else {
      return { status: 'active', color: (colors as any).success, opacity: 0.1 };
    }
  };

  const renderContract = (contract: Contract, _index: number) => {
    const { status, color } = getContractStatus(contract);

    return (
      <Surface
        key={contract.id}
        style={[
          styles.historyCardItem,
          { backgroundColor: addOpacity(colors.surfaceVariant, 0.2) },
        ]}
        elevation={0}
      >
        <View style={styles.historyCardHeader}>
          <View style={styles.historyCardTitleGroup}>
            <Text variant="labelMedium" style={{ fontWeight: 'bold' }}>
              {contract.houses?.properties?.name}
            </Text>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              House {contract.houses?.house_number}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {contract.metadata?.is_swap && (
              <Chip
                style={{
                  backgroundColor: addOpacity(colors.primary, 0.8),
                  height: 26,
                  justifyContent: 'center',
                  marginRight: 6,
                }}
                textStyle={{
                  color: colors.surface,
                  fontSize: 10,
                  fontWeight: 'bold',
                  lineHeight: 12,
                }}
                compact
              >
                SWAPPED
              </Chip>
            )}
            <Chip
              style={{
                backgroundColor: addOpacity(color, 0.15),
                height: 26,
                justifyContent: 'center',
              }}
              textStyle={{
                color: color,
                fontSize: 10,
                fontWeight: 'bold',
                lineHeight: 12,
              }}
              compact
            >
              {status.toUpperCase()}
            </Chip>
            {can('edit', 'contract') && (
              <Menu
                visible={contractMenuVisible === contract.id}
                onDismiss={() => setContractMenuVisible(null)}
                anchor={
                  <IconButton
                    icon="dots-vertical"
                    size={18}
                    onPress={() => setContractMenuVisible(contract.id)}
                  />
                }
              >
                <Menu.Item
                  onPress={() => {
                    setContractMenuVisible(null);
                    router.push(`/contracts/view/${contract.id}`);
                  }}
                  title="View Contract"
                  leadingIcon="file-document"
                />
                <Menu.Item
                  onPress={() => {
                    setContractMenuVisible(null);
                    router.push(`/contracts/edit/${contract.id}`);
                  }}
                  title="Edit Contract"
                  leadingIcon="pencil"
                />
                {isActiveContractStatus(contract.status) && (
                  <>
                    <Menu.Item
                      onPress={() => {
                        setContractMenuVisible(null);
                        setTransferContractId(contract.id);
                      }}
                      title="Transfer House"
                      leadingIcon="home-export-outline"
                    />
                    <Menu.Item
                      onPress={() => {
                        setContractMenuVisible(null);
                        setSwapContractId(contract.id);
                      }}
                      title="Swap Houses"
                      leadingIcon="swap-horizontal"
                    />
                  </>
                )}
              </Menu>
            )}
          </View>
        </View>

        <View style={styles.historyCardDetails}>
          <View style={styles.historyDetailItem}>
            <MaterialCommunityIcons
              name="calendar"
              size={14}
              color={colors.onSurfaceVariant}
            />
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              {formatDate(contract.start_date)} - {formatDate(contract.end_date)}
            </Text>
          </View>
          <View style={styles.historyDetailItem}>
            <MaterialCommunityIcons
              name="cash"
              size={14}
              color={colors.onSurfaceVariant}
            />
            <Text variant="bodySmall" style={{ fontWeight: 'bold' }}>
              {defaultCurrency
                ? formatWithCurrency(contract.rent_amount, defaultCurrency)
                : contract.rent_amount}
            </Text>
          </View>
        </View>
      </Surface>
    );
  };

  if (loading || !tenant) {
    return <LoadingCard iconName="account-group" text="Loading tenant..." />;
  }

  return (
    <StaffOrAdmin>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Surface
          style={[styles.unifiedSurface, { backgroundColor: colors.surface }]}
          elevation={2}
        >
          <View style={styles.unifiedContent}>
            {/* Header Section */}
            <View style={styles.headerSection}>
              <View style={styles.headerTop}>
                <View style={styles.titleSection}>
                  <Text variant="titleLarge" style={styles.tenantNameTitle}>
                    {tenant.name}
                  </Text>
                  <View style={styles.chipRow}>
                    <Chip
                      icon="phone"
                      style={{ backgroundColor: addOpacity(colors.primary, 0.1) }}
                      textStyle={{ fontSize: 11, color: colors.primary }}
                      compact
                    >
                      {tenant.phone || 'No phone'}
                    </Chip>
                  </View>
                </View>

                <View style={styles.actionRow}>
                  <IconButton
                    icon="phone"
                    mode="contained-tonal"
                    onPress={makeCall}
                    disabled={!tenant.phone}
                    containerColor={colors.primaryContainer}
                    iconColor={colors.primary}
                  />
                  <IconButton
                    icon="whatsapp"
                    mode="contained-tonal"
                    onPress={sendWhatsApp}
                    disabled={!tenant.phone}
                    containerColor="#25D36620"
                    iconColor="#25D366"
                  />
                  <IconButton
                    icon="email"
                    mode="contained-tonal"
                    onPress={sendEmail}
                    disabled={!tenant.email}
                    containerColor={colors.secondaryContainer}
                    iconColor={colors.secondary}
                  />
                  <Menu
                    visible={tenantMenuVisible}
                    onDismiss={() => setTenantMenuVisible(false)}
                    anchor={
                      <IconButton
                        icon="dots-vertical"
                        mode="contained-tonal"
                        onPress={() => setTenantMenuVisible(true)}
                      />
                    }
                  >
                    {can('edit', 'tenant') && (
                      <Menu.Item
                        onPress={() => {
                          setTenantMenuVisible(false);
                          router.push(`/(tabs)/tenants/edit/${tenant.id}`);
                        }}
                        title="Edit Profile"
                        leadingIcon="pencil"
                      />
                    )}
                    {can('create', 'contract') && (
                      <Menu.Item
                        onPress={() => {
                          setTenantMenuVisible(false);
                          router.push({
                            pathname: '/contracts/create',
                            params: { tenant_id: tenant.id },
                          });
                        }}
                        title="New Contract"
                        leadingIcon="file-plus"
                      />
                    )}
                    <Menu.Item
                      onPress={() => {
                        setTenantMenuVisible(false);
                        handleSharePersonalData();
                      }}
                      title="Export Profile PDF"
                      leadingIcon="file-pdf-box"
                    />
                  </Menu>
                </View>
              </View>
            </View>

            <View style={styles.receiptDividerContainer}>
              <View
                style={[
                  styles.receiptDivider,
                  { borderBottomColor: colors.outlineVariant },
                ]}
              />
            </View>

            {/* Basic Info */}
            <View style={[styles.infoBlock, { borderLeftColor: colors.primary }]}>
              <View style={styles.infoRow}>
                <View style={styles.labelSection}>
                  <MaterialCommunityIcons
                    name="email"
                    size={14}
                    color={colors.onSurfaceVariant}
                  />
                  <Text variant="labelSmall" style={styles.infoLabel}>
                    EMAIL
                  </Text>
                </View>
                <Text variant="bodyMedium" style={styles.infoValue}>
                  {tenant.email || 'N/A'}
                </Text>
              </View>

              {tenant.address && (
                <View style={styles.infoRow}>
                  <View style={styles.labelSection}>
                    <MaterialCommunityIcons
                      name="map-marker"
                      size={14}
                      color={colors.onSurfaceVariant}
                    />
                    <Text variant="labelSmall" style={styles.infoLabel}>
                      ADDRESS
                    </Text>
                  </View>
                  <Text variant="bodyMedium" style={styles.infoValue}>
                    {tenant.address || 'N/A'}
                  </Text>
                </View>
              )}

              <View style={styles.infoRow}>
                <View style={styles.labelSection}>
                  <MaterialCommunityIcons
                    name="account"
                    size={14}
                    color={colors.onSurfaceVariant}
                  />
                  <Text variant="labelSmall" style={styles.infoLabel}>
                    METADATA
                  </Text>
                </View>
                <Text variant="bodyMedium" style={styles.infoValue}>
                  {properCase(tenant.gender || 'N/A')} •{' '}
                  {properCase(tenant.nationality || 'N/A')}
                </Text>
              </View>
            </View>

            {/* Next of Kin */}
            <View style={styles.subSection}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons
                  name="account-group"
                  size={20}
                  color={colors.primary}
                />
                <Text variant="titleMedium" style={styles.sectionTitle}>
                  Emergency Contacts
                </Text>
              </View>

              {Array.isArray(tenant.next_of_kin) && tenant.next_of_kin.length > 0 ? (
                (tenant.next_of_kin as any[]).map((kin, idx) => (
                  <Surface
                    key={idx}
                    style={[
                      styles.kinCard,
                      { backgroundColor: addOpacity(colors.surfaceVariant, 0.3) },
                    ]}
                    elevation={0}
                  >
                    <View style={styles.kinHeader}>
                      <Text variant="labelMedium" style={{ fontWeight: 'bold' }}>
                        {kin.name}
                      </Text>
                      {kin.is_primary && (
                        <Chip
                          style={{
                            height: 24,
                            backgroundColor: colors.primaryContainer,
                            justifyContent: 'center',
                          }}
                          textStyle={{
                            fontSize: 9,
                            color: colors.primary,
                            fontWeight: 'bold',
                            lineHeight: 12,
                          }}
                        >
                          PRIMARY
                        </Chip>
                      )}
                    </View>
                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                      {kin.relationship} • {kin.phone}
                    </Text>
                    {kin.email && (
                      <Text
                        variant="bodySmall"
                        style={{ color: colors.onSurfaceVariant }}
                      >
                        {kin.email}
                      </Text>
                    )}
                  </Surface>
                ))
              ) : (
                <Text
                  variant="bodySmall"
                  style={{ fontStyle: 'italic', color: colors.onSurfaceVariant }}
                >
                  No emergency contacts provided
                </Text>
              )}
            </View>

            {/* Contracts */}
            <View style={styles.subSection}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons
                  name="file-document-multiple"
                  size={20}
                  color={colors.primary}
                />
                <Text variant="titleMedium" style={styles.sectionTitle}>
                  Contract History
                </Text>
              </View>
              <View style={{ gap: 10 }}>
                {contracts.length === 0 ? (
                  <Text
                    variant="bodySmall"
                    style={{ fontStyle: 'italic', color: colors.onSurfaceVariant }}
                  >
                    No contracts found
                  </Text>
                ) : (
                  contracts.map((contract: Contract, index: number) =>
                    renderContract(contract, index),
                  )
                )}
              </View>
            </View>

            {/* Recent Receipts */}
            <View style={styles.subSection}>
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name="receipt" size={20} color={colors.primary} />
                <Text variant="titleMedium" style={styles.sectionTitle}>
                  Recent Payments
                </Text>
              </View>
              <View style={{ gap: 10 }}>
                {receipts.length === 0 ? (
                  <Text
                    variant="bodySmall"
                    style={{ fontStyle: 'italic', color: colors.onSurfaceVariant }}
                  >
                    No receipts found
                  </Text>
                ) : (
                  receipts.slice(0, 5).map((receipt: Receipt) => (
                    <SPressable
                      key={receipt.id}
                      onPress={() => router.push(`/receipts/view/${receipt.id}`)}
                    >
                      <Surface
                        style={[
                          styles.historyCardItem,
                          { backgroundColor: addOpacity(colors.surfaceVariant, 0.2) },
                        ]}
                        elevation={0}
                      >
                        <View style={styles.historyCardHeader}>
                          <View style={styles.historyCardTitleGroup}>
                            <Text variant="labelMedium" style={{ fontWeight: 'bold' }}>
                              #{receipt.id.slice(-6).toUpperCase()}
                            </Text>
                            <Text
                              variant="bodySmall"
                              style={{ color: colors.onSurfaceVariant }}
                            >
                              {formatDate(receipt.payment_date)}
                            </Text>
                          </View>
                          <Text
                            variant="labelMedium"
                            style={{ fontWeight: '900', color: colors.primary }}
                          >
                            {defaultCurrency
                              ? formatWithCurrency(receipt.amount, defaultCurrency)
                              : receipt.amount}
                          </Text>
                        </View>
                      </Surface>
                    </SPressable>
                  ))
                )}
              </View>
            </View>

            {isOwner && (
              <HistoryModal
                entityType="tenants"
                entityId={tenant.id}
                targets={historyTargets}
                containerStyle={{ marginHorizontal: 16, marginBottom: 32 }}
              />
            )}
          </View>
        </Surface>

        <TransferHouseModal
          visible={!!transferContractId}
          onDismiss={() => setTransferContractId(null)}
          contractId={transferContractId}
        />
        <SwapHouseModal
          visible={!!swapContractId}
          onDismiss={() => setSwapContractId(null)}
          contractId={swapContractId}
        />
      </ScrollView>
    </StaffOrAdmin>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  unifiedSurface: {
    margin: 10,
    borderRadius: 16,
    overflow: 'hidden',
  },
  unifiedContent: {
    padding: 24,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTop: {
    alignItems: 'center',
    marginBottom: 4,
  },
  titleSection: {
    alignItems: 'center',
  },
  tenantNameTitle: {
    fontWeight: 'bold',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  receiptDividerContainer: {
    marginVertical: 16,
    overflow: 'hidden',
  },
  receiptDivider: {
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    height: 1,
  },
  infoBlock: {
    paddingLeft: 16,
    borderLeftWidth: 3,
    marginVertical: 16,
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '35%',
  },
  infoLabel: {
    fontWeight: 'bold',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  infoValue: {
    flex: 1,
    fontWeight: '700',
    textAlign: 'right',
  },
  subSection: {
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  kinCard: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    gap: 4,
  },
  kinHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyCardItem: {
    padding: 12,
    borderRadius: 12,
  },
  historyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyCardTitleGroup: {
    flex: 1,
  },
  historyCardDetails: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 16,
  },
  historyDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
