import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  HelperText,
  Icon,
  ProgressBar,
  Text,
} from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import {
  changeDirectory,
  downloadToDirectory,
  getSavedDirectoryName,
  openDirectory,
} from '@/shared/services/fileDownload';
import {
  fetchLatestDevRelease,
  formatBytes,
  type GitHubDevRelease,
} from '@/shared/services/githubReleases';

interface GitHubDevUpdateModalProps {
  visible: boolean;
  onDismiss: () => void;
  colors: any;
}

export default function GitHubDevUpdateModal({
  visible,
  onDismiss,
  colors,
}: GitHubDevUpdateModalProps) {
  const [loading, setLoading] = useState(false);
  const [release, setRelease] = useState<GitHubDevRelease | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Download state
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStats, setDownloadStats] = useState<{
    written: number;
    total: number;
  } | null>(null);
  const [savedFilePath, setSavedFilePath] = useState<string | null>(null);
  const [savedDisplayPath, setSavedDisplayPath] = useState<string | null>(null);
  const [savedDirectoryUri, setSavedDirectoryUri] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const refreshFolder = useCallback(async () => {
    const name = await getSavedDirectoryName('backupDirectoryUri');
    setFolderName(name);
  }, []);

  const searchDevReleases = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRelease(null);
    setDownloading(false);
    setDownloadProgress(0);
    setDownloadStats(null);
    setSavedFilePath(null);
    setSavedDisplayPath(null);
    setSavedDirectoryUri(null);
    setDownloadError(null);

    const result = await fetchLatestDevRelease();
    if (result.error) {
      setError(result.error);
    } else {
      setRelease(result.release);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (visible) {
      searchDevReleases();
      refreshFolder();
    }
  }, [visible, searchDevReleases, refreshFolder]);

  const handleChangeFolder = async () => {
    try {
      const dir = await changeDirectory('backupDirectoryUri');
      if (dir) {
        setFolderName(dir.name || null);
        setSavedDirectoryUri(dir.uri);
      }
    } catch (err: any) {
      console.warn('Failed to change directory:', err);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const opened = await openDirectory(savedDirectoryUri);
      if (!opened) {
        setDownloadError(
          `File saved at: ${savedDisplayPath || 'Selected Folder'}. Please open your device's Files app to view it.`,
        );
      }
    } catch (err: any) {
      console.error('[Open Folder] Error:', err);
      setDownloadError(err?.message || 'Could not open folder.');
    }
  };

  const handleDownload = async () => {
    if (!release?.apkAsset?.browser_download_url) {
      if (release?.html_url) Linking.openURL(release.html_url);
      return;
    }

    try {
      setDownloading(true);
      setDownloadError(null);
      setDownloadProgress(0);
      setDownloadStats(null);

      const filename = release.apkAsset.name || `dev-update-${Date.now()}.apk`;

      const result = await downloadToDirectory(
        release.apkAsset.browser_download_url,
        filename,
        {
          mimeType: 'application/vnd.android.package-archive',
          directoryKey: 'backupDirectoryUri',
          onProgress: ({ written, total, progress }) => {
            setDownloadProgress(progress);
            setDownloadStats({ written, total });
          },
        },
      );

      setSavedFilePath(result.localUri || result.uri);
      setSavedDisplayPath(result.displayPath || filename);
      setSavedDirectoryUri(result.directoryUri || null);
      if (result.folderName) setFolderName(result.folderName);
      setDownloadProgress(1);
    } catch (err: any) {
      console.error('[Download APK] Error:', err);
      setDownloadError(err?.message || 'Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const primaryAction = release?.apkAsset
    ? {
        label: savedFilePath
          ? 'Open Folder'
          : downloading
            ? `${Math.round(downloadProgress * 100)}%`
            : 'Download APK',
        mode: 'contained' as const,
        icon: savedFilePath
          ? 'folder-open-outline'
          : downloading
            ? undefined
            : 'download',
        loading: downloading,
        disabled: downloading,
        onPress: savedFilePath ? handleOpenFolder : handleDownload,
        style: { flex: 1 },
      }
    : {
        label: 'Search Again',
        mode: 'contained' as const,
        icon: 'refresh',
        loading: loading,
        disabled: loading,
        onPress: searchDevReleases,
        style: { flex: 1 },
      };

  return (
    <BaseModal
      visible={visible}
      onDismiss={downloading ? () => {} : onDismiss}
      title="GitHub Development Updates"
      subtitle="Search latest dev builds from GitHub releases"
      maxHeight="85%"
      scrollable
      actions={[
        {
          label: 'Close',
          mode: 'outlined',
          onPress: onDismiss,
          disabled: downloading,
          style: { flex: 1 },
        },
        primaryAction,
      ]}
    >
      <View style={{ paddingVertical: 4 }}>
        {loading ? (
          <View style={{ alignItems: 'center', paddingVertical: 24 }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text
              variant="bodySmall"
              style={{ marginTop: 10, color: colors.onSurfaceVariant }}
            >
              Checking GitHub for dev releases...
            </Text>
          </View>
        ) : error ? (
          <View style={{ paddingVertical: 8 }}>
            <Card
              style={{
                backgroundColor: colors.errorContainer || '#ffebee',
                marginBottom: 10,
              }}
              elevation={0}
            >
              <Card.Content
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <Icon source="alert-circle-outline" size={20} color={colors.error} />
                <Text
                  variant="bodySmall"
                  style={{ color: colors.error, marginLeft: 10, flex: 1 }}
                >
                  {error}
                </Text>
              </Card.Content>
            </Card>
            <Button
              mode="contained-tonal"
              compact
              icon="refresh"
              onPress={searchDevReleases}
              style={{ alignSelf: 'center' }}
            >
              Retry
            </Button>
          </View>
        ) : release ? (
          <View>
            <Card
              style={{
                backgroundColor: colors.surfaceVariant,
                marginBottom: 8,
              }}
              elevation={0}
            >
              <Card.Content style={{ paddingVertical: 10, paddingHorizontal: 12 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <Text
                    variant="titleMedium"
                    style={{ fontWeight: 'bold', flex: 1, marginRight: 8 }}
                    numberOfLines={1}
                  >
                    {release.name || release.tag_name}
                  </Text>
                  <Chip compact textStyle={{ fontSize: 12 }}>
                    {release.tag_name}
                  </Chip>
                </View>

                {release.apkAsset ? (
                  <View
                    style={{
                      backgroundColor: colors.surface,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: colors.outlineVariant || '#e0e0e0',
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <Icon source="android" size={26} color={colors.primary} />
                    <View style={{ marginLeft: 12, flex: 1 }}>
                      <Text
                        variant="bodyMedium"
                        style={{ fontWeight: '600' }}
                        numberOfLines={1}
                      >
                        {release.apkAsset.name}
                      </Text>
                      <Text
                        variant="bodySmall"
                        style={{ color: colors.onSurfaceVariant, marginTop: 2 }}
                      >
                        Size: {formatBytes(release.apkAsset.size)}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <HelperText type="info" padding="none">
                    No direct .apk asset attached.
                  </HelperText>
                )}

                {/* Target folder selection on Android */}
                {Platform.OS === 'android' && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 8,
                      paddingHorizontal: 4,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        flex: 1,
                        marginRight: 8,
                      }}
                    >
                      <Icon source="folder-outline" size={16} color={colors.primary} />
                      <Text
                        variant="labelSmall"
                        style={{ color: colors.onSurfaceVariant, marginLeft: 6 }}
                        numberOfLines={1}
                      >
                        Folder:{' '}
                        <Text
                          style={{
                            fontWeight: '600',
                            color: folderName ? colors.onSurface : colors.primary,
                          }}
                        >
                          {folderName || 'Tap to select folder'}
                        </Text>
                      </Text>
                    </View>
                    <Button
                      mode="text"
                      compact
                      disabled={downloading}
                      onPress={handleChangeFolder}
                      labelStyle={{ fontSize: 11, marginHorizontal: 2 }}
                    >
                      Change
                    </Button>
                  </View>
                )}

                {/* Download Progress Bar & Stats */}
                {downloading ? (
                  <View style={{ marginTop: 10 }}>
                    <ProgressBar
                      progress={downloadProgress}
                      color={colors.primary}
                      style={{ height: 6, borderRadius: 3 }}
                    />
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        marginTop: 4,
                      }}
                    >
                      <Text
                        variant="labelSmall"
                        style={{ color: colors.onSurfaceVariant }}
                      >
                        {downloadStats
                          ? `${formatBytes(downloadStats.written)} / ${formatBytes(downloadStats.total)}`
                          : 'Downloading...'}
                      </Text>
                      <Text
                        variant="labelSmall"
                        style={{ color: colors.primary, fontWeight: 'bold' }}
                      >
                        {Math.round(downloadProgress * 100)}%
                      </Text>
                    </View>
                  </View>
                ) : savedFilePath ? (
                  <View
                    style={{
                      marginTop: 10,
                      backgroundColor:
                        colors.elevation?.level1 || colors.surfaceVariant || '#f5f5f5',
                      padding: 10,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: colors.outlineVariant || '#e0e0e0',
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Icon
                        source="check-circle"
                        size={18}
                        color={colors.success || '#4caf50'}
                      />
                      <Text
                        variant="labelMedium"
                        style={{
                          color: colors.success || '#4caf50',
                          marginLeft: 8,
                          fontWeight: 'bold',
                          flex: 1,
                        }}
                      >
                        Saved to {folderName ? `"${folderName}"` : 'selected folder'}
                      </Text>
                    </View>
                    <Text
                      variant="labelSmall"
                      numberOfLines={2}
                      style={{
                        color: colors.onSurfaceVariant,
                        marginTop: 4,
                        fontSize: 11,
                      }}
                    >
                      {savedDisplayPath || savedFilePath}
                    </Text>
                    <Text
                      variant="labelSmall"
                      style={{
                        color: colors.primary,
                        marginTop: 6,
                        fontSize: 11,
                      }}
                    >
                      Tap "Open Folder" below to view the APK in your Files app and
                      install it.
                    </Text>
                  </View>
                ) : null}

                {downloadError ? (
                  <Text
                    variant="labelSmall"
                    style={{ color: colors.error, marginTop: 6 }}
                  >
                    {downloadError}
                  </Text>
                ) : null}

                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 8,
                  }}
                >
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    {release.published_at
                      ? `Released: ${new Date(release.published_at).toLocaleDateString(
                          undefined,
                          {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          },
                        )}`
                      : ''}
                  </Text>
                  <Button
                    mode="text"
                    compact
                    icon="open-in-new"
                    onPress={() => Linking.openURL(release.html_url)}
                    labelStyle={{ fontSize: 13, marginHorizontal: 2 }}
                    contentStyle={{ flexDirection: 'row-reverse' }}
                  >
                    View on GitHub
                  </Button>
                </View>
              </Card.Content>
            </Card>

            {release.body ? (
              <View style={{ marginBottom: 6 }}>
                <Text variant="titleSmall" style={{ fontWeight: '600', marginBottom: 6 }}>
                  Release Notes
                </Text>
                <Card
                  style={{
                    backgroundColor: colors.surface,
                    maxHeight: 140,
                  }}
                  elevation={0}
                >
                  <ScrollView nestedScrollEnabled style={{ padding: 10 }}>
                    <Text variant="bodySmall" style={{ lineHeight: 20 }}>
                      {release.body}
                    </Text>
                  </ScrollView>
                </Card>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </BaseModal>
  );
}
