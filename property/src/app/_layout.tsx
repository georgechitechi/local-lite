import Constants from 'expo-constants';
import { NavigationBar } from 'expo-navigation-bar';
import { ObserveRoot, useObserve } from 'expo-observe';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Linking, LogBox, Platform, Text, TouchableOpacity, View } from 'react-native';
import 'react-native-get-random-values';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import 'react-native-url-polyfill/auto';
import { ErrorBoundary } from 'react-error-boundary';
import { PaperProvider, Portal } from 'react-native-paper';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BusinessProvider, useBusiness } from '@/context/BusinessContext';
import { SnackbarProvider } from '@/context/SnackbarContext';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { BiometricAuthProvider } from '@/providers/BiometricAuthProvider';
import { LockScreenProvider, useIdleLock } from '@/providers/LockScreenProvider';
import { SyncClientProvider } from '@/providers/SyncClientProvider';
import { AppAccessProvider } from '@/shared/access/AppAccessProvider';
import { useOfflineImageSync } from '@/shared/components/CachedImage';
import DeletionBlocker from '@/shared/components/DeletionBlocker';
import LocalModeBanner from '@/shared/components/LocalModeBanner';
import { GlobalErrorFallback } from '@/shared/components/GlobalErrorFallback';
import LoadingCard from '@/shared/components/LoadingCard';
import LockScreen from '@/shared/components/LockScreen';
import OfflineBanner from '@/shared/components/OfflineBanner';
import { UpdatePrompt } from '@/shared/components/UpdatePrompt';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { ThemeProvider, useTheme } from '@/shared/hooks/useThemeProvider';
import { useVersionCheck } from '@/shared/hooks/useVersionCheck';

// Ignore React Native deprecation warnings coming from third-party libraries
LogBox.ignoreLogs([
  'SafeAreaView has been deprecated',
  'InteractionManager has been deprecated',
  '[Reanimated]',
  '[local-lite] 📡 Network Offline',
]);

function RootLayoutNav() {
  const { user, loading, isOfflineAuthoritative } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const { loading: businessLoading } = useBusiness();
  const { isLocked } = useIdleLock();
  const { showPrompt, onUpdate, onDismiss } = useVersionCheck();
  const { markInteractive } = useObserve();
  const insets = useSafeAreaInsets();

  // Process offline image uploads when network is restored
  useOfflineImageSync();

  useEffect(() => {
    if (loading || businessLoading) return;

    // Prevent navigation loops by checking if we're already on the target route
    const inAuthGroup = segments[0] === '(auth)';
    const isPasswordResetScreen =
      (segments as string[])[1] === 'new-password' ||
      (segments as string[])[1] === 'reset-password';
    const isCloudSyncScreen = (segments as string[]).includes('cloud-sync');

    const isAuthenticated = !!user && !isOfflineAuthoritative;

    // Only navigate if conditions are met and we're not already on the target route
    if (!isAuthenticated && !inAuthGroup && !isCloudSyncScreen) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated) {
      if (inAuthGroup && !isPasswordResetScreen) {
        router.replace('/(tabs)');
      }
    }
  }, [user, loading, businessLoading, segments, router, isOfflineAuthoritative]);

  useEffect(() => {
    if (!loading && !businessLoading) {
      markInteractive();
    }
  }, [loading, businessLoading, markInteractive]);

  const { isLocalMode } = useLocalSync();

  if (loading || (user && businessLoading)) {
    return <LoadingCard text="Initialising application..." />;
  }

  const deletionRequestedAt = user?.user_metadata?.deletion_requested_at;
  const isDeletionPending = !!deletionRequestedAt;

  const isCloudSync = (segments as string[]).includes('cloud-sync');
  const showLocalBanner = isLocalMode && !isCloudSync;

  return (
    <Portal.Host>
      <OfflineBanner />
      {showLocalBanner && <LocalModeBanner />}
      {isDeletionPending ? (
        <DeletionBlocker />
      ) : showLocalBanner ? (
        <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
          <Slot />
        </SafeAreaInsetsContext.Provider>
      ) : (
        <Slot />
      )}
      {isLocked && <LockScreen />}
      <UpdatePrompt visible={showPrompt} onUpdate={onUpdate} onDismiss={onDismiss} />
    </Portal.Host>
  );
}

export default function RootLayout() {
  if (Platform.OS === 'web') {
    const androidPackageName = Constants.expoConfig?.android?.package;
    const playStoreUrl = `https://play.google.com/store/apps/details?id=${androidPackageName}`;
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#f8f9fa',
          padding: 20,
        }}
      >
        <Text
          style={{
            fontSize: 24,
            fontWeight: 'bold',
            color: '#333',
            textAlign: 'center',
            marginBottom: 12,
          }}
        >
          Mobile App Only
        </Text>
        <Text
          style={{ fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 24 }}
        >
          This application is designed exclusively for mobile devices. Please download and
          install the app on your Android or iOS device to continue.
        </Text>
        {androidPackageName && (
          <TouchableOpacity
            style={{
              backgroundColor: '#007AFF',
              paddingHorizontal: 20,
              paddingVertical: 12,
              borderRadius: 8,
            }}
            onPress={() => Linking.openURL(playStoreUrl)}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
              Get it on Google Play
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <ErrorBoundary FallbackComponent={GlobalErrorFallback}>
      <ObserveRoot>
        <ThemeProvider>
          <ThemedApp />
        </ThemeProvider>
      </ObserveRoot>
    </ErrorBoundary>
  );
}

function ThemedApp() {
  const { isLoading, isDarkMode, theme } = useTheme();

  if (isLoading) {
    return <LoadingCard text="Loading theme..." />;
  }

  return (
    <KeyboardProvider>
      <PaperProvider theme={theme}>
        <SnackbarProvider>
          <StatusBar style={isDarkMode ? 'light' : 'dark'} />
          {Platform.OS === 'android' && (
            <NavigationBar style={isDarkMode ? 'light' : 'dark'} />
          )}
          <SyncClientProvider>
            <AuthProvider>
              <BiometricAuthProvider>
                <LockScreenProvider>
                  <BusinessProvider>
                    <AppAccessProvider>
                      <RootLayoutNav />
                    </AppAccessProvider>
                  </BusinessProvider>
                </LockScreenProvider>
              </BiometricAuthProvider>
            </AuthProvider>
          </SyncClientProvider>
        </SnackbarProvider>
      </PaperProvider>
    </KeyboardProvider>
  );
}
