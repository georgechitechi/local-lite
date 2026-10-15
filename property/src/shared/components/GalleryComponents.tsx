import { Dimensions, StyleSheet, View } from 'react-native';
import { Card, IconButton } from 'react-native-paper';
import CachedImage from '@/shared/components/CachedImage';
import SPressable from '@/shared/components/SlightPressable';

const { width } = Dimensions.get('window');

const IMAGE_SIZE = (width - 60) / 2;

export interface GalleryImage {
  name: string;
  url: string;
  id: string | null;
}

/**
 * Gallery Item sub-component with offline sync support
 */
export function GalleryItem({
  img,
  index,
  isEditMode,
  onOpen,
  onLongPress,
  onDelete,
}: {
  img: GalleryImage;
  index: number;
  isEditMode: boolean;
  onOpen: (idx: number) => void;
  onLongPress: () => void;
  onDelete: (idx: number) => void;
}) {
  return (
    <SPressable
      onPress={() => (isEditMode ? null : onOpen(index))}
      onLongPress={onLongPress}
      activeOpacity={0.8}
      style={styles.imageCardWrapper}
    >
      <Card style={styles.imageCard}>
        <CachedImage uri={img.url} style={styles.imageThumbnail} />
        {isEditMode && (
          <IconButton
            icon="delete"
            size={20}
            containerColor="rgba(0,0,0,0.6)"
            iconColor="white"
            style={styles.deleteIcon}
            onPress={e => {
              e.stopPropagation();
              onDelete(index);
            }}
          />
        )}
      </Card>
    </SPressable>
  );
}

/**
 * Fullscreen Image sub-component with offline sync support
 */
export function FullscreenImage({ url }: { url: string }) {
  return (
    <View style={[styles.fullImageContainer, { width: width }]}>
      <CachedImage uri={url} style={styles.fullImage} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  imageCardWrapper: {
    padding: 6,
  },
  imageCard: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    borderRadius: 16,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    elevation: 2,
  },
  imageThumbnail: {
    width: '100%',
    height: '100%',
  },
  deleteIcon: {
    position: 'absolute',
    top: -4,
    right: -4,
    margin: 0,
  },
  fullImageContainer: {
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
});
