import { Tabs, useRouter } from 'expo-router';
import { Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
        name="dashboard"
        options={{
          title: 'Dashboard',
          headerTitle: 'Portfolio Dashboard',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 18, color }}>📊</Text>
          ),
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/settings')}
              style={{ marginRight: 14, padding: 6 }}
            >
              <Text style={{ fontSize: 20 }}>⚙️</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Properties',
          headerTitle: 'Properties & Houses',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 18, color }}>🏠</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="tenants"
        options={{
          title: 'Tenants',
          headerTitle: 'Tenants & Contacts',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 18, color }}>👥</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="contracts"
        options={{
          title: 'Contracts',
          headerTitle: 'Lease Contracts',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 18, color }}>📄</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="receipts"
        options={{
          title: 'Receipts',
          headerTitle: 'Rent Receipts',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 18, color }}>💵</Text>
          ),
        }}
      />
    </Tabs>
  );
}
