import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import LoadingCard from '@/shared/components/LoadingCard';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { supabase } from '@/shared/services/supabase';

export default function AuthHandler() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { checkOnline } = useOfflineCheck();
  const { showSnackbar } = useSnackbar();
  const colors = useThemeColors();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleAuth = React.useCallback(async () => {
    if (!checkOnline('Authentication')) return;

    try {
      // Get the access token and refresh token from the URL
      const { access_token, refresh_token, type } = params as {
        access_token?: string;
        refresh_token?: string;
        type?: string;
      };

      if (!access_token || !refresh_token) {
        throw new Error('Invalid authentication link');
      }

      // Set the session with the tokens
      const { error: sessionError } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });

      if (sessionError) throw sessionError;

      if (type === 'recovery') {
        router.replace('/(auth)/new-password');
      } else {
        throw new Error('Magic link authentication is no longer supported.');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred');
      showSnackbar('Unable to complete authentication. Please try again.', 'error');
      router.replace('/(auth)/login');
    } finally {
      setLoading(false);
    }
  }, [params, checkOnline, router, showSnackbar]);

  useEffect(() => {
    handleAuth();
  }, [handleAuth]);

  if (loading) {
    return <LoadingCard iconName="lock-open-check" text="Completing authentication..." />;
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        <Button
          mode="contained"
          onPress={() => router.replace('/(auth)/login')}
          style={styles.button}
        >
          Return to Login
        </Button>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    marginBottom: 20,
    textAlign: 'center',
  },
  button: {
    marginTop: 20,
  },
});
