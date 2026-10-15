import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, ProgressBar, Surface, Text } from 'react-native-paper';

export function BackupOptionsCard({ flow }: { flow: any }) {
  const {
    loading,
    progress,
    backupStatus,
    hasStaleBackups,
    checkingStaleBackups,
    isCloudSyncEnabled,
    handleBackup,
    handleChangeFolder,
    handleCleanupBackups,
    handleRestore,
    colors,
    router,
  } = flow;

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <Surface style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            BACKUP OPTIONS
          </Text>
          <Button
            mode="text"
            onPress={handleChangeFolder}
            disabled={loading}
            icon={({ color }) => (
              <MaterialCommunityIcons name="folder-swap" size={24} color={color} />
            )}
            compact
            style={styles.refreshButton}
          >
            Change Folder
          </Button>
        </View>
        <Text variant="bodySmall" style={styles.description}>
          Create a complete backup of all data in your database.
        </Text>
        {loading && (
          <View style={styles.progressContainer}>
            <Text variant="bodyMedium">{backupStatus}</Text>
            <ProgressBar progress={progress} style={styles.progressBar} />
          </View>
        )}

        <View style={[styles.buttonContainer, { flexDirection: 'row', gap: 16 }]}>
          <Button
            mode="contained"
            icon="cloud-download"
            onPress={handleBackup}
            loading={loading}
            disabled={loading}
            style={[styles.button, { flex: 1 }]}
          >
            New Backup
          </Button>
          <Button
            mode="contained"
            icon={({ size, color }) => (
              <MaterialCommunityIcons name="cloud-upload" size={size} color={color} />
            )}
            onPress={handleRestore}
            loading={loading}
            disabled={loading}
            style={[styles.button, { flex: 1 }]}
            buttonColor={colors.error}
          >
            Restore File
          </Button>
        </View>
        {isCloudSyncEnabled && (
          <>
            <View style={styles.buttonContainer}>
              <Button
                mode="outlined"
                onPress={() => {
                  void router.push('/settings/schedules');
                }}
                disabled={loading}
              >
                Configure Automatic Backup Schedule
              </Button>
            </View>
            {(hasStaleBackups || checkingStaleBackups) && (
              <View style={styles.buttonContainer}>
                <Button
                  mode="outlined"
                  onPress={handleCleanupBackups}
                  loading={loading || checkingStaleBackups}
                  disabled={loading || checkingStaleBackups || !hasStaleBackups}
                  icon={({ size, color }) => (
                    <MaterialCommunityIcons name="broom" size={size} color={color} />
                  )}
                  buttonColor={colors.warning}
                  textColor="white"
                >
                  {checkingStaleBackups ? 'Checking...' : 'Clean Old Backups'}
                </Button>
              </View>
            )}
          </>
        )}
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
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
  progressContainer: {
    marginVertical: 16,
  },
  progressBar: {
    marginTop: 8,
    height: 6,
    borderRadius: 3,
  },
  buttonContainer: {
    marginTop: 16,
    gap: 12,
  },
  button: {
    marginVertical: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  refreshButton: {
    marginLeft: 'auto',
  },
});
