import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

/**
 * Safely reloads the application across web, development, and production standalone builds.
 * Guards against unhandled rejections when Updates.isEnabled is false.
 */
export async function safeReloadApp(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.location) {
        window.location.reload();
      }
      return;
    }

    if (Updates.isEnabled) {
      await Updates.reloadAsync();
    } else {
      console.log('safeReloadApp: Updates are not enabled in this environment.');
    }
  } catch (error) {
    console.warn('safeReloadApp encountered an error while reloading:', error);
  }
}
0;
