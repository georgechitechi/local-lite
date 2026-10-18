import type { User } from '@supabase/supabase-js';
import { getAuthStateSyncSnapshot, supabase } from '@/shared/services/supabase';
import { getSyncClient } from '@/shared/services/sync/client';
import { generateUUID } from '@/shared/utils/helper';
import { secureStorage } from './secureStorage';

/**
 * Request password reset OTP
 */
export const requestPasswordResetOtp = async (email: string) => {
  if (!supabase)
    throw new Error('Cloud sync is disabled or Supabase client not initialized');
  const { data, error } = await supabase.auth.resetPasswordForEmail(email);

  if (error) throw error;
  return data;
};

/**
 * Verify password reset OTP
 */
export const verifyPasswordResetOtp = async (email: string, token: string) => {
  if (!supabase)
    throw new Error('Cloud sync is disabled or Supabase client not initialized');
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'recovery',
  });

  if (error) throw error;
  return data;
};

/**
 * Update user password
 */
export const updatePassword = async (newPassword: string) => {
  if (!supabase)
    throw new Error('Cloud sync is disabled or Supabase client not initialized');
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) throw error;

  // Clear stored refresh token after password change (biometric auth will need re-authentication)
  try {
    await secureStorage.removeItem('userEmail');
    await secureStorage.removeItem('refreshToken');
    console.log('Refresh token cleared after password change');
  } catch (storageError) {
    console.error('Error clearing refresh token after password change:', storageError);
  }

  return data;
};

const inFlightEnsureProfile = new Map<
  string,
  Promise<{ profile: any; isOfflineFallback?: boolean } | null>
>();

const saveProfileToLocalLite = async (profile: any) => {
  if (!getAuthStateSyncSnapshot().isLoggedIn) return;
  const client = await getSyncClient();
  const existing = await client.findById('profiles', profile.id);
  if (existing) {
    await client.update('profiles', profile.id, profile);
  } else {
    await client.insert('profiles', profile);
  }
};

/**
 * Ensure a profile is available locally and on server.
 */
export const ensureUserProfile = async (
  user: User,
): Promise<{ profile: any; isOfflineFallback?: boolean } | null> => {
  if (!user?.id || user.id === OFFLINE_USER_ID) return null;
  if (!getAuthStateSyncSnapshot().isLoggedIn) return null;

  const userId = user.id;
  const inFlight = inFlightEnsureProfile.get(userId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const client = await getSyncClient();
    if (client) {
      try {
        const rows = await client.findMany('profiles', {
          where: { user_id: userId },
        });
        const existing = rows?.[0];
        if (existing) {
          return { profile: existing };
        }
      } catch {
        // continue
      }
    }

    const isOffline =
      !supabase ||
      user.app_metadata?.provider === 'offline' ||
      !getAuthStateSyncSnapshot().isLoggedIn;

    const stubProfile = () => ({
      id: generateUUID(),
      user_id: userId,
      email: user.email || '',
      name:
        user.user_metadata?.name ||
        user.user_metadata?.full_name ||
        user.email?.split('@')[0] ||
        'User',
      phone: null,
      avatar_url: null,
      deleted: false,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (isOffline) {
      const offlineProfile = stubProfile();
      await saveProfileToLocalLite(offlineProfile);
      return { profile: offlineProfile, isOfflineFallback: true };
    }

    const fetchByUserId = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      return { data, error };
    };

    try {
      let { data: existingProfile, error: profileError } = await fetchByUserId();

      if (!existingProfile && profileError && profileError.code !== 'PGRST116') {
        console.error('Error checking profile:', profileError);
      }

      if (!existingProfile) {
        await new Promise(resolve => setTimeout(resolve, 400));
        ({ data: existingProfile } = await fetchByUserId());
      }

      if (existingProfile?.id) {
        await saveProfileToLocalLite(existingProfile);
        return { profile: existingProfile };
      }

      // If server row is not created by auth trigger yet, upsert it directly to Supabase
      if (typeof supabase.from('profiles').upsert === 'function') {
        const { data: createdProfile, error: createError } = await supabase
          .from('profiles')
          .upsert(
            {
              user_id: userId,
              email: user.email || '',
              name:
                user.user_metadata?.name ||
                user.user_metadata?.full_name ||
                user.email?.split('@')[0] ||
                'User',
              deleted: false,
              metadata: {},
            },
            { onConflict: 'user_id' },
          )
          .select('*')
          .maybeSingle();

        if (createdProfile?.id) {
          await saveProfileToLocalLite(createdProfile);
          return { profile: createdProfile };
        }

        if (createError) {
          console.error('Error auto-creating user profile:', createError);
        }
      }

      const fallback = stubProfile();
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session) {
        console.warn('Profile not on server yet; using local fallback until sync lands');
      }

      await saveProfileToLocalLite(fallback);
      return { profile: fallback, isOfflineFallback: true };
    } catch (error) {
      console.error('Error ensuring user profile:', error);
      return null;
    }
  })().finally(() => {
    inFlightEnsureProfile.delete(userId);
  });

  inFlightEnsureProfile.set(userId, promise);
  return promise;
};

export const OFFLINE_USER_ID = '00000000-0000-0000-0000-000000000000';

export const getOfflineUser = (): User =>
  ({
    id: OFFLINE_USER_ID,
    app_metadata: { provider: 'offline' },
    user_metadata: { name: 'Offline User', full_name: 'Offline User' },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }) as User;

/**
 * Get current authenticated user
 */
export const getUser = async (): Promise<User | null> => {
  try {
    let user: User | null = null;

    if (supabase) {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.warn('Error getting session:', error);
      } else if (session?.user) {
        user = session.user;
      }
    }

    if (!user) {
      const lastUser = (await secureStorage.getItem('lastUser')) as User | null;
      if (lastUser) {
        user = lastUser;
      }
    }

    if (!user) {
      user = getOfflineUser();
    }

    if (user.id !== OFFLINE_USER_ID) {
      const result = await ensureUserProfile(user);
      if (result?.isOfflineFallback) {
        console.warn('User profile is using offline fallback data');
      }
    }

    return user;
  } catch (error) {
    console.warn('Error getting user:', error);
    return null;
  }
};
