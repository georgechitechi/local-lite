import * as SecureStore from 'expo-secure-store';
import { secureStorage } from '@/shared/services/secureStorage';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('secureStorage utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('setItem', () => {
    it('stringifies and stores value securely', async () => {
      await secureStorage.setItem('key1', { foo: 'bar' });
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith('key1', '{"foo":"bar"}');
    });
  });

  describe('getItem', () => {
    it('returns null if item not found', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
      const result = await secureStorage.getItem('key1');
      expect(result).toBeNull();
    });

    it('parses and returns stored JSON', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('{"foo":"bar"}');
      const result = await secureStorage.getItem('key1');
      expect(result).toEqual({ foo: 'bar' });
    });
  });

  describe('removeItem', () => {
    it('removes item', async () => {
      await secureStorage.removeItem('key1');
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('key1');
    });
  });

  describe('clear', () => {
    it('warns that clear is not fully supported', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await secureStorage.clear();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not fully supported'),
      );
      warnSpy.mockRestore();
    });
  });
});
