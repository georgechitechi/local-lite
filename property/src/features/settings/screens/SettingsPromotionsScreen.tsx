import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type { BatchMutation } from 'local-lite';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, ScrollView, Share, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Checkbox,
  Divider,
  IconButton,
  List,
  Menu,
  SegmentedButtons,
  Surface,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import SelectTenantModal from '@/features/tenants/components/SelectTenantModal';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import EmptyState from '@/shared/components/EmptyState';
import {
  type Promotion,
  useContracts,
  useContractsByTenantId,
  useCoreMutations,
  useHouses,
  useHousesById,
  usePromotions,
  useProperties,
  usePropertiesById,
  useReceiptsByContractId,
  useReceiptsByTenantId,
  useTenants,
  useTenantsById,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateForDB, formatDateRange } from '@/shared/utils/formatters';
import {
  addOpacity,
  generateUUID,
  safeParseJSON,
  snakeCaseToTitleCase,
} from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import { generateAndSharePromoVoucher } from '@/templates/promoVoucherTemplate';

export default function PromotionsScreen() {
  const { user } = useAuth();

  const { selectedBusiness } = useBusiness();
  const [loading, setLoading] = useState(false);
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();

  const { batch, insert, update, delete: deleteRecord } = useCoreMutations();
  const tenantsById = useTenantsById(selectedBusiness?.id);
  const housesById = useHousesById(selectedBusiness?.id);
  const propertiesById = usePropertiesById(selectedBusiness?.id);
  const receiptsByContract = useReceiptsByContractId(selectedBusiness?.id);
  const receiptsByTenant = useReceiptsByTenantId(selectedBusiness?.id);
  const contractsByTenant = useContractsByTenantId(selectedBusiness?.id);

  const allTenants = useTenants(selectedBusiness?.id);
  const allContracts = useContracts(selectedBusiness?.id);
  const allHouses = useHouses(selectedBusiness?.id);
  const allProperties = useProperties(selectedBusiness?.id);
  const allPromotions = usePromotions(selectedBusiness?.id);

  // Promo code state
  const [promoModalVisible, setPromoModalVisible] = useState(false);
  const [applyPromoModalVisible, setApplyPromoModalVisible] = useState(false);
  const [applyPromoStep, setApplyPromoStep] = useState(1);
  const [newPromotion, setNewPromotion] = useState<{
    code: string;
    amount: string;
    type: 'fixed' | 'percentage' | 'full_month';
    scope: 'business' | 'property' | 'tenant';
    property_id?: string | null;
    tenant_id?: string | null;
    description: string;
    valid_from: string | null;
    valid_until: string | null;
    is_active: boolean;
  }>({
    code: '',
    amount: '',
    type: 'fixed',
    scope: 'business',
    property_id: null,
    tenant_id: null,
    description: '',
    valid_from: null,
    valid_until: null,
    is_active: true,
  });
  const [promoStep, setPromoStep] = useState(1);
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [editingPromoId, setEditingPromoId] = useState<string | null>(null);
  const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>([]);
  const [sourceDate, setSourceDate] = useState(() => {
    const d = new Date();
    return formatDateForDB(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [targetDate, setTargetDate] = useState(() => {
    const d = new Date();
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return formatDateForDB(next);
  });

  const [applyLoading, setApplyLoading] = useState(false);
  const [adjustmentTypeMenuVisible, setAdjustmentTypeMenuVisible] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [sharingPromo, setSharingPromo] = useState<Promotion | null>(null);
  const [shareSelectedTenantId, setShareSelectedTenantId] = useState('');
  const [menuVisibleId, setMenuVisibleId] = useState<string | null>(null);

  // Selection Modals State
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [propertySearch, setPropertySearch] = useState('');
  const [modalSource, setModalSource] = useState<
    'create' | 'apply' | 'share' | 'view' | null
  >(null);
  const [viewModalVisible, setViewModalVisible] = useState(false);
  const [viewingPromotion, setViewingPromotion] = useState<Promotion | null>(null);

  const eligibleTenants = useMemo(() => {
    if (!allTenants || allTenants.length === 0) return [];

    const sourceMonth = new Date(sourceDate).getMonth() + 1;
    const sourceYear = new Date(sourceDate).getFullYear();

    return allTenants
      .map(tenant => {
        const contract = (contractsByTenant.get(tenant.id) || []).find((c: any) =>
          isActiveContractStatus(c.status),
        );
        if (!contract) return null;

        const paidAmount = (receiptsByTenant.get(tenant.id) || [])
          .filter((r: any) => {
            const p = safeParseJSON<{ month?: number; year?: number }>(
              r.payment_period as any,
              {},
            );
            return p?.month === sourceMonth && p?.year === sourceYear;
          })
          .reduce((sum: number, r: any) => sum + (parseFloat(String(r.amount)) || 0), 0);

        return { tenant, contract, paidAmount };
      })
      .filter(Boolean)
      .sort((a, b) => (a?.paidAmount || 0) - (b?.paidAmount || 0)) as {
      tenant: any;
      contract: any;
      paidAmount: number;
    }[];
  }, [allTenants, sourceDate, contractsByTenant, receiptsByTenant]);

  const resetNewPromotion = useCallback(() => {
    setNewPromotion({
      code: '',
      amount: '',
      type: 'fixed',
      scope: 'business',
      property_id: null,
      tenant_id: null,
      description: '',
      valid_from: null,
      valid_until: null,
      is_active: true,
    });
  }, []);

  const handleCreatePromo = useCallback(async () => {
    if (
      !newPromotion.code ||
      (newPromotion.type !== 'full_month' && !newPromotion.amount)
    ) {
      showSnackbar('Please enter code and value', 'error');
      return;
    }

    if (!selectedBusiness) return;

    try {
      setLoading(true);

      const promoData = {
        code: newPromotion.code.toUpperCase(),
        amount:
          newPromotion.type === 'full_month' ? null : parseFloat(newPromotion.amount),
        type: newPromotion.type,
        scope: newPromotion.scope,
        property_id: newPromotion.scope === 'property' ? newPromotion.property_id : null,
        tenant_id: newPromotion.scope === 'tenant' ? newPromotion.tenant_id : null,
        description: newPromotion.description,
        business_id: selectedBusiness.id,
        user_id: user?.id,
        valid_from: newPromotion.valid_from,
        valid_until: newPromotion.valid_until,
        is_active: newPromotion.is_active,
      };

      if (editingPromoId) {
        await update('promotions', editingPromoId, promoData);
      } else {
        const id = generateUUID();
        await insert('promotions', { id, ...promoData });
      }

      setPromoModalVisible(false);
      setEditingPromoId(null);
      setPromoStep(1);
      resetNewPromotion();
      showSnackbar(
        `Adjustment template ${editingPromoId ? 'updated' : 'created'} successfully`,
        'success',
      );
    } catch (error: any) {
      console.error('Error saving promo:', error);
      showSnackbar(error.message || 'Failed to save template', 'error');
    } finally {
      setLoading(false);
    }
  }, [
    newPromotion,
    editingPromoId,
    selectedBusiness,
    user,
    showSnackbar,
    resetNewPromotion,
    update,
    insert,
  ]);

  const handleEditPromo = (promo: Promotion) => {
    setEditingPromoId(promo.id);
    setNewPromotion({
      code: promo.code,
      amount: promo.amount?.toString() || '',
      type: (promo.type as any) || 'percentage',
      scope: (promo.scope as any) || 'business',
      property_id: promo.property_id || null,
      tenant_id: promo.tenant_id || null,
      description: promo.description || '',
      valid_from: promo.valid_from || null,
      valid_until: promo.valid_until || null,
      is_active: promo.is_active ?? true,
    });
    setPromoStep(1);
    setPromoModalVisible(true);
    setMenuVisibleId(null);
    setViewModalVisible(false); // Close view modal if editing from there
  };

  const handleViewPromo = (promo: Promotion) => {
    setViewingPromotion(promo);
    setViewModalVisible(true);
  };

  const selectProperty = (property: { id: string; name: string }) => {
    setNewPromotion(prev => ({ ...prev, property_id: property.id }));
    setShowPropertyModal(false);
  };

  const handleShareAsPDF = async () => {
    const promo = sharingPromo || selectedPromotion;
    if (!promo || !selectedBusiness) return;

    try {
      const tenant = tenantsById.get(shareSelectedTenantId as string);
      const contract = tenant
        ? allContracts.find(
            c => c.tenant_id === tenant.id && isActiveContractStatus(c.status),
          )
        : null;
      const house = contract ? housesById.get(contract.house_id as string) : null;
      const property = house ? propertiesById.get(house.property_id as string) : null;

      const details = {
        tenantName: tenant?.name,
        tenantPhone: tenant?.phone,
        propertyName: property?.name,
        houseNumber: house?.house_number,
      };

      await generateAndSharePromoVoucher(promo as any, selectedBusiness as any, details);
    } catch (error: any) {
      console.error('Error sharing promo PDF:', error);
      showSnackbar(error.message || 'Failed to generate PDF', 'error');
    }
  };

  const handleApplyPromo = async () => {
    if (!selectedPromotion || !selectedBusiness) return;

    // Check validity
    const now = formatDateForDB(new Date());
    if (!selectedPromotion.is_active) {
      showSnackbar('This adjustment template has been deactivated.', 'warning');
      return;
    }
    if (selectedPromotion.valid_from && selectedPromotion.valid_from > now) {
      showSnackbar(
        `This adjustment will be valid from ${new Date(selectedPromotion.valid_from).toLocaleDateString()}.`,
        'info',
      );
      return;
    }
    if (selectedPromotion.valid_until && selectedPromotion.valid_until < now) {
      showSnackbar('This adjustment template has expired.', 'warning');
      return;
    }

    // Handle Full Month Promo Logic (Multi-Tenant + Transfer)
    if (selectedPromotion.type === 'full_month') {
      if (selectedTenantIds.length === 0) {
        showSnackbar('Please select at least one tenant to apply the waiver.', 'error');
        return;
      }

      const sourceMonth = new Date(sourceDate).getMonth() + 1;
      const sourceYear = new Date(sourceDate).getFullYear();
      const targetMonth = new Date(targetDate).getMonth() + 1;
      const targetYear = new Date(targetDate).getFullYear();

      setApplyLoading(true);
      try {
        const mutations: BatchMutation[] = [];
        for (const tenantId of selectedTenantIds) {
          const tenant = tenantsById.get(tenantId as string);
          if (!tenant) continue;

          const contract = (contractsByTenant.get(tenant.id) || []).find((c: any) =>
            isActiveContractStatus(c.status),
          );
          if (!contract) continue;

          const rentAmount = parseFloat(String(contract.rent_amount)) || 0;
          const calculatedAmount = calculateAdjustment(selectedPromotion, rentAmount);

          // 1. Create the Promo Receipt for the Source Month
          const receiptId = generateUUID();
          mutations.push({
            tableName: 'receipts',
            operation: 'INSERT',
            payload: {
              id: receiptId,
              amount: calculatedAmount,
              payment_method: 'promo',
              payment_date: formatDateForDB(new Date()),
              payment_period: { month: sourceMonth, year: sourceYear },
              type: 'promo',
              status: 'promo',
              notes: `Applied adjustment: ${selectedPromotion.code} (${formatPromoAmount(selectedPromotion)})`,
              tenant_id: tenant.id,
              contract_id: contract.id,
              business_id: selectedBusiness?.id || '',
              user_id: user?.id,
              promotion_id: selectedPromotion.id,
              is_refunded: false,
              refunded_amount: 0,
            },
          });

          // 2. Transfer their Rent Receipts from Source to Target Month
          const periodRentReceipts = (receiptsByTenant.get(tenant.id) || []).filter(
            (r: any) => {
              // Check if it's conceptually rent
              const p = safeParseJSON<{ month?: number; year?: number }>(
                r.payment_period as any,
                {},
              );
              return p?.month === sourceMonth && p?.year === sourceYear;
            },
          );

          periodRentReceipts.forEach(r => {
            mutations.push({
              tableName: 'receipts',
              operation: 'UPDATE',
              rowId: r.id,
              payload: {
                payment_period: {
                  month: targetMonth,
                  year: targetYear,
                },
                notes: `${r.notes || ''} (Transferred from ${sourceMonth}/${sourceYear} via Promo)`,
              },
            });
          });
        }

        if (mutations.length > 0 && batch) {
          await batch(mutations);
        }

        showSnackbar(
          'Waivers applied and rent payments transferred successfully.',
          'success',
        );
        setSelectedPromotion(null);
        setSelectedTenantIds([]);
        setApplyPromoStep(1);
      } catch (error: any) {
        console.error('Error applying promos:', error);
        showSnackbar(error.message || 'Failed to apply adjustments.', 'error');
      } finally {
        setApplyLoading(false);
      }
      return;
    }

    // Standard Single-Tenant Logic for Fixed/Percentage Promos
    if (!selectedTenantId) {
      showSnackbar('Please select a tenant', 'error');
      return;
    }

    try {
      setApplyLoading(true);

      // Find active contract for tenant
      const contract = (contractsByTenant.get(selectedTenantId) || []).find((c: any) =>
        isActiveContractStatus(c.status),
      );

      if (!contract) {
        showSnackbar('No active contract found for this tenant', 'error');
        return;
      }

      // Enforce scope restrictions
      if (
        selectedPromotion.scope === 'tenant' &&
        selectedPromotion.tenant_id !== selectedTenantId
      ) {
        const tenant = tenantsById.get(selectedPromotion.tenant_id as string);
        showSnackbar(
          `This adjustment template is restricted to ${tenant ? tenant.name : 'another tenant'}.`,
          'warning',
        );
        return;
      }

      if (selectedPromotion.scope === 'property') {
        const house = housesById.get(contract.house_id as string);
        if (house?.property_id !== selectedPromotion.property_id) {
          const property = propertiesById.get(selectedPromotion.property_id as string);
          showSnackbar(
            `This adjustment template is restricted to ${property ? property.name : 'another property'}.`,
            'warning',
          );
          return;
        }
      }

      const rentAmount = parseFloat(String(contract.rent_amount)) || 0;
      const calculatedAmount = calculateAdjustment(selectedPromotion, rentAmount);

      const sourceMonth = new Date(sourceDate).getMonth() + 1;
      const sourceYear = new Date(sourceDate).getFullYear();

      // Find existing receipts for this period to check if we should update statuses
      const periodReceipts = (receiptsByTenant.get(selectedTenantId) || []).filter(
        (r: any) => {
          if (r.contract_id !== contract.id) return false;
          const p = safeParseJSON<{ month?: number; year?: number }>(
            r.payment_period as any,
            {},
          );
          return p?.month === sourceMonth && p?.year === sourceYear;
        },
      );

      const existingPaidAmount = periodReceipts.reduce(
        (sum, r) => sum + (parseFloat(String(r.amount)) || 0),
        0,
      );
      const isNowFullyPaid = existingPaidAmount + calculatedAmount >= rentAmount - 0.1; // Tolerance

      const mutations: BatchMutation[] = [];
      const receiptId = generateUUID();
      mutations.push({
        tableName: 'receipts',
        operation: 'INSERT',
        payload: {
          id: receiptId,
          amount: calculatedAmount,
          payment_method: 'promo',
          payment_date: formatDateForDB(new Date()),
          payment_period: { month: sourceMonth, year: sourceYear },
          type: 'promo',
          status: 'promo',
          notes: `Applied adjustment: ${selectedPromotion.code} (${formatPromoAmount(selectedPromotion)})`,
          tenant_id: selectedTenantId,
          contract_id: contract.id,
          business_id: selectedBusiness.id,
          user_id: user?.id,
          promotion_id: selectedPromotion.id,
          is_refunded: false,
          refunded_amount: 0,
        },
      });

      // Update partial receipts to paid if balance is cleared
      if (isNowFullyPaid) {
        (receiptsByContract.get(contract.id) || []).forEach((r: any) => {
          if (r.status === 'partial') {
            mutations.push({
              tableName: 'receipts',
              operation: 'UPDATE',
              rowId: r.id,
              payload: { status: 'paid' },
            });
          }
        });
      }

      if (batch) {
        await batch(mutations);
      }

      setApplyPromoModalVisible(false);
      showSnackbar('Adjustment applied successfully', 'success');
    } catch (error: any) {
      console.error('Error applying promo:', error);
      showSnackbar(error.message || 'Failed to apply adjustment', 'error');
    } finally {
      setApplyLoading(false);
    }
  };

  const handleDeletePromo = (id: string) => {
    setDeletePromoId(id);
    setShowDeleteConfirm(true);
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePromoId, setDeletePromoId] = useState<string | null>(null);

  const handleSharePromo = async () => {
    const promo = sharingPromo || selectedPromotion;
    if (!promo) return;

    try {
      const tenantName = shareSelectedTenantId
        ? tenantsById.get(shareSelectedTenantId as string)?.name
        : '';
      const message = `Hello${tenantName ? ` ${tenantName}` : ''}, here is a rent adjustment voucher for you:
  
  Code: ${promo.code}
  Value: ${formatPromoAmount(promo)}
  ${promo.description ? `Description: ${promo.description}` : ''}
  ${promo.valid_until ? `Valid until: ${new Date(promo.valid_until).toLocaleDateString()}` : ''}
  
  Powered by ${selectedBusiness?.name || 'Property Pass'}`;

      await Share.share({
        title: `Share ${promo.code}`,
        message: message,
      });
    } catch (error: any) {
      console.error('Error sharing promo text:', error);
      showSnackbar(error.msg || 'Failed to share promo code', 'error');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View>
            <Text variant="headlineSmall" style={{ fontWeight: 'bold' }}>
              Promo Codes
            </Text>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              Manage tenants&apos; promo codes
            </Text>
          </View>
          <Button mode="contained" onPress={() => setPromoModalVisible(true)} icon="plus">
            Create
          </Button>
        </View>

        <FlatList
          data={allPromotions}
          keyExtractor={item => item.id}
          extraData={allPromotions}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Card
              style={styles.card}
              mode="outlined"
              onPress={() => handleViewPromo(item)}
            >
              <Card.Content style={styles.cardContent}>
                <View style={styles.tenantInfo}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                      {item.code}
                    </Text>
                    <Surface
                      elevation={0}
                      style={[
                        styles.typeBadge,
                        { backgroundColor: colors.primaryContainer },
                      ]}
                    >
                      <Text
                        variant="labelSmall"
                        style={{ color: colors.onPrimaryContainer }}
                      >
                        {(item.type || '').replace('_', ' ').toUpperCase()}
                      </Text>
                    </Surface>
                    {!item.is_active && (
                      <Surface
                        elevation={0}
                        style={[
                          styles.statusBadge,
                          { backgroundColor: colors.errorContainer },
                        ]}
                      >
                        <Text
                          variant="labelSmall"
                          style={{ color: colors.onErrorContainer }}
                        >
                          INACTIVE
                        </Text>
                      </Surface>
                    )}
                    {(() => {
                      const now = formatDateForDB(new Date());
                      if (item.valid_until && item.valid_until < now) {
                        return (
                          <Surface
                            elevation={0}
                            style={[
                              styles.statusBadge,
                              { backgroundColor: colors.errorContainer },
                            ]}
                          >
                            <Text
                              variant="labelSmall"
                              style={{ color: colors.onErrorContainer }}
                            >
                              EXPIRED
                            </Text>
                          </Surface>
                        );
                      }
                      if (item.valid_from && item.valid_from > now) {
                        return (
                          <Surface
                            elevation={0}
                            style={[
                              styles.statusBadge,
                              { backgroundColor: colors.secondaryContainer },
                            ]}
                          >
                            <Text
                              variant="labelSmall"
                              style={{ color: colors.onSecondaryContainer }}
                            >
                              UPCOMING
                            </Text>
                          </Surface>
                        );
                      }
                      return null;
                    })()}
                  </View>
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    {formatPromoAmount(item)}
                  </Text>
                  {(item.valid_from || item.valid_until) && (
                    <Text
                      variant="bodySmall"
                      style={{ color: colors.outline, fontSize: 10 }}
                    >
                      {formatDateRange(item.valid_from, item.valid_until, ' • ')}
                    </Text>
                  )}
                  {item.description && (
                    <Text
                      variant="bodySmall"
                      style={{ color: colors.onSurfaceVariant, fontStyle: 'italic' }}
                    >
                      {item.description}
                    </Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Menu
                    visible={menuVisibleId === item.id}
                    onDismiss={() => setMenuVisibleId(null)}
                    anchor={
                      <IconButton
                        icon="dots-vertical"
                        onPress={() => setMenuVisibleId(item.id)}
                      />
                    }
                  >
                    <Menu.Item
                      onPress={() => {
                        setSelectedPromotion(item);
                        setApplyPromoModalVisible(true);
                        setMenuVisibleId(null);
                      }}
                      leadingIcon="check-circle-outline"
                      title="Apply Adjustment"
                    />
                    <Menu.Item
                      onPress={() => {
                        setSharingPromo(item);
                        setShareSelectedTenantId(
                          item.scope === 'tenant' ? item.tenant_id || '' : '',
                        );
                        setShareModalVisible(true);
                        setMenuVisibleId(null);
                      }}
                      leadingIcon="share-variant"
                      title="Share Promo"
                    />
                    <Menu.Item
                      onPress={() => handleEditPromo(item)}
                      leadingIcon="pencil"
                      title="Edit Template"
                    />
                    <Menu.Item
                      onPress={() => handleDeletePromo(item.id)}
                      leadingIcon="delete"
                      title="Delete Template"
                      titleStyle={{ color: colors.error }}
                    />
                  </Menu>
                </View>
              </Card.Content>
            </Card>
          )}
          ListEmptyComponent={
            <EmptyState icon="ticket-outline" title="No promo codes created yet" />
          }
        />
      </View>

      {/* View Promo Modal */}
      <BaseModal
        visible={viewModalVisible}
        onDismiss={() => {
          setViewModalVisible(false);
          setViewingPromotion(null);
        }}
        title="Adjustment Template Details"
        subtitle={viewingPromotion?.code}
        actions={[
          {
            label: 'Edit',
            onPress: () => viewingPromotion && handleEditPromo(viewingPromotion),
            mode: 'outlined',
            icon: 'pencil',
          },
          {
            label: 'Apply',
            onPress: () => {
              if (viewingPromotion) {
                setSelectedPromotion(viewingPromotion);
                setApplyPromoModalVisible(true);
                setViewModalVisible(false);
              }
            },
            mode: 'contained',
            icon: 'check-circle-outline',
          },
        ]}
      >
        {viewingPromotion && (
          <View>
            {/* Type & Status Header */}
            <View
              style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}
            >
              <Surface
                elevation={0}
                style={[
                  styles.typeBadge,
                  { backgroundColor: colors.primaryContainer, marginLeft: 0 },
                ]}
              >
                <Text
                  variant="labelMedium"
                  style={{ color: colors.onPrimaryContainer, paddingHorizontal: 4 }}
                >
                  {snakeCaseToTitleCase(viewingPromotion.type).toUpperCase()}
                </Text>
              </Surface>

              <View style={{ flexDirection: 'row', marginLeft: 'auto' }}>
                {!viewingPromotion.is_active && (
                  <Surface
                    elevation={0}
                    style={[
                      styles.statusBadge,
                      { backgroundColor: colors.errorContainer },
                    ]}
                  >
                    <Text variant="labelSmall" style={{ color: colors.onErrorContainer }}>
                      INACTIVE
                    </Text>
                  </Surface>
                )}
                {(() => {
                  const now = formatDateForDB(new Date());
                  if (
                    viewingPromotion.valid_until &&
                    viewingPromotion.valid_until < now
                  ) {
                    return (
                      <Surface
                        elevation={0}
                        style={[
                          styles.statusBadge,
                          { backgroundColor: colors.errorContainer },
                        ]}
                      >
                        <Text
                          variant="labelSmall"
                          style={{ color: colors.onErrorContainer }}
                        >
                          EXPIRED
                        </Text>
                      </Surface>
                    );
                  }
                  if (viewingPromotion.valid_from && viewingPromotion.valid_from > now) {
                    return (
                      <Surface
                        elevation={0}
                        style={[
                          styles.statusBadge,
                          { backgroundColor: colors.secondaryContainer },
                        ]}
                      >
                        <Text
                          variant="labelSmall"
                          style={{ color: colors.onSecondaryContainer }}
                        >
                          UPCOMING
                        </Text>
                      </Surface>
                    );
                  }
                  return (
                    <Surface
                      elevation={0}
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor: addOpacity(
                            (colors as any).success || '#16a34a',
                            0.15,
                          ),
                        },
                      ]}
                    >
                      <Text
                        variant="labelSmall"
                        style={{ color: (colors as any).success, fontWeight: 'bold' }}
                      >
                        ACTIVE
                      </Text>
                    </Surface>
                  );
                })()}
              </View>
            </View>

            {/* Value Highlight */}
            <Surface
              style={{
                padding: 20,
                borderRadius: 12,
                backgroundColor: colors.surfaceVariant,
                alignItems: 'center',
                marginBottom: 20,
              }}
              elevation={0}
            >
              <Text
                variant="labelSmall"
                style={{
                  color: colors.onSurfaceVariant,
                  letterSpacing: 1,
                  marginBottom: 4,
                }}
              >
                ADJUSTMENT VALUE
              </Text>
              <Text
                variant="displaySmall"
                style={{ fontWeight: 'bold', color: colors.primary }}
              >
                {viewingPromotion.type === 'full_month'
                  ? '100%'
                  : viewingPromotion.type === 'percentage'
                    ? `${viewingPromotion.amount}%`
                    : `KES ${viewingPromotion.amount?.toLocaleString()}`}
              </Text>
              <Text
                variant="bodyMedium"
                style={{ color: colors.onSurfaceVariant, marginTop: 4 }}
              >
                {viewingPromotion.type === 'full_month'
                  ? 'Full Month Rent Waiver'
                  : viewingPromotion.type === 'percentage'
                    ? 'Off Total Rent'
                    : 'Fixed Deduction'}
              </Text>
            </Surface>

            {/* Details List */}
            <List.Section>
              <List.Item
                title="Target Scope"
                description={
                  viewingPromotion.scope === 'business'
                    ? 'Global Adjustment (All Tenants)'
                    : viewingPromotion.scope === 'property'
                      ? `Restricted to Property: ${propertiesById.get(viewingPromotion.property_id as string)?.name || 'Unknown'}`
                      : `Personalized for Tenant: ${tenantsById.get(viewingPromotion.tenant_id as string)?.name || 'Unknown'}`
                }
                left={props => (
                  <List.Icon
                    {...props}
                    icon={
                      viewingPromotion.scope === 'business'
                        ? 'office-building'
                        : viewingPromotion.scope === 'property'
                          ? 'home-city'
                          : 'account'
                    }
                  />
                )}
              />
              <Divider style={{ marginHorizontal: 16 }} />
              <List.Item
                title="Validity Period"
                description={
                  viewingPromotion.valid_from || viewingPromotion.valid_until
                    ? `${viewingPromotion.valid_from ? `From ${new Date(viewingPromotion.valid_from).toLocaleDateString()}` : 'Indefinite'}${viewingPromotion.valid_until ? ` until ${new Date(viewingPromotion.valid_until).toLocaleDateString()}` : ''}`
                    : 'Always Valid'
                }
                left={props => <List.Icon {...props} icon="calendar-clock" />}
              />
              <Divider style={{ marginHorizontal: 16 }} />
              {viewingPromotion.description && (
                <List.Item
                  title="Description"
                  description={viewingPromotion.description}
                  descriptionNumberOfLines={4}
                  left={props => <List.Icon {...props} icon="text-box-outline" />}
                />
              )}
            </List.Section>
          </View>
        )}
      </BaseModal>

      {/* Create Promo Modal */}
      <BaseModal
        visible={promoModalVisible}
        onDismiss={() => {
          setPromoModalVisible(false);
          setEditingPromoId(null);
          setPromoStep(1);
          resetNewPromotion();
        }}
        title={editingPromoId ? 'Edit Template' : 'Create Template'}
        scrollable={true}
        subtitle={`Step ${promoStep} of 3: ${
          promoStep === 1 ? 'Details' : promoStep === 2 ? 'Targeting' : 'Finalize'
        }`}
        actions={
          promoStep === 1
            ? [
                {
                  label: 'Cancel',
                  onPress: () => setPromoModalVisible(false),
                  mode: 'outlined',
                },
                {
                  label: 'Next',
                  onPress: () => {
                    if (!newPromotion.code) {
                      showSnackbar('Please enter a template code', 'error');
                      return;
                    }
                    setPromoStep(2);
                  },
                  mode: 'contained',
                },
              ]
            : promoStep === 2
              ? [
                  {
                    label: 'Back',
                    onPress: () => setPromoStep(1),
                    mode: 'outlined',
                  },
                  {
                    label: 'Next',
                    onPress: () => {
                      if (
                        newPromotion.scope === 'property' &&
                        !newPromotion.property_id
                      ) {
                        showSnackbar('Please select a property', 'error');
                        return;
                      }
                      if (newPromotion.scope === 'tenant' && !newPromotion.tenant_id) {
                        showSnackbar('Please select a tenant', 'error');
                        return;
                      }
                      setPromoStep(3);
                    },
                    mode: 'contained',
                  },
                ]
              : [
                  {
                    label: 'Back',
                    onPress: () => setPromoStep(2),
                    mode: 'outlined',
                  },
                  {
                    label: editingPromoId ? 'Update' : 'Create',
                    onPress: handleCreatePromo,
                    mode: 'contained',
                    loading: loading,
                    disabled: loading,
                  },
                ]
        }
      >
        <View style={{ paddingTop: 16 }}>
          {promoStep === 1 && (
            <View>
              <View style={{ marginBottom: 16 }}>
                <Text variant="labelMedium" style={{ marginBottom: 8 }}>
                  Adjustment Type
                </Text>
                <Menu
                  visible={adjustmentTypeMenuVisible}
                  onDismiss={() => setAdjustmentTypeMenuVisible(false)}
                  anchor={
                    <Button
                      mode="outlined"
                      onPress={() => setAdjustmentTypeMenuVisible(true)}
                      icon="chevron-down"
                      contentStyle={{ flexDirection: 'row-reverse' }}
                    >
                      {newPromotion.type.replace('_', ' ').toUpperCase()}
                    </Button>
                  }
                >
                  <Menu.Item
                    onPress={() => {
                      setNewPromotion(prev => ({ ...prev, type: 'fixed' }));
                      setAdjustmentTypeMenuVisible(false);
                    }}
                    title="Fixed Amount"
                  />
                  <Menu.Item
                    onPress={() => {
                      setNewPromotion(prev => ({ ...prev, type: 'percentage' }));
                      setAdjustmentTypeMenuVisible(false);
                    }}
                    title="Percentage (%)"
                  />
                  <Menu.Item
                    onPress={() => {
                      setNewPromotion(prev => ({ ...prev, type: 'full_month' }));
                      setAdjustmentTypeMenuVisible(false);
                    }}
                    title="Full Month Rent"
                  />
                </Menu>
              </View>

              <TextInput
                label="Template Code (e.g. EBIRD500)"
                value={newPromotion.code}
                onChangeText={text => setNewPromotion(prev => ({ ...prev, code: text }))}
                autoCapitalize="characters"
                placeholder="Unique identifier"
                style={{ marginBottom: 16 }}
              />

              {newPromotion.type !== 'full_month' && (
                <TextInput
                  label={newPromotion.type === 'percentage' ? 'Percentage (%)' : 'Amount'}
                  value={newPromotion.amount}
                  onChangeText={text =>
                    setNewPromotion(prev => ({ ...prev, amount: text }))
                  }
                  keyboardType="decimal-pad"
                  style={{ marginBottom: 16 }}
                />
              )}
            </View>
          )}

          {promoStep === 2 && (
            <View>
              <View style={{ marginBottom: 16 }}>
                <Text variant="labelMedium" style={{ marginBottom: 8 }}>
                  Adjustment Scope
                </Text>
                <SegmentedButtons
                  value={newPromotion.scope}
                  onValueChange={value =>
                    setNewPromotion(prev => ({
                      ...prev,
                      scope: value as 'business' | 'property' | 'tenant',
                      property_id: value === 'property' ? prev.property_id : null,
                      tenant_id: value === 'tenant' ? prev.tenant_id : null,
                    }))
                  }
                  buttons={[
                    { value: 'business', label: 'Business', icon: 'office-building' },
                    { value: 'property', label: 'Property', icon: 'home-city' },
                    { value: 'tenant', label: 'Tenant', icon: 'account' },
                  ]}
                />
              </View>

              {newPromotion.scope === 'property' && (
                <View style={{ marginBottom: 16 }}>
                  <Text
                    variant="labelMedium"
                    style={{ marginBottom: 8, color: colors.primary }}
                  >
                    Select Linked Property:
                  </Text>
                  <Button
                    mode="outlined"
                    onPress={() => {
                      setPropertySearch('');
                      setShowPropertyModal(true);
                    }}
                    style={{ backgroundColor: colors.surface }}
                    icon="home-city-outline"
                  >
                    {newPromotion.property_id
                      ? propertiesById.get(newPromotion.property_id as string)?.name
                      : 'Choose Property'}
                  </Button>
                </View>
              )}

              {newPromotion.scope === 'tenant' && (
                <View style={{ marginBottom: 16 }}>
                  <Text
                    variant="labelMedium"
                    style={{ marginBottom: 8, color: colors.primary }}
                  >
                    Select Linked Tenant:
                  </Text>
                  <Button
                    mode="outlined"
                    onPress={() => {
                      setModalSource('create');
                      setShowTenantModal(true);
                    }}
                    style={{ backgroundColor: colors.surface }}
                    icon="account-outline"
                  >
                    {newPromotion.tenant_id
                      ? tenantsById.get(newPromotion.tenant_id as string)?.name
                      : 'Choose Tenant'}
                  </Button>
                </View>
              )}

              {newPromotion.scope === 'business' && (
                <View
                  style={{
                    padding: 16,
                    backgroundColor: colors.surfaceVariant,
                    borderRadius: 8,
                  }}
                >
                  <MaterialCommunityIcons
                    name="information-outline"
                    size={20}
                    color={colors.primary}
                  />
                  <Text variant="bodySmall" style={{ marginTop: 4 }}>
                    This adjustment will be available for all tenants in your business.
                  </Text>
                </View>
              )}
            </View>
          )}

          {promoStep === 3 && (
            <View>
              <TextInput
                label="Internal Description"
                value={newPromotion.description}
                onChangeText={text =>
                  setNewPromotion(prev => ({ ...prev, description: text }))
                }
                placeholder="e.g. Early bird discount for 2024"
                multiline
                style={{ marginBottom: 16 }}
              />

              <Surface
                style={{
                  padding: 16,
                  borderRadius: 8,
                  backgroundColor: colors.surfaceVariant,
                  marginBottom: 16,
                }}
                elevation={0}
              >
                <Text variant="titleSmall" style={{ marginBottom: 8 }}>
                  Configuration
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}
                >
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    Code:
                  </Text>
                  <Text variant="bodySmall" style={{ fontWeight: 'bold' }}>
                    {newPromotion.code || 'N/A'}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}
                >
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    Type:
                  </Text>
                  <Text variant="bodySmall" style={{ textTransform: 'uppercase' }}>
                    {newPromotion.type.replace('_', ' ')}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}
                >
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    Value:
                  </Text>
                  <Text variant="bodySmall">
                    {newPromotion.type === 'full_month'
                      ? 'Full Month Waiver'
                      : newPromotion.type === 'percentage'
                        ? `${newPromotion.amount}% Discount`
                        : `KES ${newPromotion.amount} Deduction`}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    Target:
                  </Text>
                  <Text variant="bodySmall" style={{ textTransform: 'capitalize' }}>
                    {newPromotion.scope}
                    {newPromotion.scope === 'property' &&
                      ` (${propertiesById.get(newPromotion.property_id as string)?.name || 'None'})`}
                    {newPromotion.scope === 'tenant' &&
                      ` (${tenantsById.get(newPromotion.tenant_id as string)?.name || 'None'})`}
                  </Text>
                </View>
              </Surface>

              <View style={{ marginBottom: 16 }}>
                <Text variant="labelMedium" style={{ marginBottom: 8 }}>
                  Validity Period (Optional)
                </Text>
                <View style={{ gap: 8 }}>
                  <DatePicker
                    label="Starts From"
                    value={newPromotion.valid_from}
                    onChange={date =>
                      setNewPromotion(prev => ({ ...prev, valid_from: date }))
                    }
                    maximumDate={null}
                  />
                  <DatePicker
                    label="Expires On"
                    value={newPromotion.valid_until}
                    onChange={date =>
                      setNewPromotion(prev => ({ ...prev, valid_until: date }))
                    }
                    maximumDate={null}
                  />
                </View>
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 16,
                }}
              >
                <View>
                  <Text variant="bodyMedium">Active Status</Text>
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    Allow this template to be applied
                  </Text>
                </View>
                <Switch
                  value={newPromotion.is_active}
                  onValueChange={value =>
                    setNewPromotion(prev => ({ ...prev, is_active: value }))
                  }
                />
              </View>
            </View>
          )}
        </View>
      </BaseModal>

      {/* Apply Promo Modal */}
      <BaseModal
        visible={applyPromoModalVisible}
        onDismiss={() => {
          setApplyPromoModalVisible(false);
          setSelectedTenantId('');
          setSelectedTenantIds([]);
          setApplyPromoStep(1);
        }}
        title={`Apply ${selectedPromotion?.code || 'Adjustment'}`}
        scrollable={true}
        subtitle={
          selectedPromotion?.type === 'full_month'
            ? `Step ${applyPromoStep} of 3: ${applyPromoStep === 1 ? 'Source Month' : applyPromoStep === 2 ? 'Select Tenants' : 'Transfer'}`
            : 'Select a tenant and period'
        }
        actions={
          selectedPromotion?.type === 'full_month'
            ? applyPromoStep === 1
              ? [
                  {
                    label: 'Cancel',
                    onPress: () => {
                      setApplyPromoModalVisible(false);
                      setSelectedTenantId('');
                      setSelectedTenantIds([]);
                      setApplyPromoStep(1);
                    },
                    mode: 'outlined' as any,
                  },
                  {
                    label: 'Next',
                    onPress: () => {
                      if (selectedTenantIds.length === 0) {
                        setSelectedTenantIds(eligibleTenants.map(t => t.tenant.id));
                      }
                      setApplyPromoStep(2);
                    },
                    mode: 'contained' as any,
                  },
                ]
              : applyPromoStep === 2
                ? [
                    {
                      label: 'Back',
                      onPress: () => setApplyPromoStep(1),
                      mode: 'outlined' as any,
                    },
                    {
                      label: 'Next',
                      onPress: () => {
                        if (selectedTenantIds.length === 0) {
                          showSnackbar('Please select at least one tenant', 'error');
                          return;
                        }
                        setApplyPromoStep(3);
                      },
                      mode: 'contained' as any,
                    },
                  ]
                : [
                    {
                      label: 'Back',
                      onPress: () => setApplyPromoStep(2),
                      mode: 'outlined' as any,
                    },
                    {
                      label: 'Apply Promo',
                      onPress: handleApplyPromo,
                      mode: 'contained' as any,
                      loading: applyLoading,
                    },
                  ]
            : [
                {
                  label: 'Cancel',
                  onPress: () => {
                    setApplyPromoModalVisible(false);
                    setSelectedTenantId('');
                    setSelectedTenantIds([]);
                    setApplyPromoStep(1);
                  },
                  mode: 'outlined' as any,
                },
                {
                  label: 'Apply Promo',
                  onPress: handleApplyPromo,
                  mode: 'contained' as any,
                  loading: applyLoading,
                  disabled: !selectedTenantId,
                },
              ]
        }
      >
        {selectedPromotion && (
          <Surface
            style={[
              styles.card,
              { padding: 16, marginBottom: 16, marginHorizontal: 0, borderRadius: 0 },
            ]}
            elevation={1}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <View>
                <Text variant="bodyLarge" style={{ fontWeight: 'bold' }}>
                  {selectedPromotion.type === 'full_month'
                    ? 'Full Month Rent Waiver'
                    : selectedPromotion.type === 'percentage'
                      ? `${selectedPromotion.amount}% Discount`
                      : `KES ${selectedPromotion.amount} Deduction`}
                </Text>
                {selectedPromotion.description && (
                  <Text
                    variant="bodyMedium"
                    style={{ color: colors.onSurfaceVariant, marginTop: 4 }}
                  >
                    {selectedPromotion.description}
                  </Text>
                )}
              </View>
              <MaterialCommunityIcons
                name="ticket-percent"
                size={32}
                color={colors.primary}
              />
            </View>
          </Surface>
        )}
        <ScrollView>
          {(selectedPromotion?.type !== 'full_month' || applyPromoStep === 1) && (
            <View style={{ marginBottom: 16 }}>
              <DatePicker
                label={
                  selectedPromotion?.type === 'full_month'
                    ? 'Waive Rent For (Source Month)'
                    : 'Apply To Month'
                }
                value={sourceDate}
                onChange={date => date && setSourceDate(date)}
                mode="month"
              />
            </View>
          )}

          {selectedPromotion?.type === 'full_month' && applyPromoStep === 3 && (
            <View style={{ marginBottom: 24 }}>
              <DatePicker
                label="Transfer Future Payments To"
                value={targetDate}
                onChange={date => date && setTargetDate(date)}
                mode="month"
              />
            </View>
          )}

          {selectedPromotion?.type === 'full_month' && applyPromoStep === 2 && (
            <View style={{ marginBottom: 16 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <Text variant="labelMedium" style={{ color: colors.primary }}>
                  Select Tenants:
                </Text>
                {eligibleTenants.length > 0 && (
                  <Button
                    mode="text"
                    compact
                    onPress={() => {
                      if (selectedTenantIds.length === eligibleTenants.length) {
                        setSelectedTenantIds([]);
                      } else {
                        setSelectedTenantIds(eligibleTenants.map(t => t.tenant.id));
                      }
                    }}
                  >
                    {selectedTenantIds.length === eligibleTenants.length
                      ? 'Deselect All'
                      : 'Select All'}
                  </Button>
                )}
              </View>
              {eligibleTenants.length === 0 ? (
                <Surface
                  style={[styles.card, { padding: 16, alignItems: 'center' }]}
                  elevation={0}
                >
                  <Text
                    variant="bodyMedium"
                    style={{ color: colors.onSurfaceVariant, fontStyle: 'italic' }}
                  >
                    No active tenants found.
                  </Text>
                </Surface>
              ) : (
                <View style={{ overflow: 'hidden' }}>
                  {eligibleTenants.map(({ tenant, contract, paidAmount }, index) => {
                    const house = allHouses?.find(h => h.id === contract.house_id);
                    const property = house
                      ? allProperties?.find(p => p.id === house.property_id)
                      : null;

                    let description: React.ReactNode;
                    const propertyDescription =
                      property && house
                        ? `${property.name} • ${house.house_number}`
                        : 'Active Contract';

                    if (paidAmount > 0) {
                      description = `${propertyDescription} • Paid: KES ${paidAmount.toLocaleString()}`;
                    } else {
                      description = (
                        <Text variant="bodyMedium" style={{ color: colors.error }}>
                          {propertyDescription} • Unpaid
                        </Text>
                      );
                    }

                    const isSelected = selectedTenantIds.includes(tenant.id);

                    return (
                      <React.Fragment key={tenant.id}>
                        <List.Item
                          title={tenant.name}
                          description={description}
                          left={() => (
                            <Checkbox.Android
                              status={isSelected ? 'checked' : 'unchecked'}
                              onPress={() => {
                                setSelectedTenantIds(prev =>
                                  isSelected
                                    ? prev.filter(id => id !== tenant.id)
                                    : [...prev, tenant.id],
                                );
                              }}
                            />
                          )}
                          onPress={() => {
                            setSelectedTenantIds(prev =>
                              isSelected
                                ? prev.filter(id => id !== tenant.id)
                                : [...prev, tenant.id],
                            );
                          }}
                        />
                        {index < eligibleTenants.length - 1 && <Divider />}
                      </React.Fragment>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {selectedPromotion?.type !== 'full_month' && (
            <View style={{ marginBottom: 16 }}>
              <Text
                variant="labelMedium"
                style={{ marginBottom: 8, color: colors.primary }}
              >
                Target Tenant:
              </Text>
              <Button
                mode="outlined"
                onPress={() => {
                  setModalSource('apply');
                  setShowTenantModal(true);
                }}
                style={{ backgroundColor: colors.surface }}
                icon="account-outline"
              >
                {selectedTenantId
                  ? tenantsById.get(selectedTenantId as string)?.name
                  : 'Choose Tenant to Apply To'}
              </Button>
            </View>
          )}
        </ScrollView>
      </BaseModal>

      {/* Share Promo Modal */}
      <BaseModal
        visible={shareModalVisible}
        onDismiss={() => {
          setShareModalVisible(false);
          setShareSelectedTenantId('');
        }}
        title="Share Promo Code"
        subtitle="Send this code to your tenants"
        actions={[
          {
            label: 'Share PDF',
            onPress: handleShareAsPDF,
            mode: 'outlined',
          },
          {
            label: 'Share Now',
            onPress: handleSharePromo,
            mode: 'contained',
          },
        ]}
      >
        <View>
          <Text
            variant="bodySmall"
            style={{ marginBottom: 8, color: colors.onSurfaceVariant }}
          >
            Personalize for a tenant (Optional):
          </Text>
          <Button
            mode="outlined"
            onPress={() => {
              setModalSource('share');
              setShowTenantModal(true);
            }}
            style={{ backgroundColor: colors.surface, marginBottom: 16 }}
            icon="account-outline"
          >
            {shareSelectedTenantId
              ? tenantsById.get(shareSelectedTenantId as string)?.name
              : 'None (General Share)'}
          </Button>

          {sharingPromo && (
            <View style={styles.shareCardContainer}>
              <View
                style={[
                  styles.promoVisualCard,
                  { elevation: 4, backgroundColor: colors.primary },
                ]}
              >
                <View style={styles.cardPattern}>
                  <MaterialCommunityIcons
                    name="ticket-percent"
                    size={80}
                    color="rgba(255,255,255,0.2)"
                  />
                </View>
                <View style={styles.cardHeader}>
                  <View>
                    <Text variant="labelLarge" style={styles.cardLabel}>
                      OFFICIAL PROMO
                    </Text>
                    {shareSelectedTenantId && (
                      <Text
                        variant="labelSmall"
                        style={{ color: colors.onPrimary, opacity: 0.8 }}
                      >
                        For: {tenantsById.get(shareSelectedTenantId as string)?.name}
                      </Text>
                    )}
                  </View>
                  <MaterialCommunityIcons
                    name="rhombus-split"
                    size={24}
                    color={colors.onPrimary}
                  />
                </View>
                <View style={styles.cardMain}>
                  <Text
                    variant="displaySmall"
                    style={[styles.cardCode, { color: colors.onPrimary }]}
                  >
                    {sharingPromo.code}
                  </Text>
                  <Text
                    variant="headlineSmall"
                    style={[styles.cardAmount, { color: colors.onPrimary }]}
                  >
                    {formatPromoAmount(sharingPromo)}
                  </Text>
                  {shareSelectedTenantId &&
                    (() => {
                      const tenant = tenantsById.get(shareSelectedTenantId as string);
                      const contract = tenant
                        ? (contractsByTenant.get(tenant.id) || []).find((c: any) =>
                            isActiveContractStatus(c.status),
                          )
                        : null;
                      const house = contract
                        ? housesById.get(contract.house_id as string)
                        : null;
                      const property = house
                        ? propertiesById.get(house.property_id as string)
                        : null;
                      return property ? (
                        <Text
                          variant="labelSmall"
                          style={{
                            color: colors.onPrimary,
                            marginTop: 4,
                            opacity: 0.7,
                          }}
                        >
                          Valid at {property.name}{' '}
                          {house ? `(${house.house_number})` : ''}
                        </Text>
                      ) : null;
                    })()}
                  <View
                    style={[
                      styles.dashLine,
                      { backgroundColor: addOpacity(colors.onPrimary, 0.3) },
                    ]}
                  />
                  <Text
                    variant="bodySmall"
                    style={[
                      styles.cardDescription,
                      { color: colors.onPrimary, opacity: 0.7 },
                    ]}
                    numberOfLines={2}
                  >
                    {sharingPromo.description ||
                      'Apply this code for a discount on your next rent payment!'}
                  </Text>
                </View>
                <View style={styles.cardFooter}>
                  <Text
                    variant="labelSmall"
                    style={[styles.footerNote, { color: colors.onPrimary, opacity: 0.5 }]}
                  >
                    {selectedBusiness?.name} Promo • {new Date().toLocaleDateString()}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>
      </BaseModal>
      <BaseModal
        visible={showPropertyModal}
        onDismiss={() => setShowPropertyModal(false)}
        title="Select Property"
        subtitle="Manage your properties"
        edgeToEdge
        maxHeight="80%"
        scrollable
        showCloseButton
        search={{
          value: propertySearch,
          onChangeText: setPropertySearch,
          placeholder: 'Search properties...',
        }}
      >
        <View>
          {allProperties
            .filter(p => p.name.toLowerCase().includes(propertySearch.toLowerCase()))
            .map(property => (
              <React.Fragment key={property.id}>
                <List.Item
                  title={property.name}
                  onPress={() => selectProperty(property)}
                />
                <Divider />
              </React.Fragment>
            ))}
        </View>
      </BaseModal>

      <SelectTenantModal
        visible={showTenantModal}
        onDismiss={() => setShowTenantModal(false)}
        tenants={allTenants}
        contracts={allContracts}
        houses={allHouses}
        properties={allProperties}
        includeNone={modalSource === 'share' || modalSource === 'create'}
        onSelect={selection => {
          if (Array.isArray(selection)) return; // Should not happen in single-select modes

          const tenant = selection as any;
          if (modalSource === 'share') {
            setShareSelectedTenantId(tenant?.id || '');
          } else if (modalSource === 'create') {
            setNewPromotion(prev => ({ ...prev, tenant_id: tenant?.id || null }));
          } else if (modalSource === 'apply') {
            setSelectedTenantId(tenant?.id || '');
          }
          setShowTenantModal(false);
        }}
        selectedId={
          modalSource === 'share'
            ? shareSelectedTenantId
            : modalSource === 'create'
              ? (newPromotion.tenant_id as any)
              : modalSource === 'apply'
                ? selectedTenantId
                : undefined
        }
      />

      <BaseModal
        mode="confirm"
        visible={showDeleteConfirm}
        onDismiss={() => {
          setShowDeleteConfirm(false);
          setDeletePromoId(null);
        }}
        onConfirm={async () => {
          if (!deletePromoId) return;
          try {
            await deleteRecord('promotions', deletePromoId);
            showSnackbar('Adjustment template deleted successfully', 'success');
            setViewModalVisible(false);
          } catch (error) {
            console.error('Error deleting promo:', error);
            showSnackbar('Failed to delete adjustment template', 'error');
          } finally {
            setShowDeleteConfirm(false);
            setDeletePromoId(null);
          }
        }}
        title="Delete Template"
        message="Are you sure you want to delete this adjustment template?"
        confirmText="Delete"
        destructive={true}
      />
    </View>
  );
}

function formatPromoAmount(promo: Promotion): string {
  switch (promo.type) {
    case 'full_month':
      return 'Full Month Rent';
    case 'percentage':
      return `${promo.amount}% Discount`;
    default:
      return `${promo.amount?.toLocaleString()} Fixed`;
  }
}

function calculateAdjustment(promo: Promotion, rentAmount: number): number {
  switch (promo.type) {
    case 'full_month':
      return rentAmount;
    case 'percentage': {
      const pct = (promo.amount || 0) / 100;
      return rentAmount * pct;
    }
    default:
      return promo.amount || 0;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  listContent: {
    paddingBottom: 100,
  },
  card: {
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  cardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tenantInfo: {
    flex: 1,
  },
  typeBadge: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadge: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  shareCardContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  promoVisualCard: {
    width: '100%',
    aspectRatio: 1.6,
    borderRadius: 20,
    overflow: 'hidden',
    padding: 24,
    justifyContent: 'space-between',
  },
  cardPattern: {
    position: 'absolute',
    right: -20,
    top: -20,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLabel: {
    letterSpacing: 2,
  },
  cardMain: {
    alignItems: 'center',
  },
  cardCode: {
    fontWeight: 'bold',
    letterSpacing: 4,
  },
  cardAmount: {
    marginTop: 8,
  },
  dashLine: {
    width: '80%',
    height: 1,
    marginVertical: 12,
  },
  cardDescription: {
    textAlign: 'center',
  },
  cardFooter: {
    alignItems: 'center',
  },
  footerNote: {
    fontStyle: 'italic',
  },
});
