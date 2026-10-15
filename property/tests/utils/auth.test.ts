import type { User } from '@supabase/supabase-js';
import {
  ensureUserProfile,
  getUser,
  requestPasswordResetOtp,
  updatePassword,
  verifyPasswordResetOtp,
} from '@/shared/services/auth';
import { secureStorage } from '@/shared/services/secureStorage';
import { supabase } from '@/shared/services/supabase';
import { generateUUID } from '@/shared/utils/helper';

jest.mock('@/shared/services/supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: jest.fn(),
      verifyOtp: jest.fn(),
      updateUser: jest.fn(),
      getSession: jest.fn(),
    },
    from: jest.fn(),
  },
  getAuthStateSyncSnapshot: () => ({ isLoggedIn: true }),
}));

jest.mock('@/shared/services/secureStorage', () => ({
  secureStorage: {
    removeItem: jest.fn(),
    getItem: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('@/shared/utils/helper', () => ({
  generateUUID: jest.fn(() => 'profile-1'),
}));

const mockFindMany = jest.fn().mockResolvedValue([]);
const mockInsert = jest.fn().mockResolvedValue('profile-1');
jest.mock('@/shared/services/sync/client', () => ({
  getSyncClient: jest.fn(async () => ({
    findMany: mockFindMany,
    findById: jest.fn().mockResolvedValue(null),
    insert: mockInsert,
    update: jest.fn(),
  })),
}));

describe('auth utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (generateUUID as jest.Mock).mockReturnValue('profile-1');
  });

  describe('requestPasswordResetOtp', () => {
    it('requests password reset successfully', async () => {
      (supabase.auth.resetPasswordForEmail as jest.Mock).mockResolvedValue({
        data: { message: 'ok' },
        error: null,
      });
      const result = await requestPasswordResetOtp('test@example.com');
      expect(result).toEqual({ message: 'ok' });
      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        'test@example.com',
      );
    });
  });

  describe('verifyPasswordResetOtp', () => {
    it('verifies otp successfully', async () => {
      (supabase.auth.verifyOtp as jest.Mock).mockResolvedValue({
        data: { session: true },
        error: null,
      });
      const result = await verifyPasswordResetOtp('test@example.com', '123456');
      expect(result).toEqual({ session: true });
      expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
        email: 'test@example.com',
        token: '123456',
        type: 'recovery',
      });
    });
  });

  describe('updatePassword', () => {
    it('updates password and clears storage', async () => {
      (supabase.auth.updateUser as jest.Mock).mockResolvedValue({
        data: { user: true },
        error: null,
      });
      (secureStorage.removeItem as jest.Mock).mockResolvedValue(true);

      const result = await updatePassword('new-pass');
      expect(result).toEqual({ user: true });
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'new-pass' });
      expect(secureStorage.removeItem).toHaveBeenCalledWith('userEmail');
      expect(secureStorage.removeItem).toHaveBeenCalledWith('refreshToken');
    });
  });

  describe('ensureUserProfile', () => {
    it('returns null if user has no id', async () => {
      const result = await ensureUserProfile({} as User);
      expect(result).toBeNull();
    });

    it('returns profile from local store if it exists', async () => {
      mockFindMany.mockResolvedValueOnce([{ name: 'Local User' }]);

      const result = await ensureUserProfile({ id: 'user-1' } as User);
      expect(result).toEqual({ profile: { name: 'Local User' } });
    });

    it('creates offline profile if provider is offline', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      const result = await ensureUserProfile({
        id: 'user-1',
        app_metadata: { provider: 'offline' },
      } as unknown as User);
      expect(result?.isOfflineFallback).toBe(true);
      expect(mockInsert).toHaveBeenCalled();
      expect(mockInsert).toHaveBeenCalledWith(
        'profiles',
        expect.objectContaining({ id: 'profile-1' }),
      );
    });

    it('fetches profile from database if not in local store', async () => {
      mockFindMany.mockResolvedValueOnce([]);

      const mockMaybeSingle = jest.fn().mockResolvedValue({
        data: { id: 'profile-db', name: 'DB User' },
        error: null,
      });
      const mockEq = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      (supabase.from as jest.Mock).mockReturnValue({ select: mockSelect });

      const result = await ensureUserProfile({ id: 'user-1' } as User);
      expect(result).toEqual({ profile: { id: 'profile-db', name: 'DB User' } });
      expect(supabase.from).toHaveBeenCalledWith('profiles');
      expect(mockInsert).toHaveBeenCalled();
    });

    it('does not insert when the server profile is missing', async () => {
      mockFindMany.mockResolvedValueOnce([]);
      jest.useFakeTimers();

      const mockMaybeSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });
      const mockInsert = jest.fn();
      (supabase.from as jest.Mock).mockReturnValue({
        select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
        insert: mockInsert,
      });
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const pending = ensureUserProfile({
        id: 'user-1',
        email: 'test@test.com',
      } as User);
      await jest.advanceTimersByTimeAsync(400);
      const result = await pending;
      jest.useRealTimers();

      expect(result?.isOfflineFallback).toBe(true);
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  describe('getUser', () => {
    it('returns offline user if no user in session', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: null,
      });
      const result = await getUser();
      expect(result?.id).toBe('00000000-0000-0000-0000-000000000000');
    });

    it('returns user and ensures profile', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: { user: { id: 'user-1' } } },
        error: null,
      });
      mockFindMany.mockResolvedValueOnce([{ name: 'Local User' }]);

      const result = await getUser();
      expect(result).toEqual({ id: 'user-1' });
    });
  });
});
