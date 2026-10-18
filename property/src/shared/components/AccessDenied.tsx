import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';

export interface AccessDeniedProps {
  title?: string;
  message?: string;
  showBackButton?: boolean;
}

export default function AccessDenied({
  title = 'Access Denied',
  message = 'You do not have permission to view this page.',
  showBackButton = true,
}: AccessDeniedProps) {
  const router = useRouter();
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <MaterialCommunityIcons
        name="shield-lock-outline"
        size={80}
        color={theme.colors.error}
        style={styles.icon}
      />
      <Text variant="titleLarge" style={[styles.title, { color: theme.colors.error }]}>
        {title}
      </Text>
      <Text variant="titleMedium" style={styles.message}>
        {message}
      </Text>
      {showBackButton && (
        <Button
          mode="contained"
          onPress={() => router.replace('/')}
          style={styles.button}
          labelStyle={styles.buttonLabel}
        >
          Go Back
        </Button>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  icon: {
    marginBottom: 16,
    opacity: 0.9,
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  message: {
    textAlign: 'center',
    opacity: 0.7,
    marginBottom: 24,
  },
  button: {
    borderRadius: 8,
    paddingHorizontal: 16,
  },
  buttonLabel: {
    fontSize: 16,
  },
});
