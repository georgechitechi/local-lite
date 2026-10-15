import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { useAuth } from '@/providers/AuthProvider';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { validateFields, validations } from '@/shared/utils/validations';

interface FormState {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export default function SignUpScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { signUp } = useAuth();
  const { checkOnline, isOnline } = useOfflineCheck();

  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const updateField = (field: keyof FormState, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const validateForm = (): boolean => {
    const result = validateFields(form, {
      name: validations.required,
      email: validations.combine(validations.required, validations.email),
      password: validations.combine(validations.required, validations.minLength(6)),
      confirmPassword: validations.required,
    });
    const newErrors = { ...result.errors };
    if (form.password && form.confirmPassword && form.password !== form.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSignUp = async () => {
    if (!checkOnline('Sign Up')) return;
    if (!validateForm()) return;

    setLoading(true);
    setError('');

    try {
      const result = await signUp({
        email: form.email,
        password: form.password,
        name: form.name,
      });

      if (result.error) {
        throw result.error;
      }

      // Navigation will be handled by AuthProvider and root layout
      router.replace('/(tabs)');
    } catch (err: any) {
      let errorMessage = 'Sign up failed. Please try again.';

      const errorCode = err?.code || '';
      const errorMsg = err?.message || '';

      if (
        errorCode === 'user_already_exists' ||
        errorMsg.includes('already registered')
      ) {
        errorMessage = 'An account with this email already exists. Please login.';
      } else if (errorCode === 'weak_password' || errorMsg.includes('weak password')) {
        errorMessage = 'Password is too weak. Please use a stronger password.';
      } else if (errorMsg.includes('Network') || errorMsg.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardScroll
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { flexGrow: 1, justifyContent: 'center' }]}
      safeAreaBackgroundColor={colors.background}
    >
      <View style={styles.header}>
        <Text
          variant="headlineLarge"
          style={[styles.title, { color: colors.onBackground }]}
        >
          Create Account
        </Text>
        <Text
          variant="bodyLarge"
          style={[styles.subtitle, { color: colors.onSurfaceVariant }]}
        >
          Sign up to get started
        </Text>
      </View>

      {error ? (
        <HelperText type="error" style={styles.submitError}>
          {error}
        </HelperText>
      ) : null}

      <TextInput
        label="Name"
        value={form.name}
        onChangeText={text => updateField('name', text)}
        autoCapitalize="words"
        style={[styles.input, { backgroundColor: colors.surface }]}
        error={!!errors.name}
      />
      {errors.name && <HelperText type="error">{errors.name}</HelperText>}

      <TextInput
        label="Email"
        value={form.email}
        onChangeText={text => updateField('email', text)}
        keyboardType="email-address"
        autoCapitalize="none"
        style={[styles.input, { backgroundColor: colors.surface }]}
        error={!!errors.email}
      />
      {errors.email && <HelperText type="error">{errors.email}</HelperText>}

      <TextInput
        label="Password"
        value={form.password}
        autoCapitalize="none"
        onChangeText={text => updateField('password', text)}
        secureTextEntry={!showPassword}
        right={
          <TextInput.Icon
            icon={showPassword ? 'eye-off' : 'eye'}
            onPress={() => setShowPassword(prev => !prev)}
          />
        }
        style={[styles.input, { backgroundColor: colors.surface }]}
        error={!!errors.password}
      />
      {errors.password && <HelperText type="error">{errors.password}</HelperText>}

      <TextInput
        label="Confirm Password"
        value={form.confirmPassword}
        autoCapitalize="none"
        onChangeText={text => updateField('confirmPassword', text)}
        secureTextEntry={!showConfirmPassword}
        right={
          <TextInput.Icon
            icon={showConfirmPassword ? 'eye-off' : 'eye'}
            onPress={() => setShowConfirmPassword(prev => !prev)}
          />
        }
        style={[styles.input, { backgroundColor: colors.surface }]}
        error={!!errors.confirmPassword}
      />
      {errors.confirmPassword && (
        <HelperText type="error">{errors.confirmPassword}</HelperText>
      )}

      <Button
        mode="contained"
        onPress={handleSignUp}
        loading={loading}
        disabled={loading}
        style={[styles.button, !isOnline && { opacity: 0.5 }]}
      >
        Sign Up
      </Button>

      <Button
        mode="text"
        onPress={() => router.push('/(auth)/login')}
        style={styles.loginButton}
      >
        Already have an account? Sign In
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
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    marginBottom: 8,
    fontWeight: 'bold',
  },
  subtitle: {
    textAlign: 'center',
  },
  input: {
    marginBottom: 8,
  },
  button: {
    marginTop: 8,
    marginBottom: 16,
  },
  submitError: {
    textAlign: 'center',
    marginBottom: 4,
  },
  loginButton: {
    marginTop: 8,
  },
});
