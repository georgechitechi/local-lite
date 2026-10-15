import React from 'react';
import { StyleSheet, View } from 'react-native';
import { RadioButton } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { addOpacity } from '@/shared/utils/helper';

interface SelectionItem {
  id: string;
  title: string;
  subtitle?: string;
  color?: string;
  disabled?: boolean;
}

interface StatusUpdateModalProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  subtitle?: string;
  items: SelectionItem[];
  onSelect: (id: string) => void;
  children?: React.ReactNode;
}

export default function StatusUpdateModal({
  visible,
  onDismiss,
  title,
  subtitle,
  items,
  onSelect,
  children,
}: StatusUpdateModalProps) {
  const colors = useThemeColors() as any;
  const [selectedValue, setSelectedValue] = React.useState<string | null>(null);

  const [initializedKey, setInitializedKey] = React.useState<string | null>(null);

  const handleDismiss = () => {
    setSelectedValue(null);
    setInitializedKey(null);
    onDismiss();
  };

  React.useEffect(() => {
    if (!visible) return;
    if (initializedKey === 'open') return;

    const current = items.find(item => item.disabled);
    if (current) {
      setSelectedValue(current.id);
    }
    setInitializedKey('open');
  }, [visible, items, initializedKey]);

  const handleUpdate = () => {
    if (selectedValue) {
      onSelect(selectedValue);
      handleDismiss();
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={handleDismiss}
      title={title}
      subtitle={subtitle}
      actions={[
        {
          label: 'Cancel',
          onPress: handleDismiss,
          mode: 'outlined',
        },
        {
          label: 'Update',
          onPress: handleUpdate,
          mode: 'contained',
          disabled: !selectedValue,
        },
      ]}
    >
      <View style={styles.container}>
        <RadioButton.Group
          onValueChange={value => setSelectedValue(value)}
          value={selectedValue || ''}
        >
          <View style={{ gap: 8 }}>
            {items.map(item => (
              <RadioButton.Item
                key={item.id}
                label={item.title}
                value={item.id}
                status={selectedValue === item.id ? 'checked' : 'unchecked'}
                disabled={item.disabled && selectedValue !== item.id}
                style={[
                  styles.radioItem,
                  { borderColor: colors.outline },
                  selectedValue === item.id && {
                    borderColor: item.color || colors.primary,
                    backgroundColor:
                      colors.primaryContainer ||
                      addOpacity(item.color || colors.primary, 0.12),
                  },
                ]}
                labelStyle={[
                  item.disabled && selectedValue !== item.id
                    ? styles.disabledText
                    : undefined,
                  selectedValue === item.id && {
                    color: colors.onPrimaryContainer || item.color || colors.primary,
                    fontWeight: 'bold',
                  },
                ]}
              />
            ))}
          </View>
        </RadioButton.Group>
        {children}
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  radioItem: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 4,
  },
  disabledText: {
    opacity: 0.5,
  },
});
