import React, { useState, useEffect } from 'react';
import { LocalFirstClient } from '../core/client.js';
import { useSyncStatus } from './status.js';
import { BenchmarkModal } from './BenchmarkModal.js';

let RN: any;
try {
  RN = require('react-native');
} catch {
  // Web / DOM environment
}

let RNSafeArea: any;
try {
  RNSafeArea = require('react-native-safe-area-context');
} catch {
  // Web / DOM environment or not installed
}

export interface SyncInspectorProps {
  client: LocalFirstClient | null | undefined;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'top' | 'bottom' | 'inline';
  variant?: 'pill' | 'compact' | 'icon' | 'minimal';
  initialOpen?: boolean;
  fullWidth?: boolean;
  enableBenchmark?: boolean;
  onOpenBenchmark?: () => void;
  style?: any;
  renderTrigger?: (props: {
    isOpen: boolean;
    open: () => void;
    status: any;
    metrics: any;
    statusColor: string;
    statusLabel: string;
  }) => React.ReactNode;
}

/**
 * Universal Developer Inspector Component for local-lite.
 * Opens as a full-screen modal respecting device safe areas, exactly like BenchmarkModal.
 * Displays real-time outbox telemetry, connection status, metrics, and triggers manual pushes,
 * pulls, cursor resets, and the benchmark test suite.
 */
