import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import { secureStorage } from '@/shared/services/secureStorage';
import { supabase } from '@/shared/services/supabase';
import { setOfflineUser, setOnlineUser } from './authStore';

const BIOMETRIC_ENABLED_KEY = 'biometricEnabled';

export interface BiometricSupportResult {
  isSupported: boolean;
  biometricType: string | null;
}

export const checkBiometricSupport = async (): Promise<BiometricSupportResult> => {
  if (Platform.OS === 'web') {
    return { isSupported: false, biometricType: null };
  }

  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();

    if (!compatible || !enrolled) {
      return { isSupported: false, biometricType: null };
    }

    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const typeNames = types.map(type => {
      switch (type) {
        case LocalAuthentication.AuthenticationType.FINGERPRINT:
          return 'Fingerprint';
        case LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION:
          return 'Face ID';
        case LocalAuthentication.AuthenticationType.IRIS:
          return 'Iris';
        default:
          return 'Biometric';
      }
    });

    return {
      isSupported: true,
      biometricType: typeNames[0] || 'Biometric',
    };
  } catch (error) {
    console.error('Error checking biometric support:', error);
    return { isSupported: false, biometricType: null };
  }
};

export const loadBiometricPreference = async (): Promise<boolean> => {
  try {
    const enabled = await secureStorage.getItem(BIOMETRIC_ENABLED_KEY);
    return enabled === true;
  } catch (error) {
    console.error('Error loading biometric preference:', error);
    return false;
  }
};

export const enableBiometric = async (): Promise<{
  success: boolean;
  error?: string;
}> => {
  if (Platform.OS === 'web') {
    return { success: false, error: 'Biometric authentication not available on web' };
  }

  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      return { success: false, error: 'Biometric authentication not available' };
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Enable biometric authentication',
      fallbackLabel: 'Use passcode',
      cancelLabel: 'Cancel',
    });

    if (result.success) {
      await secureStorage.setItem(BIOMETRIC_ENABLED_KEY, true);
      return { success: true };
    }

    return { success: false, error: 'Authentication failed' };
  } catch (error: any) {
    console.error('Error enabling biometric:', error);
    return { success: false, error: error.message || 'Failed to enable biometric' };
  }
};

export const disableBiometric = async (): Promise<{
  success: boolean;
  error?: string;
}> => {
  try {
    await secureStorage.removeItem(BIOMETRIC_ENABLED_KEY);
    await secureStorage.removeItem('userEmail');
    await secureStorage.removeItem('refreshToken');
    return { success: true };
  } catch (error: any) {
    console.error('Error disabling biometric:', error);
    return { success: false, error: error.message || 'Failed to disable biometric' };
  }
};

export interface BiometricAuthCallbacks {
  setOfflineUser?: (user: any) => void;
  setOnlineUser?: (user: any) => void;
}

export const authenticateWithBiometric = async (
  callbacks?: BiometricAuthCallbacks,
): Promise<{
  success: boolean;
  error?: string;
}> => {
  if (Platform.OS === 'web') {
    return { success: false, error: 'Biometric authentication not available on web' };
  }

  const applyOfflineUser = callbacks?.setOfflineUser || setOfflineUser;
  const applyOnlineUser = callbacks?.setOnlineUser || setOnlineUser;

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate to login',
      fallbackLabel: 'Use password',
      cancelLabel: 'Cancel',
    });

    if (result.success) {
      const refreshToken = (await secureStorage.getItem('refreshToken')) as string | null;

      if (!refreshToken) {
        const lastUser = (await secureStorage.getItem('lastUser')) as any;
        if (lastUser) {
          applyOfflineUser(lastUser);
          return { success: true };
        }

        return {
          success: false,
          error: 'No saved session found. Please login with password first.',
        };
      }

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.refreshSession({
          refresh_token: refreshToken,
        });

        if (sessionError || !session) {
          const lastUser = (await secureStorage.getItem('lastUser')) as any;
          if (lastUser) {
            applyOfflineUser(lastUser);
            return { success: true };
          }

          await secureStorage.removeItem('refreshToken');
          await secureStorage.removeItem('userEmail');
          return {
            success: false,
            error:
              'Session expired and no offline fallback available. Please login with password.',
          };
        }

        const lastUser = session.user;
        if (session.refresh_token) {
          await secureStorage.setItem('refreshToken', session.refresh_token);
        }
        await secureStorage.setItem('lastUser', lastUser);
        applyOnlineUser(lastUser);
      } catch (refreshError) {
        const lastUser = (await secureStorage.getItem('lastUser')) as any;
        if (lastUser) {
          applyOfflineUser(lastUser);
          return { success: true };
        }
        throw refreshError;
      }

      return { success: true };
    }

    return { success: false, error: 'Authentication cancelled' };
  } catch (error: any) {
    console.error('Error authenticating with biometric:', error);
    return { success: false, error: error.message || 'Authentication failed' };
  }
};
