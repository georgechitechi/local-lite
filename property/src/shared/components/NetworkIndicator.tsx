import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import { useSyncStatus } from 'local-lite/react';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { useLocalClient } from '@/providers/SyncClientProvider';
import BaseModal from '@/shared/components/BaseModal';
import ChangeViewer from '@/shared/components/ChangeViewer';
import EmptyState from '@/shared/components/EmptyState';
import SectionGroup from '@/shared/components/SectionGroup';
import SPressable from '@/shared/components/SlightPressable';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { clearAllPersistence } from '@/stores/syncHelper';

interface PendingGroup {
  store: string;
  count: number;
  changes: any[];
}

const NetworkIndicator = () => {
  const client = useLocalClient();
  const theme = useTheme();
  const { showSnackbar } = useSnackbar();
  const router = useRouter();

  const [modalVisible, setModalVisible] = useState(false);
  const [showResetSyncModal, setShowResetSyncModal] = useState(false);
  const [expandedChanges, setExpandedChanges] = useState<Set<number>>(new Set());

  const { isSyncActive: isCloudSyncEnabled, isDemoMode } = useLocalSync();
  const { isOnline, isSyncing, pendingCount, pendingRecords, refresh } =
    useSyncStatus(client);

  const isFullyOnline = isOnline && isCloudSyncEnabled;

  // Group pending SQLite outbox records by table name
  const pendingChanges = useMemo(() => {
    const groups: Record<string, PendingGroup> = {};
    for (const record of pendingRecords || []) {
      const storeName = record.tableName || 'other';
      if (!groups[storeName]) {
        groups[storeName] = { store: storeName, count: 0, changes: [] };
      }
      groups[storeName].count++;
      groups[storeName].changes.push(record);
    }
    return Object.values(groups);
  }, [pendingRecords]);

  const handleIconPress = () => {
    setModalVisible(true);
  };

  const handleForceSync = async () => {
    if (client?.syncWorker) {
      try {
        await Promise.all([
          client.syncWorker.pushLocalChanges(),
          client.syncWorker.pullRemoteChanges(),
        ]);
        await refresh();
        showSnackbar('Sync completed', 'success');
      } catch (error) {
        console.error('Force sync failed:', error);
        showSnackbar('Sync failed', 'error');
      }
    }
  };

  if (pendingCount === 0 && isFullyOnline) {
    return null;
  }

  if (isDemoMode) {
    return null;
  }

  return (
    <React.Fragment>
      <SPressable onPress={handleIconPress} style={styles.container}>
        <View style={styles.iconContainer}>
          <MaterialCommunityIcons
            name={
              isFullyOnline
                ? isSyncing
                  ? 'cloud-refresh'
                  : 'cloud-sync'
                : !isOnline
                  ? 'wifi-off'
                  : 'cloud-cog'
            }
            size={24}
            color={
              !isOnline
                ? theme.colors.error
                : !isCloudSyncEnabled
                  ? theme.colors.outline
                  : theme.colors.primary
            }
          />
          {pendingCount > 0 && (
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: theme.colors.primary,
                },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  {
                    color: theme.colors.onPrimary,
                  },
                ]}
              >
                {pendingCount > 99 ? '99+' : pendingCount}
              </Text>
            </View>
          )}
        </View>
      </SPressable>

      <BaseModal
        visible={modalVisible}
        onDismiss={() => setModalVisible(false)}
        title={isFullyOnline ? 'Network & Sync' : 'Offline Mode'}
        edgeToEdge
        subtitle={
          isFullyOnline
            ? isSyncing
              ? 'Synchronizing data...'
              : pendingCount > 0
                ? `${pendingCount} changes waiting to upload`
                : 'All changes synced'
            : !isCloudSyncEnabled
              ? 'Cloud sync is not configured. Working locally.'
              : 'Changes will sync when back online'
        }
        actions={
          !isCloudSyncEnabled
            ? [
                {
                  label: 'Configure Sync',
                  onPress: () => {
                    setModalVisible(false);
                    router.push('/settings/cloud-sync');
                  },
                  icon: 'cloud-cog',
                  mode: 'contained',
                },
              ]
            : [
                {
                  label: 'Reset Sync',
                  onPress: () => setShowResetSyncModal(true),
                  icon: 'delete-forever',
                  mode: 'outlined',
                },
                {
                  label: 'Force Sync',
                  onPress: handleForceSync,
                  icon: 'cloud-sync',
                  mode: 'contained',
                },
              ]
        }
        scrollable={true}
      >
        {!isCloudSyncEnabled ? (
          <EmptyState
            icon="cloud-cog"
            title="Local Mode"
            description="You are currently working in local-only mode. Connect to your database to back up your data and enable real-time sync across devices."
          />
        ) : pendingChanges.length === 0 ? (
          <EmptyState
            icon="check-circle-outline"
            title="All caught up!"
            description="All your offline changes have been committed and synced to the cloud."
            iconColor={theme.colors.primary}
          />
        ) : (
          <View>
            <Text
              variant="titleMedium"
              style={{ marginBottom: 12, paddingHorizontal: 16 }}
            >
              Pending Changes ({pendingCount})
            </Text>
            {pendingChanges.map((change, index) => {
              const isExpanded = expandedChanges.has(index);
              return (
                <View key={change.store}>
                  <SectionGroup
                    title={change.store}
                    subtitle={`${change.count} changes queued in SQLite outbox`}
                    isExpanded={isExpanded}
                    onToggle={() => {
                      setExpandedChanges(prev => {
                        const next = new Set(prev);
                        if (next.has(index)) next.delete(index);
                        else next.add(index);
                        return next;
                      });
                    }}
                    rightContent={
                      <Text
                        variant="labelSmall"
                        style={{ alignSelf: 'center', opacity: 0.7 }}
                      >
                        {change.count}
                      </Text>
                    }
                  />
                  {isExpanded && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                      <ChangeViewer data={change.changes} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </BaseModal>

      <BaseModal
        mode="confirm"
        visible={showResetSyncModal}
        onDismiss={() => setShowResetSyncModal(false)}
        onConfirm={async () => {
          try {
            setShowResetSyncModal(false);
            setModalVisible(false);
            showSnackbar('Local data cleared. App will now reload.', 'success');
            await clearAllPersistence();
          } catch (error) {
            console.error('Failed to reset all data:', error);
            showSnackbar('Failed to clear local data.', 'error');
          }
        }}
        title="Reset Sync"
        message={
          'This will permanently clear all local application data, including your offline changes, preferences, and session state. You will need to log in again, and the app will re-sync from the server.\n\nAre you sure you want to proceed?'
        }
        confirmText="Reset Sync"
        destructive={true}
      />
    </React.Fragment>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainer: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 10,
  },
});

export default NetworkIndicator;
