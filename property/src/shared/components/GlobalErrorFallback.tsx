import Storage from 'expo-sqlite/kv-store';
import type { FallbackProps } from 'react-error-boundary';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Text, useTheme } from 'react-native-paper';
import { safeReloadApp } from '@/shared/utils/safeReload';

export const GlobalErrorFallback = ({ error, resetErrorBoundary }: FallbackProps) => {
  const { colors } = useTheme();

  const handleHardReset = async () => {
    try {
      await Storage.clearAsync();
    } catch (e) {
      console.error('Failed to clear storage during hard reset:', e);
    } finally {
      await safeReloadApp();
    }
    resetErrorBoundary();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Card style={styles.card}>
        <Card.Content>
          <Text
            variant="headlineSmall"
            style={{
              color: colors.error,
              marginBottom: 8,
              fontWeight: 'bold',
              textAlign: 'center',
            }}
          >
            We hit an snag.
          </Text>

          <Text
            variant="bodyMedium"
            style={{ color: colors.onSurface, marginBottom: 16 }}
          >
            The app encountered an unexpected error.
          </Text>

          <View style={[styles.errorBox, { backgroundColor: colors.errorContainer }]}>
            <ScrollView style={{ maxHeight: 150 }}>
              <Text
                variant="bodySmall"
                style={{ color: colors.onErrorContainer, fontFamily: 'monospace' }}
              >
                {error instanceof Error ? error.message : String(error)}
              </Text>
            </ScrollView>
          </View>

          <Button
            mode="contained"
            onPress={resetErrorBoundary}
            style={styles.button}
            buttonColor={colors.primary}
          >
            Try Again
          </Button>

          <Button
            mode="outlined"
            onPress={handleHardReset}
            style={{ ...styles.button, borderColor: colors.error }}
            textColor={colors.error}
          >
            Reset App State
          </Button>
        </Card.Content>
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    elevation: 4,
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
  },
  button: {
    marginVertical: 4,
  },
});
