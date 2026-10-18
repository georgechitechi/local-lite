import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as LocalAuthentication from 'expo-local-authentication';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from './AuthProvider';
import { useBiometric } from './BiometricAuthProvider';

export interface LockScreenContextValue {
  isLocked: boolean;
  lockApp: () => void;
  unlockApp: () => Promise<boolean>;
  pauseAutoLock: () => Promise<void>;
  resumeAutoLock: () => void;
}

const LockScreenContext = createContext<LockScreenContextValue | null>(null);

interface LockScreenProviderProps {
  children: React.ReactNode;
}

export function LockScreenProvider({ children }: LockScreenProviderProps) {
  const { user } = useAuth();
  const { isBiometricEnabled, isBiometricSupported } = useBiometric();
  const [isLocked, setIsLocked] = useState(false);
  const isAutoLockPausedRef = useRef(false);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const hasLockedOnStartup = useRef(false);

  const lockApp = useCallback(() => {
    setIsLocked(true);
  }, []);

  const unlockApp = useCallback(async (): Promise<boolean> => {
    if (!isLocked) return true;

    if (Platform.OS === 'web') {
      setIsLocked(false);
      return true;
    }

    if (isBiometricEnabled && isBiometricSupported) {
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock app',
          fallbackLabel: 'Use password',
          cancelLabel: 'Cancel',
        });

        if (result.success) {
          setIsLocked(false);
          return true;
        }
        return false;
      } catch (error) {
        console.error('Error unlocking with biometric:', error);
        return false;
      }
    } else {
      setIsLocked(false);
      return true;
    }
  }, [isLocked, isBiometricEnabled, isBiometricSupported]);

  const pauseAutoLock = useCallback(async () => {
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }
    isAutoLockPausedRef.current = true;
    try {
      await activateKeepAwakeAsync();
    } catch (error) {
      console.warn('Failed to activate keep awake:', error);
    }
  }, []);

  const resumeAutoLock = useCallback(() => {
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
    }
    resumeTimeoutRef.current = setTimeout(() => {
      isAutoLockPausedRef.current = false;
      resumeTimeoutRef.current = null;
      try {
        deactivateKeepAwake();
      } catch (error) {
        console.warn('Failed to deactivate keep awake:', error);
      }
    }, 1000);
  }, []);

  useEffect(() => {
    if (
      user &&
      isBiometricEnabled &&
      isBiometricSupported &&
      !isLocked &&
      !hasLockedOnStartup.current
    ) {
      setIsLocked(true);
      hasLockedOnStartup.current = true;
    }
  }, [user, isBiometricEnabled, isBiometricSupported, isLocked]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState.match(/inactive|background/)) {
        if (
          user &&
          !isLocked &&
          isBiometricEnabled &&
          isBiometricSupported &&
          !isAutoLockPausedRef.current
        ) {
          setIsLocked(true);
        }
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [user, isLocked, isBiometricEnabled, isBiometricSupported]);

  useEffect(() => {
    if (!user) {
      setIsLocked(false);
    }
  }, [user]);

  const value = useMemo<LockScreenContextValue>(
    () => ({
      isLocked,
      lockApp,
      unlockApp,
      pauseAutoLock,
      resumeAutoLock,
    }),
    [isLocked, lockApp, unlockApp, pauseAutoLock, resumeAutoLock],
  );

  return (
    <LockScreenContext.Provider value={value}>{children}</LockScreenContext.Provider>
  );
}

export const useIdleLock = (): LockScreenContextValue => {
  const context = useContext(LockScreenContext);
  if (!context) {
    return {
      isLocked: false,
      lockApp: () => {},
      unlockApp: async () => true,
      pauseAutoLock: async () => {},
      resumeAutoLock: () => {},
    };
  }
  return context;
};
