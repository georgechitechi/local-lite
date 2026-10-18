import React, { useState, useEffect, useMemo, useCallback } from 'react';
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

const BENCHMARK_DESCRIPTION =
  'Runs automated stress tests directly validating local-lite client APIs: atomic batch ingestion, indexing, ACID rollback isolation, outbox queues, and non-blocking WAL concurrency.';

/**
 * Universal Developer Inspector Component for local-lite.
 * Respects device safe areas and displays real-time outbox telemetry,
 * connection status, metrics, and triggers manual push, pull, reset, and benchmarks.
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
    client.getMetrics().then(setMetrics).catch(() => {});
  }, [client, isOpen, status.isSyncing, status.pendingCount]);

  const runAction = useCallback(
    async (startMsg: string, doneMsg: (res?: any) => string, action: () => Promise<any>) => {
      if (!client) return;
      setActionMessage(startMsg);
      try {
        const res = await action();
        setActionMessage(doneMsg(res));
      } catch (err: any) {
        setActionMessage(`Failed: ${err.message || err}`);
      }
      setTimeout(() => setActionMessage(null), 3000);
    },
    [client]
  );

  const handlePush = () =>
    runAction('Pushing mutations...', () => 'Push complete', () => client!.syncWorker.pushLocalChanges());

  const handlePull = () =>
    runAction('Pulling remote changes...', () => 'Pull complete', () => client!.syncWorker.pullRemoteChanges());

  const handleResetCursor = () =>
    runAction('Resetting cursor & refetching...', () => 'Cursor reset & refetched', async () => {
      await client!.resetSyncCursor();
      await client!.syncWorker.pullRemoteChanges();
    });

  const handleRetryFailed = () =>
    runAction('Re-queueing failed mutations...', (count) => `Re-queued ${count || 0} mutations`, () =>
      client!.retryFailedMutations()
    );

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

  const isInline = position === 'inline';
  const isTop = position.startsWith('top') || position === 'top';
  const isLeft = position.includes('left');
  const isCenter = position === 'top' || position === 'bottom';

  // Shared Stat Cards Data (Pending & Failed)
  const statCards = useMemo(
    () => [
      {
        id: 'pending',
        num: status.pendingCount,
        label: 'Pending Outbox',
        sub: 'Awaiting sync push',
        numColor: '#F9FAFB',
      },
      {
        id: 'failed',
        num: metrics?.outboxFailedCount || 0,
        label: 'Failed Mutations',
        sub: metrics?.outboxFailedCount ? 'Needs retry' : 'All clear',
        numColor: metrics?.outboxFailedCount ? '#EF4444' : '#10B981',
      },
    ],
    [status.pendingCount, metrics?.outboxFailedCount]
  );

  // Shared Connection & Telemetry Rows
  const telemetryItems = useMemo(
    () => [
      {
        id: 'status',
        label: 'Connection Status',
        value: status.isOnline ? 'Connected' : 'Offline',
        color: statusColor,
        hasDot: true,
      },
      {
        id: 'last-synced',
        label: 'Last Synchronized',
        value: status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleTimeString() : 'Never',
      },
      {
        id: 'push-duration',
        label: 'Last Push Duration',
        value: `${metrics?.lastPushDurationMs || 0} ms`,
      },
      {
        id: 'pull-duration',
        label: 'Last Pull Duration',
        value: `${metrics?.lastPullDurationMs || 0} ms`,
      },
    ],
    [status.isOnline, status.isSyncing, status.lastSyncedAt, statusColor, metrics?.lastPushDurationMs, metrics?.lastPullDurationMs]
  );

  // Shared Action Buttons
  const actionButtons = useMemo(
    () => [
      { id: 'push', label: '🚀 Push Changes', onPress: handlePush, bg: '#3B82F6' },
      { id: 'pull', label: '📥 Pull Changes', onPress: handlePull, bg: '#2563EB' },
      { id: 'retry', label: '🔄 Retry Failed', onPress: handleRetryFailed, bg: '#374151' },
      { id: 'reset', label: '⏪ Reset Cursor', onPress: handleResetCursor, bg: '#374151' },
    ],
    [handlePush, handlePull, handleRetryFailed, handleResetCursor]
  );

  const triggerLabel =
    variant === 'compact'
      ? status.pendingCount > 0
        ? `${status.pendingCount} queued`
        : statusLabel
      : 'local-lite';

  if (!client) return null;

  // React Native Renderer
  if (RN && RN.View) {
    const { View, Text, TouchableOpacity, ScrollView, Modal, Platform, StatusBar } = RN;
    const SafeComp = RNSafeArea?.SafeAreaView || RN.SafeAreaView || View;
    const isAndroid = Platform?.OS === 'android';
    const statusBarHeight = isAndroid ? StatusBar?.currentHeight || 24 : 0;

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
                  <Text style={isInline ? rnStyles.inlinePillText : rnStyles.pillText}>{triggerLabel}</Text>
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

        <Modal
          visible={isOpen}
          animationType="slide"
          presentationStyle="fullScreen"
          statusBarTranslucent={true}
          onRequestClose={() => setIsOpen(false)}
        >
          <SafeComp style={rnStyles.fullScreenSafe} edges={['top', 'bottom', 'left', 'right']}>
            {/* Top Bar */}
            <View
              style={[
                rnStyles.topBar,
                !RNSafeArea?.SafeAreaView && isAndroid && { paddingTop: statusBarHeight + 10 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={rnStyles.topBarTitle}>⚡ Local Lite DevTools</Text>
                <Text style={rnStyles.topBarSub}>Engine Inspector & Sync Telemetry</Text>
              </View>
              <View style={[rnStyles.statusBadge, { borderColor: statusColor, backgroundColor: `${statusColor}20` }]}>
                <Text style={[rnStyles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
              <TouchableOpacity onPress={() => setIsOpen(false)} style={rnStyles.closeCircle} activeOpacity={0.7}>
                <Text style={rnStyles.closeCircleText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Scrollable Body */}
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

              {/* Stat Cards (Pending & Failed) */}
              <View style={rnStyles.statGrid}>
                {statCards.map((card) => (
                  <View key={card.id} style={rnStyles.statCard}>
                    <Text style={[rnStyles.statNum, { color: card.numColor }]}>{String(card.num ?? 0)}</Text>
                    <Text style={rnStyles.statLabel}>{card.label}</Text>
                    <Text style={rnStyles.statSub}>{card.sub}</Text>
                  </View>
                ))}
              </View>

              {/* Connection & Telemetry */}
              <View style={rnStyles.infoCard}>
                <Text style={rnStyles.infoCardTitle}>CONNECTION & TELEMETRY</Text>
                {telemetryItems.map((item, idx) => (
                  <View
                    key={item.id}
                    style={[rnStyles.infoRow, idx === telemetryItems.length - 1 && { borderBottomWidth: 0 }]}
                  >
                    <Text style={rnStyles.infoKey}>{item.label}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {item.hasDot && <View style={[rnStyles.dotSmall, { backgroundColor: item.color }]} />}
                      <Text
                        style={[
                          rnStyles.infoVal,
                          item.color ? { color: item.color, fontWeight: '700' } : undefined,
                        ]}
                      >
                        {item.value}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* Engine Actions */}
              <View style={rnStyles.infoCard}>
                <Text style={rnStyles.infoCardTitle}>ENGINE ACTIONS</Text>
                <View style={rnStyles.btnRow}>
                  {actionButtons.slice(0, 2).map((btn) => (
                    <TouchableOpacity
                      key={btn.id}
                      onPress={btn.onPress}
                      style={[rnStyles.actionBtn, { backgroundColor: btn.bg }]}
                      activeOpacity={0.8}
                    >
                      <Text style={rnStyles.actionBtnText}>{btn.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={[rnStyles.btnRow, { marginTop: 8 }]}>
                  {actionButtons.slice(2, 4).map((btn) => (
                    <TouchableOpacity
                      key={btn.id}
                      onPress={btn.onPress}
                      style={[rnStyles.actionBtn, { backgroundColor: btn.bg }]}
                      activeOpacity={0.8}
                    >
                      <Text style={rnStyles.actionBtnText}>{btn.label}</Text>
                    </TouchableOpacity>
                  ))}
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
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 10,
                    }}
                  >
                    <Text style={rnStyles.infoCardTitle}>
                      QUEUED OUTBOX MUTATIONS ({status.pendingRecords.length})
                    </Text>
                    <Text style={{ fontSize: 10, color: '#9CA3AF' }}>Latest queued</Text>
                  </View>
                  {status.pendingRecords.slice(0, 8).map((rec: any, idx: number) => (
                    <View
                      key={rec.id || idx}
                      style={[
                        rnStyles.infoRow,
                        idx === Math.min(status.pendingRecords.length, 8) - 1 && { borderBottomWidth: 0 },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View
                            style={[
                              rnStyles.dotSmall,
                              { backgroundColor: rec.status === 'FAILED' ? '#EF4444' : '#F59E0B' },
                            ]}
                          />
                          <Text style={{ color: '#F9FAFB', fontSize: 13, fontWeight: '600' }}>
                            {rec.tableName || 'record'}
                          </Text>
                          <View
                            style={{
                              backgroundColor: '#374151',
                              paddingHorizontal: 5,
                              paddingVertical: 1,
                              borderRadius: 4,
                            }}
                          >
                            <Text style={{ color: '#D1D5DB', fontSize: 10, fontWeight: '700' }}>
                              {rec.operation || 'MUTATE'}
                            </Text>
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
                    <Text style={{ fontSize: 10, color: '#A78BFA', fontWeight: '700' }}>ACID & WAL</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 12, lineHeight: 18 }}>
                    {BENCHMARK_DESCRIPTION}
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

            {/* Bottom Bar */}
            <View
              style={[
                rnStyles.bottomBar,
                !RNSafeArea?.SafeAreaView && isAndroid && { paddingBottom: 32 },
              ]}
            >
              <TouchableOpacity onPress={() => setIsOpen(false)} style={rnStyles.doneBtn} activeOpacity={0.8}>
                <Text style={rnStyles.doneBtnText}>Close DevTools</Text>
              </TouchableOpacity>
            </View>
          </SafeComp>
        </Modal>

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

  // Web / DOM Renderer Fallback
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
              {statCards.map((card) => (
                <div
                  key={card.id}
                  style={{
                    backgroundColor: '#1F2937',
                    border: '1px solid #374151',
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div style={{ fontSize: 24, fontWeight: 800, color: card.numColor }}>{card.num}</div>
                  <div style={{ fontSize: 12, color: '#D1D5DB', marginTop: 4, fontWeight: 600 }}>
                    {card.label}
                  </div>
                  <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{card.sub}</div>
                </div>
              ))}
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
              {telemetryItems.map((item, idx) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: idx === telemetryItems.length - 1 ? 'none' : '1px solid #374151',
                  }}
                >
                  <span style={{ color: '#9CA3AF', fontSize: 13 }}>{item.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {item.hasDot && (
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: item.color,
                        }}
                      />
                    )}
                    <span
                      style={{
                        color: item.color || '#F9FAFB',
                        fontSize: 13,
                        fontWeight: item.color ? 700 : 600,
                      }}
                    >
                      {item.value}
                    </span>
                  </div>
                </div>
              ))}
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
                {actionButtons.map((btn) => (
                  <button
                    key={btn.id}
                    onClick={btn.onPress}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: btn.bg,
                      color: '#FFF',
                      border: 'none',
                      borderRadius: 8,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {btn.label}
                  </button>
                ))}
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
                  {BENCHMARK_DESCRIPTION}
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
                <span style={{ fontWeight: 600, fontSize: isInline ? 12 : 13 }}>{triggerLabel}</span>
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
          width: '100%',
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
        },
        statLabel: {
          fontSize: 12,
          fontWeight: '600',
          color: '#D1D5DB',
          marginTop: 4,
        },
        statSub: {
          fontSize: 11,
          color: '#6B7280',
          marginTop: 2,
        },
        infoCard: {
          backgroundColor: '#1F2937',
          borderWidth: 1,
          borderColor: '#374151',
          borderRadius: 12,
          padding: 16,
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
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 9,
          borderBottomWidth: 1,
          borderBottomColor: '#374151',
        },
        infoKey: {
          color: '#9CA3AF',
          fontSize: 13,
        },
        infoVal: {
          color: '#F9FAFB',
          fontSize: 13,
          fontWeight: '600',
        },
        btnRow: {
          flexDirection: 'row',
          width: '100%',
          gap: 8,
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
        dotSmall: {
          width: 8,
          height: 8,
          borderRadius: 4,
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
