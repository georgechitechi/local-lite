import { StyleSheet, View } from 'react-native';
import { Card, IconButton, Menu, Surface, Text } from 'react-native-paper';
import type { Promotion } from '@/shared/types/types';
import { formatDateForDB, formatDateRange } from '@/shared/utils/formatters';
import { formatPromoAmount } from './promotionHelpers';

export interface PromotionCardProps {
  item: Promotion;
  colors: any;
  menuVisible: boolean;
  onOpenMenu: () => void;
  onDismissMenu: () => void;
  onView: () => void;
  onApply: () => void;
  onShare: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function PromotionCard({
  item,
  colors,
  menuVisible,
  onOpenMenu,
  onDismissMenu,
  onView,
  onApply,
  onShare,
  onEdit,
  onDelete,
}: PromotionCardProps) {
  const now = formatDateForDB(new Date());

  return (
    <Card style={styles.card} mode="outlined" onPress={onView}>
      <Card.Content style={styles.cardContent}>
        <View style={styles.tenantInfo}>
          <View style={styles.headerRow}>
            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
              {item.code}
            </Text>
            <Surface
              elevation={0}
              style={[styles.typeBadge, { backgroundColor: colors.primaryContainer }]}
            >
              <Text variant="labelSmall" style={{ color: colors.onPrimaryContainer }}>
                {(item.type || '').replace('_', ' ').toUpperCase()}
              </Text>
            </Surface>
            {!item.is_active && (
              <Surface
                elevation={0}
                style={[styles.statusBadge, { backgroundColor: colors.errorContainer }]}
              >
                <Text variant="labelSmall" style={{ color: colors.onErrorContainer }}>
                  INACTIVE
                </Text>
              </Surface>
            )}
            {item.valid_until && item.valid_until < now && (
              <Surface
                elevation={0}
                style={[styles.statusBadge, { backgroundColor: colors.errorContainer }]}
              >
                <Text variant="labelSmall" style={{ color: colors.onErrorContainer }}>
                  EXPIRED
                </Text>
              </Surface>
            )}
            {item.valid_from && item.valid_from > now && (
              <Surface
                elevation={0}
                style={[
                  styles.statusBadge,
                  { backgroundColor: colors.secondaryContainer },
                ]}
              >
                <Text variant="labelSmall" style={{ color: colors.onSecondaryContainer }}>
                  UPCOMING
                </Text>
              </Surface>
            )}
          </View>
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            {formatPromoAmount(item)}
          </Text>
          {(item.valid_from || item.valid_until) && (
            <Text variant="bodySmall" style={{ color: colors.outline, fontSize: 10 }}>
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
            visible={menuVisible}
            onDismiss={onDismissMenu}
            anchor={<IconButton icon="dots-vertical" onPress={onOpenMenu} />}
          >
            <Menu.Item
              onPress={() => {
                onDismissMenu();
                onApply();
              }}
              leadingIcon="check-circle-outline"
              title="Apply Adjustment"
            />
            <Menu.Item
              onPress={() => {
                onDismissMenu();
                onShare();
              }}
              leadingIcon="share-variant"
              title="Share Promo"
            />
            <Menu.Item
              onPress={() => {
                onDismissMenu();
                onEdit();
              }}
              leadingIcon="pencil"
              title="Edit Template"
            />
            <Menu.Item
              onPress={() => {
                onDismissMenu();
                onDelete();
              }}
              leadingIcon="delete"
              title="Delete Template"
              titleStyle={{ color: colors.error }}
            />
          </Menu>
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 8,
  },
  cardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tenantInfo: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 6,
  },
});
