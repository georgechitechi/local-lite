import { Tabs } from 'expo-router';
import { Platform, Text } from 'react-native';

export default function RootLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#0284c7',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e2e8f0',
          height: Platform.OS === 'ios' ? 84 : 62,
          paddingBottom: Platform.OS === 'ios' ? 24 : 8,
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
    </Tabs>
  );
}
