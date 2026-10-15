import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { useIdleLock } from '@/providers/LockScreenProvider';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { requestPasswordResetOtp, verifyPasswordResetOtp } from '@/shared/services/auth';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { checkOnline, isOnline } = useOfflineCheck();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();

  useEffect(() => {
    pauseAutoLock();
    return () => resumeAutoLock();
  }, [pauseAutoLock, resumeAutoLock]);

  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<'request' | 'verify'>('request');

  const handleRequestOtp = async () => {
    if (!checkOnline('Reset Password')) return;
    if (!email) {
      setError('Email is required');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await requestPasswordResetOtp(email);
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!checkOnline('Verify OTP')) return;
    if (otp.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await verifyPasswordResetOtp(email, otp);
      // Navigation to new password happens on successful verification
      router.replace('/(auth)/new-password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code, please try again');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'verify') {
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
          Check Your Email
        </Text>
        <Text
          variant="bodyLarge"
          style={[styles.message, { color: colors.onSurfaceVariant }]}
        >
          We&apos;ve sent a 6-digit code to {email}. Please enter it below to reset your
          password.
        </Text>

        <TextInput
          label="6-digit Code"
          value={otp}
          onChangeText={setOtp}
          keyboardType="number-pad"
          maxLength={6}
          style={[styles.input, { backgroundColor: colors.surface }]}
          error={!!error}
        />
        {error ? <HelperText type="error">{error}</HelperText> : null}

        <Button
          mode="contained"
          onPress={handleVerifyOtp}
          style={[styles.button, !isOnline && { opacity: 0.5 }]}
          loading={loading}
          disabled={loading || otp.length !== 6}
        >
          Verify Code
        </Button>

        <Button
          mode="text"
          onPress={() => {
            setStep('request');
            setOtp('');
            setError('');
          }}
          disabled={loading}
        >
          Use a different email
        </Button>
      </KeyboardScroll>
    );
  }

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
        Reset Password
      </Text>
      <Text
        variant="bodyLarge"
        style={[styles.subtitle, { color: colors.onSurfaceVariant }]}
      >
        Enter your email address and we&apos;ll send you a 6-digit code to reset your
        password.
      </Text>

      <TextInput
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        style={[styles.input, { backgroundColor: colors.surface }]}
        error={!!error}
      />
      {error ? <HelperText type="error">{error}</HelperText> : null}

      <Button
        mode="contained"
        onPress={handleRequestOtp}
        style={[styles.button, !isOnline && { opacity: 0.5 }]}
        loading={loading}
        disabled={loading}
      >
        Send Code
      </Button>

      <Button mode="text" onPress={() => router.back()}>
        Back to Login
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
  message: {
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  input: {
    marginBottom: 16,
  },
  button: {
    marginBottom: 16,
  },
});
