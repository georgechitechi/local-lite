import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Chip, Text } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { extractProjectRef } from './types';

export interface DiagnosticsResult {
  restLatency: number;
  authHealthy: boolean;
  dbHealthy: boolean;
  checkedAt: string;
  issues?: string[];
}

interface ActiveSyncCardProps {
  user: any;
  supabaseUrl?: string;
  projectName?: string | null;
  isOwner: boolean;
  hasPat: boolean;
  diagLoading: boolean;
  diagResult: DiagnosticsResult | null;
  onShowAppKey: () => void;
  onOpenPatModal: () => void;
  onRunDiagnostics: () => void;
  onOpenUsersModal: () => void;
  onResetProject: () => void;
  onInspectSqlite?: () => void;
}

export const ActiveSyncCard: React.FC<ActiveSyncCardProps> = ({
  supabaseUrl,
  projectName,
  isOwner,
  hasPat,
  diagLoading,
  diagResult,
  onShowAppKey,
  onOpenPatModal,
  onRunDiagnostics,
  onOpenUsersModal,
  onResetProject,
  onInspectSqlite,
}) => {
  const colors = useThemeColors();
  const projectRef = supabaseUrl ? extractProjectRef(supabaseUrl) : null;
  const displayName = projectName || projectRef;

  return (
    <View style={[styles.activeContainer, { backgroundColor: colors.primaryContainer }]}>
      <View style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4,
          }}
        >
          <Text variant="titleSmall" style={{ color: colors.primary, fontWeight: '700' }}>
            Connected & Synced
          </Text>
          {displayName && (
            <Chip compact textStyle={{ fontSize: 11, fontWeight: '600' }}>
              {displayName}
            </Chip>
          )}
        </View>

        <View style={{ marginBottom: 8 }}>
          {projectName && (
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              Project: {projectName}
            </Text>
          )}
          {supabaseUrl && (
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              Link: {supabaseUrl}
            </Text>
          )}
        </View>

        {/* Live Diagnostics Card */}
        {diagResult && (
          <View
            style={{
              backgroundColor: colors.surface,
              padding: 10,
              borderRadius: 8,
              marginBottom: 8,
              gap: 6,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                Health Diagnostics ({diagResult.checkedAt})
              </Text>
              <Text
                variant="labelSmall"
                style={{
                  color:
                    diagResult.dbHealthy && diagResult.authHealthy
                      ? colors.success
                      : colors.error,
                  fontWeight: 'bold',
                }}
              >
                {diagResult.dbHealthy && diagResult.authHealthy
                  ? 'Healthy'
                  : 'Issues Detected'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Chip
                compact
                icon="speedometer"
                style={{ flex: 1 }}
                textStyle={{ fontSize: 11 }}
              >
                {diagResult.restLatency}ms
              </Chip>
              <Chip
                compact
                icon={diagResult.authHealthy ? 'shield-check' : 'shield-alert'}
                style={{
                  flex: 1,
                  backgroundColor: diagResult.authHealthy
                    ? colors.secondaryContainer
                    : colors.errorContainer,
                }}
                textStyle={{
                  fontSize: 11,
                  color: diagResult.authHealthy
                    ? colors.onSecondaryContainer
                    : colors.onErrorContainer,
                }}
              >
                {diagResult.authHealthy ? 'Auth: OK' : 'Auth: Err'}
              </Chip>
              <Chip
                compact
                icon={diagResult.dbHealthy ? 'database-check' : 'database-alert'}
                style={{
                  flex: 1,
                  backgroundColor: diagResult.dbHealthy
                    ? colors.secondaryContainer
                    : colors.errorContainer,
                }}
                textStyle={{
                  fontSize: 11,
                  color: diagResult.dbHealthy
                    ? colors.onSecondaryContainer
                    : colors.onErrorContainer,
                }}
              >
                {diagResult.dbHealthy ? 'DB: OK' : 'DB: Err'}
              </Chip>
            </View>

            {diagResult.issues && diagResult.issues.length > 0 && (
              <View
                style={{
                  backgroundColor: colors.errorContainer,
                  padding: 8,
                  borderRadius: 6,
                  marginTop: 4,
                  gap: 2,
                }}
              >
                {diagResult.issues.map((issue, idx) => (
                  <Text
                    key={idx}
                    variant="labelSmall"
                    style={{ color: colors.onErrorContainer }}
                  >
                    • {issue}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
        {(isOwner || hasPat) && (
          <View style={{ flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                mode="contained"
                compact
                icon="eye"
                onPress={onShowAppKey}
                style={{ flex: 1 }}
              >
                Show App Key
              </Button>
              <Button
                mode={hasPat ? 'contained' : 'outlined'}
                compact
                icon={hasPat ? 'shield-check' : 'shield-key'}
                onPress={onOpenPatModal}
                style={{ flex: 1 }}
              >
                Management API
              </Button>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                mode="outlined"
                compact
                icon="pulse"
                loading={diagLoading}
                disabled={diagLoading}
                onPress={onRunDiagnostics}
                style={{ flex: 1 }}
              >
                Run Diagnostics
              </Button>
              <Button
                mode="outlined"
                compact
                icon="account-group"
                onPress={onOpenUsersModal}
                style={{ flex: 1 }}
              >
                Project Users
              </Button>
            </View>

            {onInspectSqlite && (
              <Button
                mode="contained-tonal"
                icon="database-search"
                onPress={onInspectSqlite}
              >
                Inspect SQLite Data (Tables & Rows)
              </Button>
            )}

            <Button
              mode="outlined"
              icon="refresh"
              textColor={colors.error}
              style={{ borderColor: colors.error }}
              onPress={onResetProject}
            >
              Reset Project
            </Button>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  activeContainer: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
  },
});
