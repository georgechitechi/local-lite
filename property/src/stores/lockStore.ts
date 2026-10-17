import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

let _isAutoLockPausedState = false;
let isLockedState = false;
let resumeTimeoutRef: ReturnType<typeof setTimeout> | null = null;

export const pauseAutoLock = async () => {
  if (resumeTimeoutRef) {
    clearTimeout(resumeTimeoutRef);
    resumeTimeoutRef = null;
  }
  _isAutoLockPausedState = true;
  try {
    await activateKeepAwakeAsync();
  } catch (error) {
    console.warn('Failed to activate keep awake:', error);
  }
};

export const resumeAutoLock = () => {
  if (resumeTimeoutRef) {
    clearTimeout(resumeTimeoutRef);
  }
  resumeTimeoutRef = setTimeout(() => {
    _isAutoLockPausedState = false;
    resumeTimeoutRef = null;
    try {
      deactivateKeepAwake();
    } catch (error) {
      console.warn('Failed to deactivate keep awake:', error);
    }
  }, 1000);
};

export const lockApp = () => {
  isLockedState = true;
};

export const unlockApp = async (options?: {
  isBiometricEnabled?: boolean;
  isBiometricSupported?: boolean;
}): Promise<boolean> => {
  if (!isLockedState) return true;

  if (Platform.OS === 'web') {
    isLockedState = false;
    return true;
  }

  const { isBiometricEnabled = false, isBiometricSupported = false } = options || {};

  if (isBiometricEnabled && isBiometricSupported) {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock app',
        fallbackLabel: 'Use password',
        cancelLabel: 'Cancel',
      });

      if (result.success) {
        isLockedState = false;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error unlocking with biometric:', error);
      return false;
    }
  } else {
    isLockedState = false;
    return true;
  }
};
