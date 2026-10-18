import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { BatchMutation } from 'local-lite';
import { useMemo, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Chip,
  Divider,
  IconButton,
  Menu,
  Portal,
  Surface,
  Text,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useIdleLock } from '@/providers/LockScreenProvider';
import AccessGuard from '@/shared/components/AccessGuard';
import BaseModal from '@/shared/components/BaseModal';
import HistoryModal from '@/shared/components/HistoryModal';
import LoadingCard from '@/shared/components/LoadingCard';
import SPressable from '@/shared/components/SlightPressable';
import StatusUpdateModal from '@/shared/components/StatusUpdateModal';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import {
  useContracts,
  useContractsById,
  useCoreMutations,
  useHousesById,
  usePropertiesById,
  useReceiptsByContractId,
  useSettings,
  useStoreRefresh,
  useTenantsById,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import {
  deleteContractDocument,
  pickDocument,
  uploadContractDocument,
} from '@/shared/services/fileUpload';
import {
  formatDate,
  formatDateForDB,
  formatDateTime,
  formatWithCurrency,
} from '@/shared/utils/formatters';
import { addOpacity, properCase } from '@/shared/utils/helper';
import {
  isActiveContractStatus,
  isFormerContractStatus,
  resolveHouseStatusFromContracts,
} from '@/shared/utils/statusHelper';

interface Property {
  id: string;
  name: string;
}

interface House {
  id: string;
  house_number: string;
  type?: string;
  property?: Property;
}

interface Tenant {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  gender?: string;
  marital_status?: string;
  next_of_kin?: any[];
}

interface Contract {
  id: string;
  house_id: string;
  tenant_id: string;
  start_date: string;
  end_date: string;
  rent_amount: number;
  remarks?: string;
  status: string;
  documents?: string[];
  metadata?: {
    breaks?: any[];
  };
  house?: House;
  tenant?: Tenant;
}

interface Receipt {
  id: string;
  amount: number;
  payment_date: string;
  type?: string;
  payment_method?: string;
}

interface StatusColor {
  color: string;
  bgColor: string;
}

export default function ViewContractScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { selectedBusiness } = useBusiness();
  const { isOwner, can } = useAccessControl();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();
  const colors = useThemeColors();

  const allContracts = useContracts(selectedBusiness?.id);
  const allSettings = useSettings(selectedBusiness?.id);
  const tenantsById = useTenantsById(selectedBusiness?.id);
  const housesById = useHousesById(selectedBusiness?.id);
  const propertiesById = usePropertiesById(selectedBusiness?.id);
  const contractsById = useContractsById(selectedBusiness?.id);
  const receiptsByContract = useReceiptsByContractId(selectedBusiness?.id);
  const { batch, update, delete: deleteRecord } = useCoreMutations();
  const { refreshing, onRefresh } = useStoreRefresh();

  // Network status check with Snackbar
  const { checkOnline } = useOfflineCheck();
  const { showSnackbar } = useSnackbar();

  const defaultCurrency = useMemo(() => {
    const currencySetting = allSettings.find(s => s.setting_key === 'currency_settings');
    if (currencySetting && Array.isArray(currencySetting.setting_value)) {
      const currencies = currencySetting.setting_value as any[];
      return currencies.find(c => c.default) || currencies[0];
    }
    return null;
  }, [allSettings]);

  const contract = useMemo(() => {
    const c = contractsById.get(id as string);
    if (!c) return null;

    const tenant = tenantsById.get(c.tenant_id as string);
    const house = housesById.get(c.house_id as string);
    const property = house ? propertiesById.get(house.property_id as string) : undefined;

    return {
      ...c,
      rent_amount: Number(c.rent_amount),
      tenant,
      house: house
        ? {
            ...house,
            property: property ? { id: property.id, name: property.name } : undefined,
          }
        : undefined,
    } as Contract;
  }, [id, contractsById, tenantsById, housesById, propertiesById]);

  const receipts = useMemo(() => {
    return (receiptsByContract.get(id as string) || [])
      .map((r: Receipt) => ({
        ...r,
        amount: Number(r.amount),
      }))
      .sort(
        (a: Receipt, b: Receipt) =>
          new Date(b.payment_date || 0).getTime() -
          new Date(a.payment_date || 0).getTime(),
      ) as Receipt[];
  }, [id, receiptsByContract]);

  const [menuVisible, setMenuVisible] = useState(false);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentDeleteLoading, setDocumentDeleteLoading] = useState<number | null>(null);
  const [deleteDocVisible, setDeleteDocVisible] = useState(false);
  const [docToDelete, setDocToDelete] = useState<{ url: string; index: number } | null>(
    null,
  );
  const [occupancyModalVisible, setOccupancyModalVisible] = useState(false);
  const [occupancyModalData, setOccupancyModalData] = useState<{
    contractId: string;
    tenantName: string;
  } | null>(null);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [updateStatusLoading, setUpdateStatusLoading] = useState(false);

  const statusItems = useMemo(
    () => [
      {
        id: 'active',
        title: 'Active',
        color: (colors as any).success,
        disabled: contract?.status === 'active',
      },
      {
        id: 'expiring_soon',
        title: 'Expiring Soon',
        color: (colors as any).warning,
        disabled: contract?.status === 'expiring_soon',
      },
      {
        id: 'expired',
        title: 'Expired',
        color: (colors as any).warning,
        disabled: contract?.status === 'expired',
      },
      {
        id: 'terminated',
        title: 'Terminated',
        color: colors.error,
        disabled: contract?.status === 'terminated',
      },
    ],
    [contract, colors],
  );

  const handleUpdateStatus = async (newStatus: string) => {
    if (!contract || !id || updateStatusLoading) return;

    try {
      setUpdateStatusLoading(true);
      const updateData: any = { status: newStatus };
      if (newStatus === 'terminated') {
        updateData.end_date = formatDateForDB(new Date());
      }

      const mutations: BatchMutation[] = [
        {
          tableName: 'contracts',
          operation: 'UPDATE',
          payload: updateData,
          rowId: id,
        },
      ];

      if (contract.house_id) {
        const houseId = contract.house_id;
        const houseData = housesById.get(houseId);
        const contractsAfterUpdate = allContracts.map(c =>
          c.id === id ? { ...c, status: newStatus } : c,
        );
        mutations.push({
          tableName: 'houses',
          operation: 'UPDATE',
          payload: {
            ...houseData,
            status: resolveHouseStatusFromContracts(
              houseData?.status,
              contractsAfterUpdate,
              houseId,
            ),
          },
          rowId: houseId,
        });
      }

      await batch(mutations);

      showSnackbar('Contract status updated successfully', 'success');
    } catch (error) {
      console.error('Error updating status:', error);
      showSnackbar('Failed to update status', 'error');
    } finally {
      setUpdateStatusLoading(false);
      setStatusModalVisible(false);
    }
  };

  const loading = !id || !selectedBusiness || !contract;
  const notFound = !!id && !!selectedBusiness && !contract;

  const getStatusColor = (status: string): StatusColor => {
    if (isActiveContractStatus(status)) {
      if (status === 'expiring_soon') {
        return {
          color: (colors as any).warning,
          bgColor: (colors as any).warningContainer,
        };
      }
      return {
        color: (colors as any).success,
        bgColor: (colors as any).successContainer,
      };
    }

    if (isFormerContractStatus(status)) {
      if (status === 'expired') {
        return {
          color: (colors as any).warning,
          bgColor: (colors as any).warningContainer,
        };
      }
      return {
        color: colors.error,
        bgColor: (colors as any).errorContainer,
      };
    }

    return {
      color: colors.onSurfaceVariant,
      bgColor: (colors as any).surfaceVariant,
    };
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleteLoading(true);
    try {
      await deleteRecord('contracts', id);
      router.push('/contracts');
    } catch (error: any) {
      console.error('Error deleting contract:', error);
      showSnackbar(`Failed to delete contract: ${error.message}`, 'error');
    } finally {
      setDeleteLoading(false);
      setDeleteDialogVisible(false);
    }
  };

  const handleDocumentUpload = async () => {
    if (!contract) return;

    setDocumentLoading(true);
    pauseAutoLock();
    try {
      const file = await pickDocument();
      if (!file) {
        setDocumentLoading(false);
        return;
      }

      // Upload the document with offline support
      const { publicUrl } = await uploadContractDocument(contract.id, file, {
        offlineSupport: true,
      });

      // Update contract with new document URL via local-lite
      const updatedDocuments = [...(contract.documents || []), publicUrl];
      await update('contracts', contract.id, {
        documents: updatedDocuments,
      });

      showSnackbar('Document uploaded successfully', 'success');
    } catch (error) {
      console.error('Error uploading document:', error);
      showSnackbar('Failed to upload document', 'error');
    } finally {
      setDocumentLoading(false);
      resumeAutoLock();
    }
  };

  const handleDeleteDocument = async () => {
    if (!contract || !docToDelete) return;

    // Check network status before deleting
    if (!checkOnline('Document Deletion')) return;

    const { url, index } = docToDelete;
    setDocumentDeleteLoading(index);
    setDeleteDocVisible(false);

    try {
      // Delete from storage
      await deleteContractDocument(url);

      // Update contract documents via local-lite
      const updatedDocuments = [...(contract.documents || [])];
      updatedDocuments.splice(index, 1);
      await update('contracts', contract.id, {
        documents: updatedDocuments,
      });

      showSnackbar('Document deleted successfully', 'success');
    } catch (error) {
      console.error('Error deleting document:', error);
      showSnackbar('Failed to delete document', 'error');
    } finally {
      setDocumentDeleteLoading(null);
      setDocToDelete(null);
    }
  };

  const handleRemoveBreak = async (breakId: string) => {
    if (!contract) return;

    try {
      const currentMetadata = contract.metadata || {};
      const currentBreaks = (currentMetadata as any).breaks || [];

      const updatedMetadata = {
        ...currentMetadata,
        breaks: currentBreaks.filter((b: any) => b.id !== breakId),
      };

      await update('contracts', contract.id, {
        metadata: updatedMetadata,
      });
      showSnackbar('Holiday break removed successfully.', 'success');
    } catch (error) {
      console.error('Error removing holiday break:', error);
      showSnackbar('Failed to remove holiday break', 'error');
    }
  };

  if (loading || !contract) {
    if (notFound) {
      return (
        <View style={styles.centered}>
          <Text variant="headlineSmall">Contract not found</Text>
          <Text variant="bodyMedium">
            This contract may have been deleted or you may not have access.
          </Text>
        </View>
      );
    }
    return <LoadingCard iconName="file-document-outline" text="Loading contract..." />;
  }

  const statusStyle = getStatusColor(contract.status);

  // Calculate contract progress
  const getProgress = () => {
    const start = new Date(contract.start_date).getTime();
    const end = new Date(contract.end_date).getTime();
    const now = Date.now();

    if (now < start) return 0;
    if (now > end) return 1;

    return (now - start) / (end - start);
  };

  const progress = getProgress();
  const daysRemaining = Math.max(
    0,
    Math.ceil(
      (new Date(contract.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    ),
  );

  return (
    <AccessGuard roles={['admin']}>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.content}>
          <Surface
            style={[styles.unifiedSurface, { backgroundColor: colors.surface }]}
            elevation={2}
          >
            <View style={styles.unifiedContent}>
              {/* Header Section */}
              <View style={styles.headerSection}>
                <View style={styles.headerTop}>
                  <View style={styles.titleSection}>
                    <Text variant="titleLarge" style={styles.contractTitle}>
                      RENTAL AGREEMENT
                    </Text>
                    <Text
                      variant="bodySmall"
                      style={[styles.contractId, { color: colors.onSurfaceVariant }]}
                    >
                      #{contract.id.substring(0, 8).toUpperCase()}
                    </Text>
                  </View>
                </View>

                <View style={styles.chipRow}>
                  <Chip
                    icon="clock-outline"
                    style={[
                      styles.headerChip,
                      {
                        backgroundColor: addOpacity(statusStyle.color, 0.1),
                        flex: 1,
                        borderRadius: 12,
                        justifyContent: 'center',
                      },
                    ]}
                    textStyle={{
                      color: statusStyle.color,
                      fontSize: 11,
                      fontWeight: 'bold',
                      lineHeight: 14,
                      textAlign: 'center',
                    }}
                    compact
                  >
                    {properCase(contract.status)}
                  </Chip>
                  {contract.house?.house_number && (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        flex: 1,
                      }}
                    >
                      <Chip
                        icon="home-variant-outline"
                        style={[
                          styles.headerChip,
                          {
                            backgroundColor: addOpacity(colors.primary, 0.1),
                            flex: 1,
                            borderRadius: 12,
                            justifyContent: 'center',
                          },
                        ]}
                        textStyle={{
                          color: colors.primary,
                          fontSize: 11,
                          fontWeight: 'bold',
                          lineHeight: 14,
                          textAlign: 'center',
                        }}
                        compact
                      >
                        UNIT {contract.house.house_number}
                      </Chip>
                      <Menu
                        visible={menuVisible}
                        onDismiss={() => setMenuVisible(false)}
                        anchor={
                          <IconButton
                            icon="dots-vertical"
                            mode="contained-tonal"
                            containerColor={addOpacity(colors.secondary, 0.08)}
                            iconColor={colors.secondary}
                            size={18}
                            onPress={() => setMenuVisible(true)}
                            style={{ margin: 0, width: 32, height: 32, borderRadius: 8 }}
                          />
                        }
                      >
                        <Menu.Item
                          onPress={() => {
                            setMenuVisible(false);
                            router.push(`/(tabs)/contracts/edit/${id}`);
                          }}
                          title="Edit Contract"
                          leadingIcon="pencil"
                        />
                        <Menu.Item
                          onPress={() => {
                            setMenuVisible(false);
                            setStatusModalVisible(true);
                          }}
                          title="Update Status"
                          leadingIcon="list-status"
                        />
                        {can('delete', 'contract') && (
                          <Menu.Item
                            onPress={() => {
                              setMenuVisible(false);
                              setDeleteDialogVisible(true);
                            }}
                            title="Delete Contract"
                            leadingIcon="delete"
                            titleStyle={{ color: colors.error }}
                          />
                        )}
                      </Menu>
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.progressSection}>
                <View style={styles.progressHeader}>
                  <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                    LEASE PROGRESS
                  </Text>
                  <Text variant="labelSmall" style={{ color: colors.primary }}>
                    {daysRemaining} DAYS LEFT
                  </Text>
                </View>
                <View
                  style={[
                    styles.progressBarContainer,
                    { backgroundColor: colors.surfaceVariant },
                  ]}
                >
                  <View
                    style={[
                      styles.progressBar,
                      {
                        backgroundColor: colors.primary,
                        width: `${progress * 100}%`,
                      },
                    ]}
                  />
                </View>
              </View>

              <Divider style={styles.divider} />
              <View
                style={[
                  styles.rentSecondary,
                  {
                    alignContent: 'center',
                    justifyContent: 'center',
                    alignItems: 'center',
                  },
                ]}
              >
                <Text variant="bodyMedium" style={styles.infoValue}>
                  Duration: {formatDate(contract.start_date)} -{' '}
                  {formatDate(contract.end_date)}
                </Text>
              </View>
              {/* Rent Summary Card */}
              <Surface
                style={[
                  styles.rentSummary,
                  {
                    backgroundColor: addOpacity(colors.primary, 0.03),
                    borderColor: addOpacity(colors.primary, 0.1),
                  },
                ]}
                elevation={0}
              >
                <View style={styles.rentBlock}>
                  <Text
                    variant="labelSmall"
                    style={{ color: colors.onSurfaceVariant, letterSpacing: 1 }}
                  >
                    MONTHLY RENT
                  </Text>
                  <Text
                    variant="bodyMedium"
                    style={{ fontWeight: '900', color: colors.primary, marginTop: 4 }}
                  >
                    {defaultCurrency
                      ? formatWithCurrency(contract.rent_amount, defaultCurrency)
                      : formatWithCurrency(contract.rent_amount, defaultCurrency as any)}
                  </Text>
                  <View style={[styles.rentMiniItem, { marginTop: 8 }]}>
                    <MaterialCommunityIcons
                      name="office-building-outline"
                      size={14}
                      color={colors.onSurfaceVariant}
                    />
                    <Text
                      variant="bodySmall"
                      style={{ marginLeft: 4, color: colors.onSurfaceVariant }}
                    >
                      {contract.house?.property?.name}
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.rentDivider,
                    { backgroundColor: addOpacity(colors.primary, 0.1) },
                  ]}
                />
                <View style={styles.rentSecondary}>
                  <View style={styles.rentMiniItem}>
                    <MaterialCommunityIcons
                      name="account-outline"
                      size={14}
                      color={colors.onSurfaceVariant}
                    />
                    <Text
                      variant="bodySmall"
                      style={{ marginLeft: 4, color: colors.onSurfaceVariant }}
                    >
                      {contract.tenant?.name}
                    </Text>
                  </View>
                  <View style={[styles.rentMiniItem, { marginTop: 4 }]}>
                    <MaterialCommunityIcons
                      name="phone-outline"
                      size={14}
                      color={colors.onSurfaceVariant}
                    />
                    <Text
                      variant="bodySmall"
                      style={{ marginLeft: 4, color: colors.onSurfaceVariant }}
                    >
                      {contract.tenant?.phone}
                    </Text>
                  </View>
                  <View style={[styles.rentMiniItem, { marginTop: 4 }]}>
                    <MaterialCommunityIcons
                      name="home-outline"
                      size={14}
                      color={colors.onSurfaceVariant}
                    />
                    <Text
                      variant="bodySmall"
                      style={{ marginLeft: 4, color: colors.onSurfaceVariant }}
                    >
                      Unit: {contract.house?.house_number}
                    </Text>
                  </View>
                </View>
              </Surface>

              {contract.remarks && (
                <View style={styles.infoSection}>
                  <Text variant="labelLarge" style={styles.sectionLabel}>
                    REMARKS / TERMS
                  </Text>
                  <Surface
                    style={[
                      styles.remarksCard,
                      { backgroundColor: addOpacity(colors.surfaceVariant, 0.3) },
                    ]}
                    elevation={0}
                  >
                    <Text variant="bodyMedium" style={{ lineHeight: 20 }}>
                      {contract.remarks}
                    </Text>
                  </Surface>
                </View>
              )}

              {/* Holiday Breaks */}
              {((contract.metadata as any)?.breaks || []).length > 0 && (
                <View style={styles.infoSection}>
                  <Text variant="labelLarge" style={styles.sectionLabel}>
                    HOLIDAY BREAKS
                  </Text>
                  {(contract.metadata as any).breaks.map((b: any) => (
                    <Surface
                      key={b.id}
                      style={[
                        styles.breakCard,
                        { backgroundColor: addOpacity(colors.warning, 0.05) },
                      ]}
                      elevation={0}
                    >
                      <View style={styles.breakInfo}>
                        <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                          {b.reason || 'Holiday Break'}
                        </Text>
                        <Text
                          variant="bodySmall"
                          style={{ color: colors.onSurfaceVariant }}
                        >
                          {formatDate(b.start_date)} - {formatDate(b.end_date)}
                        </Text>
                        {(b.updated_at || b.created_at) && (
                          <Text
                            variant="labelSmall"
                            style={{
                              color: colors.onSurfaceDisabled,
                              fontStyle: 'italic',
                            }}
                          >
                            Last Updated: {formatDateTime(b.updated_at || b.created_at)}
                          </Text>
                        )}
                      </View>
                      <IconButton
                        icon="delete-outline"
                        size={20}
                        onPress={() => handleRemoveBreak(b.id)}
                      />
                    </Surface>
                  ))}
                </View>
              )}

              {/* Documents Section */}
              <View style={styles.infoSection}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text variant="labelLarge" style={styles.sectionLabel}>
                    ATTACHMENTS
                  </Text>
                  <Button
                    mode="text"
                    compact
                    icon="plus"
                    onPress={handleDocumentUpload}
                    loading={documentLoading}
                  >
                    Add
                  </Button>
                </View>
                {!contract.documents || contract.documents.length === 0 ? (
                  <Text
                    variant="bodySmall"
                    style={[styles.emptyText, { color: colors.onSurfaceDisabled }]}
                  >
                    No documents attached
                  </Text>
                ) : (
                  contract.documents.map((url, index) => {
                    const fileName = `${url.split('/').pop()?.substring(0, 20)}...`;
                    return (
                      <Surface
                        key={index}
                        style={[
                          styles.documentCard,
                          { backgroundColor: addOpacity(colors.surfaceVariant, 0.3) },
                        ]}
                        elevation={0}
                      >
                        <IconButton icon="file-document" size={20} />
                        <Text
                          variant="bodyMedium"
                          style={styles.documentName}
                          onPress={() => Linking.openURL(url)}
                        >
                          {fileName}
                        </Text>
                        <IconButton
                          icon="delete-outline"
                          size={18}
                          onPress={() => {
                            setDocToDelete({ url, index });
                            setDeleteDocVisible(true);
                          }}
                          disabled={documentDeleteLoading === index}
                        />
                      </Surface>
                    );
                  })
                )}
              </View>

              {/* Tenant Ledger */}
              <View style={styles.infoSection}>
                <Text variant="labelLarge" style={styles.sectionLabel}>
                  TENANT LEDGER
                </Text>
                {receipts.length === 0 ? (
                  <Text
                    variant="bodySmall"
                    style={[styles.emptyText, { color: colors.onSurfaceDisabled }]}
                  >
                    No payments recorded
                  </Text>
                ) : (
                  receipts.slice(0, 5).map(receipt => (
                    <SPressable
                      key={receipt.id}
                      onPress={() => router.push(`/(tabs)/receipts/view/${receipt.id}`)}
                      style={styles.paymentItem}
                    >
                      <View style={styles.paymentContent}>
                        <View style={styles.paymentMain}>
                          <Text variant="bodyLarge" style={{ fontWeight: 'bold' }}>
                            {defaultCurrency
                              ? formatWithCurrency(receipt.amount, defaultCurrency)
                              : formatWithCurrency(
                                  receipt.amount,
                                  defaultCurrency as any,
                                )}
                          </Text>
                          <Text
                            variant="bodySmall"
                            style={{ color: colors.onSurfaceVariant }}
                          >
                            {receipt.type || 'Payment'} •{' '}
                            {formatDate(receipt.payment_date)}
                          </Text>
                        </View>
                        <IconButton icon="chevron-right" size={20} />
                      </View>
                    </SPressable>
                  ))
                )}
              </View>
            </View>
          </Surface>
        </View>

        {isOwner && (
          <HistoryModal
            entityType="contracts"
            entityId={contract?.id}
            containerStyle={{ marginHorizontal: 16, marginBottom: 32 }}
          />
        )}

        <Portal>
          <BaseModal
            mode="confirm"
            visible={deleteDialogVisible}
            onDismiss={() => setDeleteDialogVisible(false)}
            onConfirm={handleDelete}
            title="Delete Contract"
            message="Are you sure you want to delete this contract? This action cannot be undone."
            confirmText="Delete"
            cancelText="Cancel"
            loading={deleteLoading}
            destructive={true}
          />

          <BaseModal
            mode="confirm"
            visible={occupancyModalVisible}
            onDismiss={() => {
              setOccupancyModalVisible(false);
              setOccupancyModalData(null);
            }}
            onConfirm={() => {
              if (occupancyModalData) {
                const targetId = occupancyModalData.contractId;
                setOccupancyModalVisible(false);
                setOccupancyModalData(null);
                router.push(`/(tabs)/contracts/edit/${targetId}`);
              }
            }}
            title="House Already Occupied"
            message={`This house already has an active contract with ${occupancyModalData?.tenantName || 'another tenant'}. Please terminate, expire, or cancel that contract first.`}
            confirmText="Edit Other Contract"
            cancelText="Cancel"
          />
          <BaseModal
            visible={deleteDocVisible}
            mode="confirm"
            onDismiss={() => setDeleteDocVisible(false)}
            title="Delete Attachment"
            confirmText="Delete"
            destructive
            icon="error"
            onConfirm={handleDeleteDocument}
          >
            <Text>
              Are you sure you want to delete this attachment? This action cannot be
              undone.
            </Text>
          </BaseModal>

          <StatusUpdateModal
            visible={statusModalVisible}
            onDismiss={() => setStatusModalVisible(false)}
            title="Update Contract Status"
            subtitle={contract ? `Tenant: ${contract.tenant?.name}` : undefined}
            items={statusItems}
            onSelect={status => {
              handleUpdateStatus(status);
            }}
          />
        </Portal>
      </ScrollView>
    </AccessGuard>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 8,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  unifiedSurface: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  unifiedContent: {
    padding: 24,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTop: {
    alignItems: 'center',
    marginBottom: 4,
  },
  titleSection: {
    alignItems: 'center',
  },
  contractTitle: {
    fontWeight: 'bold',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  contractId: {
    opacity: 0.7,
    marginTop: 2,
  },
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
    width: '100%',
  },
  headerChip: {
    height: 28,
    justifyContent: 'center',
  },
  progressSection: {
    marginTop: 8,
    marginBottom: 4,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressBarContainer: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  rentSummary: {
    padding: 20,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
  },
  rentBlock: {
    flex: 1,
  },
  rentDivider: {
    width: 1,
    height: '60%',
    marginHorizontal: 20,
  },
  rentSecondary: {
    flex: 1,
  },
  rentMiniItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    marginVertical: 20,
    opacity: 0.5,
  },
  infoSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    opacity: 0.6,
    letterSpacing: 1,
    marginBottom: 12,
    fontSize: 10,
    fontWeight: '900',
  },
  infoValue: {
    fontWeight: '600',
    marginTop: 2,
  },
  remarksCard: {
    padding: 16,
    borderRadius: 12,
  },
  breakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  breakInfo: {
    flex: 1,
  },
  documentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 12,
    marginBottom: 8,
  },
  documentName: {
    flex: 1,
    fontWeight: '500',
  },
  paymentItem: {
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  paymentContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  paymentMain: {
    flex: 1,
  },
  emptyText: {
    textAlign: 'center',
    padding: 16,
  },
});
