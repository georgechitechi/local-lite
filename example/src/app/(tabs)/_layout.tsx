import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSync } from '../../context/SyncContext';

export default function TabLayout() {
  const { pendingCount } = useSync();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#090D16',
          borderTopColor: '#1E293B',
          height: 56 + Math.max(insets.bottom, 14),
          paddingBottom: Math.max(insets.bottom, 10),
          paddingTop: 8,
        },
        tabBarActiveTintColor: '#38BDF8',
        tabBarInactiveTintColor: '#64748B',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Units',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="business" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tenants"
        options={{
          title: 'Tenants',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="maintenance"
        options={{
          title: 'Repairs',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="construct" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="payments"
        options={{
          title: 'Rent',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="card" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: 'Sync',
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: '#38BDF8',
            color: '#090D16',
            fontWeight: '800',
            fontSize: 10,
          },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cloud-done" size={size - 2} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
