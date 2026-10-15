import * as Updates from 'expo-updates';
import NativeInAppUpdates from 'native-in-app-updates';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export function useVersionCheck() {
  const { isUpdatePending, isUpdateAvailable } = Updates.useUpdates();
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // When an Expo OTA update is downloaded and ready to be applied
    if (isUpdatePending) {
      setShowPrompt(true);
    }
  }, [isUpdatePending]);

  useEffect(() => {
    // We want to check for native updates only in production builds
    if (__DEV__) return;

    const checkForNativeUpdates = async () => {
      try {
        if (Platform.OS === 'android') {
          await NativeInAppUpdates.checkAndPromptForUpdate('IMMEDIATE');
        }
      } catch (err) {
        console.log('In-app update check failed:', err);
      }
    };

    checkForNativeUpdates();
  }, []);

  const onUpdate = async () => {
    try {
      await Updates.reloadAsync();
    } catch (error) {
      console.error('Failed to reload app for update:', error);
    }
  };

  const onDismiss = () => {
    setShowPrompt(false);
  };

  return {
    showPrompt,
    isUpdateAvailable,
    onUpdate,
    onDismiss,
  };
}
