import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { StyleSheet, View } from 'react-native';
import { IconButton, Menu, Surface, Text } from 'react-native-paper';
import FormattedText from '@/shared/components/FormattedText';
import SPressable from '@/shared/components/SlightPressable';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { parseNextOfKin } from '@/shared/services/contactsSync';
import { htmlToPlain } from '@/shared/services/templateService';
import type {
  ReminderCategoryType,
  ReminderLog,
  ReminderTenant,
} from '@/shared/types/types';
import type { Currency } from '@/shared/utils/formatters';
import { formatWithCurrency } from '@/shared/utils/formatters';

type Tenant = ReminderTenant;

interface ReminderCardProps {
  item: Tenant | ReminderLog;
  index: number;
  selectedCategory: ReminderCategoryType | null;
  defaultCurrency: Currency | null;
  reminderLogs: ReminderLog[];
  selectedDate: Date;
  menuVisible: string | null;
  onMenuToggle: (id: string | null) => void;
  onSendSMS: (tenant: Tenant) => void;
  onSendWhatsApp: (tenant: Tenant) => void;
  onSendEmail: (tenant: Tenant) => void;
  onSendInfoRequest: (item: Tenant | ReminderLog) => void;
  onDelete: (log: ReminderLog) => void;
  onShowHistory: (tenant: { id: string; name?: string | null }) => void;
  hasAdminAccess: boolean;
}

