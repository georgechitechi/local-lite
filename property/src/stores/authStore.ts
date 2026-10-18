import type { Session, User } from '@supabase/supabase-js';
import * as SplashScreen from 'expo-splash-screen';
import {
  ensureUserProfile,
  getOfflineUser,
  OFFLINE_USER_ID,
} from '@/shared/services/auth';
import { secureStorage } from '@/shared/services/secureStorage';
import {
  initializeSupabaseClient,
  SupabaseStorage,
  supabase,
  updateAuthStateSync,
} from '@/shared/services/supabase';
import { getSyncClient } from '@/shared/services/sync/client';
import { clearAllPersistence } from './syncHelper';

export interface SignUpData {
  email: string;
  password: string;
  name?: string;
}

export interface SignInData {
  email: string;
  password: string;
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isOfflineAuthoritative: boolean;
  isSigningOut: boolean;
  isSignOutDialogVisible: boolean;
}

let authState: AuthState = {
  user: null,
  session: null,
  loading: true,
  isOfflineAuthoritative: false,
  isSigningOut: false,
  isSignOutDialogVisible: false,
};

const listeners = new Set<() => void>();

export const subscribeAuth = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const getAuthStateSnapshot = (): AuthState => authState;

export const updateAuthState = (patch: Partial<AuthState>) => {
  authState = { ...authState, ...patch };
  listeners.forEach(cb => {
    cb();
  });
};

export const setOfflineUser = (offlineUser: User) => {
  updateAuthState({
    user: offlineUser,
    isOfflineAuthoritative: true,
  });
};

export const setOnlineUser = (onlineUser: User) => {
  updateAuthState({
    user: onlineUser,
    isOfflineAuthoritative: false,
  });
};

export const setOfflineSession = () => {
  updateAuthState({
    user: getOfflineUser(),
    session: null,
    isOfflineAuthoritative: true,
  });
  updateAuthStateSync({ isLoggedIn: false });
};

export const setOnlineSession = async (
  user: User,
  session: Session | null,
  migrate = false,
) => {
  await secureStorage.setItem('lastUser', user);
  if (session?.refresh_token) {
    await secureStorage.setItem('refreshToken', session.refresh_token);
  }
  if (migrate) {
    await migrateOfflineData(user.id);
  }
  updateAuthState({
    user,
    session,
    isOfflineAuthoritative: false,
  });
  updateAuthStateSync({ isLoggedIn: true });

  // Start background sync worker after login
  getSyncClient()
    .then(client => {
      client.syncWorker.start();
    })
    .catch(() => {});
};

export const migrateOfflineData = async (newUserId: string) => {
  try {
    const client = await getSyncClient();
    const businesses = await client.findMany('businesses', {
      where: { user_id: OFFLINE_USER_ID },
    });
    await client.batch(
      businesses.map(business => ({
        tableName: 'businesses',
        operation: 'UPDATE' as const,
        rowId: business.id,
        payload: { user_id: newUserId },
      })),
    );
  } catch (err) {
    console.error('Error migrating offline data:', err);
  }
};

export const signUp = async (data: SignUpData) => {
  if (!supabase)
    return {
      user: null,
      error: new Error('Cloud Sync is disabled. Configure it in Settings first.'),
    };
  try {
    const { data: authData, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          name: data.name || data.email,
          full_name: data.name || data.email,
        },
      },
    });

    if (error) return { user: null, error };

    if (authData.user) {
      await setOnlineSession(authData.user, authData.session, true);
    }
    return { user: authData.user, error: null };
  } catch (error) {
    return { user: null, error: error as Error };
  }
};

export const signIn = async (data: SignInData) => {
  if (!supabase)
    return {
      user: null,
      error: new Error('Cloud Sync is disabled. Configure it in Settings first.'),
    };
  try {
    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) return { user: null, error };

    if (authData.user) {
      await setOnlineSession(authData.user, authData.session, true);
    }
    return { user: authData.user, error: null };
  } catch (error) {
    return { user: null, error: error as Error };
  }
};

