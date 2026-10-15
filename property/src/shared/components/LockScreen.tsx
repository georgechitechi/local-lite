import Constants from 'expo-constants';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useBiometric } from '@/providers/BiometricAuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

export default function LockScreen() {
  const colors = useThemeColors();
  const { isLocked, unlockApp } = useIdleLock();
  const { isBiometricSupported, isBiometricEnabled, biometricType } = useBiometric();
  const [isUnlocking, setIsUnlocking] = useState(false);
  const hasTriggeredRef = React.useRef(false);

  const handleUnlock = useCallback(async () => {
    if (isUnlocking) return; // Prevent multiple simultaneous attempts

    setIsUnlocking(true);

    // Safety timeout - reset unlocking state after 10 seconds
    const timeoutId = setTimeout(() => {
      setIsUnlocking(false);
      hasTriggeredRef.current = false;
    }, 10000);

    try {
      const success = await unlockApp();
      clearTimeout(timeoutId);

      if (!success) {
        // User cancelled or failed - allow retry
        hasTriggeredRef.current = false;
      }
    } catch (error) {
      console.error('Error unlocking:', error);
      clearTimeout(timeoutId);
      hasTriggeredRef.current = false;
    } finally {
      setIsUnlocking(false);
    }
  }, [isUnlocking, unlockApp]);

  useEffect(() => {
    // Reset trigger flag when lock state changes
    if (!isLocked) {
      hasTriggeredRef.current = false;
      setIsUnlocking(false);
      return undefined;
    }

    // Auto-trigger biometric when screen appears (only once)
    if (
      isLocked &&
      isBiometricEnabled &&
      isBiometricSupported &&
      !isUnlocking &&
      !hasTriggeredRef.current
    ) {
      hasTriggeredRef.current = true;
      const timer = setTimeout(() => {
        handleUnlock();
      }, 500); // Small delay to ensure UI is ready
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [isLocked, isBiometricEnabled, isBiometricSupported, handleUnlock, isUnlocking]);

  if (!isLocked) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Image
            source={require('@/assets/icon.png')}
            style={styles.appIcon}
            resizeMode="contain"
          />
        </View>
        <Text
          variant="headlineMedium"
          style={[styles.title, { color: colors.onBackground }]}
        >
          {Constants.expoConfig?.name || 'Property Admin'}
        </Text>
        <Text
          variant="bodyLarge"
          style={[styles.subtitle, { color: colors.onSurfaceVariant }]}
        >
          {isBiometricEnabled && isBiometricSupported
            ? `Use ${biometricType || 'biometric'} to unlock`
            : 'App is locked due to inactivity'}
        </Text>

        {isBiometricEnabled && isBiometricSupported ? (
          <Button
            mode="contained"
            onPress={handleUnlock}
            loading={isUnlocking}
            disabled={isUnlocking}
            style={styles.button}
            icon="fingerprint"
          >
            {isUnlocking ? 'Unlocking...' : `Unlock with ${biometricType || 'Biometric'}`}
          </Button>
        ) : (
          <Button
            mode="contained"
            onPress={handleUnlock}
            loading={isUnlocking}
            disabled={isUnlocking}
            style={styles.button}
          >
            {isUnlocking ? 'Unlocking...' : 'Unlock'}
          </Button>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    padding: 32,
  },
  iconContainer: {
    marginBottom: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  title: {
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitle: {
    marginBottom: 32,
    textAlign: 'center',
  },
  button: {
    marginTop: 16,
    minWidth: 200,
  },
});
