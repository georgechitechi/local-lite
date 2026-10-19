import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import type { GroupMap, IndexMap } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { Contract, House, Promotion, Property, Tenant } from '@/shared/types/types';
import { addOpacity } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import { formatPromoAmount } from './promotionHelpers';

interface SharePromoModalProps {
  visible: boolean;
  onDismiss: () => void;
  sharingPromo: Promotion | null;
  shareSelectedTenantId: string;
  onSelectTenant: () => void;
  onSharePDF: () => void;
  onShareNow: () => void;
  tenantsById: IndexMap<Tenant>;
  contractsByTenant: GroupMap<Contract>;
  housesById: IndexMap<House>;
  propertiesById: IndexMap<Property>;
  selectedBusiness: any;
}

export const SharePromoModal: React.FC<SharePromoModalProps> = ({
  visible,
  onDismiss,
  sharingPromo,
  shareSelectedTenantId,
  onSelectTenant,
  onSharePDF,
  onShareNow,
  tenantsById,
  contractsByTenant,
  housesById,
  propertiesById,
  selectedBusiness,
}) => {
  const colors = useThemeColors();

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Share Promo Code"
      subtitle="Send this code to your tenants"
      actions={[
        {
          label: 'Share PDF',
          onPress: onSharePDF,
          mode: 'outlined',
        },
        {
          label: 'Share Now',
          onPress: onShareNow,
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
          onPress={onSelectTenant}
          style={{ backgroundColor: colors.surface, marginBottom: 16 }}
          icon="account-outline"
        >
          {shareSelectedTenantId
            ? tenantsById.get(shareSelectedTenantId)?.name
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
                      For: {tenantsById.get(shareSelectedTenantId)?.name}
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
                    const tenant = tenantsById.get(shareSelectedTenantId);
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
                        Valid at {property.name} {house ? `(${house.house_number})` : ''}
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
  );
};

export default SharePromoModal;

const styles = StyleSheet.create({
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
