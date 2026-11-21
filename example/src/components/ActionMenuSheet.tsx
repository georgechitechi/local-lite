import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BottomSheetModal } from './BottomSheetModal';

export interface ActionMenuItem {
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

export interface ActionMenuSheetProps {
  visible: boolean;
  title?: string;
  actions: ActionMenuItem[];
  onClose: () => void;
}

export function ActionMenuSheet({
  visible,
  title,
  actions,
  onClose,
}: ActionMenuSheetProps) {
  return (
    <BottomSheetModal visible={visible} onClose={onClose} title={title ?? 'Actions'}>
      <View style={styles.list}>
        {actions.map((item, idx) => (
          <TouchableOpacity
            key={`${item.label}-${idx}`}
            style={styles.item}
            onPress={() => {
              onClose();
              item.onPress();
            }}
          >
            <Text style={[styles.label, item.destructive && styles.destructive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 4,
  },
  item: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  destructive: {
    color: '#dc2626',
  },
});
