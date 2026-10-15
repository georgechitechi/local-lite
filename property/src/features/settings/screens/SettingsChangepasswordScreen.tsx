import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Divider, HelperText, Text, TextInput } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { updatePassword } from '@/shared/services/auth';

export default function ChangePasswordScreen() {
  const { user } = useAuth();

  const colors = useThemeColors();
  const router = useRouter();
  const { signIn, signOut } = useAuth();
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Password change states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handlePasswordChange = async () => {
    if (!currentPassword) {
      setError('Current password is required');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match');
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (!user?.email) {
        throw new Error('Unable to verify your account. Please sign in again.');
      }

      const { error: signInError } = await signIn({
        email: user.email,
        password: currentPassword,
      });

      if (signInError) throw signInError;

      await updatePassword(newPassword);
      setNewPassword('');
      setConfirmNewPassword('');
      router.push('/settings/profile');
      showSnackbar('Password updated successfully', 'success');
    } catch (err) {
      const error = err as { message?: string };
      if (error?.message === 'Invalid login credentials') {
        setError('Current password is incorrect');
      } else {
        setError(error?.message || 'An error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      const error = err as { message?: string };
      setError(error?.message || 'An error occurred');
    }
  };

  return (
    <KeyboardScroll
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <View>
        <TextInput
          label="Name"
          value={user?.user_metadata?.name || user?.user_metadata?.full_name || ''}
          disabled
          style={styles.input}
        />
        <TextInput
          label="Email"
          value={user?.email || ''}
          disabled
          style={styles.input}
        />
      </View>

      <Divider style={styles.divider} />

      <View>
        <Text variant="titleMedium" style={styles.sectionTitle}>
          Change Password
        </Text>

        <TextInput
          label="Current Password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry={!showPassword}
          right={
            <TextInput.Icon
              icon={showPassword ? 'eye-off' : 'eye'}
              onPress={() => setShowPassword(!showPassword)}
            />
          }
          style={styles.input}
        />

        <TextInput
          label="New Password"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry={!showPassword}
          style={styles.input}
        />

        <TextInput
          label="Confirm New Password"
          value={confirmNewPassword}
          onChangeText={setConfirmNewPassword}
          secureTextEntry={!showPassword}
          style={styles.input}
        />

        {error ? <HelperText type="error">{error}</HelperText> : null}

        <Button
          mode="contained"
          onPress={handlePasswordChange}
          loading={loading}
          style={styles.button}
        >
          Update Password
        </Button>
        <Divider style={styles.divider} />

        <Button mode="outlined" onPress={handleSignOut} style={styles.signOutButton}>
          Sign Out
        </Button>
      </View>
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
  sectionTitle: {
    marginBottom: 10,
  },
  input: {
    marginBottom: 8,
  },
  button: {
    marginTop: 10,
  },
  divider: {
    marginVertical: 10,
  },
  signOutButton: {
    marginTop: 10,
  },
});
