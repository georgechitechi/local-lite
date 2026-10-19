import type { Session, User } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import type React from 'react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { AppState, type AppStateStatus, StyleSheet, View } from 'react-native';
import BaseModal from '@/shared/components/BaseModal';
import LoadingCard from '@/shared/components/LoadingCard';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { ensureUserProfile } from '@/shared/services/auth';
import { secureStorage } from '@/shared/services/secureStorage';
import { supabase, updateAuthStateSync } from '@/shared/services/supabase';
import {
  authorizeLocalMode,
  confirmSignOut,
  getAuthStateSnapshot,
  hideSignOutDialog,
  initializeAuth,
  refreshUser,
  type SignInData,
  type SignUpData,
  setOfflineUser,
  setOnlineUser,
  signIn,
  signOut,
  signUp,
  subscribeAuth,
  updateAuthState,
} from '@/stores/authStore';

SplashScreen.preventAutoHideAsync().catch(() => {});

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isOfflineAuthoritative: boolean;
  isLocalModeAuthorized: boolean;
  authorizeLocalMode: () => Promise<void>;
  signUp: (data: SignUpData) => Promise<{ user: User | null; error: Error | null }>;
  signIn: (data: SignInData) => Promise<{ user: User | null; error: Error | null }>;
  signOut: (options?: { clearLocalData?: boolean }) => Promise<void>;
  confirmSignOut: () => void;
  refreshUser: () => Promise<void>;
  setOfflineUser: (user: User) => void;
  setOnlineUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const router = useRouter();
  const appStateRef = useRef(AppState.currentState);
  const authState = useSyncExternalStore(subscribeAuth, getAuthStateSnapshot);
  const { isCloudSyncEnabled } = useLocalSync();

  useEffect(() => {
    let mounted = true;
    initializeAuth(() => mounted);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let subscription: any = null;
    let mounted = true;

    if (isCloudSyncEnabled && supabase) {
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        const isExplicitEvent =
          event === 'SIGNED_IN' ||
          event === 'SIGNED_OUT' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'PASSWORD_RECOVERY' ||
          event === 'USER_UPDATED';

        const isStillInitializing = getAuthStateSnapshot().loading;

        if (mounted) {
          if (session?.user) {
            updateAuthState({ user: session.user });
            updateAuthState({ session: session });
            updateAuthStateSync({ isLoggedIn: true });
            updateAuthState({ isOfflineAuthoritative: false });
          } else if (!isStillInitializing || isExplicitEvent) {
            updateAuthState({ user: null });
            updateAuthState({ session: null });
            updateAuthStateSync({ isLoggedIn: false });
            updateAuthState({ isOfflineAuthoritative: false });
          }
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            await secureStorage.setItem('lastUser', session.user);
            ensureUserProfile(session.user).catch(console.error);
          }
          if (session?.refresh_token) {
            try {
              await secureStorage.setItem('refreshToken', session.refresh_token);
            } catch (error) {
              console.error('Error storing refresh token:', error);
            }
          }
        } else if (event === 'SIGNED_OUT') {
          try {
            const biometricEnabled = await secureStorage.getItem('biometricEnabled');
            if (biometricEnabled !== true) {
              await secureStorage.removeItem('refreshToken');
              await secureStorage.removeItem('userEmail');
              await secureStorage.removeItem('lastUser');
            }
          } catch (error) {
            console.error('Error clearing storage on sign out:', error);
          }
        }
      });
      subscription = data.subscription;
    }

    return () => {
      mounted = false;
      if (subscription) subscription.unsubscribe();
    };
  }, [isCloudSyncEnabled]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      async (nextAppState: AppStateStatus) => {
        const user = getAuthStateSnapshot().user;
        const isOfflineAuthoritative = getAuthStateSnapshot().isOfflineAuthoritative;

        if (
          appStateRef.current?.match(/inactive|background/) &&
          nextAppState === 'active' &&
          user &&
          !isOfflineAuthoritative &&
          supabase
        ) {
          try {
            const {
              data: { session },
              error,
            } = await supabase.auth.getSession();
            if (session?.user && !error) {
              updateAuthState({ user: session.user });
              updateAuthState({ session: session });
              updateAuthStateSync({ isLoggedIn: true });
              await secureStorage.setItem('lastUser', session.user);
            }
          } catch {
            // Error checking session, nothing we can do here
          }
        }
        appStateRef.current = nextAppState;
      },
    );
    return () => subscription.remove();
  }, []);

  const handleSignOutConfirm = async () => {
    hideSignOutDialog();
    await signOut();
    router.replace('/(auth)/login');
  };

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user: authState.user,
      session: authState.session,
      loading: authState.loading,
      isOfflineAuthoritative: authState.isOfflineAuthoritative,
      isLocalModeAuthorized: authState.isLocalModeAuthorized,
      authorizeLocalMode,
      signUp,
      signIn,
      signOut,
      confirmSignOut,
      refreshUser,
      setOfflineUser,
      setOnlineUser,
    }),
    [
      authState.user,
      authState.session,
      authState.loading,
      authState.isOfflineAuthoritative,
      authState.isLocalModeAuthorized,
    ],
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
      {authState.isSigningOut && (
        <View style={{ ...StyleSheet.absoluteFill, zIndex: 999999 }}>
          <LoadingCard text="Signing out and clearing data..." iconName="loading" />
        </View>
      )}
      <BaseModal
        visible={authState.isSignOutDialogVisible}
        onDismiss={hideSignOutDialog}
        mode="confirm"
        title="Sign Out"
        icon="logout"
        message="Are you sure you want to sign out? For your security, all offline data will be wiped from this device. You can sign back in to sync your data again."
        confirmText="Sign Out"
        cancelText="Cancel"
        destructive={true}
        onConfirm={handleSignOutConfirm}
        onCancel={hideSignOutDialog}
      />
    </AuthContext.Provider>
  );
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    const snapshot = getAuthStateSnapshot();
    return {
      user: snapshot.user,
      session: snapshot.session,
      loading: snapshot.loading,
      isOfflineAuthoritative: snapshot.isOfflineAuthoritative,
      isLocalModeAuthorized: snapshot.isLocalModeAuthorized,
      authorizeLocalMode,
      signUp,
      signIn,
      signOut,
      confirmSignOut,
      refreshUser,
      setOfflineUser,
      setOnlineUser,
    };
  }
  return context;
};
