import React from 'react';
import { Stack } from 'expo-router';
import { SyncProvider } from '../context/SyncContext';

export default function RootLayout() {
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
