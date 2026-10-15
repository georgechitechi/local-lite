import { StyleSheet } from 'react-native';
import { ActivityIndicator, Modal, Portal, Text } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
  subtitle?: string;
}

export default function LoadingOverlay({
  visible,
  message = 'Loading...',
  subtitle,
}: LoadingOverlayProps) {
  const colors = useThemeColors();

  if (!visible) return null;

  return (
    <Portal>
      <Modal
        visible={visible}
        dismissable={false}
        onDismiss={() => {}}
        contentContainerStyle={[styles.container, { backgroundColor: colors.surface }]}
      >
        <ActivityIndicator animating={true} size="large" color={colors.primary} />
        {message ? (
          <Text variant="titleMedium" style={[styles.text, { color: colors.onSurface }]}>
            {message}
          </Text>
        ) : null}
        {subtitle ? (
          <Text
            variant="bodyMedium"
            style={[styles.subtitle, { color: colors.onSurfaceVariant }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    paddingHorizontal: 24,
    paddingVertical: 48,
    minHeight: 220,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    marginTop: 16,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  subtitle: {
    marginTop: 8,
    textAlign: 'center',
  },
});
