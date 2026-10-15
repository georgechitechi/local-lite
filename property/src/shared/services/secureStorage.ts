import * as SecureStore from 'expo-secure-store';

/**
 * Secure storage utility
 * Uses native OS secure storage (Keychain/Keystore)
 */
class SecureStorage {
  /**
   * Store data securely using native OS encryption
   */
  async setItem(key: string, value: unknown): Promise<void> {
    try {
      // SecureStore handles encryption at the OS level
      const stringValue = JSON.stringify(value);
      await SecureStore.setItemAsync(key, stringValue);
    } catch (error) {
      console.error('Error storing secure data:', error);
      throw new Error('Failed to store secure data');
    }
  }

  /**
   * Retrieve data
   */
  async getItem(key: string): Promise<unknown> {
    try {
      const storedValue = await SecureStore.getItemAsync(key);

      if (!storedValue) {
        return null;
      }

      try {
        return JSON.parse(storedValue);
      } catch (e) {
        console.log(`Failed to parse secure data for ${key}`, e);
        return null;
      }
    } catch (error) {
      console.error('Error retrieving secure data:', error);
      return null;
    }
  }

  /**
   * Remove secure data
   */
  async removeItem(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      console.error('Error removing secure data:', error);
    }
  }

  /**
   * Clear all secure data
   */
  async clear(): Promise<void> {
    try {
      console.warn(
        'SecureStore.clear() not fully supported on mobile without key tracking',
      );
    } catch (error) {
      console.error('Error clearing secure data:', error);
    }
  }
}

// Create singleton instance
export const secureStorage = new SecureStorage();
