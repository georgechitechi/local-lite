import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  authenticateWithBiometric as authenticateWithBiometricService,
  checkBiometricSupport,
  disableBiometric as disableBiometricService,
  enableBiometric as enableBiometricService,
  loadBiometricPreference,
} from '@/stores/biometricStore';
import { useAuth } from './AuthProvider';

export interface BiometricContextValue {
  isBiometricSupported: boolean;
  isBiometricEnabled: boolean;
  biometricType: string | null;
  isAuthenticating: boolean;
  enableBiometric: () => Promise<{ success: boolean; error?: string }>;
  disableBiometric: () => Promise<{ success: boolean; error?: string }>;
  authenticateWithBiometric: () => Promise<{ success: boolean; error?: string }>;
}

const BiometricAuthContext = createContext<BiometricContextValue | null>(null);

interface BiometricAuthProviderProps {
  children: React.ReactNode;
}

export function BiometricAuthProvider({ children }: BiometricAuthProviderProps) {
  const { user, setOfflineUser, setOnlineUser } = useAuth();
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [isBiometricEnabled, setIsBiometricEnabled] = useState(false);
  const [biometricType, setBiometricType] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    let mounted = true;
    checkBiometricSupport().then(res => {
      if (mounted) {
        setIsBiometricSupported(res.isSupported);
        setBiometricType(res.biometricType);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (user) {
      loadBiometricPreference().then(enabled => {
        if (mounted) {
          setIsBiometricEnabled(enabled);
        }
      });
    } else {
      setIsBiometricEnabled(false);
    }
    return () => {
      mounted = false;
    };
  }, [user]);

  const enableBiometric = useCallback(async () => {
    const res = await enableBiometricService();
    if (res.success) {
      setIsBiometricEnabled(true);
    }
    return res;
  }, []);

  const disableBiometric = useCallback(async () => {
    const res = await disableBiometricService();
    if (res.success) {
      setIsBiometricEnabled(false);
    }
    return res;
  }, []);

  const authenticateWithBiometric = useCallback(async () => {
    if (!isBiometricSupported) {
      return { success: false, error: 'Biometric authentication not supported' };
    }
    if (!isBiometricEnabled) {
      return { success: false, error: 'Biometric authentication not enabled' };
    }

    setIsAuthenticating(true);
    try {
      const res = await authenticateWithBiometricService({
        setOfflineUser,
        setOnlineUser,
      });
      return res;
    } finally {
      setIsAuthenticating(false);
    }
  }, [isBiometricSupported, isBiometricEnabled, setOfflineUser, setOnlineUser]);

  const contextValue = useMemo<BiometricContextValue>(
    () => ({
      isBiometricSupported,
      isBiometricEnabled,
      biometricType,
      isAuthenticating,
      enableBiometric,
      disableBiometric,
      authenticateWithBiometric,
    }),
    [
      isBiometricSupported,
      isBiometricEnabled,
      biometricType,
      isAuthenticating,
      enableBiometric,
      disableBiometric,
      authenticateWithBiometric,
    ]
  );

  return (
    <BiometricAuthContext.Provider value={contextValue}>
      {children}
    </BiometricAuthContext.Provider>
  );
}

export const useBiometric = (): BiometricContextValue => {
  const context = useContext(BiometricAuthContext);
  if (!context) {
    return {
      isBiometricSupported: false,
      isBiometricEnabled: false,
      biometricType: null,
      isAuthenticating: false,
      enableBiometric: async () => ({ success: false, error: 'BiometricAuthProvider missing' }),
      disableBiometric: async () => ({ success: false, error: 'BiometricAuthProvider missing' }),
      authenticateWithBiometric: async () => ({
        success: false,
        error: 'BiometricAuthProvider missing',
      }),
    };
  }
  return context;
};
