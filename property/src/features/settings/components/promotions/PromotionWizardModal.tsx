import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Button,
  Menu,
  SegmentedButtons,
  Surface,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import type { IndexMap } from '@/shared/hooks/useStore';
import type { Property, Tenant } from '@/shared/types/types';
import type { PromotionFormData } from './promotionHelpers';

export interface PromotionWizardModalProps {
  visible: boolean;
  isEditing: boolean;
  loading: boolean;
  promotion: PromotionFormData;
  setPromotion: React.Dispatch<React.SetStateAction<PromotionFormData>>;
  onDismiss: () => void;
  onSubmit: () => void;
  propertiesById: IndexMap<Property>;
  tenantsById: IndexMap<Tenant>;
  onOpenPropertyPicker: () => void;
  onOpenTenantPicker: () => void;
  colors: any;
  showSnackbar: (msg: string, type?: 'error' | 'success' | 'info' | 'warning') => void;
}

export default function PromotionWizardModal({
  visible,
  isEditing,
  loading,
  promotion,
  setPromotion,
  onDismiss,
  onSubmit,
  propertiesById,
  tenantsById,
  onOpenPropertyPicker,
  onOpenTenantPicker,
  colors,
  showSnackbar,
}: PromotionWizardModalProps) {
  const [promoStep, setPromoStep] = useState(1);
  const [adjustmentTypeMenuVisible, setAdjustmentTypeMenuVisible] = useState(false);

  const handleClose = () => {
    setPromoStep(1);
    onDismiss();
  };

  const actions =
    promoStep === 1
      ? [
          {
            label: 'Cancel',
            onPress: handleClose,
            mode: 'outlined' as const,
          },
          {
            label: 'Next',
            onPress: () => {
              if (!promotion.code?.trim()) {
                showSnackbar('Please enter a template code', 'error');
                return;
              }
              setPromoStep(2);
            },
            mode: 'contained' as const,
          },
        ]
      : promoStep === 2
        ? [
            {
              label: 'Back',
              onPress: () => setPromoStep(1),
              mode: 'outlined' as const,
            },
            {
              label: 'Next',
              onPress: () => {
                if (promotion.scope === 'property' && !promotion.property_id) {
                  showSnackbar('Please select a property', 'error');
                  return;
                }
                if (promotion.scope === 'tenant' && !promotion.tenant_id) {
                  showSnackbar('Please select a tenant', 'error');
                  return;
                }
                setPromoStep(3);
              },
              mode: 'contained' as const,
            },
          ]
        : [
            {
              label: 'Back',
              onPress: () => setPromoStep(2),
              mode: 'outlined' as const,
            },
            {
              label: isEditing ? 'Update' : 'Create',
              onPress: onSubmit,
              mode: 'contained' as const,
              loading: loading,
              disabled: loading,
            },
          ];

  return (
    <BaseModal
      visible={visible}
      onDismiss={handleClose}
      title={isEditing ? 'Edit Template' : 'Create Template'}
      scrollable={true}
      subtitle={`Step ${promoStep} of 3: ${
        promoStep === 1 ? 'Details' : promoStep === 2 ? 'Targeting' : 'Finalize'
      }`}
      actions={actions}
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
                    {promotion.type.replace('_', ' ').toUpperCase()}
                  </Button>
                }
              >
                <Menu.Item
                  onPress={() => {
                    setPromotion(prev => ({ ...prev, type: 'fixed' }));
                    setAdjustmentTypeMenuVisible(false);
                  }}
                  title="Fixed Amount"
                />
                <Menu.Item
                  onPress={() => {
                    setPromotion(prev => ({ ...prev, type: 'percentage' }));
                    setAdjustmentTypeMenuVisible(false);
                  }}
                  title="Percentage (%)"
                />
                <Menu.Item
                  onPress={() => {
                    setPromotion(prev => ({ ...prev, type: 'full_month' }));
                    setAdjustmentTypeMenuVisible(false);
                  }}
                  title="Full Month Rent"
                />
              </Menu>
            </View>

            <TextInput
              label="Template Code (e.g. EBIRD500)"
              value={promotion.code}
              onChangeText={text => setPromotion(prev => ({ ...prev, code: text }))}
              autoCapitalize="characters"
              placeholder="Unique identifier"
              style={{ marginBottom: 16 }}
            />

            {promotion.type !== 'full_month' && (
              <TextInput
                label={promotion.type === 'percentage' ? 'Percentage (%)' : 'Amount'}
                value={promotion.amount}
                onChangeText={text =>
                  setPromotion(prev => ({ ...prev, amount: text }))
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
                value={promotion.scope}
                onValueChange={value =>
                  setPromotion(prev => ({
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

            {promotion.scope === 'property' && (
              <View style={{ marginBottom: 16 }}>
                <Text
                  variant="labelMedium"
                  style={{ marginBottom: 8, color: colors.primary }}
                >
                  Select Linked Property:
                </Text>
                <Button
                  mode="outlined"
                  onPress={onOpenPropertyPicker}
                  style={{ backgroundColor: colors.surface }}
                  icon="home-city-outline"
                >
                  {promotion.property_id
                    ? propertiesById.get(promotion.property_id as string)?.name
                    : 'Choose Property'}
                </Button>
              </View>
            )}

            {promotion.scope === 'tenant' && (
              <View style={{ marginBottom: 16 }}>
                <Text
                  variant="labelMedium"
                  style={{ marginBottom: 8, color: colors.primary }}
                >
                  Select Linked Tenant:
                </Text>
                <Button
                  mode="outlined"
                  onPress={onOpenTenantPicker}
                  style={{ backgroundColor: colors.surface }}
                  icon="account-outline"
                >
                  {promotion.tenant_id
                    ? tenantsById.get(promotion.tenant_id as string)?.name
                    : 'Choose Tenant'}
                </Button>
              </View>
            )}

            {promotion.scope === 'business' && (
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
              value={promotion.description}
              onChangeText={text =>
                setPromotion(prev => ({ ...prev, description: text }))
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
                  {promotion.code || 'N/A'}
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
                  {promotion.type.replace('_', ' ')}
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
                  {promotion.type === 'full_month'
                    ? 'Full Month Waiver'
                    : promotion.type === 'percentage'
                      ? `${promotion.amount}% Discount`
                      : `KES ${promotion.amount} Deduction`}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  Target:
                </Text>
                <Text variant="bodySmall" style={{ textTransform: 'capitalize' }}>
                  {promotion.scope}
                  {promotion.scope === 'property' &&
                    ` (${propertiesById.get(promotion.property_id as string)?.name || 'None'})`}
                  {promotion.scope === 'tenant' &&
                    ` (${tenantsById.get(promotion.tenant_id as string)?.name || 'None'})`}
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
                  value={promotion.valid_from}
                  onChange={date =>
                    setPromotion(prev => ({ ...prev, valid_from: date }))
                  }
                  maximumDate={null}
                />
                <DatePicker
                  label="Expires On"
                  value={promotion.valid_until}
                  onChange={date =>
                    setPromotion(prev => ({ ...prev, valid_until: date }))
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
                value={promotion.is_active}
                onValueChange={value =>
                  setPromotion(prev => ({ ...prev, is_active: value }))
                }
              />
            </View>
          </View>
        )}
      </View>
    </BaseModal>
  );
}
