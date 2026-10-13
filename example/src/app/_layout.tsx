import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SyncProvider } from '../context/SyncContext';

// Prevent native splash screen from auto-hiding before React mounts
SplashScreen.preventAutoHideAsync().catch(() => {
  /* ignore error if already prevented or unsupported */
});

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {
      /* ignore error if already hidden */
    });
  }, []);

  return (
    <SyncProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#090D16' },
          headerTintColor: '#F8FAFC',
          headerTitleStyle: { fontWeight: '800', fontSize: 18 },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </SyncProvider>
  );
}

