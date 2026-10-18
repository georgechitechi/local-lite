import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { useAuth } from '@/providers/AuthProvider';
import { useBiometric } from '@/providers/BiometricAuthProvider';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import SPressable from '@/shared/components/SlightPressable';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { secureStorage } from '@/shared/services/secureStorage';
import { supabase } from '@/shared/services/supabase';
import { validateFields, validations } from '@/shared/utils/validations';

interface FormErrors {
  email?: string;
  password?: string;
}

export default function LoginScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { signIn } = useAuth();
  const {
    isBiometricSupported,
    isBiometricEnabled,
    authenticateWithBiometric,
    enableBiometric,
    isAuthenticating,
  } = useBiometric();
  const { checkOnline, isOnline } = useOfflineCheck();

  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const validateForm = (): boolean => {
    const result = validateFields(
      { email, password },
      {
        email: validations.required,
        password: validations.required,
      },
    );
    setErrors(result.errors);
    return result.isValid;
  };

  const handleLogin = async () => {
    if (!checkOnline('Login')) return;
    if (!validateForm()) return;

    setLoading(true);
    setError('');

    try {
      const result = await signIn({
        email,
        password,
      });

      if (result.error) {
        throw result.error;
      }

      if (Platform.OS !== 'web' && isBiometricSupported) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.refresh_token) {
            await secureStorage.setItem('userEmail', email);
            await secureStorage.setItem('refreshToken', session.refresh_token);

            const existingBiometricSetting =
              await secureStorage.getItem('biometricEnabled');

            if (existingBiometricSetting === null) {
              const wantsToEnable = await new Promise<boolean>(resolve => {
                Alert.alert(
                  'Enable Biometric Login',
                  'Would you like to enable biometric login for faster access?',
                  [
                    { text: 'Not Now', onPress: () => resolve(false), style: 'cancel' },
                    { text: 'Enable', onPress: () => resolve(true) },
                  ],
                );
              });

              if (wantsToEnable) {
                const enableResult = await enableBiometric();
                if (!enableResult.success) {
                  console.log('User cancelled or failed biometric setup during login');
                }
              } else {
                await secureStorage.setItem('biometricEnabled', false);
              }
            } else if (existingBiometricSetting !== false) {
              await secureStorage.setItem('biometricEnabled', true);
            }
          }
        } catch (storageError) {
          console.error('Error storing refresh token for biometric auth:', storageError);
        }
      }

      router.replace('/(tabs)');
    } catch (err: any) {
      let errorMessage = 'Login failed. Please try again.';

      const errorCode = err?.code || '';
      const errorMsg = err?.message || '';

      if (
        errorCode === 'invalid_credentials' ||
        errorCode === 'invalid_grant' ||
        errorMsg.toLowerCase().includes('invalid login credentials') ||
        errorMsg.toLowerCase().includes('invalid email or password')
      ) {
        errorMessage = 'Invalid email or password. Please try again.';
      } else if (
        errorCode === 'email_not_confirmed' ||
        errorMsg.includes('Email not confirmed')
      ) {
        errorMessage = 'Please verify your email before signing in.';
      } else if (errorCode === 'user_not_found' || errorMsg.includes('User not found')) {
        errorMessage = 'No account found with this email. Please sign up.';
      } else if (errorMsg.includes('Network') || errorMsg.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    if (Platform.OS === 'web') {
      setError('Biometric authentication is not available on web.');
      return;
    }

    if (!isBiometricSupported) {
      setError('Biometric authentication is not available on this device.');
      return;
    }

    if (!isBiometricEnabled) {
      setError('Please enable biometric authentication in settings first.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const result = await authenticateWithBiometric();

      if (!result.success) {
        setError(result.error || 'Biometric authentication failed');
        return;
      }

      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Biometric login error:', error);
      setError('Biometric authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const { isDemoMode } = useLocalSync();

  return (
    <KeyboardScroll
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      safeAreaBackgroundColor={colors.background}
    >
      <View style={styles.header}>
        <Text
          variant="headlineLarge"
          style={[styles.title, { color: colors.onBackground }]}
        >
          Welcome Back
        </Text>
        <Text
          variant="bodyLarge"
          style={[styles.subtitle, { color: colors.onSurfaceVariant }]}
        >
          Sign in to manage your Businesses
        </Text>
      </View>

      {error ? (
        <HelperText type="error" style={styles.submitError}>
          {error}
        </HelperText>
      ) : null}

      {isDemoMode ? (
        <View style={styles.demoModeContainer}>
          <Text
            variant="bodyLarge"
            style={[styles.demoModeText, { color: colors.onSurface }]}
          >
            To use this app, you need to set up Cloud Sync first.
          </Text>
          <Button
            mode="contained"
            onPress={() => router.push('/(tabs)/settings/cloud-sync')}
            style={styles.demoModeButton}
          >
            Set Up Cloud Sync
          </Button>
        </View>
      ) : (
        <>
          <TextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            style={[styles.input, { backgroundColor: colors.surface }]}
            error={!!errors.email}
          />
          {errors.email && <HelperText type="error">{errors.email}</HelperText>}

          <TextInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            right={
              <TextInput.Icon
                icon={showPassword ? 'eye-off' : 'eye'}
                onPress={() => setShowPassword(!showPassword)}
              />
            }
            style={[styles.input, { backgroundColor: colors.surface }]}
            error={!!errors.password}
          />
          {errors.password && <HelperText type="error">{errors.password}</HelperText>}

          <Button
            mode="text"
            onPress={() => router.push('/(auth)/reset-password')}
            style={styles.forgotPassword}
          >
            Forgot Password?
          </Button>

          <Button
            mode="contained"
            onPress={handleLogin}
            loading={loading}
            disabled={loading || isAuthenticating}
            style={[styles.button, !isOnline && { opacity: 0.5 }]}
          >
            Sign In
          </Button>

          {Platform.OS !== 'web' && isBiometricSupported && isBiometricEnabled && (
            <View style={styles.biometricContainer}>
              <SPressable
                style={[
                  styles.biometricButton,
                  {
                    backgroundColor: colors.surfaceVariant,
                    borderColor: colors.primary,
                  },
                ]}
                onPress={handleBiometricLogin}
                disabled={isAuthenticating || loading}
              >
                {isAuthenticating ? (
                  <MaterialCommunityIcons
                    name="loading"
                    size={44}
                    color={colors.primary}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name="fingerprint"
                    size={44}
                    color={colors.primary}
                  />
                )}
              </SPressable>
              <Text style={[styles.biometricText, { color: colors.onSurfaceVariant }]}>
                {isAuthenticating ? 'Authenticating...' : 'Login with Biometrics'}
              </Text>
            </View>
          )}

          <View style={styles.legalLinks}>
            <Text
              variant="bodySmall"
              style={[styles.legalText, { color: colors.onSurfaceVariant }]}
            >
              By continuing, you agree to our{'\n'}
              <Text
                variant="bodySmall"
                style={[styles.link, { color: colors.primary }]}
                onPress={() => router.push('/(auth)/terms-of-use')}
              >
                Terms of Use
              </Text>{' '}
              and{' '}
              <Text
                variant="bodySmall"
                style={[styles.link, { color: colors.primary }]}
                onPress={() => router.push('/(auth)/privacy-policy')}
              >
                Privacy Policy
              </Text>
            </Text>
          </View>

          <Button
            mode="text"
            onPress={() => router.push('/(auth)/sign-up')}
            style={styles.signUpButton}
          >
            Don&apos;t have an account? Sign Up
          </Button>
        </>
      )}
    </KeyboardScroll>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 32,
    alignItems: 'center',
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {},
  input: {
    marginBottom: 8,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  button: {
    marginBottom: 24,
    paddingVertical: 6,
  },
  legalLinks: {
    marginBottom: 24,
    alignItems: 'center',
  },
  legalText: {
    textAlign: 'center',
    lineHeight: 18,
  },
  link: {
    fontWeight: 'bold',
  },
  signUpButton: {
    marginTop: 8,
  },
  biometricContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  biometricButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    marginBottom: 8,
  },
  biometricText: {
    fontSize: 14,
    textAlign: 'center',
  },
  submitError: {
    marginBottom: 16,
    textAlign: 'center',
  },
  demoModeContainer: {
    alignItems: 'center',
    marginVertical: 24,
    padding: 16,
  },
  demoModeText: {
    textAlign: 'center',
    marginBottom: 16,
  },
  demoModeButton: {
    paddingVertical: 6,
  },
});
