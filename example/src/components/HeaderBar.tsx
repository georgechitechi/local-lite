import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { useSync } from '../context/SyncContext';
import { useRouter } from 'expo-router';

export function HeaderBar() {
  const { isOnline, toggleOnline, pendingCount, lastSyncedText, statusMessage, forceResync } = useSync();
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.brandCol}>
          <Text style={styles.title}>🏢 PropFlow</Text>
          <Text style={styles.subtitle}>Offline-First Property Operations</Text>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.networkBadge, isOnline ? styles.networkOnline : styles.networkOffline]}
            onPress={toggleOnline}
            activeOpacity={0.8}
          >
            <View style={[styles.dot, isOnline ? styles.dotGreen : styles.dotOrange]} />
            <Text style={styles.networkText}>{isOnline ? 'Online Sync' : 'Airplane Mode'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.outboxBadge}
            onPress={() => router.push('/(tabs)/sync' as any)}
            activeOpacity={0.8}
          >
            <Text style={styles.outboxBadgeText}>📦 {pendingCount}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusText} numberOfLines={1}>
          {statusMessage}
        </Text>
        <TouchableOpacity onPress={forceResync}>
          <Text style={styles.cursorText}>Synced: {lastSyncedText} ↻</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#090D16',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  topRow: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandCol: {
    flex: 1,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 16,
  },
  networkOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  networkOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  dotGreen: {
    backgroundColor: '#10B981',
  },
  dotOrange: {
    backgroundColor: '#EF4444',
  },
  networkText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  outboxBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  outboxBadgeText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  statusRow: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
  },
  statusText: {
    color: '#94A3B8',
    fontSize: 11,
    flex: 1,
    marginRight: 8,
  },
  cursorText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '600',
  },
});
