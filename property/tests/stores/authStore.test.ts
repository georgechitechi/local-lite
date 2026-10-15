const mockFindMany = jest.fn().mockResolvedValue([]);
const mockBatch = jest.fn().mockResolvedValue([]);
jest.mock('@/shared/services/sync/client', () => ({
  getSyncClient: jest.fn(async () => ({
    findMany: mockFindMany,
    batch: mockBatch,
    syncWorker: { pullRemoteChanges: jest.fn().mockResolvedValue(undefined) },
  })),
}));

import * as SplashScreen from 'expo-splash-screen';
import { secureStorage } from '@/shared/services/secureStorage';
import {
  SupabaseStorage,
  supabase,
  updateAuthStateSync,
} from '@/shared/services/supabase';
import {
  confirmSignOut,
  getAuthStateSnapshot,
  hideSignOutDialog,
  initializeAuth,
  migrateOfflineData,
  refreshUser,
  setOfflineUser,
  setOnlineUser,
  signIn,
  signOut,
  signUp,
  updateAuthState,
} from '@/stores/authStore';
import { clearAllPersistence } from '@/stores/syncHelper';

jest.mock('@/shared/services/supabase', () => ({
  supabase: {
    auth: {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      refreshSession: jest.fn(),
      getSession: jest.fn(),
      getUser: jest.fn(),
    },
  },
  updateAuthStateSync: jest.fn(),
  initializeSupabaseClient: jest.fn().mockResolvedValue(true),
  SupabaseStorage: {
    removeItem: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('@/shared/services/secureStorage', () => ({
  secureStorage: {
    setItem: jest.fn().mockResolvedValue(true),
    getItem: jest.fn().mockResolvedValue(null),
    removeItem: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('@/stores/syncHelper', () => ({
  clearAllPersistence: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-splash-screen', () => ({
  hideAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-sqlite/kv-store', () => ({
  clearAsync: jest.fn().mockResolvedValue(true),
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('@/shared/services/auth', () => ({
  OFFLINE_USER_ID: 'offline-user-id',
  getOfflineUser: jest.fn().mockReturnValue({ id: 'offline-user-id' }),
  ensureUserProfile: jest.fn().mockResolvedValue(true),
}));

describe('authStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateAuthState({ user: null });
    updateAuthState({ session: null });
    updateAuthState({ isOfflineAuthoritative: false });
    updateAuthState({ isSignOutDialogVisible: false });
    updateAuthState({ loading: true });
  });

  describe('setOfflineUser / setOnlineUser', () => {
    it('sets offline user correctly', () => {
      setOfflineUser({ id: 'off' } as any);
      expect(getAuthStateSnapshot().user?.id).toBe('off');
      expect(getAuthStateSnapshot().isOfflineAuthoritative).toBe(true);
    });

    it('sets online user correctly', () => {
      setOnlineUser({ id: 'on' } as any);
      expect(getAuthStateSnapshot().user?.id).toBe('on');
      expect(getAuthStateSnapshot().isOfflineAuthoritative).toBe(false);
    });
  });

  describe('migrateOfflineData', () => {
    it('persists offline ownership changes through local-lite', async () => {
      mockFindMany.mockResolvedValueOnce([{ id: 'b1', user_id: 'offline-user-id' }]);
      await migrateOfflineData('new-user-id');
      expect(mockFindMany).toHaveBeenCalledWith('businesses', {
        where: { user_id: 'offline-user-id' },
      });
      expect(mockBatch).toHaveBeenCalledWith([
        {
          tableName: 'businesses',
          operation: 'UPDATE',
          rowId: 'b1',
          payload: { user_id: 'new-user-id' },
        },
      ]);
    });
  });

  describe('signUp', () => {
    it('handles successful sign up', async () => {
      const mockUser = { id: 'u1', email: 'test@test.com' };
      const mockSession = { access_token: '123' };
      (supabase.auth.signUp as jest.Mock).mockResolvedValueOnce({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const res = await signUp({
        email: 'test@test.com',
        password: 'pass',
        name: 'Test',
      });

      expect(res.error).toBeNull();
      expect(res.user).toEqual(mockUser);
      expect(secureStorage.setItem).toHaveBeenCalledWith('lastUser', mockUser);
      expect(getAuthStateSnapshot().user).toEqual(mockUser);
      expect(getAuthStateSnapshot().session).toEqual(mockSession);
      expect(updateAuthStateSync).toHaveBeenCalledWith({ isLoggedIn: true });
    });

    it('returns error if supabase is not initialized', async () => {
      const tempSupabase = require('@/shared/services/supabase').supabase;
      require('@/shared/services/supabase').supabase = null;
      const res = await signUp({
        email: 'test@test.com',
        password: 'pass',
        name: 'Test',
      });
      expect(res.error?.message).toMatch(/Cloud Sync is disabled/);
      require('@/shared/services/supabase').supabase = tempSupabase;
    });

    it('handles sign up error', async () => {
      const mockError = new Error('Sign up failed');
      (supabase.auth.signUp as jest.Mock).mockResolvedValueOnce({
        data: { user: null },
        error: mockError,
      });

      const res = await signUp({ email: 'test@test.com', password: 'pass' });

      expect(res.user).toBeNull();
      expect(res.error).toEqual(mockError);
    });

    it('handles exception during sign up', async () => {
      const mockError = new Error('Exception');
      (supabase.auth.signUp as jest.Mock).mockRejectedValueOnce(mockError);

      const res = await signUp({ email: 'test@test.com', password: 'pass' });

      expect(res.user).toBeNull();
      expect(res.error).toEqual(mockError);
    });
  });

  describe('signIn', () => {
    it('handles successful sign in', async () => {
      const mockUser = { id: 'u1' };
      const mockSession = { access_token: '123' };
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValueOnce({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      const res = await signIn({ email: 'test@test.com', password: 'pass' });

      expect(res.error).toBeNull();
      expect(res.user).toEqual(mockUser);
      expect(secureStorage.setItem).toHaveBeenCalledWith('lastUser', mockUser);
    });

    it('returns error if supabase is not initialized', async () => {
      const tempSupabase = require('@/shared/services/supabase').supabase;
      require('@/shared/services/supabase').supabase = null;
      const res = await signIn({ email: 'test@test.com', password: 'pass' });
      expect(res.error?.message).toMatch(/Cloud Sync is disabled/);
      require('@/shared/services/supabase').supabase = tempSupabase;
    });

    it('handles sign in error', async () => {
      const mockError = new Error('Sign in failed');
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValueOnce({
        data: { user: null },
        error: mockError,
      });

      const res = await signIn({ email: 'test@test.com', password: 'pass' });

      expect(res.user).toBeNull();
      expect(res.error).toEqual(mockError);
    });
  });

  describe('signOut', () => {
    it('signs out and clears everything (no biometrics)', async () => {
      (secureStorage.getItem as jest.Mock).mockResolvedValueOnce(false); // biometrics disabled
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await signOut();

      expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
      expect(SupabaseStorage.removeItem).toHaveBeenCalledWith('supabase.auth.token');
      expect(secureStorage.removeItem).toHaveBeenCalledWith('refreshToken');
      expect(clearAllPersistence).toHaveBeenCalled();
      expect(updateAuthStateSync).toHaveBeenCalledWith({ isLoggedIn: false });
      expect(getAuthStateSnapshot().session).toBeNull();
      expect(getAuthStateSnapshot().user?.id).toBe('offline-user-id');
    });

    it('handles sign out with biometrics enabled', async () => {
      (secureStorage.getItem as jest.Mock).mockResolvedValueOnce(true); // biometrics enabled
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await signOut();

      expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(SupabaseStorage.removeItem).not.toHaveBeenCalled();
      expect(secureStorage.removeItem).not.toHaveBeenCalledWith('refreshToken');
    });

    it('preserves local data when requested for cloud onboarding', async () => {
      (secureStorage.getItem as jest.Mock).mockResolvedValueOnce(false);
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({ error: null });

      await signOut({ clearLocalData: false });

      expect(clearAllPersistence).not.toHaveBeenCalled();
      expect(getAuthStateSnapshot().user?.id).toBe('offline-user-id');
      expect(getAuthStateSnapshot().session).toBeNull();
    });

    it('handles sign out error gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (secureStorage.getItem as jest.Mock).mockRejectedValueOnce(
        new Error('Storage failure'),
      );
      (supabase.auth.signOut as jest.Mock).mockResolvedValueOnce({
        error: new Error('Failed to sign out globally'),
      });
      (supabase.auth.signOut as jest.Mock).mockRejectedValueOnce(
        new Error('Local signout failed'),
      );

      await signOut();
      expect(getAuthStateSnapshot().user?.id).toBe('offline-user-id');
      consoleSpy.mockRestore();
    });

    it('handles exception in signOut gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (secureStorage.getItem as jest.Mock).mockImplementation(() => {
        throw new Error('Crash');
      });
      await signOut();
      consoleSpy.mockRestore();
    });
  });

  describe('dialog toggles', () => {
    it('toggles dialog', () => {
      confirmSignOut();
      expect(getAuthStateSnapshot().isSignOutDialogVisible).toBe(true);
      hideSignOutDialog();
      expect(getAuthStateSnapshot().isSignOutDialogVisible).toBe(false);
    });
  });

  describe('refreshUser', () => {
    it('refreshes session if refresh token exists', async () => {
      (secureStorage.getItem as jest.Mock).mockResolvedValueOnce('refresh-123');
      const mockSession = { user: { id: 'u1' }, refresh_token: 'new-refresh' };
      (supabase.auth.refreshSession as jest.Mock).mockResolvedValueOnce({
        data: { session: mockSession },
        error: null,
      });

      await refreshUser();

      expect(supabase.auth.refreshSession).toHaveBeenCalledWith({
        refresh_token: 'refresh-123',
      });
      expect(getAuthStateSnapshot().user?.id).toBe('u1');
      expect(secureStorage.setItem).toHaveBeenCalledWith('refreshToken', 'new-refresh');
    });

    it('gets session if no refresh token exists', async () => {
      (secureStorage.getItem as jest.Mock).mockResolvedValueOnce(null);
      const mockSession = { user: { id: 'u1' } };
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({
        data: { session: mockSession },
        error: null,
      });

      await refreshUser();

      expect(supabase.auth.getSession).toHaveBeenCalled();
      expect(getAuthStateSnapshot().user?.id).toBe('u1');
    });

    it('handles getSession error and falls back to offline', async () => {
      (secureStorage.getItem as jest.Mock).mockResolvedValueOnce(null);
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({
        data: { session: null },
        error: new Error('Session fetch failed'),
      });

      await refreshUser();
      expect(getAuthStateSnapshot().user?.id).toBe('offline-user-id');
    });

    it('handles refreshSession error (invalid token) and falls back', async () => {
      (secureStorage.getItem as jest.Mock).mockResolvedValueOnce('refresh-123');
      (supabase.auth.refreshSession as jest.Mock).mockResolvedValueOnce({
        data: { session: null },
        error: { message: 'Invalid Refresh Token', status: 400 },
      });

      await refreshUser();
      expect(getAuthStateSnapshot().user?.id).toBe('offline-user-id');
    });

    it('sets offline if localSession has no user', async () => {
      (secureStorage.getItem as jest.Mock).mockResolvedValueOnce(null);
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({
        data: { session: {} }, // no user
        error: null,
      });

      await refreshUser();
      expect(getAuthStateSnapshot().user?.id).toBe('offline-user-id');
    });
  });

  describe('initializeAuth', () => {
    it('initializes and restores session', async () => {
      const mockSession = { user: { id: 'u1' } };
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({
        data: { session: mockSession },
        error: null,
      });
      (supabase.auth.getUser as jest.Mock).mockResolvedValueOnce({
        data: { user: { id: 'u1-fresh' } },
        error: null,
      });
      (secureStorage.getItem as jest.Mock).mockResolvedValue(null);

      await initializeAuth(() => true);

      expect(getAuthStateSnapshot().user?.id).toBe('u1-fresh');
      expect(SplashScreen.hideAsync).toHaveBeenCalled();
    });

    it('sets offline if no session or user', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });
      (secureStorage.getItem as jest.Mock).mockResolvedValue(null);

      await initializeAuth(() => true);

      expect(getAuthStateSnapshot().user?.id).toBe('offline-user-id');
      expect(getAuthStateSnapshot().isOfflineAuthoritative).toBe(true);
    });

    it('restores session via refresh token if getSession fails', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({
        data: { session: null },
        error: new Error('Get session failed'),
      });
      (secureStorage.getItem as jest.Mock).mockImplementation(key => {
        if (key === 'refreshToken') return Promise.resolve('refresh-123');
        return Promise.resolve(null);
      });
      (supabase.auth.refreshSession as jest.Mock).mockResolvedValueOnce({
        data: { session: { user: { id: 'u2' }, refresh_token: 'new-refresh' } },
        error: null,
      });
      (supabase.auth.getUser as jest.Mock).mockResolvedValueOnce({
        data: { user: { id: 'u2' } },
        error: null,
      });

      await initializeAuth(() => true);

      expect(getAuthStateSnapshot().user?.id).toBe('u2');
      expect(secureStorage.setItem).toHaveBeenCalledWith('refreshToken', 'new-refresh');
    });

    it('catches exception and falls back to offline', async () => {
      (supabase.auth.getSession as jest.Mock).mockRejectedValueOnce(new Error('Crash'));
      await initializeAuth(() => true);
      expect(getAuthStateSnapshot().user?.id).toBe('offline-user-id');
    });
  });
});
