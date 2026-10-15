import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Dimensions, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, FAB, ProgressBar, Text } from 'react-native-paper';
import { v4 as uuidv4 } from 'uuid';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useIdleLock } from '@/providers/LockScreenProvider';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import { FullscreenImage, GalleryItem } from '@/shared/components/GalleryComponents';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import {
  useCoreMutations,
  useGalleryImages,
  useStoreRefresh,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { deleteImage, uploadImage } from '@/shared/services/fileUpload';
import { EMPTY_ARRAY } from '@/shared/utils/helper';

const { width } = Dimensions.get('window');

export default function GalleryScreen() {
  const { selectedBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const colors = useThemeColors();
  const { checkOnline } = useOfflineCheck();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();

  const { isSyncActive: isCloudSyncEnabled } = useLocalSync();

  // Use local-lite SQLite hook for gallery images
  const images = useGalleryImages(selectedBusiness?.id);
  const { refreshing, onRefresh } = useStoreRefresh();
  const { insert, delete: deleteRecord } = useCoreMutations();

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isEditMode, setIsEditMode] = useState(false);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [viewModalVisible, setViewModalVisible] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({
    total: 0,
    current: 0,
    visible: false,
  });

  const handlePickImage = async () => {
    if (isCloudSyncEnabled && !checkOnline('Upload Photo')) return;
    try {
      // Prevent screen locking during picker and upload
      pauseAutoLock();

      // Request permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showSnackbar(
          'Sorry, we need camera roll permissions to make this work!',
          'error',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.5,
      });

      if (
        !result.canceled &&
        result.assets &&
        result.assets.length > 0 &&
        selectedBusiness?.id
      ) {
        const totalCount = result.assets.length;
        setUploadStatus({ total: totalCount, current: 0, visible: true });
        setUploading(true);

        let completedCount = 0;
        // Upload each asset and update progress
        // Use offlineSupport: true to enable queuing and optimistic URLs
        await Promise.all(
          result.assets.map(async asset => {
            try {
              let publicUrl = '';
              let newId = uuidv4();
              let fileName = `${uuidv4()}.${asset.uri.split('.').pop()}`;

              if (isCloudSyncEnabled) {
                const uploadRes = await uploadImage(
                  { uri: asset.uri, mimeType: asset.mimeType },
                  'public-assets',
                  'images',
                  selectedBusiness.id,
                  { offlineSupport: true },
                );
                publicUrl = uploadRes.publicUrl;
                fileName = uploadRes.filePath.split('/').pop() || fileName;
                newId = uploadRes.uploadId || newId;
              } else {
                // Local only - use the asset URI directly since it's already in the cache directory
                publicUrl = asset.uri;
              }

              // Add to local SQLite store immediately via local-lite
              if (insert) {
                await insert('gallery_images', {
                  name: fileName,
                  url: publicUrl,
                  id: newId,
                  business_id: selectedBusiness.id,
                });
              }

              completedCount++;
              setUploadStatus(prev => ({ ...prev, current: completedCount }));
            } catch (error) {
              console.error('Error uploading individual image:', error);
            }
          }),
        );

        setUploadStatus({ total: 0, current: 0, visible: false });
      }
    } catch (error: any) {
      console.error('Error uploading image:', error);
      showSnackbar('Failed to upload image. Make sure file size is reasonable.', 'error');
    } finally {
      setUploading(false);
      resumeAutoLock();
    }
  };

  const handleDeleteImage = async () => {
    const imgToDelete = images[selectedImageIndex];
    if (!imgToDelete || !selectedBusiness?.id) return;

    try {
      setLoading(true);
      if (isCloudSyncEnabled) {
        if (!checkOnline('Delete Photo')) return;
        const path = `images/${selectedBusiness.id}/${imgToDelete.name}`;

        // Delete from storage
        await deleteImage('public-assets', path);
      }

      // Delete locally
      if (deleteRecord) {
        await deleteRecord('gallery_images', imgToDelete.id);
      }

      setDeleteDialogVisible(false);
      showSnackbar('Image removed from gallery', 'success');
    } catch (error: any) {
      console.error('Error deleting image:', error);
      showSnackbar('Failed to delete image', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openImageViewer = (index: number) => {
    setSelectedImageIndex(index);
    setViewModalVisible(true);
  };

  // Initial loading state
  if (loading && images.length === 0) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text
          variant="bodyMedium"
          style={{ marginTop: 16, color: colors.onSurfaceVariant }}
        >
          Syncing your gallery...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {isEditMode && (
          <View
            style={{
              paddingHorizontal: 12,
              paddingBottom: 8,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text variant="labelLarge" style={{ color: colors.error }}>
              Edit Mode: Tap icons to delete
            </Text>
            <Button
              mode="text"
              onPress={() => setIsEditMode(false)}
              textColor={colors.primary}
            >
              Done
            </Button>
          </View>
        )}

        {images.length === 0 ? (
          <EmptyState
            icon="image-plus"
            title="Gallery is Empty"
            description="Add photos of your business to showcase it to potential tenants"
            iconSize={80}
            style={{ paddingVertical: 60 }}
          >
            <Button
              mode="contained"
              onPress={handlePickImage}
              style={{ marginTop: 24, paddingHorizontal: 32 }}
              icon="upload"
            >
              Upload First Photo
            </Button>
          </EmptyState>
        ) : (
          <View style={styles.grid}>
            {images.map((img, index) => (
              <GalleryItem
                key={img.name + index}
                img={img}
                index={index}
                isEditMode={isEditMode}
                onOpen={openImageViewer}
                onLongPress={() => setIsEditMode(true)}
                onDelete={idx => {
                  setSelectedImageIndex(idx);
                  setDeleteDialogVisible(true);
                }}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {images.length > 0 && (
        <FAB
          icon="camera-plus"
          label="Upload"
          style={[styles.fab, { backgroundColor: colors.primary }]}
          color={colors.onPrimary}
          onPress={handlePickImage}
          loading={uploading}
          disabled={uploading}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <BaseModal
        mode="confirm"
        visible={deleteDialogVisible}
        onDismiss={() => setDeleteDialogVisible(false)}
        onConfirm={handleDeleteImage}
        title="Delete Photo"
        message="Permanently remove this photo from your business gallery?"
        confirmText="Delete"
        cancelText="Keep it"
        loading={loading}
        destructive={true}
      />

      {/* Full Screen Image Viewer */}
      <BaseModal
        visible={viewModalVisible}
        onDismiss={() => setViewModalVisible(false)}
        title={`Image Preview (${selectedImageIndex + 1}/${images.length || 0})`}
        subtitle="Manage your businesses"
        edgeToEdge
        maxHeight="100%"
        rounded={false}
      >
        <View style={{ backgroundColor: colors.scrim || '#000', height: '100%' }}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={event => {
              const index = Math.round(
                event.nativeEvent.contentOffset.x /
                  event.nativeEvent.layoutMeasurement.width,
              );
              setSelectedImageIndex(index);
            }}
            contentOffset={{ x: selectedImageIndex * width, y: 0 }}
          >
            {images.map((img, index) => (
              <FullscreenImage key={index} url={img.url} />
            ))}
          </ScrollView>
        </View>
      </BaseModal>

      <BaseModal
        visible={uploadStatus.visible}
        title="Optimizing and Uploading"
        subtitle="Manage your businesses"
        onDismiss={() => setUploadStatus({ visible: false, current: 0, total: 0 })}
      >
        <View style={{ alignItems: 'center', paddingVertical: 10 }}>
          <ProgressBar
            progress={
              uploadStatus.total > 0 ? uploadStatus.current / uploadStatus.total : 0
            }
            color={colors.primary}
            style={{ width: '100%', height: 10, borderRadius: 5 }}
          />
          <Text variant="bodyLarge" style={{ marginTop: 20, fontWeight: 'bold' }}>
            {uploadStatus.current} of {uploadStatus.total} Photos Processed
          </Text>
          <Text
            variant="bodySmall"
            style={{ marginTop: 8, color: colors.onSurfaceVariant }}
          >
            Please stay on this screen to ensure successful sync
          </Text>
        </View>
      </BaseModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 12,
    paddingBottom: 100,
    flexGrow: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 4,
  },
  fab: {
    position: 'absolute',
    margin: 24,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    elevation: 4,
  },
});
