import type { ReactNode } from 'react';
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type DimensionValue,
} from 'react-native';

export interface BottomSheetModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  maxHeight?: DimensionValue;
  children: ReactNode;
}

export function BottomSheetModal({
  visible,
  onClose,
  title,
  maxHeight = '85%',
  children,
}: BottomSheetModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={[
            styles.overlay,
            Platform.OS === 'web' && ({ backdropFilter: 'blur(3px)' } as any),
          ]}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.container, { maxHeight }]}>
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>

          {title !== undefined && (
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>
          )}

          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  container: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderColor: '#e2e8f0',
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  closeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  closeText: {
    fontSize: 18,
    color: '#64748b',
    fontWeight: '600',
  },
});
