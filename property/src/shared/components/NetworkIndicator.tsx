import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { SyncIndicator, type SyncIndicatorProps } from 'local-lite/react';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useLocalClient } from '@/providers/SyncClientProvider';
import SPressable from '@/shared/components/SlightPressable';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useNetworkStatus } from '@/shared/hooks/useNetworkStatus';

export interface NetworkIndicatorProps extends Partial<SyncIndicatorProps> {
  alwaysVisible?: boolean;
}

/**
 * Universal Sync Indicator connected to the local-lite client.
 * In 'icon' variant, renders the exact native MaterialCommunityIcons cloud/wifi status
 * icon with outbox badge, and opens the local-lite DevTools inspector on tap, providing:
 * - Pending outbox & failed mutations counts
 * - Push/pull cycles and latency metrics (ms)
 * - Engine actions: force push, force pull, retry mutations, cursor reset
 * - SQLite ACID & WAL benchmark suite
 * - Outbox mutation viewer & sync error diagnostics
 */
export const NetworkIndicator = ({
  position = 'inline',
  variant = 'icon',
  enableBenchmark = true,
  renderTrigger,
  alwaysVisible = false,
  ...rest
}: NetworkIndicatorProps) => {
  const client = useLocalClient();
  const theme = useTheme();
  const { isSyncActive: isCloudSyncEnabled, isDemoMode } = useLocalSync();
  const isNetworkOnline = useNetworkStatus();

  const customRenderTrigger = useMemo(() => {
    if (renderTrigger) return renderTrigger;
    if (variant === 'icon') {
      return ({ open, status }: { open: () => void; status: any }) => {
        const isOnline = isNetworkOnline && (status?.isOnline ?? true);
        const isSyncing = status?.isSyncing ?? false;
        const pendingCount = status?.pendingCount ?? 0;
        const isFullyOnline = isOnline && isCloudSyncEnabled;

        // When not set to always visible, hide icon when no changes are pending (and fully online), or in demo mode
        if (!alwaysVisible) {
          if (pendingCount === 0 && isFullyOnline) return null;
          if (isDemoMode) return null;
        }

        let iconName = 'cloud-check';
        if (!isOnline) iconName = 'wifi-off';
        else if (isDemoMode) iconName = 'cloud-off-outline';
        else if (!isCloudSyncEnabled) iconName = 'cloud-cog';
        else if (isSyncing) iconName = 'cloud-refresh';
        else if (pendingCount > 0) iconName = 'cloud-sync';

        let iconColor = theme.colors.primary;
        if (!isOnline) iconColor = theme.colors.error;
        else if (isDemoMode || !isCloudSyncEnabled) iconColor = theme.colors.outline;
        else if (pendingCount === 0 && isFullyOnline) iconColor = '#10B981';

        return (
          <SPressable onPress={open} style={styles.container}>
            <View style={styles.iconContainer}>
              <MaterialCommunityIcons
                name={iconName as any}
                size={24}
                color={iconColor}
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
        );
      };
    }
  }, [
    renderTrigger,
    variant,
    isCloudSyncEnabled,
    isDemoMode,
    theme.colors,
    isNetworkOnline,
    alwaysVisible,
  ]);

  return (
    <SyncIndicator
      client={client}
      position={position}
      variant={variant}
      enableBenchmark={enableBenchmark}
      renderTrigger={customRenderTrigger}
      alwaysVisible={alwaysVisible}
      theme={rest.theme ?? (theme.dark ? 'dark' : 'light')}
      {...rest}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
    borderRadius: 20,
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

export { SyncIndicator };
export default NetworkIndicator;
