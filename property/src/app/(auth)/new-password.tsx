import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { useIdleLock } from '@/providers/LockScreenProvider';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { updatePassword } from '@/shared/services/auth';
import { supabase } from '@/shared/services/supabase';

export default function NewPasswordScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { checkOnline, isOnline } = useOfflineCheck();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    pauseAutoLock();
    return () => resumeAutoLock();
  }, [pauseAutoLock, resumeAutoLock]);

  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleUpdatePassword = async () => {
    if (!checkOnline('Password Update')) return;

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setError('');
    pauseAutoLock();
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        throw new Error(
          'Your reset session has expired. Please request a new password reset link.',
        );
      }

      await updatePassword(password);

      showSnackbar('Your password has been updated successfully', 'success');
      router.replace('/(auth)/login');
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
      resumeAutoLock();
    }
  };

  return (
    <KeyboardScroll
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      safeAreaBackgroundColor={colors.background}
    >
      <Text
        variant="headlineMedium"
        style={[styles.title, { color: colors.onBackground }]}
      >
        Set New Password
      </Text>
      <Text
        variant="bodyLarge"
        style={[styles.subtitle, { color: colors.onSurfaceVariant }]}
      >
        Please enter your new password
      </Text>

      <TextInput
        label="New Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        right={
          <TextInput.Icon
            icon={showPassword ? 'eye-off' : 'eye'}
            onPress={() => setShowPassword(prev => !prev)}
          />
        }
        style={[styles.input, { backgroundColor: colors.surface }]}
        error={!!error}
      />

      <TextInput
        label="Confirm New Password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        style={[styles.input, { backgroundColor: colors.surface }]}
        error={!!error}
      />

      {error ? <HelperText type="error">{error}</HelperText> : null}

      <Button
        mode="contained"
        onPress={handleUpdatePassword}
        style={[styles.button, !isOnline && { opacity: 0.5 }]}
        loading={loading}
        disabled={loading}
      >
        Update Password
      </Button>
    </KeyboardScroll>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    marginBottom: 16,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: 32,
  },
  input: {
    marginBottom: 16,
  },
  button: {
    marginTop: 16,
  },
});