export default function ReminderCard({
  item,
  index,
  selectedCategory,
  defaultCurrency,
  reminderLogs,
  selectedDate,
  menuVisible,
  onMenuToggle,
  onSendSMS,
  onSendWhatsApp,
  onSendEmail,
  onSendInfoRequest,
  onDelete,
  onShowHistory,
  hasAdminAccess,
}: ReminderCardProps) {
  const colors = useThemeColors();

  const tenant = (item as ReminderLog).tenant || (item as Tenant);
  const contract = tenant.contracts?.[0];
  const house = contract?.house;
  const property = house?.property;
  const reminderLog = item as ReminderLog;
  // Badge: Tenant objects have no `tenant_id` field; ReminderLogs do.
  const isPendingItem = !(item as any).tenant_id;
  const alreadySent =
    isPendingItem &&
    reminderLogs.some(log => {
      if (log.tenant_id !== tenant.id) return false;
      if (log.reminder_type !== selectedCategory) return false;
      if (log.status !== 'sent') return false;
      if (selectedCategory === 'payment') {
        const targetDate = (log.metadata as any)?.target_date;
        if (!targetDate) return false;
        const d = new Date(targetDate);
        return (
          d.getMonth() === selectedDate.getMonth() &&
          d.getFullYear() === selectedDate.getFullYear()
        );
      }
      return true;
    });

  return (
    <Surface style={[styles.reminderCard, index === 0 && { marginTop: 8 }]} elevation={1}>
      <View style={styles.reminderHeader}>
        <View style={styles.tenantInfo}>
          <View style={styles.nameContainer}>
            <MaterialCommunityIcons name="account" size={20} color={colors.primary} />
            <Text variant="titleMedium" style={styles.nameText}>
              {tenant.name}
            </Text>
          </View>

          <View style={styles.detailRow}>
            <MaterialCommunityIcons
              name="home-outline"
              size={16}
              color={colors.onSurfaceVariant}
            />
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              {property?.name
                ? `${property.name} - ${house?.house_number}`
                : 'No property assigned'}
            </Text>
          </View>

          {tenant.phone && (
            <View style={styles.detailRow}>
              <MaterialCommunityIcons
                name="phone-outline"
                size={16}
                color={colors.onSurfaceVariant}
              />
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {tenant.phone}
              </Text>
            </View>
          )}

          {selectedCategory === 'payment' && contract && (
            <View style={styles.detailRow}>
              <MaterialCommunityIcons
                name="cash-multiple"
                size={16}
                color={colors.onSurfaceVariant}
              />
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {`Pending: ${defaultCurrency ? formatWithCurrency(tenant.pendingRentAmount || 0, defaultCurrency) : tenant.pendingRentAmount} of ${defaultCurrency ? formatWithCurrency(contract?.rent_amount || 0, defaultCurrency) : contract?.rent_amount}`}
              </Text>
            </View>
          )}

          {selectedCategory === 'data_cleanup' &&
            (() => {
              const missingItems = [
                (!tenant.email || tenant.email.startsWith('placeholder')) && 'Email',
                !tenant.phone && 'Phone',
                parseNextOfKin(tenant.next_of_kin).length === 0 && 'Next of Kin',
              ].filter(Boolean);

              if (missingItems.length === 0) {
                return (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons
                      name="check-circle-outline"
                      size={16}
                      color={colors.success}
                    />
                    <Text
                      variant="bodySmall"
                      style={{ color: colors.success, fontWeight: 'bold' }}
                    >
                      All Info Provided
                    </Text>
                  </View>
                );
              }

              return (
                <View style={styles.detailRow}>
                  <MaterialCommunityIcons
                    name="alert-circle-outline"
                    size={16}
                    color={colors.error}
                  />
                  <Text
                    variant="bodySmall"
                    style={{ color: colors.error, fontWeight: 'bold' }}
                  >
                    Missing: {missingItems.join(', ')}
                  </Text>
                </View>
              );
            })()}

          {reminderLog.sent_at && (
            <View style={styles.detailRow}>
              <MaterialCommunityIcons
                name="clock-outline"
                size={16}
                color={colors.onSurfaceVariant}
              />
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                Sent: {new Date(reminderLog.sent_at).toLocaleString()}
              </Text>
            </View>
          )}
        </View>

        {/* Badge + Menu column */}
        <View style={{ alignItems: 'center', justifyContent: 'flex-start' }}>
          <Menu
            visible={menuVisible === item.id}
            onDismiss={() => onMenuToggle(null)}
            anchor={
              <IconButton
                icon="dots-vertical"
                onPress={() => onMenuToggle(item.id)}
                style={styles.menuButton}
              />
            }
          >
            {selectedCategory === 'data_cleanup' && (
              <Menu.Item
                onPress={() => {
                  onMenuToggle(null);
                  onSendInfoRequest(item);
                }}
                title="Request Info"
                leadingIcon={({ size }) => (
                  <MaterialCommunityIcons
                    name="account-edit-outline"
                    size={size}
                    color={colors.secondary}
                  />
                )}
                titleStyle={{ color: colors.secondary, fontWeight: 'bold' }}
              />
            )}
            <Menu.Item
              onPress={() => {
                onMenuToggle(null);
                onSendSMS(tenant);
              }}
              title="Send SMS"
              leadingIcon={({ size }) => (
                <MaterialCommunityIcons
                  name="message-outline"
                  size={size}
                  color={colors.primary}
                />
              )}
              titleStyle={{ color: colors.primary }}
            />
            <Menu.Item
              onPress={() => {
                onMenuToggle(null);
                onSendWhatsApp(tenant);
              }}
              title="Send WhatsApp"
              leadingIcon={({ size }) => (
                <MaterialCommunityIcons
                  name="whatsapp"
                  size={size}
                  color={colors.success}
                />
              )}
              titleStyle={{ color: colors.success }}
            />
            <Menu.Item
              onPress={() => {
                onMenuToggle(null);
                onSendEmail(tenant);
              }}
              title="Send Email"
              leadingIcon={({ size }) => (
                <MaterialCommunityIcons name="email" size={size} color={colors.error} />
              )}
              titleStyle={{ color: colors.error }}
            />
            {hasAdminAccess &&
              (reminderLog.status === 'sent' || reminderLog.status === 'failed') && (
                <Menu.Item
                  onPress={() => {
                    onMenuToggle(null);
                    onDelete(reminderLog);
                  }}
                  title="Delete Log"
                  leadingIcon={({ size }) => (
                    <MaterialCommunityIcons
                      name="delete"
                      size={size}
                      color={colors.error}
                    />
                  )}
                  titleStyle={{ color: colors.error }}
                />
              )}
          </Menu>
        </View>
      </View>

      {reminderLog.message && (
        <View style={[styles.messagePreview, { backgroundColor: colors.surfaceVariant }]}>
          <FormattedText
            variant="bodySmall"
            numberOfLines={10}
            style={{ color: colors.onSurfaceVariant }}
            text={htmlToPlain(reminderLog.message)}
          />
        </View>
      )}

      {alreadySent && (
        <SPressable
          style={{ position: 'absolute', bottom: 14, right: 14, zIndex: 10 }}
          onPress={() => onShowHistory({ id: tenant.id, name: tenant.name })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialCommunityIcons name="check-circle" size={18} color={colors.success} />
        </SPressable>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  reminderCard: {
    padding: 12,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  reminderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  tenantInfo: {
    flex: 1,
    gap: 4,
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nameText: {
    fontWeight: 'bold',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  menuButton: {
    margin: -8,
  },
  messagePreview: {
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
  },
});
