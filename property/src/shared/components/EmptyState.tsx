import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  iconColor?: string;
  iconSize?: number;
  style?: ViewStyle;
  children?: React.ReactNode;
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  iconColor,
  iconSize = 48,
  style,
  children,
}: EmptyStateProps) {
  const colors = useThemeColors();

  return (
    <View style={[styles.container, style]}>
      {icon && (
        <MaterialCommunityIcons
          name={icon as any}
          size={iconSize}
          color={iconColor || colors.onSurfaceDisabled}
          style={styles.icon}
        />
      )}
      <Text variant="titleMedium" style={styles.title}>
        {title}
      </Text>
      {description && (
        <Text
          variant="bodyMedium"
          style={[styles.description, { color: colors.onSurfaceVariant }]}
        >
          {description}
        </Text>
      )}
      {actionLabel && onAction && (
        <Button mode="outlined" onPress={onAction} style={styles.button}>
          {actionLabel}
        </Button>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    textAlign: 'center',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  description: {
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    marginTop: 8,
  },
});