export const signOut = async (options?: { clearLocalData?: boolean }) => {
  const clearLocalData = options?.clearLocalData ?? true;
  try {
    updateAuthState({ isSigningOut: true });

    // 1. Immediately stop any active synchronization
    try {
      const client = await getSyncClient();
      client.syncWorker.stop();
    } catch {}

    let biometricEnabled = false;
    try {
      biometricEnabled = (await secureStorage.getItem('biometricEnabled')) === true;
    } catch (storageError) {
      console.error('Error reading biometric state:', storageError);
    }

    if (supabase) {
      try {
        await supabase.auth.signOut({
          scope: biometricEnabled ? 'local' : 'global',
        });
      } catch (err) {
        console.warn('Supabase signOut error:', err);
      }
      if (!biometricEnabled) {
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {}
        try {
          await SupabaseStorage.removeItem('supabase.auth.token');
        } catch (e) {
          console.error('Failed to manually wipe SupabaseStorage', e);
        }
      }
    }

    if (!biometricEnabled) {
      try {
        await secureStorage.removeItem('refreshToken');
        await secureStorage.removeItem('userEmail');
        await secureStorage.removeItem('lastUser');
      } catch (storageError) {
        console.error('Error cleaning up secure storage:', storageError);
      }
    }

    // Set auth state to logged out: null user & session
    updateAuthState({
      user: null,
      session: null,
      isOfflineAuthoritative: false,
    });
    updateAuthStateSync({ isLoggedIn: false });

    if (clearLocalData) {
      await clearAllPersistence({ reload: false });
    }
  } catch (error) {
    console.error('Error signing out:', error);
    updateAuthState({
      user: null,
      session: null,
      isOfflineAuthoritative: false,
    });
    updateAuthStateSync({ isLoggedIn: false });
  } finally {
    updateAuthState({ isSigningOut: false });
  }
};

export const confirmSignOut = () => updateAuthState({ isSignOutDialogVisible: true });
export const hideSignOutDialog = () => updateAuthState({ isSignOutDialogVisible: false });

export const refreshUser = async () => {
  if (!supabase) return;
  try {
    const storedRefreshToken = (await secureStorage.getItem('refreshToken')) as
      | string
      | null;

    if (storedRefreshToken) {
      const {
        data: { session },
        error: refreshError,
      } = await supabase.auth.refreshSession({
        refresh_token: storedRefreshToken,
      });

      if (!refreshError && session?.user) {
        await setOnlineSession(session.user, session, false);
        return;
      }

      if (refreshError) {
        if (
          refreshError.message?.includes('not found') ||
          refreshError.message?.includes('invalid') ||
          refreshError.status === 400
        ) {
          updateAuthState({
            user: null,
            session: null,
            isOfflineAuthoritative: false,
          });
          updateAuthStateSync({ isLoggedIn: false });
          return;
        }
      }
    }

    const {
      data: { session: localSession },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      updateAuthState({
        user: null,
        session: null,
        isOfflineAuthoritative: false,
      });
      updateAuthStateSync({ isLoggedIn: false });
      return;
    }

    if (localSession?.user) {
      await setOnlineSession(localSession.user, localSession, false);
    } else {
      updateAuthState({
        user: null,
        session: null,
        isOfflineAuthoritative: false,
      });
      updateAuthStateSync({ isLoggedIn: false });
    }
  } catch {
    updateAuthState({
      user: null,
      session: null,
      isOfflineAuthoritative: false,
    });
    updateAuthStateSync({ isLoggedIn: false });
  }
};

export const initializeAuth = async (mountedCheck: () => boolean) => {
  try {
    await initializeSupabaseClient();

    if (!supabase) {
      if (mountedCheck()) {
        setOfflineSession();
        updateAuthState({ loading: false });
      }
      await SplashScreen.hideAsync();
      return;
    }

    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();
    let nextSession = session;

    if (!nextSession || error) {
      try {
        const storedRefreshToken = (await secureStorage.getItem('refreshToken')) as
          | string
          | null;
        if (storedRefreshToken) {
          const { data: refreshData, error: refreshError } =
            await supabase.auth.refreshSession({
              refresh_token: storedRefreshToken,
            });

          if (!refreshError && refreshData.session) {
            nextSession = refreshData.session;
            if (refreshData.session.refresh_token) {
              await secureStorage.setItem(
                'refreshToken',
                refreshData.session.refresh_token,
              );
            }
          } else {
            await secureStorage.removeItem('refreshToken');
          }
        }
      } catch (restoreError) {
        console.error('Error restoring session:', restoreError);
      }
    }

    if (mountedCheck()) {
      const storedUser = (await secureStorage.getItem('lastUser')) as User | null;
      const finalUser = nextSession?.user ?? storedUser ?? null;

      if (!finalUser) {
        updateAuthState({
          user: null,
          session: null,
          isOfflineAuthoritative: false,
        });
        updateAuthStateSync({ isLoggedIn: false });
      } else {
        await setOnlineSession(finalUser, nextSession, false);
        migrateOfflineData(finalUser.id).catch(console.error);
        ensureUserProfile(finalUser).catch(console.error);

        supabase.auth
          .getUser()
          .then(({ data: { user: freshUser }, error: userError }) => {
            if (mountedCheck() && !userError && freshUser) {
              updateAuthState({ user: freshUser });
              secureStorage.setItem('lastUser', freshUser).catch(console.error);
            }
          })
          .catch(console.error);
      }
      updateAuthState({ loading: false });
    }
    await SplashScreen.hideAsync();
  } catch {
    if (mountedCheck()) {
      updateAuthState({
        user: null,
        session: null,
        isOfflineAuthoritative: false,
        loading: false,
      });
      updateAuthStateSync({ isLoggedIn: false });
    }
    await SplashScreen.hideAsync();
  }
};
