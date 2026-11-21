import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="settings"
          options={{
            title: 'Settings',
            headerStyle: { backgroundColor: '#ffffff' },
            headerTitleStyle: { fontWeight: '700', color: '#0f172a' },
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
