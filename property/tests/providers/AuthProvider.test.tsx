import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Text } from 'react-native';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { OFFLINE_USER_ID } from '@/shared/services/auth';
import { secureStorage } from '@/shared/services/secureStorage';
import { supabase } from '@/shared/services/supabase';

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(true),
  hideAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/shared/hooks/useLocalSync', () => ({
  useLocalSync: () => ({ isCloudSyncEnabled: true }),
}));

jest.mock('@/shared/services/sync/client', () => ({
  getSyncClient: jest.fn().mockResolvedValue({
    syncWorker: { pullRemoteChanges: jest.fn().mockResolvedValue(undefined) },
    findMany: jest.fn().mockResolvedValue([]),
    batch: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('@/stores/syncHelper', () => ({
  clearAllPersistence: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/shared/components/BaseModal', () => {
  const { View, Button } = require('react-native');
  return (props: any) => (
    <View testID="base-modal">
      <Button testID="modal-confirm" title="Confirm" onPress={props.onConfirm} />
    </View>
  );
});

jest.mock('@/shared/components/LoadingCard', () => {
  const { View } = require('react-native');
  return () => <View testID="loading-card" />;
});

jest.mock('@/shared/services/auth', () => {
  const actual = jest.requireActual('@/shared/services/auth');
  return {
    ...actual,
    ensureUserProfile: jest.fn().mockResolvedValue(true),
  };
});

jest.mock('@/shared/services/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(),
    setItem: jest.fn().mockResolvedValue(true),
    removeItem: jest.fn().mockResolvedValue(true),
  },
}));

let authStateCallback: any = null;

jest.mock('@/shared/services/supabase', () => {
  const mockSupabase: any = {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
      onAuthStateChange: jest.fn().mockImplementation(cb => {
        authStateCallback = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      refreshSession: jest.fn(),
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
  };
  return {
    supabase: mockSupabase,
    initializeSupabaseClient: jest.fn().mockResolvedValue(true),
    updateAuthStateSync: jest.fn(),
    SupabaseStorage: {
      removeItem: jest.fn().mockResolvedValue(true),
    },
  };
});

let appStateCallback: any = null;

const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
  }),
}));

