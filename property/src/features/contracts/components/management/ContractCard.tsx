import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Divider, IconButton, Menu, Text } from 'react-native-paper';
import SPressable from '@/shared/components/SlightPressable';
import { formatDate } from '@/shared/utils/formatters';
import { properCase } from '@/shared/utils/helper';

export interface ContractCardProps {
  contract: any;
  colors: any;
  isSelected: boolean;
  isSelectionMode: boolean;
  menuVisible: boolean;
  onLongPress: () => void;
  onPress: () => void;
  onMenuVisible: () => void;
  onMenuDismiss: () => void;
  onViewContract: () => void;
  onRenewContract: () => void;
  onPauseContract: () => void;
  onResumeContract: () => void;
  onSendReminder: () => void;
  onTerminateContract: () => void;
}

export const ContractCard = memo(
  ({
    contract,
    colors,
    isSelected,
    isSelectionMode,
    menuVisible,
    onLongPress,
    onPress,
    onMenuVisible,
    onMenuDismiss,
    onViewContract,
    onRenewContract,
    onPauseContract,
    onResumeContract,
    onSendReminder,
    onTerminateContract,
  }: ContractCardProps) => {
    const daysLeft = contract.daysUntilExpiry ?? null;
    const isOverdue = daysLeft !== null && daysLeft < 0;
    const isUrgent = daysLeft !== null && daysLeft >= 0 && daysLeft < 14;
    const dayColor = isOverdue || isUrgent ? colors.error : colors.warning;

    let statusColor = colors.onSurfaceVariant;
    let displayStatus = properCase(contract.status);

    if (contract.isPaused) {
      statusColor = colors.warning;
      displayStatus = 'Paused';
    } else if (contract.status === 'active' || contract.status === 'renewed') {
      statusColor = colors.primary;
    } else if (contract.status === 'expiring_soon') {
      statusColor = colors.warning;
    } else if (contract.status === 'terminated' || contract.status === 'expired') {
      statusColor = colors.error;
    }

    return (
      <SPressable
        onLongPress={onLongPress}
        onPress={onPress}
        style={[styles.contractCard, { borderBottomColor: colors.outlineVariant }]}
      >
        <View style={styles.contractHeader}>
          <View style={styles.tenantInfo}>
            <Text variant="titleSmall" style={styles.tenantName}>
              {contract.tenantName}
            </Text>
            {contract.tenantEmail && (
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                {contract.tenantEmail}
              </Text>
            )}
          </View>
          <View style={styles.headerRight}>
            {isSelectionMode ? (
              <MaterialCommunityIcons
                name={isSelected ? 'check-circle' : 'checkbox-blank-circle-outline'}
                size={22}
                color={isSelected ? colors.primary : colors.outline}
                style={{ margin: 4 }}
              />
            ) : (
              <Menu
                visible={menuVisible}
                onDismiss={onMenuDismiss}
                anchor={
                  <IconButton
                    icon="dots-vertical"
                    size={20}
                    onPress={onMenuVisible}
                    style={styles.menuButton}
                  />
                }
              >
                <Menu.Item
                  onPress={onViewContract}
                  title="View Contract"
                  leadingIcon="eye"
                />
                <Menu.Item
                  onPress={onRenewContract}
                  title="Renew Contract"
                  leadingIcon="refresh"
                />
                {!contract.isPaused ? (
                  <Menu.Item
                    onPress={onPauseContract}
                    title="Pause Contract"
                    leadingIcon="pause-circle-outline"
                  />
                ) : (
                  <Menu.Item
                    onPress={onResumeContract}
                    title="Resume Contract"
                    leadingIcon="play-circle-outline"
                  />
                )}
                {contract.tenantEmail && (
                  <Menu.Item
                    onPress={onSendReminder}
                    title="Send Reminder"
                    leadingIcon="email-outline"
                  />
                )}
                <Divider />
                <Menu.Item
                  onPress={onTerminateContract}
                  title="Terminate Contract"
                  titleStyle={{ color: colors.error }}
                  leadingIcon="close-circle-outline"
                />
              </Menu>
            )}
          </View>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 4,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <MaterialCommunityIcons
              name="office-building"
              size={14}
              color={colors.onSurfaceVariant}
              style={{ marginRight: 4 }}
            />
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              {contract.propertyName} - Unit {contract.houseNumber}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <MaterialCommunityIcons
              name="calendar-clock"
              size={14}
              color={colors.onSurfaceVariant}
              style={{ marginRight: 4 }}
            />
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              {formatDate(contract.end_date)}
            </Text>
          </View>
        </View>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 }}
        >
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            Status:{' '}
            <Text style={{ color: statusColor, fontWeight: 'bold' }}>
              {displayStatus}
            </Text>
          </Text>
        </View>
        <View style={styles.reminderRow}>
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            Last Reminder:{' '}
            {contract.renewal_reminder_sent_at
              ? formatDate(contract.renewal_reminder_sent_at)
              : 'Never'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {daysLeft !== null && (
              <Text
                variant="bodySmall"
                style={[styles.daysLeftText, { color: dayColor }]}
              >
                {daysLeft >= 0
                  ? `${daysLeft} days left`
                  : `${Math.abs(daysLeft)} days overdue`}
              </Text>
            )}
          </View>
        </View>
      </SPressable>
    );
  },
  (prevProps: ContractCardProps, nextProps: ContractCardProps) => {
    return (
      prevProps.contract.id === nextProps.contract.id &&
      prevProps.contract.status === nextProps.contract.status &&
      prevProps.contract.isPaused === nextProps.contract.isPaused &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isSelectionMode === nextProps.isSelectionMode &&
      prevProps.menuVisible === nextProps.menuVisible
    );
  },
);

export default ContractCard;

const styles = StyleSheet.create({
  contractCard: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    paddingHorizontal: 4,
  },
  contractHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  tenantInfo: {
    flex: 1,
  },
  tenantName: {
    fontWeight: 'bold',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuButton: {
    margin: -8,
  },
  reminderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  daysLeftText: {
    fontWeight: 'bold',
  },
});
