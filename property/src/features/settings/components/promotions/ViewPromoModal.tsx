import { StyleSheet, View } from 'react-native';
import { Divider, List, Surface, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import type { IndexMap } from '@/shared/hooks/useStore';
import type { Promotion, Property, Tenant } from '@/shared/types/types';
import { formatDateForDB } from '@/shared/utils/formatters';
import { addOpacity, snakeCaseToTitleCase } from '@/shared/utils/helper';

export interface ViewPromoModalProps {
  visible: boolean;
  promotion: Promotion | null;
  onDismiss: () => void;
  onEdit: (promo: Promotion) => void;
  onApply: (promo: Promotion) => void;
  colors: any;
  propertiesById: IndexMap<Property>;
  tenantsById: IndexMap<Tenant>;
}

export default function ViewPromoModal({
  visible,
  promotion,
  onDismiss,
  onEdit,
  onApply,
  colors,
  propertiesById,
  tenantsById,
}: ViewPromoModalProps) {
  if (!promotion) return null;

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Adjustment Template Details"
      subtitle={promotion.code}
      actions={[
        {
          label: 'Edit',
          onPress: () => onEdit(promotion),
          mode: 'outlined',
          icon: 'pencil',
        },
        {
          label: 'Apply',
          onPress: () => onApply(promotion),
          mode: 'contained',
          icon: 'check-circle-outline',
        },
      ]}
    >
      <View>
        {/* Type & Status Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
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
              {snakeCaseToTitleCase(promotion.type).toUpperCase()}
            </Text>
          </Surface>

          <View style={{ flexDirection: 'row', marginLeft: 'auto' }}>
            {!promotion.is_active && (
              <Surface
                elevation={0}
                style={[styles.statusBadge, { backgroundColor: colors.errorContainer }]}
              >
                <Text variant="labelSmall" style={{ color: colors.onErrorContainer }}>
                  INACTIVE
                </Text>
              </Surface>
            )}
            {(() => {
              const now = formatDateForDB(new Date());
              if (promotion.valid_until && promotion.valid_until < now) {
                return (
                  <Surface
                    elevation={0}
                    style={[
                      styles.statusBadge,
                      { backgroundColor: colors.errorContainer },
                    ]}
                  >
                    <Text variant="labelSmall" style={{ color: colors.onErrorContainer }}>
                      EXPIRED
                    </Text>
                  </Surface>
                );
              }
              if (promotion.valid_from && promotion.valid_from > now) {
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
                      backgroundColor: addOpacity(colors.success || '#16a34a', 0.15),
                    },
                  ]}
                >
                  <Text
                    variant="labelSmall"
                    style={{ color: colors.success || '#16a34a', fontWeight: 'bold' }}
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
            {promotion.type === 'full_month'
              ? '100%'
              : promotion.type === 'percentage'
                ? `${promotion.amount}%`
                : `KES ${promotion.amount?.toLocaleString()}`}
          </Text>
          <Text
            variant="bodyMedium"
            style={{ color: colors.onSurfaceVariant, marginTop: 4 }}
          >
            {promotion.type === 'full_month'
              ? 'Full Month Rent Waiver'
              : promotion.type === 'percentage'
                ? 'Off Total Rent'
                : 'Fixed Deduction'}
          </Text>
        </Surface>

        {/* Details List */}
        <List.Section>
          <List.Item
            title="Target Scope"
            description={
              promotion.scope === 'business'
                ? 'Global Adjustment (All Tenants)'
                : promotion.scope === 'property'
                  ? `Restricted to Property: ${propertiesById.get(promotion.property_id as string)?.name || 'Unknown'}`
                  : `Personalized for Tenant: ${tenantsById.get(promotion.tenant_id as string)?.name || 'Unknown'}`
            }
            left={props => (
              <List.Icon
                {...props}
                icon={
                  promotion.scope === 'business'
                    ? 'office-building'
                    : promotion.scope === 'property'
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
              promotion.valid_from || promotion.valid_until
                ? `${promotion.valid_from ? `From ${new Date(promotion.valid_from).toLocaleDateString()}` : 'Indefinite'}${promotion.valid_until ? ` until ${new Date(promotion.valid_until).toLocaleDateString()}` : ''}`
                : 'Always Valid'
            }
            left={props => <List.Icon {...props} icon="calendar-clock" />}
          />
          <Divider style={{ marginHorizontal: 16 }} />
          {promotion.description && (
            <List.Item
              title="Description"
              description={promotion.description}
              descriptionNumberOfLines={4}
              left={props => <List.Icon {...props} icon="text-box-outline" />}
            />
          )}
        </List.Section>
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 6,
  },
});
