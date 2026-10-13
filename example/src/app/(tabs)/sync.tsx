import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSync } from '../../context/SyncContext';
import { HeaderBar } from '../../components/HeaderBar';

export default function SyncScreen() {
  const {
    isOnline,
    toggleOnline,
    pendingCount,
    pendingRecords,
    refreshOutbox,
    lastSyncedText,
    forceResync,
    seedDemoData,
  } = useSync();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#090D16" />
      <HeaderBar />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Network & Engine Controls */}
        <View style={styles.controlsCard}>
          <Text style={styles.cardHeaderTitle}>Engine Controls</Text>
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[
                styles.toggleBtn,
                isOnline ? styles.toggleOnline : styles.toggleOffline,
              ]}
              onPress={toggleOnline}
            >
              <Text style={styles.toggleBtnText}>
                {isOnline ? '🟢 Connected (Online)' : '🔴 Disconnected (Airplane Mode)'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.resyncBtn} onPress={forceResync}>
              <Text style={styles.resyncBtnText}>🔄 Reset Cursor</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.engineStatsRow}>
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>Pending Queue</Text>
              <Text style={styles.statValue}>{pendingCount} mutations</Text>
            </View>
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>Persistent Cursor</Text>
              <Text style={styles.statValue}>{lastSyncedText}</Text>
            </View>
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>Local Storage</Text>
              <Text style={styles.statValue}>SQLite ACID</Text>
            </View>
          </View>
        </View>

        {/* Informative Explanation */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoTitle}>⚡ Transactional Outbox Pattern in Action</Text>
          <Text style={styles.infoText}>
            Every write in this app commits atomically to both your local SQLite table and the
            <Text style={styles.codeText}> sync_outbox </Text>table in a single database transaction.
          </Text>
          <Text style={[styles.infoText, { marginTop: 6 }]}>
            1. Toggle to <Text style={{ fontWeight: 'bold' }}>Airplane Mode</Text> above.{'\n'}
            2. Go to any tab and create or edit properties, tenants, or tickets.{'\n'}
            3. Return here to inspect the queued outbox operations.{'\n'}
            4. Switch back to <Text style={{ fontWeight: 'bold' }}>Online</Text> to watch the outbox
            drain and flush immediately!
          </Text>

          <TouchableOpacity style={styles.seedBannerBtn} onPress={seedDemoData}>
            <Text style={styles.seedBannerText}>🚀 Seed Demo Portfolio (Multi-Table)</Text>
          </TouchableOpacity>
        </View>

        {/* Outbox Records List */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Local Outbox Queue ({pendingCount})</Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={refreshOutbox}>
            <Text style={styles.refreshBtnText}>↻ Refresh</Text>
          </TouchableOpacity>
        </View>

        {pendingRecords.length === 0 ? (
          <View style={styles.cleanCard}>
            <Text style={styles.cleanTitle}>✨ Outbox is Clean</Text>
            <Text style={styles.cleanText}>
              All local mutations have been successfully pushed to the remote backend.
            </Text>
          </View>
        ) : (
          pendingRecords.map((item, idx) => (
            <View key={item.id ?? idx} style={styles.recordCard}>
              <View style={styles.recordTop}>
                <View
                  style={[
                    styles.opBadge,
                    item.operation === 'INSERT'
                      ? styles.opInsert
                      : item.operation === 'UPDATE'
                      ? styles.opUpdate
                      : styles.opDelete,
                  ]}
                >
                  <Text style={styles.opText}>{item.operation}</Text>
                </View>
                <Text style={styles.tableName}>{item.table_name}</Text>
                <Text style={styles.statusPill}>{item.status}</Text>
              </View>

              <Text style={styles.idText}>Row ID: {item.row_id}</Text>
              {item.payload ? (
                <Text style={styles.payloadText} numberOfLines={2}>
                  Payload: {typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload)}
                </Text>
              ) : null}
              <Text style={styles.timeText}>
                Stamptime: {new Date(Number(item.timestamp)).toLocaleTimeString()} • Retries: {item.retry_count ?? 0}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#090D16' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  controlsCard: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
    marginBottom: 16,
  },
  cardHeaderTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  controlsRow: { flexDirection: 'row', gap: 10 },
  toggleBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  toggleOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  toggleBtnText: { color: '#F8FAFC', fontWeight: '700', fontSize: 13 },
  resyncBtn: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  resyncBtnText: { color: '#38BDF8', fontWeight: '700', fontSize: 12 },
  engineStatsRow: {
    flexDirection: 'row',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  statCol: { flex: 1 },
  statLabel: { fontSize: 10, color: '#6B7280', fontWeight: '600' },
  statValue: { fontSize: 13, fontWeight: '700', color: '#E2E8F0', marginTop: 2 },
  infoBanner: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#38BDF8',
  },
  infoTitle: { fontSize: 14, fontWeight: '700', color: '#F8FAFC', marginBottom: 6 },
  infoText: { fontSize: 12, color: '#94A3B8', lineHeight: 18 },
  codeText: { fontFamily: 'monospace', color: '#38BDF8', fontWeight: '600' },
  seedBannerBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  seedBannerText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#F8FAFC' },
  refreshBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  refreshBtnText: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  cleanCard: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  cleanTitle: { color: '#10B981', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  cleanText: { color: '#9CA3AF', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  recordCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  recordTop: { flexDirection: 'row', alignItems: 'center' },
  opBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  opInsert: { backgroundColor: '#10B981' },
  opUpdate: { backgroundColor: '#3B82F6' },
  opDelete: { backgroundColor: '#EF4444' },
  opText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  tableName: { color: '#F3F4F6', fontWeight: '700', fontSize: 13, flex: 1 },
  statusPill: { color: '#F59E0B', fontSize: 11, fontWeight: '700' },
  idText: { color: '#9CA3AF', fontSize: 11, marginTop: 6 },
  payloadText: {
    color: '#D1D5DB',
    fontSize: 11,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  timeText: { color: '#6B7280', fontSize: 10, marginTop: 4 },
});
