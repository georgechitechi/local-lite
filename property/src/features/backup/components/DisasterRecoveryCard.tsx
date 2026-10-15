import { StyleSheet, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import { addOpacity } from '@/shared/utils/helper';

export function DisasterRecoveryCard({ flow }: { flow: any }) {
  const {
    loading,
    isCloudSyncEnabled,
    backupProjectRef,
    setShowReplicateDialog,
    progressOperationType,
    handleRestoreFromReplica,
    colors,
    router,
  } = flow;

  return (
    <>
      {isCloudSyncEnabled && (
        <Surface style={[styles.section, { borderColor: colors.error, borderWidth: 1 }]}>
          <View style={styles.sectionHeader}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
              }}
            >
              <Text
                variant="titleMedium"
                style={{ ...styles.sectionTitle, color: colors.error }}
              >
                DISASTER RECOVERY
              </Text>
              {backupProjectRef ? (
                <View
                  style={{
                    backgroundColor: addOpacity(colors.success, 0.15),
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 6,
                  }}
                >
                  <Text
                    variant="labelSmall"
                    style={{
                      color: colors.success,
                      fontWeight: 'bold',
                      fontSize: 10,
                    }}
                  >
                    REPLICA READY
                  </Text>
                </View>
              ) : (
                <Button
                  mode="text"
                  compact
                  icon="cog"
                  onPress={() => router.push('/settings/cloud-sync')}
                  style={{ margin: 0 }}
                  labelStyle={{ fontSize: 12, marginHorizontal: 4 }}
                >
                  Configure
                </Button>
              )}
            </View>
          </View>
          <Text variant="bodySmall" style={styles.description}>
            {backupProjectRef
              ? `Sync database to your external replica (${backupProjectRef}) or restore from it in an emergency.`
              : 'Tap Configure above to connect your external Supabase project for disaster recovery.'}
          </Text>

          <View style={[styles.buttonContainer, { gap: 8 }]}>
            <View style={{ flexDirection: 'column', gap: 8 }}>
              <Button
                mode="contained-tonal"
                icon="database-export"
                onPress={() => setShowReplicateDialog(true)}
                loading={loading && progressOperationType === 'replicate'}
                disabled={loading || !backupProjectRef}
                style={{ flex: 1 }}
                textColor={colors.onSecondaryContainer}
              >
                Replicate Database
              </Button>
              <Button
                mode="contained-tonal"
                icon="database-refresh"
                onPress={handleRestoreFromReplica}
                loading={loading && progressOperationType === 'restore'}
                disabled={loading || !backupProjectRef}
                style={{ flex: 1 }}
                textColor={colors.onErrorContainer}
              >
                Restore from Replica
              </Button>
            </View>
          </View>
        </Surface>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontWeight: 'bold',
  },
  description: {
    lineHeight: 20,
  },
  buttonContainer: {
    marginTop: 16,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
});
