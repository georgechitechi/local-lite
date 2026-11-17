import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

function TabsNavigator() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#0284c7',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e2e8f0',
          height: 54 + bottomPadding,
          paddingBottom: bottomPadding,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        headerStyle: {
          backgroundColor: '#ffffff',
        },
        headerTitleStyle: {
          fontWeight: '700',
          color: '#0f172a',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Auth',
          headerTitle: 'local-lite Auth',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 18, color }}>🔐</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="payments"
        options={{
          title: 'Payments',
          headerTitle: 'local-lite Payments',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 18, color }}>💳</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="emails"
        options={{
          title: 'Emails',
          headerTitle: 'local-lite Emails (Dev)',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 18, color }}>✉️</Text>
          ),
        }}
      />
    </Tabs>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <TabsNavigator />
    </SafeAreaProvider>
  );
}
