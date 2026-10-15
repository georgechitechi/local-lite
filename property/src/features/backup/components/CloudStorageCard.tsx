import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Divider,
  Surface,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { formatFileSize } from '@/features/backup/services/backupUtils';
import { downloadStorageFile } from '@/shared/services/storageService';
import { formatDateTime } from '@/shared/utils/formatters';
import { addOpacity } from '@/shared/utils/helper';

export function CloudStorageCard({ flow }: { flow: any }) {
  const { showSnackbar } = useSnackbar();

  const {
    loading,
    isCloudSyncEnabled,
    currentStoragePath,
    listStorageFiles,
    loadingStorage,
    storageFolders,
    storageFiles,
    downloadingFileName,
    setDownloadingFileName,
    restoreFromStorageFile,
    colors,
    restoreModalData,
  } = flow;

  return (
    <>
      {isCloudSyncEnabled && (
        <Surface style={[styles.section, { marginBottom: 30 }]}>
          {/* Section Header */}
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text variant="titleMedium" style={styles.sectionTitle}>
                STORAGE RESTORE
              </Text>
              <Text variant="bodySmall" style={styles.description}>
                Browse and restore directly from Supabase Storage backups.
              </Text>
            </View>
            <Button
              mode="text"
              icon={({ color }) => (
                <MaterialCommunityIcons name="refresh" size={20} color={color} />
              )}
              onPress={() => listStorageFiles(currentStoragePath)}
              loading={loadingStorage}
              disabled={loadingStorage}
              compact
              style={styles.refreshButton}
            >
              Refresh
            </Button>
          </View>
          {/* Breadcrumb Navigation Bar */}
          <View
            style={[
              styles.breadcrumbBar,
              {
                backgroundColor: colors.elevation.level1,
                borderColor: colors.outlineVariant || '#e2e8f0',
              },
            ]}
          >
            {currentStoragePath !== 'backups' && (
              <TouchableOpacity
                onPress={() => {
                  const parts = currentStoragePath.split('/');
                  const parent = parts.slice(0, -1).join('/') || 'backups';
                  listStorageFiles(parent);
                }}
                style={[
                  styles.breadcrumbUpBtn,
                  { backgroundColor: addOpacity(colors.primary, 0.1) },
                ]}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Go up one folder"
              >
                <MaterialCommunityIcons
                  name="arrow-up"
                  size={18}
                  color={colors.primary}
                />
              </TouchableOpacity>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.breadcrumbScroll}
            >
              {currentStoragePath
                .split('/')
                .filter(Boolean)
                .map((segment: string, index: number, arr: string[]) => {
                  const isLast = index === arr.length - 1;
                  const isRoot = index === 0;
                  return (
                    <View key={index} style={styles.breadcrumbSegmentRow}>
                      {index > 0 && (
                        <MaterialCommunityIcons
                          name="chevron-right"
                          size={16}
                          color={colors.onSurfaceVariant}
                          style={styles.breadcrumbSeparator}
                        />
                      )}
                      <TouchableOpacity
                        onPress={() => {
                          if (!isLast) {
                            const target = arr.slice(0, index + 1).join('/');
                            listStorageFiles(target);
                          }
                        }}
                        disabled={isLast}
                        style={styles.breadcrumbSegment}
                        activeOpacity={0.6}
                      >
                        {isRoot && (
                          <MaterialCommunityIcons
                            name="folder-home"
                            size={16}
                            color={isLast ? colors.primary : colors.onSurfaceVariant}
                            style={{ marginRight: 4 }}
                          />
                        )}
                        <Text
                          variant="bodyMedium"
                          style={[
                            styles.breadcrumbText,
                            isLast
                              ? [styles.breadcrumbTextActive, { color: colors.onSurface }]
                              : [styles.breadcrumbTextLink, { color: colors.primary }],
                          ]}
                          numberOfLines={1}
                        >
                          {segment}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
            </ScrollView>
          </View>

          {/* Content summary stats */}
          {!loadingStorage && (storageFolders.length > 0 || storageFiles.length > 0) && (
            <View style={styles.statsBar}>
              <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                {[
                  storageFolders.length > 0 &&
                    `${storageFolders.length} ${storageFolders.length === 1 ? 'folder' : 'folders'}`,
                  storageFiles.length > 0 &&
                    `${storageFiles.length} ${storageFiles.length === 1 ? 'backup' : 'backups'}`,
                ]
                  .filter(Boolean)
                  .join(' • ')}
              </Text>
            </View>
          )}

          {/* Content Body */}
          {loadingStorage ? (
            <View style={styles.storageLoadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text
                variant="bodySmall"
                style={{ marginTop: 12, color: colors.onSurfaceVariant }}
              >
                Fetching storage contents...
              </Text>
            </View>
          ) : (
            <View style={{ marginTop: 4 }}>
              {/* Folders */}
              {storageFolders.length > 0 && (
                <View style={styles.foldersContainer}>
                  <Text variant="labelMedium" style={styles.foldersHeaderTitle}>
                    FOLDERS
                  </Text>
                  <View style={styles.folderList}>
                    {storageFolders.map((folder: any) => (
                      <TouchableRipple
                        key={folder.name}
                        onPress={() =>
                          listStorageFiles(`${currentStoragePath}/${folder.name}`)
                        }
                        style={[
                          styles.folderCard,
                          {
                            backgroundColor: colors.elevation.level1,
                            borderColor: colors.outlineVariant || '#e2e8f0',
                          },
                        ]}
                        borderless
                      >
                        <View style={styles.folderCardRow}>
                          <View
                            style={[
                              styles.folderIconBox,
                              { backgroundColor: addOpacity('#f59e0b', 0.12) },
                            ]}
                          >
                            <MaterialCommunityIcons
                              name="folder"
                              size={22}
                              color="#f59e0b"
                            />
                          </View>
                          <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text
                              variant="titleSmall"
                              style={{ fontWeight: '600' }}
                              numberOfLines={1}
                            >
                              {folder.name}
                            </Text>
                            <Text
                              variant="bodySmall"
                              style={{ color: colors.onSurfaceVariant, fontSize: 11 }}
                            >
                              Folder
                            </Text>
                          </View>
                          <MaterialCommunityIcons
                            name="chevron-right"
                            size={20}
                            color={colors.onSurfaceVariant}
                          />
                        </View>
                      </TouchableRipple>
                    ))}
                  </View>
                </View>
              )}

              {/* Files */}
              {storageFiles.length > 0 && (
                <View style={styles.filesContainer}>
                  <Text variant="labelMedium" style={styles.filesHeaderTitle}>
                    BACKUP FILES
                  </Text>
                  <View style={styles.filesList}>
                    {storageFiles.map((file: any) => (
                      <Surface
                        key={file.name}
                        style={[
                          styles.fileCard,
                          {
                            backgroundColor: colors.elevation.level1,
                            borderColor: colors.outlineVariant || '#e2e8f0',
                          },
                        ]}
                        elevation={0}
                      >
                        <View style={styles.fileCardHeader}>
                          <View
                            style={[
                              styles.fileIconBox,
                              { backgroundColor: addOpacity(colors.primary, 0.12) },
                            ]}
                          >
                            <MaterialCommunityIcons
                              name="database"
                              size={20}
                              color={colors.primary}
                            />
                          </View>
                          <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text
                              variant="titleSmall"
                              style={styles.fileNameTitle}
                              numberOfLines={1}
                            >
                              {file.name}
                            </Text>
                            <View style={styles.fileMetaRow}>
                              <MaterialCommunityIcons
                                name="clock-outline"
                                size={12}
                                color={colors.onSurfaceVariant}
                              />
                              <Text
                                variant="labelSmall"
                                style={{
                                  color: colors.onSurfaceVariant,
                                  marginLeft: 4,
                                  fontSize: 11,
                                }}
                              >
                                {file.updated_at || file.created_at
                                  ? formatDateTime(
                                      new Date(file.updated_at || file.created_at || ''),
                                    )
                                  : 'Date unknown'}
                              </Text>
                            </View>
                          </View>
                          <View
                            style={[
                              styles.sizeBadge,
                              { backgroundColor: colors.elevation.level2 },
                            ]}
                          >
                            <Text
                              variant="labelSmall"
                              style={{
                                fontWeight: '700',
                                fontSize: 11,
                                color: colors.onSurface,
                              }}
                            >
                              {formatFileSize(file.metadata?.size)}
                            </Text>
                          </View>
                        </View>

                        <Divider style={styles.cardDivider} />

                        <View style={styles.fileCardActionsRow}>
                          <Button
                            mode="outlined"
                            icon="download"
                            onPress={async () => {
                              try {
                                setDownloadingFileName(file.name);
                                await downloadStorageFile(
                                  `${currentStoragePath}/${file.name}`,
                                  file.name,
                                );
                                showSnackbar('File downloaded successfully', 'success');
                              } catch (error: any) {
                                console.error('Download error:', error);
                                showSnackbar(
                                  `Failed to download file: ${error.message}`,
                                  'error',
                                );
                              } finally {
                                setDownloadingFileName(null);
                              }
                            }}
                            loading={downloadingFileName === file.name}
                            disabled={loading || downloadingFileName !== null}
                            compact
                            style={[styles.actionBtn, { flex: 1 }]}
                            labelStyle={{ fontSize: 12 }}
                          >
                            Download
                          </Button>
                          <Button
                            mode="contained"
                            buttonColor={colors.error}
                            icon={({ size, color }) => (
                              <MaterialCommunityIcons
                                name="cloud-download"
                                size={size}
                                color={color}
                              />
                            )}
                            onPress={() =>
                              restoreFromStorageFile(
                                `${currentStoragePath}/${file.name}`,
                                file.name,
                              )
                            }
                            loading={loading && restoreModalData?.fileName === file.name}
                            disabled={loading || downloadingFileName !== null}
                            compact
                            style={[styles.actionBtn, { flex: 1 }]}
                            labelStyle={{ fontSize: 12 }}
                          >
                            Restore
                          </Button>
                        </View>
                      </Surface>
                    ))}
                  </View>
                </View>
              )}

              {/* Empty state */}
              {storageFolders.length === 0 && storageFiles.length === 0 && (
                <View style={styles.storageEmptyBox}>
                  <MaterialCommunityIcons
                    name="folder-open-outline"
                    size={48}
                    color={colors.onSurfaceVariant}
                    style={{ opacity: 0.4, marginBottom: 10 }}
                  />
                  <Text
                    variant="titleSmall"
                    style={{ fontWeight: '600', marginBottom: 4 }}
                  >
                    No files or folders found
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{
                      textAlign: 'center',
                      color: colors.onSurfaceVariant,
                      marginBottom: 16,
                      maxWidth: 280,
                      lineHeight: 18,
                    }}
                  >
                    This storage folder is currently empty.
                  </Text>
                </View>
              )}
            </View>
          )}
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
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  refreshButton: {
    marginLeft: 'auto',
  },
  breadcrumbBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
    marginBottom: 10,
    minHeight: 44,
  },
  breadcrumbUpBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  breadcrumbScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingRight: 8,
  },
  breadcrumbSegmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breadcrumbSeparator: {
    marginHorizontal: 3,
    opacity: 0.5,
  },
  breadcrumbSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },
  breadcrumbText: {
    fontSize: 13,
  },
  breadcrumbTextLink: {
    fontWeight: '500',
  },
  breadcrumbTextActive: {
    fontWeight: '700',
  },
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  storageLoadingContainer: {
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foldersContainer: {
    marginBottom: 14,
  },
  foldersHeaderTitle: {
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
    opacity: 0.8,
  },
  folderList: {
    gap: 8,
  },
  folderCard: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  folderCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  folderIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filesContainer: {
    marginTop: 4,
  },
  filesHeaderTitle: {
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
    opacity: 0.8,
  },
  filesList: {
    gap: 10,
  },
  fileCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  fileCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileNameTitle: {
    fontWeight: '600',
    fontSize: 13,
  },
  fileMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  sizeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 8,
  },
  cardDivider: {
    marginVertical: 10,
  },
  fileCardActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    borderRadius: 8,
  },
  storageEmptyBox: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
