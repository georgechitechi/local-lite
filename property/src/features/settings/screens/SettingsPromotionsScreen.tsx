import type { BatchMutation } from 'local-lite';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Share, StyleSheet, View } from 'react-native';
import { Button, Divider, List, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import SelectTenantModal from '@/features/tenants/components/SelectTenantModal';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
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
import { formatDateForDB } from '@/shared/utils/formatters';
import {
  generateUUID,
  safeParseJSON,
} from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import { generateAndSharePromoVoucher } from '@/templates/promoVoucherTemplate';

import ApplyPromoModal from '../components/promotions/ApplyPromoModal';
import PromotionCard from '../components/promotions/PromotionCard';
import PromotionWizardModal from '../components/promotions/PromotionWizardModal';
import {
  calculateAdjustment,
  formatPromoAmount,
  type PromotionFormData,
} from '../components/promotions/promotionHelpers';
import SharePromoModal from '../components/promotions/SharePromoModal';
import ViewPromoModal from '../components/promotions/ViewPromoModal';

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
  const [newPromotion, setNewPromotion] = useState<PromotionFormData>({
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePromoId, setDeletePromoId] = useState<string | null>(null);

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
        code: newPromotion.code,
        amount:
          newPromotion.type === 'full_month' ? 0 : parseFloat(newPromotion.amount),
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
    setPromoModalVisible(true);
    setMenuVisibleId(null);
    setViewModalVisible(false);
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
        setApplyPromoModalVisible(false);
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

      const contract = (contractsByTenant.get(selectedTenantId) || []).find((c: any) =>
        isActiveContractStatus(c.status),
      );

      if (!contract) {
        showSnackbar('No active contract found for this tenant', 'error');
        return;
      }

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
      const isNowFullyPaid = existingPaidAmount + calculatedAmount >= rentAmount - 0.1;

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
            <PromotionCard
              item={item}
              colors={colors}
              menuVisible={menuVisibleId === item.id}
              onOpenMenu={() => setMenuVisibleId(item.id)}
              onDismissMenu={() => setMenuVisibleId(null)}
              onView={() => handleViewPromo(item)}
              onApply={() => {
                setSelectedPromotion(item);
                setApplyPromoModalVisible(true);
              }}
              onShare={() => {
                setSharingPromo(item);
                setShareSelectedTenantId(
                  item.scope === 'tenant' ? item.tenant_id || '' : '',
                );
                setShareModalVisible(true);
              }}
              onEdit={() => handleEditPromo(item)}
              onDelete={() => handleDeletePromo(item.id)}
            />
          )}
          ListEmptyComponent={
            <EmptyState icon="ticket-outline" title="No promo codes created yet" />
          }
        />
      </View>

      {/* View Promo Modal */}
      <ViewPromoModal
        visible={viewModalVisible}
        promotion={viewingPromotion}
        onDismiss={() => {
          setViewModalVisible(false);
          setViewingPromotion(null);
        }}
        onEdit={handleEditPromo}
        onApply={promo => {
          setSelectedPromotion(promo);
          setApplyPromoModalVisible(true);
          setViewModalVisible(false);
        }}
        colors={colors}
        propertiesById={propertiesById}
        tenantsById={tenantsById}
      />

      {/* Promotion Wizard Modal (Create & Edit) */}
      <PromotionWizardModal
        visible={promoModalVisible}
        isEditing={!!editingPromoId}
        loading={loading}
        promotion={newPromotion}
        setPromotion={setNewPromotion}
        onDismiss={() => {
          setPromoModalVisible(false);
          setEditingPromoId(null);
          resetNewPromotion();
        }}
        onSubmit={handleCreatePromo}
        propertiesById={propertiesById}
        tenantsById={tenantsById}
        onOpenPropertyPicker={() => setShowPropertyModal(true)}
        onOpenTenantPicker={() => {
          setModalSource('create');
          setShowTenantModal(true);
        }}
        colors={colors}
        showSnackbar={showSnackbar}
      />

      {/* Apply Promo Modal */}
      <ApplyPromoModal
        visible={applyPromoModalVisible}
        onDismiss={() => setApplyPromoModalVisible(false)}
        selectedPromotion={selectedPromotion}
        applyPromoStep={applyPromoStep}
        setApplyPromoStep={setApplyPromoStep}
        selectedTenantId={selectedTenantId}
        setSelectedTenantId={setSelectedTenantId}
        selectedTenantIds={selectedTenantIds}
        setSelectedTenantIds={setSelectedTenantIds}
        sourceDate={sourceDate}
        setSourceDate={setSourceDate}
        targetDate={targetDate}
        setTargetDate={setTargetDate}
        eligibleTenants={eligibleTenants}
        allHouses={allHouses}
        allProperties={allProperties}
        tenantsById={tenantsById}
        onSelectTenant={() => {
          setModalSource('apply');
          setShowTenantModal(true);
        }}
        onApply={handleApplyPromo}
        loading={applyLoading}
        showSnackbar={showSnackbar}
      />

      {/* Share Promo Modal */}
      <SharePromoModal
        visible={shareModalVisible}
        onDismiss={() => {
          setShareModalVisible(false);
          setShareSelectedTenantId('');
        }}
        sharingPromo={sharingPromo}
        shareSelectedTenantId={shareSelectedTenantId}
        onSelectTenant={() => {
          setModalSource('share');
          setShowTenantModal(true);
        }}
        onSharePDF={handleShareAsPDF}
        onShareNow={handleSharePromo}
        tenantsById={tenantsById}
        contractsByTenant={contractsByTenant}
        housesById={housesById}
        propertiesById={propertiesById}
        selectedBusiness={selectedBusiness}
      />

      {/* Property Selection Modal */}
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

      {/* Tenant Selection Modal */}
      <SelectTenantModal
        visible={showTenantModal}
        onDismiss={() => setShowTenantModal(false)}
        tenants={allTenants}
        contracts={allContracts}
        houses={allHouses}
        properties={allProperties}
        includeNone={modalSource === 'share' || modalSource === 'create'}
        onSelect={selection => {
          if (Array.isArray(selection)) return;

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

      {/* Delete Confirmation Modal */}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  listContent: {
    paddingBottom: 100,
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
});
