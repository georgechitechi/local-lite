import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { SupabaseStorage } from '@/shared/services/supabase';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

describe('SupabaseStorage', () => {
  let localStorageMock: { getItem: jest.Mock; setItem: jest.Mock; removeItem: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
    localStorageMock = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    };
    Object.defineProperty(global, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
  });

  describe('getItem', () => {
    it('uses SecureStore on native', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('value');
      const result = await SupabaseStorage.getItem('key');
      expect(result).toBe('value');
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith('key');
    });

    it('uses localStorage on web', () => {
      Platform.OS = 'web';
      localStorageMock.getItem.mockReturnValue('web-value');
      const result = SupabaseStorage.getItem('key');
      expect(result).toBe('web-value');
      expect(localStorageMock.getItem).toHaveBeenCalledWith('key');
    });

    it('returns null on web if localStorage is undefined', () => {
      Platform.OS = 'web';
      Object.defineProperty(global, 'localStorage', {
        value: undefined,
        writable: true,
      });
      const result = SupabaseStorage.getItem('key');
      expect(result).toBeNull();
    });
  });

  describe('setItem', () => {
    it('uses SecureStore on native', async () => {
      await SupabaseStorage.setItem('key', 'value');
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith('key', 'value');
    });

    it('uses localStorage on web', async () => {
      Platform.OS = 'web';
      await SupabaseStorage.setItem('key', 'value');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('key', 'value');
    });

    it('ignores on web if localStorage is undefined', async () => {
      Platform.OS = 'web';
      Object.defineProperty(global, 'localStorage', {
        value: undefined,
        writable: true,
      });
      await SupabaseStorage.setItem('key', 'value'); // should not throw
    });
  });

  describe('removeItem', () => {
    it('uses SecureStore on native', async () => {
      await SupabaseStorage.removeItem('key');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('key');
    });

    it('uses localStorage on web', async () => {
      Platform.OS = 'web';
      await SupabaseStorage.removeItem('key');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('key');
    });

    it('ignores on web if localStorage is undefined', async () => {
      Platform.OS = 'web';
      Object.defineProperty(global, 'localStorage', {
        value: undefined,
        writable: true,
      });
      await SupabaseStorage.removeItem('key'); // should not throw
    });
  });
});
