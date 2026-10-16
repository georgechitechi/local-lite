import React, { useState } from 'react';
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
    clearDemoData,
    seedLocalData,
    seedRemoteData,
  } = useSync();

  // Seeder UI state
  const [selectedCount, setSelectedCount] = useState<number>(200);
  const [skipOutbox, setSkipOutbox] = useState<boolean>(false);
  const [isSeeding, setIsSeeding] = useState<boolean>(false);
  const [seedStage, setSeedStage] = useState<string>('');
  const [seedPercent, setSeedPercent] = useState<number>(0);
  const [seedRate, setSeedRate] = useState<number>(0);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleSeedLocal = async () => {
    setIsSeeding(true);
    setSeedPercent(0);
    setSeedStage('Initializing local seed...');
    setLastResult(null);
    try {
      const res = await seedLocalData(selectedCount, skipOutbox, (p) => {
        setSeedPercent(p.percent);
        setSeedStage(p.stage);
        if (p.rate) setSeedRate(p.rate);
      });
      setLastResult(
        `⚡ Seeded ${res.totalInserted} records in ${(res.durationMs / 1000).toFixed(2)}s (${res.rate} rec/s)`
      );
    } catch (err: any) {
      setLastResult(`❌ Error: ${err?.message || err}`);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleSeedRemote = async () => {
    setIsSeeding(true);
    setSeedPercent(0);
    setSeedStage('Connecting to Convex...');
    setLastResult(null);
    try {
      const res = await seedRemoteData(selectedCount, (p) => {
        setSeedPercent(p.percent);
        setSeedStage(p.stage);
        if (p.rate) setSeedRate(p.rate);
      });
      setLastResult(
        `☁️ Seeded ${res.totalInserted} rows into Convex in ${(res.durationMs / 1000).toFixed(2)}s (${res.rate} rec/s). Ready to sync!`
      );
    } catch (err: any) {
      setLastResult(`❌ Error: ${err?.message || err}`);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleClearAll = async () => {
    setIsSeeding(true);
    setSeedStage('Clearing local SQLite and Convex tables...');
    try {
      await clearDemoData({ clearRemote: true, clearOutbox: true });
      setLastResult('🧹 All local SQLite & Convex tables cleared!');
    } catch (err: any) {
      setLastResult(`❌ Error clearing: ${err?.message || err}`);
    } finally {
      setIsSeeding(false);
    }
  };

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

        {/* Massive Data Seeder & Stress Benchmark Card */}
        <View style={styles.seederCard}>
          <View style={styles.seederHeader}>
            <Text style={styles.seederTitle}>⚡ Massive Data Generator & Stress Test</Text>
            <Text style={styles.seederSubtitle}>
              Test local SQLite insertion speed, outbox drain throughput, or Convex pull paging.
            </Text>
          </View>

          {/* Record Count Selector */}
          <Text style={styles.seederSectionLabel}>Choose Record Count:</Text>
          <View style={styles.countPillsRow}>
            {[50, 200, 1000, 2500].map((count) => (
              <TouchableOpacity
                key={count}
                style={[
                  styles.countPill,
                  selectedCount === count && styles.countPillSelected,
                ]}
                onPress={() => setSelectedCount(count)}
                disabled={isSeeding}
              >
                <Text
                  style={[
                    styles.countPillText,
                    selectedCount === count && styles.countPillTextSelected,
                  ]}
                >
                  {count >= 1000 ? `${count / 1000}k` : count} records
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Outbox mode toggle */}
          <View style={styles.seederToggleRow}>
            <Text style={styles.seederToggleLabel}>Queue in Outbox (Push to Cloud):</Text>
            <TouchableOpacity
              style={[
                styles.modePill,
                !skipOutbox ? styles.modePillActive : styles.modePillInactive,
              ]}
              onPress={() => setSkipOutbox(!skipOutbox)}
              disabled={isSeeding}
            >
              <Text style={styles.modePillText}>
                {!skipOutbox ? 'Enabled (Syncs)' : 'Disabled (Local Only)'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Action Buttons */}
          <View style={styles.seederBtnRow}>
            <TouchableOpacity
              style={[styles.seedActionBtn, styles.seedLocalBtn, isSeeding && styles.btnDisabled]}
              onPress={handleSeedLocal}
              disabled={isSeeding}
            >
              <Text style={styles.seedActionBtnText}>🚀 Seed SQLite</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.seedActionBtn, styles.seedRemoteBtn, isSeeding && styles.btnDisabled]}
              onPress={handleSeedRemote}
              disabled={isSeeding}
            >
              <Text style={styles.seedActionBtnText}>☁️ Seed Convex</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.clearAllBtn, isSeeding && styles.btnDisabled]}
            onPress={handleClearAll}
            disabled={isSeeding}
          >
            <Text style={styles.clearAllBtnText}>🗑️ Clear All (Local SQLite & Convex)</Text>
          </TouchableOpacity>

          {/* Live Progress Bar */}
          {isSeeding && (
            <View style={styles.progressContainer}>
              <View style={styles.progressBarTrack}>
                <View style={[styles.progressBarFill, { width: `${seedPercent}%` }]} />
              </View>
              <View style={styles.progressMetaRow}>
                <Text style={styles.progressStageText}>{seedStage}</Text>
                <Text style={styles.progressPercentText}>{seedPercent}%</Text>
              </View>
              {seedRate > 0 && (
                <Text style={styles.progressRateText}>⚡ {seedRate.toLocaleString()} records/sec</Text>
              )}
            </View>
          )}

          {/* Benchmark Results */}
          {lastResult && !isSeeding && (
            <View style={styles.benchmarkBanner}>
              <Text style={styles.benchmarkText}>{lastResult}</Text>
            </View>
          )}
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
            2. Tap <Text style={{ fontWeight: 'bold' }}>Seed SQLite (with Outbox enabled)</Text>.{'\n'}
            3. Inspect the queued outbox mutations below.{'\n'}
            4. Switch back to <Text style={{ fontWeight: 'bold' }}>Online</Text> to watch the outbox
            drain loop flush batches of 50 in rapid succession!
          </Text>
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
  clearCacheBtn: {
    backgroundColor: '#334155',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  clearCacheBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
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

  // Seeder Styles
  seederCard: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#374151',
    marginBottom: 16,
  },
  seederHeader: { marginBottom: 14 },
  seederTitle: { fontSize: 15, fontWeight: '800', color: '#F3F4F6' },
  seederSubtitle: { fontSize: 11, color: '#9CA3AF', marginTop: 4, lineHeight: 16 },
  seederSectionLabel: { fontSize: 11, fontWeight: '700', color: '#D1D5DB', marginBottom: 8 },
  countPillsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  countPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1F2937',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  countPillSelected: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8',
  },
  countPillText: { fontSize: 11, fontWeight: '700', color: '#9CA3AF' },
  countPillTextSelected: { color: '#FFFFFF' },
  seederToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingVertical: 4,
  },
  seederToggleLabel: { fontSize: 11, fontWeight: '600', color: '#9CA3AF' },
  modePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  modePillActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10B981',
  },
  modePillInactive: {
    backgroundColor: 'rgba(107, 114, 128, 0.15)',
    borderColor: '#6B7280',
  },
  modePillText: { fontSize: 10, fontWeight: '700', color: '#F9FAFB' },
  seederBtnRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  seedActionBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seedLocalBtn: { backgroundColor: '#2563EB' },
  seedRemoteBtn: { backgroundColor: '#059669' },
  seedActionBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  clearAllBtn: {
    backgroundColor: '#374151',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 2,
  },
  clearAllBtnText: { color: '#F87171', fontWeight: '700', fontSize: 11 },
  btnDisabled: { opacity: 0.5 },
  progressContainer: {
    marginTop: 14,
    padding: 12,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#1E293B',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#38BDF8',
    borderRadius: 4,
  },
  progressMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressStageText: { fontSize: 11, color: '#94A3B8', flex: 1, marginRight: 8 },
  progressPercentText: { fontSize: 11, fontWeight: '800', color: '#38BDF8' },
  progressRateText: { fontSize: 11, fontWeight: '700', color: '#10B981', marginTop: 4 },
  benchmarkBanner: {
    marginTop: 12,
    padding: 10,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  benchmarkText: { fontSize: 11, fontWeight: '700', color: '#38BDF8', textAlign: 'center' },
});