// A simple test component to consume the context
const TestComponent = () => {
  const { user, loading, isOfflineAuthoritative } = useAuth();
  return (
    <>
      <Text testID="loading-state">{loading ? 'loading' : 'ready'}</Text>
      <Text testID="user-id">{user?.id || 'none'}</Text>
      <Text testID="offline-state">{isOfflineAuthoritative ? 'offline' : 'online'}</Text>
    </>
  );
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { AppState } = require('react-native');
    jest.spyOn(AppState, 'addEventListener').mockImplementation((event, cb: any) => {
      if (event === 'change') appStateCallback = cb;
      return { remove: jest.fn() } as any;
    });
    AppState.currentState = 'background';
  });

  it('renders correctly and sets offline user if no session is found', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: null,
    });
    (secureStorage.getItem as jest.Mock).mockResolvedValue(null);

    await act(async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>,
      );
      await delay(50);
    });

    expect(screen.getByTestId('loading-state').props.children).toBe('ready');
    expect(screen.getByTestId('user-id').props.children).toBe(OFFLINE_USER_ID);
    expect(screen.getByTestId('offline-state').props.children).toBe('offline');
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  it('restores session from secure storage refresh token if session is missing', async () => {
    const mockUser = { id: 'user-1' };
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: null,
    });
    (secureStorage.getItem as jest.Mock).mockImplementation(key => {
      if (key === 'refreshToken') return Promise.resolve('valid-token');
      return Promise.resolve(null);
    });

    (supabase.auth.refreshSession as jest.Mock).mockResolvedValue({
      data: { session: { user: mockUser, refresh_token: 'new-token' } },
      error: null,
    });
    (supabase.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });

    await act(async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>,
      );
      await delay(100);
    });

    expect(screen.getByTestId('loading-state').props.children).toBe('ready');
    expect(screen.getByTestId('user-id').props.children).toBe('user-1');
    expect(screen.getByTestId('offline-state').props.children).toBe('online');
    expect(secureStorage.setItem).toHaveBeenCalledWith('refreshToken', 'new-token');
    expect(secureStorage.setItem).toHaveBeenCalledWith('lastUser', mockUser);
  });

  it('signs out user and clears data', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: null },
      error: null,
    });
    (secureStorage.getItem as jest.Mock).mockResolvedValue(null);

    let contextValue: any;
    const ContextExtractor = () => {
      contextValue = useAuth();
      return null;
    };

    await act(async () => {
      render(
        <AuthProvider>
          <ContextExtractor />
        </AuthProvider>,
      );
      await delay(500);
    });

    expect(contextValue).toBeDefined();
    expect(typeof contextValue.signOut).toBe('function');

    await act(async () => {
      await contextValue.signOut();
    });

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(secureStorage.removeItem).toHaveBeenCalledWith('refreshToken');
    expect(secureStorage.removeItem).toHaveBeenCalledWith('userEmail');
    expect(secureStorage.removeItem).toHaveBeenCalledWith('lastUser');
  });

  it('handles auth state changes correctly', async () => {
    await act(async () => {
      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>,
      );
      await delay(50);
    });

    const mockSession = { user: { id: 'u2' }, refresh_token: 'r2' };

    // Test SIGNED_IN
    await act(async () => {
      await authStateCallback('SIGNED_IN', mockSession);
    });
    expect(screen.getByTestId('user-id').props.children).toBe('u2');
    expect(secureStorage.setItem).toHaveBeenCalledWith('lastUser', mockSession.user);
    expect(secureStorage.setItem).toHaveBeenCalledWith('refreshToken', 'r2');

    // Test SIGNED_OUT
    (secureStorage.getItem as jest.Mock).mockResolvedValueOnce(false); // biometrics disabled
    await act(async () => {
      await authStateCallback('SIGNED_OUT', null);
    });
    expect(screen.getByTestId('user-id').props.children).toBe(OFFLINE_USER_ID);
    expect(secureStorage.removeItem).toHaveBeenCalledWith('lastUser');
    expect(secureStorage.removeItem).toHaveBeenCalledWith('refreshToken');
    expect(secureStorage.removeItem).toHaveBeenCalledWith('userEmail');
  });

  it('handles AppState changes from background to active', async () => {
    // Initial state is 'background' from mock
    const mockSession = { user: { id: 'app-state-user' } };
    (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({
      data: { session: mockSession },
      error: null,
    });

    let contextValue: any;
    const ContextExtractor = () => {
      contextValue = useAuth();
      return null;
    };

    await act(async () => {
      render(
        <AuthProvider>
          <ContextExtractor />
          <TestComponent />
        </AuthProvider>,
      );
      await delay(50);
    });

    // Set user manually to avoid being blocked by !user check in AppState change
    await act(async () => {
      contextValue.setOnlineUser(mockSession.user);
    });

    await act(async () => {
      await appStateCallback('active');
    });

    expect(supabase.auth.getSession).toHaveBeenCalled();
    expect(screen.getByTestId('user-id').props.children).toBe('app-state-user');
  });

  it('handles sign out confirm', async () => {
    let contextValue: any;
    const ContextExtractor = () => {
      contextValue = useAuth();
      return null;
    };

    await act(async () => {
      render(
        <AuthProvider>
          <ContextExtractor />
        </AuthProvider>,
      );
      await delay(50);
    });

    await act(async () => {
      contextValue.confirmSignOut();
    });

    const confirmButton = screen.getByTestId('modal-confirm');
    expect(confirmButton).toBeDefined();

    await act(async () => {
      fireEvent.press(confirmButton);
      await delay(100);
    });

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(mockRouterReplace).toHaveBeenCalledWith('/');
  });
});
