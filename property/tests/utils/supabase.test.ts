import { createClient } from '@supabase/supabase-js';
import { secureStorage } from '@/shared/services/secureStorage';
import * as supabaseModule from '@/shared/services/supabase';
import {
  configureSupabaseClient,
  disableCloudSync,
  getCloudSyncStateSnapshot,
  initializeSupabaseClient,
  updateCloudSyncState,
} from '@/shared/services/supabase';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/shared/services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

describe('supabase utility', () => {
  const mockCreateClient = createClient as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset global state
    updateCloudSyncState({ isEnabled: false });
    updateCloudSyncState({ isInitializing: true });
    // @ts-expect-error
    supabaseModule.supabase = null;
  });

  describe('initializeSupabaseClient', () => {
    it('initializes client if url and key are present', async () => {
      (secureStorage.getItem as jest.Mock).mockImplementation(key => {
        if (key === 'supabase_custom_url') return 'https://test.supabase.co';
        if (key === 'supabase_custom_key') return 'test-key';
        return null;
      });
      mockCreateClient.mockReturnValue({ auth: {} });

      await initializeSupabaseClient();

      expect(mockCreateClient).toHaveBeenCalledWith(
        'https://test.supabase.co',
        'test-key',
        expect.any(Object),
      );
      expect(supabaseModule.supabase).not.toBeNull();
      expect(getCloudSyncStateSnapshot().isEnabled).toBe(true);
      expect(getCloudSyncStateSnapshot().isInitializing).toBe(false);
    });

    it('does not initialize client if url or key are missing', async () => {
      (secureStorage.getItem as jest.Mock).mockResolvedValue(null);

      await initializeSupabaseClient();

      expect(mockCreateClient).not.toHaveBeenCalled();
      expect(supabaseModule.supabase).toBeNull();
      expect(getCloudSyncStateSnapshot().isEnabled).toBe(false);
      expect(getCloudSyncStateSnapshot().isInitializing).toBe(false);
    });
  });

  describe('configureSupabaseClient', () => {
    it('sets items and initializes', async () => {
      (secureStorage.getItem as jest.Mock).mockImplementation(key => {
        if (key === 'supabase_custom_url') return 'https://test.supabase.co';
        if (key === 'supabase_custom_key') return 'test-key';
        return null;
      });
      mockCreateClient.mockReturnValue({ auth: {} });

      const client = await configureSupabaseClient(
        'https://test.supabase.co ',
        ' test-key ',
      );

      expect(secureStorage.setItem).toHaveBeenCalledWith(
        'supabase_custom_url',
        'https://test.supabase.co',
      );
      expect(secureStorage.setItem).toHaveBeenCalledWith(
        'supabase_custom_key',
        'test-key',
      );
      expect(mockCreateClient).toHaveBeenCalled();
      expect(client).toBe(supabaseModule.supabase);
    });
  });

  describe('disableCloudSync', () => {
    it('removes storage items and clears client', async () => {
      // Setup a mock client properly
      const mockSignOut = jest.fn();
      (secureStorage.getItem as jest.Mock).mockImplementation(key => {
        if (key === 'supabase_custom_url') return 'https://test.supabase.co';
        if (key === 'supabase_custom_key') return 'test-key';
        return null;
      });
      mockCreateClient.mockReturnValue({ auth: { signOut: mockSignOut } });
      await initializeSupabaseClient(); // This sets `supabase` inside the module

      await disableCloudSync();

      expect(secureStorage.removeItem).toHaveBeenCalledWith('supabase_custom_url');
      expect(secureStorage.removeItem).toHaveBeenCalledWith('supabase_custom_key');
      expect(mockSignOut).toHaveBeenCalled();
      expect(supabaseModule.supabase).toBeNull();
      expect(getCloudSyncStateSnapshot().isEnabled).toBe(false);
    });
  });
});
