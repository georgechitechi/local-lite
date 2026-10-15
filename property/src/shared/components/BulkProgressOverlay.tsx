import { StyleSheet, View } from 'react-native';
import { Portal, ProgressBar, Surface, Text } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface BulkProgressOverlayProps {
  progress: { current: number; total: number; label: string } | null;
  isEmail: boolean;
}

export default function BulkProgressOverlay({
  progress,
  isEmail,
}: BulkProgressOverlayProps) {
  const colors = useThemeColors();

  if (!progress) return null;

  return (
    <Portal>
      <View style={[styles.overlay, { backgroundColor: 'rgba(0, 0, 0, 0.7)' }]}>
        <Surface style={styles.card} elevation={5}>
          <Text variant="titleMedium" style={{ textAlign: 'center' }}>
            {isEmail ? 'Sending Emails…' : 'Sending SMS…'}
          </Text>
          <ProgressBar
            progress={progress.total > 0 ? progress.current / progress.total : 0}
            color={colors.primary}
            style={{ height: 8, borderRadius: 4 }}
          />
          <Text
            variant="bodySmall"
            style={{ textAlign: 'center', color: colors.onSurfaceVariant }}
          >
            {progress.current} of {progress.total}
            {progress.label && progress.label !== 'Preparing…'
              ? ` — ${progress.label}`
              : progress.label === 'Preparing…'
                ? ' — Preparing…'
                : ''}
          </Text>
        </Surface>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  card: {
    width: '80%',
    borderRadius: 16,
    padding: 24,
    gap: 16,
  },
});
