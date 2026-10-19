import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Checkbox, Divider, List, Surface, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import type { IndexMap } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { Promotion, Tenant } from '@/shared/types/types';

interface ApplyPromoModalProps {
  visible: boolean;
  onDismiss: () => void;
  selectedPromotion: Promotion | null;
  applyPromoStep: number;
  setApplyPromoStep: React.Dispatch<React.SetStateAction<number>>;
  selectedTenantId: string;
  setSelectedTenantId: (id: string) => void;
  selectedTenantIds: string[];
  setSelectedTenantIds: React.Dispatch<React.SetStateAction<string[]>>;
  sourceDate: string;
  setSourceDate: (date: string) => void;
  targetDate: string;
  setTargetDate: (date: string) => void;
  eligibleTenants: Array<{ tenant: any; contract: any; paidAmount: number }>;
  allHouses: any[];
  allProperties: any[];
  tenantsById: IndexMap<Tenant>;
  onSelectTenant: () => void;
  onApply: () => void;
  loading: boolean;
  showSnackbar: (msg: string, type?: 'info' | 'error' | 'success' | 'warning') => void;
}

export const ApplyPromoModal: React.FC<ApplyPromoModalProps> = ({
  visible,
  onDismiss,
  selectedPromotion,
  applyPromoStep,
  setApplyPromoStep,
  selectedTenantId,
  setSelectedTenantId,
  selectedTenantIds,
  setSelectedTenantIds,
  sourceDate,
  setSourceDate,
  targetDate,
  setTargetDate,
  eligibleTenants,
  allHouses,
  allProperties,
  tenantsById,
  onSelectTenant,
  onApply,
  loading,
  showSnackbar,
}) => {
  const colors = useThemeColors();

  const handleClose = () => {
    onDismiss();
    setSelectedTenantId('');
    setSelectedTenantIds([]);
    setApplyPromoStep(1);
  };

  const getActions = () => {
    if (selectedPromotion?.type === 'full_month') {
      if (applyPromoStep === 1) {
        return [
          {
            label: 'Cancel',
            onPress: handleClose,
            mode: 'outlined' as const,
          },
          {
            label: 'Next',
            onPress: () => {
              if (selectedTenantIds.length === 0) {
                setSelectedTenantIds(eligibleTenants.map(t => t.tenant.id));
              }
              setApplyPromoStep(2);
            },
            mode: 'contained' as const,
          },
        ];
      }
      if (applyPromoStep === 2) {
        return [
          {
            label: 'Back',
            onPress: () => setApplyPromoStep(1),
            mode: 'outlined' as const,
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
            mode: 'contained' as const,
          },
        ];
      }
      return [
        {
          label: 'Back',
          onPress: () => setApplyPromoStep(2),
          mode: 'outlined' as const,
        },
        {
          label: 'Apply Promo',
          onPress: onApply,
          mode: 'contained' as const,
          loading,
        },
      ];
    }

    return [
      {
        label: 'Cancel',
        onPress: handleClose,
        mode: 'outlined' as const,
      },
      {
        label: 'Apply Promo',
        onPress: onApply,
        mode: 'contained' as const,
        loading,
        disabled: !selectedTenantId,
      },
    ];
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={handleClose}
      title={`Apply ${selectedPromotion?.code || 'Adjustment'}`}
      scrollable={true}
      subtitle={
        selectedPromotion?.type === 'full_month'
          ? `Step ${applyPromoStep} of 3: ${applyPromoStep === 1 ? 'Source Month' : applyPromoStep === 2 ? 'Select Tenants' : 'Transfer'}`
          : 'Select a tenant and period'
      }
      actions={getActions()}
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
              onChange={(date: string | null) => date && setSourceDate(date)}
              mode="month"
            />
          </View>
        )}

        {selectedPromotion?.type === 'full_month' && applyPromoStep === 3 && (
          <View style={{ marginBottom: 24 }}>
            <DatePicker
              label="Transfer Future Payments To"
              value={targetDate}
              onChange={(date: string | null) => date && setTargetDate(date)}
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
              onPress={onSelectTenant}
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
  );
};

export default ApplyPromoModal;

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
  },
});