export function SyncInspector({
  client,
  position = 'bottom-right',
  variant = 'pill',
  initialOpen = false,
  enableBenchmark = true,
  onOpenBenchmark,
  style,
  renderTrigger,
}: SyncInspectorProps) {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isBenchmarkModalOpen, setIsBenchmarkModalOpen] = useState(false);
  const status = useSyncStatus(client);
  const [metrics, setMetrics] = useState<any>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !isOpen) return;
    client.getMetrics().then(setMetrics).catch(() => { });
  }, [client, isOpen, status.isSyncing, status.pendingCount]);

  if (!client) return null;

  const handlePush = async () => {
    setActionMessage('Pushing mutations...');
    try {
      await client.syncWorker.pushLocalChanges();
      setActionMessage('Push complete');
    } catch (err: any) {
      setActionMessage(`Push failed: ${err.message || err}`);
    }
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handlePull = async () => {
    setActionMessage('Pulling remote changes...');
    try {
      await client.syncWorker.pullRemoteChanges();
      setActionMessage('Pull complete');
    } catch (err: any) {
      setActionMessage(`Pull failed: ${err.message || err}`);
    }
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handleResetCursor = async () => {
    setActionMessage('Resetting cursor & refetching...');
    try {
      await client.resetSyncCursor();
      await client.syncWorker.pullRemoteChanges();
      setActionMessage('Cursor reset & refetched');
    } catch (err: any) {
      setActionMessage(`Reset failed: ${err.message || err}`);
    }
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handleRetryFailed = async () => {
    setActionMessage('Re-queueing failed mutations...');
    try {
      const count = await client.retryFailedMutations();
      setActionMessage(`Re-queued ${count} mutations`);
    } catch (err: any) {
      setActionMessage(`Retry failed: ${err.message || err}`);
    }
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handleBenchmarkPress = () => {
    if (onOpenBenchmark) {
      onOpenBenchmark();
      setIsOpen(false);
    } else {
      setIsBenchmarkModalOpen(true);
    }
  };

  const statusColor = !status.isOnline ? '#EF4444' : status.isSyncing ? '#F59E0B' : '#10B981';
  const statusLabel = !status.isOnline ? 'Offline' : status.isSyncing ? 'Syncing' : 'Online';

  // React Native renderer (Full-height modal with Safe Areas)
  if (RN && RN.View) {
    const { View, Text, TouchableOpacity, ScrollView, Modal, Platform, StatusBar } = RN;
    const SafeComp = RNSafeArea?.SafeAreaView || RN.SafeAreaView || View;
    const isAndroid = Platform?.OS === 'android';
    const statusBarHeight = isAndroid ? (StatusBar?.currentHeight || 24) : 0;

    const isInline = position === 'inline';
    const isTop = position.startsWith('top') || position === 'top';
    const isLeft = position.includes('left');
    const isCenter = position === 'top' || position === 'bottom';

    const pillPosStyle = isInline
      ? { position: 'relative' as const }
      : {
        position: 'absolute' as const,
        zIndex: 99999,
        left: isCenter ? 16 : isLeft ? 16 : undefined,
        right: isCenter ? 16 : !isLeft ? 16 : undefined,
        ...(isTop ? { top: isAndroid ? statusBarHeight + 12 : 48 } : { bottom: 24 }),
      };

    return (
      <>
        {/* Floating or Inline Trigger Pill when closed */}
        {!isOpen && (
          <View style={[pillPosStyle, style]} pointerEvents="box-none">
            {renderTrigger ? (
              renderTrigger({
                isOpen,
                open: () => setIsOpen(true),
                status,
                metrics,
                statusColor,
                statusLabel,
              })
            ) : (
              <TouchableOpacity
                onPress={() => setIsOpen(true)}
                style={[
                  isInline ? rnStyles.inlinePill : rnStyles.pill,
                  {
                    borderColor: statusColor,
                    alignSelf: isInline ? 'auto' : isCenter ? 'center' : isLeft ? 'flex-start' : 'flex-end',
                  },
                ]}
                activeOpacity={0.8}
              >
                <View style={[rnStyles.dot, { backgroundColor: statusColor }]} />
                {variant !== 'icon' && variant !== 'minimal' && (
                  <Text style={isInline ? rnStyles.inlinePillText : rnStyles.pillText}>
                    {variant === 'compact'
                      ? status.pendingCount > 0
                        ? `${status.pendingCount} queued`
                        : statusLabel
                      : 'local-lite'}
                  </Text>
                )}
                {status.pendingCount > 0 && variant !== 'compact' && (
                  <View style={rnStyles.badge}>
                    <Text style={rnStyles.badgeText}>{status.pendingCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Full-screen DevTools Modal with Safe Areas */}
        <Modal
          visible={isOpen}
          animationType="slide"
          presentationStyle="fullScreen"
          statusBarTranslucent={true}
          onRequestClose={() => setIsOpen(false)}
        >
          <SafeComp
            style={rnStyles.fullScreenSafe}
            edges={['top', 'bottom', 'left', 'right']}
          >
            {/* Top Navigation Bar with safe area padding */}
            <View
              style={[
                rnStyles.topBar,
                !RNSafeArea?.SafeAreaView && isAndroid && { paddingTop: statusBarHeight + 10 },
              ]}
            >
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View>
                  <Text style={rnStyles.topBarTitle}>⚡ local-lite DevTools</Text>
                  <Text style={rnStyles.topBarSub}>Engine Inspector & Sync Telemetry</Text>
                </View>
              </View>
              <View
                style={[
                  rnStyles.statusBadge,
                  { borderColor: statusColor, backgroundColor: `${statusColor}20` },
                ]}
              >
                <Text style={[rnStyles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsOpen(false)}
                style={rnStyles.closeCircle}
                activeOpacity={0.7}
              >
                <Text style={rnStyles.closeCircleText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Scrollable Content Body */}
            <ScrollView
              style={rnStyles.scrollBody}
              contentContainerStyle={rnStyles.scrollContent}
              showsVerticalScrollIndicator={true}
            >
              {actionMessage && (
                <View style={rnStyles.actionMsgBox}>
                  <Text style={rnStyles.actionMsgText}>{actionMessage}</Text>
                </View>
              )}

              {/* Stat Overview Cards: Pending and Failed */}
              <View style={rnStyles.statGrid}>
                <View style={rnStyles.statCard}>
                  <Text style={rnStyles.statNum}>{status.pendingCount}</Text>
                  <Text style={rnStyles.statLabel}>Pending Outbox</Text>
                  <Text style={rnStyles.statSub}>Awaiting sync push</Text>
                </View>
                <View style={rnStyles.statCard}>
                  <Text
                    style={[
                      rnStyles.statNum,
                      { color: metrics?.outboxFailedCount ? '#EF4444' : '#10B981' },
                    ]}
                  >
                    {metrics?.outboxFailedCount || 0}
                  </Text>
                  <Text style={rnStyles.statLabel}>Failed Mutations</Text>
                  <Text style={rnStyles.statSub}>
                    {metrics?.outboxFailedCount ? 'Needs retry' : 'All clear'}
                  </Text>
                </View>
              </View>

              {/* Engine & Connection Telemetry */}
              <View style={rnStyles.infoCard}>
                <Text style={rnStyles.infoCardTitle}>CONNECTION & TELEMETRY</Text>
                <View style={rnStyles.infoRow}>
                  <Text style={rnStyles.infoKey}>Connection Status</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={[rnStyles.dotSmall, { backgroundColor: statusColor }]} />
                    <Text style={[rnStyles.infoVal, { color: statusColor, fontWeight: '700' }]}>
                      {status.isOnline ? 'Online (Connected)' : 'Offline'}
                    </Text>
                  </View>
                </View>
                <View style={rnStyles.infoRow}>
                  <Text style={rnStyles.infoKey}>Sync State</Text>
                  <Text style={[rnStyles.infoVal, { color: status.isSyncing ? '#F59E0B' : '#9CA3AF' }]}>
                    {status.isSyncing ? 'Syncing...' : 'Idle'}
                  </Text>
                </View>
                <View style={rnStyles.infoRow}>
                  <Text style={rnStyles.infoKey}>Last Synchronized</Text>
                  <Text style={rnStyles.infoVal}>
                    {status.lastSyncedAt
                      ? new Date(status.lastSyncedAt).toLocaleTimeString()
                      : 'Never'}
                  </Text>
                </View>
                <View style={rnStyles.infoRow}>
                  <Text style={rnStyles.infoKey}>Last Push Duration</Text>
                  <Text style={rnStyles.infoVal}>{metrics?.lastPushDurationMs || 0} ms</Text>
                </View>
                <View style={[rnStyles.infoRow, { borderBottomWidth: 0 }]}>
                  <Text style={rnStyles.infoKey}>Last Pull Duration</Text>
                  <Text style={rnStyles.infoVal}>{metrics?.lastPullDurationMs || 0} ms</Text>
                </View>
              </View>

              {/* Engine Actions Card */}
              <View style={rnStyles.infoCard}>
                <Text style={rnStyles.infoCardTitle}>ENGINE ACTIONS</Text>
                <View style={rnStyles.btnRow}>
                  <TouchableOpacity
                    onPress={handlePush}
                    style={[rnStyles.actionBtn, { backgroundColor: '#3B82F6' }]}
                    activeOpacity={0.8}
                  >
                    <Text style={rnStyles.actionBtnText}>🚀 Push Changes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handlePull}
                    style={[rnStyles.actionBtn, { backgroundColor: '#2563EB' }]}
                    activeOpacity={0.8}
                  >
                    <Text style={rnStyles.actionBtnText}>📥 Pull Changes</Text>
                  </TouchableOpacity>
                </View>
                <View style={rnStyles.btnRow}>
                  <TouchableOpacity
                    onPress={handleRetryFailed}
                    style={[rnStyles.actionBtn, { backgroundColor: '#374151' }]}
                    activeOpacity={0.8}
                  >
                    <Text style={rnStyles.actionBtnText}>🔄 Retry Failed</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleResetCursor}
                    style={[rnStyles.actionBtn, { backgroundColor: '#374151' }]}
                    activeOpacity={0.8}
                  >
                    <Text style={rnStyles.actionBtnText}>⏪ Reset Cursor</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Sync Errors Diagnostics */}
              {(metrics?.lastPushError || metrics?.lastPullError) && (
                <View style={[rnStyles.infoCard, { borderColor: '#EF444480', backgroundColor: '#7F1D1D20' }]}>
                  <Text style={[rnStyles.infoCardTitle, { color: '#F87171' }]}>SYNC ENGINE ERRORS</Text>
                  {metrics?.lastPushError && (
                    <View style={{ marginBottom: 6 }}>
                      <Text style={{ fontSize: 11, color: '#FCA5A5', fontWeight: '700' }}>Last Push Error:</Text>
                      <Text style={{ fontSize: 12, color: '#FECACA' }}>{String(metrics.lastPushError)}</Text>
                    </View>
                  )}
                  {metrics?.lastPullError && (
                    <View>
                      <Text style={{ fontSize: 11, color: '#FCA5A5', fontWeight: '700' }}>Last Pull Error:</Text>
                      <Text style={{ fontSize: 12, color: '#FECACA' }}>{String(metrics.lastPullError)}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Queued Outbox Mutations */}
              {status.pendingRecords && status.pendingRecords.length > 0 && (
                <View style={rnStyles.infoCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <Text style={rnStyles.infoCardTitle}>QUEUED OUTBOX MUTATIONS ({status.pendingRecords.length})</Text>
                    <Text style={{ fontSize: 10, color: '#9CA3AF' }}>Latest queued</Text>
                  </View>
                  {status.pendingRecords.slice(0, 8).map((rec: any, idx: number) => (
                    <View key={rec.id || idx} style={[rnStyles.infoRow, idx === Math.min(status.pendingRecords.length, 8) - 1 && { borderBottomWidth: 0 }]}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[rnStyles.dotSmall, { backgroundColor: rec.status === 'FAILED' ? '#EF4444' : '#F59E0B' }]} />
                          <Text style={{ color: '#F9FAFB', fontSize: 13, fontWeight: '600' }}>{rec.tableName || 'record'}</Text>
                          <View style={{ backgroundColor: '#374151', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                            <Text style={{ color: '#D1D5DB', fontSize: 10, fontWeight: '700' }}>{rec.operation || 'MUTATE'}</Text>
                          </View>
                        </View>
                        {rec.rowId && (
                          <Text style={{ color: '#9CA3AF', fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                            ID: {rec.rowId}
                          </Text>
                        )}
                        {rec.errorMessage && (
                          <Text style={{ color: '#EF4444', fontSize: 11, marginTop: 2 }}>{rec.errorMessage}</Text>
                        )}
                      </View>
                      <Text style={{ color: '#9CA3AF', fontSize: 11 }}>{rec.status || 'PENDING'}</Text>
                    </View>
                  ))}
                  {status.pendingRecords.length > 8 && (
                    <Text style={{ color: '#9CA3AF', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
                      + {status.pendingRecords.length - 8} more mutations in outbox
                    </Text>
                  )}
                </View>
              )}

              {/* Benchmark Suite Card */}
              {enableBenchmark && (
                <View
                  style={[
                    rnStyles.infoCard,
                    { borderColor: '#8B5CF640', backgroundColor: '#1E1B4B25' },
                  ]}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                    }}
                  >
                    <Text style={[rnStyles.infoCardTitle, { color: '#C4B5FD', marginBottom: 0 }]}>
                      PERFORMANCE BENCHMARK
                    </Text>
                    <Text style={{ fontSize: 10, color: '#A78BFA', fontWeight: '700' }}>
                      ACID & WAL
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontSize: 12,
                      color: '#9CA3AF',
                      marginBottom: 12,
                      lineHeight: 18,
                    }}
                  >
                    Runs 11 automated stress tests directly testing local-lite client APIs: atomic
                    batch ingestion, indexing, ACID rollback isolation, outbox queues, and non-blocking WAL concurrency.
                  </Text>
                  <TouchableOpacity
                    onPress={handleBenchmarkPress}
                    style={[rnStyles.actionBtn, { backgroundColor: '#8B5CF6' }]}
                    activeOpacity={0.8}
                  >
                    <Text style={[rnStyles.actionBtnText, { fontWeight: '700' }]}>
                      ⚡ Open SQLite Benchmark Suite
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>

            {/* Bottom Safe Area Action Bar */}
            <View
              style={[
                rnStyles.bottomBar,
                !RNSafeArea?.SafeAreaView && isAndroid && { paddingBottom: 32 },
              ]}
            >
              <TouchableOpacity
                onPress={() => setIsOpen(false)}
                style={rnStyles.doneBtn}
                activeOpacity={0.8}
              >
                <Text style={rnStyles.doneBtnText}>Close DevTools</Text>
              </TouchableOpacity>
            </View>
          </SafeComp>
        </Modal>

        {/* Separated Full-Height Benchmark Modal */}
        {enableBenchmark && !onOpenBenchmark && (
          <BenchmarkModal
            client={client}
            visible={isBenchmarkModalOpen}
            onDismiss={() => setIsBenchmarkModalOpen(false)}
          />
        )}
      </>
    );
  }

  // Web / DOM renderer fallback
  const isInline = position === 'inline';
  const isTop = position.startsWith('top') || position === 'top';
  const isLeft = position.includes('left');
  const isCenter = position === 'top' || position === 'bottom';

  return (
    <>
      {isOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: '#111827',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#F9FAFB',
          }}
        >
          {/* Top Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 24px',
              backgroundColor: '#1F2937',
              borderBottom: '1px solid #374151',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: statusColor,
                }}
              />
              <div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>⚡ local-lite DevTools</div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                  Engine Inspector & Sync Telemetry
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  border: `1px solid ${statusColor}`,
                  color: statusColor,
                  padding: '3px 10px',
                  borderRadius: 12,
                  fontSize: 11,
                  fontWeight: 700,
                  backgroundColor: `${statusColor}20`,
                }}
              >
                {statusLabel}
              </div>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: '#374151',
                  border: 'none',
                  color: '#F9FAFB',
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Scrollable Body */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 24,
              maxWidth: 720,
              width: '100%',
              margin: '0 auto',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {actionMessage && (
              <div
                style={{
                  backgroundColor: '#1E3A8A',
                  border: '1px solid #3B82F6',
                  color: '#93C5FD',
                  padding: 10,
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: 'center',
                }}
              >
                {actionMessage}
              </div>
            )}

            {/* Stat Cards */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 12,
              }}
            >
              <div
                style={{
                  backgroundColor: '#1F2937',
                  border: '1px solid #374151',
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 24, fontWeight: 800 }}>{status.pendingCount}</div>
                <div style={{ fontSize: 12, color: '#D1D5DB', marginTop: 4, fontWeight: 600 }}>
                  Pending Outbox
                </div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>Awaiting sync push</div>
              </div>
              <div
                style={{
                  backgroundColor: '#1F2937',
                  border: '1px solid #374151',
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: metrics?.outboxFailedCount ? '#EF4444' : '#10B981',
                  }}
                >
                  {metrics?.outboxFailedCount || 0}
                </div>
                <div style={{ fontSize: 12, color: '#D1D5DB', marginTop: 4, fontWeight: 600 }}>
                  Failed Mutations
                </div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                  {metrics?.outboxFailedCount ? 'Needs retry' : 'All clear'}
                </div>
              </div>
            </div>

            {/* Connection & Telemetry Card */}
            <div
              style={{
                backgroundColor: '#1F2937',
                border: '1px solid #374151',
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#9CA3AF',
                  letterSpacing: '0.8px',
                  marginBottom: 12,
                }}
              >
                CONNECTION & TELEMETRY
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #374151',
                }}
              >
                <span style={{ color: '#9CA3AF', fontSize: 13 }}>Connection Status</span>
                <span style={{ color: statusColor, fontWeight: 700, fontSize: 13 }}>
                  {status.isOnline ? 'Online (Connected)' : 'Offline'}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #374151',
                }}
              >
                <span style={{ color: '#9CA3AF', fontSize: 13 }}>Sync State</span>
                <span
                  style={{
                    color: status.isSyncing ? '#F59E0B' : '#9CA3AF',
                    fontSize: 13,
                  }}
                >
                  {status.isSyncing ? 'Syncing...' : 'Idle'}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #374151',
                }}
              >
                <span style={{ color: '#9CA3AF', fontSize: 13 }}>Last Synchronized</span>
                <span style={{ color: '#F9FAFB', fontSize: 13, fontWeight: 600 }}>
                  {status.lastSyncedAt
                    ? new Date(status.lastSyncedAt).toLocaleTimeString()
                    : 'Never'}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #374151',
                }}
              >
                <span style={{ color: '#9CA3AF', fontSize: 13 }}>Last Push Duration</span>
                <span style={{ color: '#F9FAFB', fontSize: 13, fontWeight: 600 }}>
                  {metrics?.lastPushDurationMs || 0} ms
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                }}
              >
                <span style={{ color: '#9CA3AF', fontSize: 13 }}>Last Pull Duration</span>
                <span style={{ color: '#F9FAFB', fontSize: 13, fontWeight: 600 }}>
                  {metrics?.lastPullDurationMs || 0} ms
                </span>
              </div>
            </div>

            {/* Actions Card */}
            <div
              style={{
                backgroundColor: '#1F2937',
                border: '1px solid #374151',
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#9CA3AF',
                  letterSpacing: '0.8px',
                  marginBottom: 12,
                }}
              >
                ENGINE ACTIONS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  onClick={handlePush}
                  style={{
                    padding: '10px 14px',
                    backgroundColor: '#3B82F6',
                    color: '#FFF',
                    border: 'none',
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🚀 Push Changes
                </button>
                <button
                  onClick={handlePull}
                  style={{
                    padding: '10px 14px',
                    backgroundColor: '#2563EB',
                    color: '#FFF',
                    border: 'none',
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  📥 Pull Changes
                </button>
                <button
                  onClick={handleRetryFailed}
                  style={{
                    padding: '10px 14px',
                    backgroundColor: '#374151',
                    color: '#E5E7EB',
                    border: 'none',
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🔄 Retry Failed
                </button>
                <button
                  onClick={handleResetCursor}
                  style={{
                    padding: '10px 14px',
                    backgroundColor: '#374151',
                    color: '#E5E7EB',
                    border: 'none',
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ⏪ Reset Cursor
                </button>
              </div>
            </div>

            {/* Benchmark Suite Card */}
            {enableBenchmark && (
              <div
                style={{
                  backgroundColor: '#1E1B4B25',
                  border: '1px solid #8B5CF640',
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#C4B5FD' }}>
                    PERFORMANCE BENCHMARK
                  </div>
                  <div style={{ fontSize: 10, color: '#A78BFA', fontWeight: 700 }}>ACID & WAL</div>
                </div>
                <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 12px 0', lineHeight: '18px' }}>
                  Runs 11 automated stress tests directly testing local-lite client APIs: atomic
                  batch ingestion, indexing, ACID rollback isolation, outbox queues, and non-blocking WAL concurrency.
                </p>
                <button
                  onClick={handleBenchmarkPress}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    backgroundColor: '#8B5CF6',
                    color: '#FFF',
                    border: 'none',
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  ⚡ Open SQLite Benchmark Suite
                </button>
              </div>
            )}
          </div>

          {/* Bottom Bar */}
          <div
            style={{
              padding: '14px 20px',
              backgroundColor: '#1F2937',
              borderTop: '1px solid #374151',
            }}
          >
            <button
              onClick={() => setIsOpen(false)}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#374151',
                color: '#F9FAFB',
                border: 'none',
                borderRadius: 8,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Close DevTools
            </button>
          </div>
        </div>
      ) : (
        /* Floating or Inline Trigger Pill */
        <div
          style={
            isInline
              ? { position: 'relative', display: 'inline-flex', ...style }
              : {
                position: 'fixed',
                zIndex: 99999,
                left: isCenter ? '50%' : isLeft ? 16 : undefined,
                right: !isCenter && !isLeft ? 16 : undefined,
                transform: isCenter ? 'translateX(-50%)' : undefined,
                ...(isTop ? { top: 20 } : { bottom: 20 }),
                pointerEvents: 'auto',
                ...style,
              }
          }
        >
          {renderTrigger ? (
            renderTrigger({
              isOpen,
              open: () => setIsOpen(true),
              status,
              metrics,
              statusColor,
              statusLabel,
            })
          ) : (
            <button
              onClick={() => setIsOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: '#1F2937',
                color: '#F9FAFB',
                border: `1.5px solid ${statusColor}`,
                padding: isInline ? '5px 10px' : '8px 14px',
                borderRadius: 20,
                cursor: 'pointer',
                boxShadow: isInline ? undefined : '0 4px 12px rgba(0,0,0,0.3)',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: statusColor,
                }}
              />
              {variant !== 'icon' && variant !== 'minimal' && (
                <span style={{ fontWeight: 600, fontSize: isInline ? 12 : 13 }}>
                  {variant === 'compact'
                    ? status.pendingCount > 0
                      ? `${status.pendingCount} queued`
                      : statusLabel
                    : 'local-lite'}
                </span>
              )}
              {status.pendingCount > 0 && variant !== 'compact' && (
                <span
                  style={{
                    background: '#EF4444',
                    color: '#fff',
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 10,
                    fontWeight: 700,
                  }}
                >
                  {status.pendingCount}
                </span>
              )}
            </button>
          )}
        </div>
      )}

      {/* Separated Full-Height Benchmark Modal */}
      {enableBenchmark && !onOpenBenchmark && (
        <BenchmarkModal
          client={client}
          visible={isBenchmarkModalOpen}
          onDismiss={() => setIsBenchmarkModalOpen(false)}
        />
      )}
    </>
  );
}

const rnStyles =
  RN && RN.StyleSheet
    ? RN.StyleSheet.create({
      fullScreenSafe: {
        flex: 1,
        height: '100%',
        backgroundColor: '#111827',
      },
      topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 18,
        paddingVertical: 14,
        backgroundColor: '#1F2937',
        borderBottomWidth: 1,
        borderBottomColor: '#374151',
      },
      topBarTitle: {
        color: '#F9FAFB',
        fontSize: 17,
        fontWeight: '700',
      },
      topBarSub: {
        color: '#9CA3AF',
        fontSize: 11,
        marginTop: 2,
      },
      statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 12,
        borderWidth: 1,
        marginRight: 10,
      },
      statusBadgeText: {
        fontSize: 11,
        fontWeight: '700',
      },
      closeCircle: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#374151',
        alignItems: 'center',
        justifyContent: 'center',
      },
      closeCircleText: {
        color: '#F9FAFB',
        fontSize: 14,
        fontWeight: '700',
      },
      scrollBody: {
        flex: 1,
        backgroundColor: '#111827',
      },
      scrollContent: {
        padding: 16,
        paddingBottom: 24,
      },
      actionMsgBox: {
        backgroundColor: '#1E3A8A',
        borderWidth: 1,
        borderColor: '#3B82F6',
        padding: 10,
        borderRadius: 8,
        marginBottom: 14,
      },
      actionMsgText: {
        color: '#93C5FD',
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
      },
      statGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 14,
      },
      statCard: {
        flex: 1,
        minWidth: '45%',
        backgroundColor: '#1F2937',
        borderWidth: 1,
        borderColor: '#374151',
        borderRadius: 12,
        padding: 14,
      },
      statNum: {
        fontSize: 24,
        fontWeight: '800',
        color: '#F9FAFB',
      },
      statLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#D1D5DB',
        marginTop: 4,
      },
      statSub: {
        fontSize: 10,
        color: '#6B7280',
        marginTop: 2,
      },
      infoCard: {
        backgroundColor: '#1F2937',
        borderWidth: 1,
        borderColor: '#374151',
        borderRadius: 12,
        padding: 14,
        marginBottom: 14,
      },
      infoCardTitle: {
        fontSize: 11,
        fontWeight: '700',
        color: '#9CA3AF',
        letterSpacing: 0.8,
        marginBottom: 10,
      },
      infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#374151',
      },
      infoKey: {
        fontSize: 13,
        color: '#9CA3AF',
      },
      infoVal: {
        fontSize: 13,
        color: '#F9FAFB',
        fontWeight: '600',
      },
      dotSmall: {
        width: 8,
        height: 8,
        borderRadius: 4,
      },
      dotLarge: {
        width: 12,
        height: 12,
        borderRadius: 6,
      },
      btnRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 8,
      },
      actionBtn: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
      },
      actionBtnText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '600',
      },
      bottomBar: {
        paddingHorizontal: 18,
        paddingVertical: 12,
        backgroundColor: '#1F2937',
        borderTopWidth: 1,
        borderTopColor: '#374151',
      },
      doneBtn: {
        backgroundColor: '#374151',
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
      },
      doneBtnText: {
        color: '#F9FAFB',
        fontSize: 14,
        fontWeight: '700',
      },
      pill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1F2937',
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 20,
        borderWidth: 1.5,
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      inlinePill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1F2937',
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: 16,
        borderWidth: 1.5,
      },
      pillText: {
        color: '#F9FAFB',
        fontWeight: '600',
        fontSize: 13,
        marginLeft: 8,
      },
      inlinePillText: {
        color: '#F9FAFB',
        fontWeight: '600',
        fontSize: 12,
        marginLeft: 6,
      },
      dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
      },
      badge: {
        backgroundColor: '#EF4444',
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 10,
        marginLeft: 8,
      },
      badgeText: {
        color: '#FFF',
        fontSize: 11,
        fontWeight: '700',
      },
    })
    : {};

export const SyncIndicator = SyncInspector;
export type SyncIndicatorProps = SyncInspectorProps;
