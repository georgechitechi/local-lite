import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { LocalFirstClient } from '../core/client.js';
import { useSyncStatus } from '../react/status.js';
import { BenchmarkModal } from './BenchmarkModal.js';
import { resolveSyncTheme, type SyncThemeColors } from '../react/theme.js';

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
  title?: string;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'top' | 'bottom' | 'inline';
  variant?: 'pill' | 'compact' | 'icon' | 'minimal';
  initialOpen?: boolean;
  fullWidth?: boolean;
  enableBenchmark?: boolean;
  onOpenBenchmark?: () => void;
  style?: any;
  theme?: 'auto' | 'dark' | 'light' | Partial<SyncThemeColors>;
  alwaysVisible?: boolean;
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
 * Respects device safe areas and active theme (dark/light/custom).
 * Displays real-time outbox telemetry, connection status, metrics, and triggers manual push, pull, reset, and benchmarks.
 */
export function SyncInspector({
  client,
  position = 'bottom-right',
  variant = 'pill',
  initialOpen = false,
  enableBenchmark = true,
  onOpenBenchmark,
  style,
  theme = 'auto',
  alwaysVisible = true,
  renderTrigger,
  title = '⚡ Local Lite DevTools',
}: SyncInspectorProps) {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isBenchmarkModalOpen, setIsBenchmarkModalOpen] = useState(false);
  const status = useSyncStatus(client);
  const [metrics, setMetrics] = useState<any>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const systemColorScheme = RN?.useColorScheme ? RN.useColorScheme() : null;
  const currentTheme = useMemo(
    () => resolveSyncTheme(theme, systemColorScheme),
    [theme, systemColorScheme]
  );

  useEffect(() => {
    if (!client || !isOpen) return;
    client.getMetrics().then(setMetrics).catch(() => { });
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

  const handleClearOutbox = () => {
    const clearOutbox = () =>
      runAction('Clearing stuck outbox...', (count) => `Cleared ${count || 0} stuck outbox mutations`, async () => {
        client!.syncWorker.pause();
        try {
          const count = await client!.maintenance.pruneOutbox({ statuses: ['PENDING', 'PROCESSING', 'FAILED'] });
          if (count > 0) {
            client!.events.emit('sync_outbox', { operation: 'DELETE', rowId: 'clear-stuck' });
          }
          await status.refresh();
          return count;
        } finally {
          client!.syncWorker.resume();
        }
      });
    const message =
      'This permanently removes queued pending, processing, and failed mutations. Local database records are not deleted.';

    if (RN?.Alert?.alert) {
      RN.Alert.alert('Clear stuck outbox?', message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear outbox', style: 'destructive', onPress: () => { void clearOutbox(); } },
      ]);
      return;
    }
    if (typeof globalThis.confirm === 'function' && globalThis.confirm(message)) {
      void clearOutbox();
    }
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
        numColor: currentTheme.text,
      },
      {
        id: 'failed',
        num: metrics?.outboxFailedCount || 0,
        label: 'Failed Mutations',
        sub: metrics?.outboxFailedCount ? 'Needs retry' : 'All clear',
        numColor: metrics?.outboxFailedCount ? '#EF4444' : '#10B981',
      },
    ],
    [status.pendingCount, metrics?.outboxFailedCount, currentTheme.text]
  );


  // Shared Action Buttons
  const actionButtons = useMemo(
    () => [
      { id: 'push', label: '🚀 Push Changes', onPress: handlePush, bg: '#3B82F6', color: '#FFFFFF' },
      { id: 'pull', label: '📥 Pull Changes', onPress: handlePull, bg: '#2563EB', color: '#FFFFFF' },
      { id: 'retry', label: '🔄 Retry Failed', onPress: handleRetryFailed, bg: currentTheme.actionBg, color: currentTheme.actionText },
      { id: 'reset', label: '⏪ Reset Cursor', onPress: handleResetCursor, bg: currentTheme.actionBg, color: currentTheme.actionText },
      { id: 'clear-outbox', label: 'Clear Stuck Outbox', onPress: handleClearOutbox, disabled: status.pendingCount === 0, bg: '#EF4444', color: '#FFFFFF' },
    ],
    [handlePush, handlePull, handleRetryFailed, handleResetCursor, handleClearOutbox, currentTheme.actionBg, currentTheme.actionText, status.pendingCount]
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
            ) : !alwaysVisible && status.pendingCount === 0 && status.isOnline && !status.isSyncing ? null : (
              <TouchableOpacity
                onPress={() => setIsOpen(true)}
                style={[
                  isInline ? rnStyles.inlinePill : rnStyles.pill,
                  {
                    borderColor: statusColor,
                    backgroundColor: currentTheme.surface,
                    alignSelf: isInline ? 'auto' : isCenter ? 'center' : isLeft ? 'flex-start' : 'flex-end',
                  },
                ]}
                activeOpacity={0.8}
              >
                <View style={[rnStyles.dot, { backgroundColor: statusColor }]} />
                {variant !== 'icon' && variant !== 'minimal' && (
                  <Text style={[isInline ? rnStyles.inlinePillText : rnStyles.pillText, { color: currentTheme.text }]}>
                    {triggerLabel}
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

        <Modal
          visible={isOpen}
          animationType="slide"
          presentationStyle="fullScreen"
          statusBarTranslucent={true}
          onRequestClose={() => setIsOpen(false)}
        >
          <SafeComp
            style={[rnStyles.fullScreenSafe, { backgroundColor: currentTheme.bg }]}
            edges={['top', 'bottom', 'left', 'right']}
          >
            {/* Top Bar */}
            <View
              style={[
                rnStyles.topBar,
                {
                  backgroundColor: currentTheme.surface,
                  borderBottomColor: currentTheme.border,
                },
                !RNSafeArea?.SafeAreaView && isAndroid && { paddingTop: statusBarHeight + 10 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[rnStyles.topBarTitle, { color: currentTheme.text }]}>{title}</Text>
                <Text style={[rnStyles.topBarSub, { color: currentTheme.textMuted }]}>
                  Engine Inspector & Sync Telemetry
                </Text>
              </View>
              <View style={[rnStyles.statusBadge, { borderColor: statusColor, backgroundColor: `${statusColor}20` }]}>
                <Text style={[rnStyles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsOpen(false)}
                style={[rnStyles.closeCircle, { backgroundColor: currentTheme.actionBg }]}
                activeOpacity={0.7}
              >
                <Text style={[rnStyles.closeCircleText, { color: currentTheme.actionText }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Scrollable Body */}
            <ScrollView
              style={[rnStyles.scrollBody, { backgroundColor: currentTheme.bg }]}
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
                  <View
                    key={card.id}
                    style={[
                      rnStyles.statCard,
                      {
                        backgroundColor: currentTheme.card,
                        borderColor: currentTheme.border,
                      },
                    ]}
                  >
                    <Text style={[rnStyles.statNum, { color: card.numColor }]}>{String(card.num ?? 0)}</Text>
                    <Text style={[rnStyles.statLabel, { color: currentTheme.textSecondary }]}>{card.label}</Text>
                    <Text style={[rnStyles.statSub, { color: currentTheme.textMuted }]}>{card.sub}</Text>
                  </View>
                ))}
              </View>


              {/* Engine Actions */}
              <View
                style={[
                  rnStyles.infoCard,
                  {
                    backgroundColor: currentTheme.card,
                    borderColor: currentTheme.border,
                  },
                ]}
              >
                <Text style={[rnStyles.infoCardTitle, { color: currentTheme.textMuted }]}>ENGINE ACTIONS</Text>
                <View style={rnStyles.btnRow}>
                  {actionButtons.slice(0, 2).map((btn) => (
                    <TouchableOpacity
                      key={btn.id}
                      onPress={btn.onPress}
                      style={[rnStyles.actionBtn, { backgroundColor: btn.bg }]}
                      activeOpacity={0.8}
                    >
                      <Text style={[rnStyles.actionBtnText, { color: btn.color }]}>{btn.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={[rnStyles.btnRow, { marginTop: 8 }]}>
                  {actionButtons.slice(2, 4).map((btn) => (
                    <TouchableOpacity
                      key={btn.id}
                      onPress={btn.onPress}
                      style={[rnStyles.actionBtn, { backgroundColor: btn.bg }, btn.disabled && { opacity: 0.5 }]}
                      disabled={btn.disabled}
                      activeOpacity={0.8}
                    >
                      <Text style={[rnStyles.actionBtnText, { color: btn.color }]}>{btn.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={[rnStyles.btnRow, { marginTop: 8 }]}>
                  {actionButtons.slice(4, 5).map((btn) => (
                    <TouchableOpacity
                      key={btn.id}
                      onPress={btn.onPress}
                      style={[rnStyles.actionBtn, { backgroundColor: btn.bg }, btn.disabled && { opacity: 0.5 }]}
                      disabled={btn.disabled}
                      activeOpacity={0.8}
                    >
                      <Text style={[rnStyles.actionBtnText, { color: btn.color }]}>{btn.label}</Text>
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
                <View
                  style={[
                    rnStyles.infoCard,
                    {
                      backgroundColor: currentTheme.card,
                      borderColor: currentTheme.border,
                    },
                  ]}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 10,
                    }}
                  >
                    <Text style={[rnStyles.infoCardTitle, { color: currentTheme.textMuted }]}>
                      QUEUED OUTBOX MUTATIONS ({status.pendingRecords.length})
                    </Text>
                    <Text style={{ fontSize: 10, color: currentTheme.textMuted }}>Latest queued</Text>
                  </View>
                  {status.pendingRecords.slice(0, 8).map((rec: any, idx: number) => (
                    <View
                      key={rec.id || idx}
                      style={[
                        rnStyles.infoRow,
                        { borderBottomColor: currentTheme.border },
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
                          <Text style={{ color: currentTheme.text, fontSize: 13, fontWeight: '600' }}>
                            {rec.tableName || 'record'}
                          </Text>
                          <View
                            style={{
                              backgroundColor: currentTheme.actionBg,
                              paddingHorizontal: 5,
                              paddingVertical: 1,
                              borderRadius: 4,
                            }}
                          >
                            <Text style={{ color: currentTheme.actionText, fontSize: 10, fontWeight: '700' }}>
                              {rec.operation || 'MUTATE'}
                            </Text>
                          </View>
                        </View>
                        {rec.rowId && (
                          <Text style={{ color: currentTheme.textMuted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                            ID: {rec.rowId}
                          </Text>
                        )}
                        {rec.errorMessage && (
                          <Text style={{ color: '#EF4444', fontSize: 11, marginTop: 2 }}>{rec.errorMessage}</Text>
                        )}
                      </View>
                      <Text style={{ color: currentTheme.textMuted, fontSize: 11 }}>{rec.status || 'PENDING'}</Text>
                    </View>
                  ))}
                  {status.pendingRecords.length > 8 && (
                    <Text style={{ color: currentTheme.textMuted, fontSize: 11, textAlign: 'center', marginTop: 8 }}>
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
                    {
                      borderColor: '#8B5CF640',
                      backgroundColor: currentTheme.isDark ? '#1E1B4B25' : '#F5F3FF',
                    },
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
                    <Text
                      style={[
                        rnStyles.infoCardTitle,
                        { color: currentTheme.isDark ? '#C4B5FD' : '#6D28D9', marginBottom: 0 },
                      ]}
                    >
                      PERFORMANCE BENCHMARK
                    </Text>
                    <Text
                      style={{
                        fontSize: 10,
                        color: currentTheme.isDark ? '#A78BFA' : '#7C3AED',
                        fontWeight: '700',
                      }}
                    >
                      ACID & WAL
                    </Text>
                  </View>
                  <Text style={{ fontSize: 12, color: currentTheme.textMuted, marginBottom: 12, lineHeight: 18 }}>
                    {BENCHMARK_DESCRIPTION}
                  </Text>
                  <TouchableOpacity
                    onPress={handleBenchmarkPress}
                    style={[rnStyles.actionBtn, { backgroundColor: '#8B5CF6' }]}
                    activeOpacity={0.8}
                  >
                    <Text style={[rnStyles.actionBtnText, { color: '#FFFFFF', fontWeight: '700' }]}>
                      ⚡ Open SQLite Benchmark Suite
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>

          </SafeComp>
        </Modal>

        {enableBenchmark && !onOpenBenchmark && (
          <BenchmarkModal
            client={client}
            visible={isBenchmarkModalOpen}
            onDismiss={() => setIsBenchmarkModalOpen(false)}
            theme={theme}
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
            backgroundColor: currentTheme.bg,
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: currentTheme.text,
          }}
        >
          {/* Top Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 24px',
              backgroundColor: currentTheme.surface,
              borderBottom: `1px solid ${currentTheme.border}`,
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
                <div style={{ fontSize: 17, fontWeight: 700, color: currentTheme.text }}>{title}</div>
                <div style={{ fontSize: 11, color: currentTheme.textMuted, marginTop: 2 }}>
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
                  backgroundColor: currentTheme.actionBg,
                  border: 'none',
                  color: currentTheme.actionText,
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
                    backgroundColor: currentTheme.card,
                    border: `1px solid ${currentTheme.border}`,
                    borderRadius: 12,
                    padding: 8,
                  }}
                >
                  <div style={{ fontSize: 24, fontWeight: 800, color: card.numColor }}>{card.num}</div>
                  <div style={{ fontSize: 12, color: currentTheme.textSecondary, marginTop: 4, fontWeight: 600 }}>
                    {card.label}
                  </div>
                  <div style={{ fontSize: 11, color: currentTheme.textMuted, marginTop: 2 }}>{card.sub}</div>
                </div>
              ))}
            </div>


            {/* Actions Card */}
            <div
              style={{
                backgroundColor: currentTheme.card,
                border: `1px solid ${currentTheme.border}`,
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: currentTheme.textMuted,
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
                    disabled={btn.disabled}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: btn.bg,
                      color: btn.color,
                      border: 'none',
                      borderRadius: 8,
                      fontWeight: 600,
                      cursor: btn.disabled ? 'not-allowed' : 'pointer',
                      opacity: btn.disabled ? 0.5 : 1,
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
                  backgroundColor: currentTheme.isDark ? '#1E1B4B25' : '#F5F3FF',
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
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: currentTheme.isDark ? '#C4B5FD' : '#6D28D9',
                    }}
                  >
                    PERFORMANCE BENCHMARK
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: currentTheme.isDark ? '#A78BFA' : '#7C3AED',
                      fontWeight: 700,
                    }}
                  >
                    ACID & WAL
                  </div>
                </div>
                <p style={{ fontSize: 12, color: currentTheme.textMuted, margin: '0 0 12px 0', lineHeight: '18px' }}>
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
          ) : !alwaysVisible && status.pendingCount === 0 && status.isOnline && !status.isSyncing ? null : (
            <button
              onClick={() => setIsOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: currentTheme.surface,
                color: currentTheme.text,
                border: `1.5px solid ${statusColor}`,
                padding: isInline ? '5px 10px' : '8px 14px',
                borderRadius: 20,
                cursor: 'pointer',
                boxShadow: isInline ? undefined : '0 4px 12px rgba(0,0,0,0.15)',
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
          theme={theme}
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
      },
      topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderBottomWidth: 1,
      },
      topBarTitle: {
        fontSize: 17,
        fontWeight: '700',
      },
      topBarSub: {
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
        alignItems: 'center',
        justifyContent: 'center',
      },
      closeCircleText: {
        fontSize: 14,
        fontWeight: '700',
      },
      scrollBody: {
        flex: 1,
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
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 8,
        paddingHorizontal: 12,
      },
      statNum: {
        fontSize: 24,
        fontWeight: '800',
      },
      statLabel: {
        fontSize: 12,
        fontWeight: '600',
        marginTop: 4,
      },
      statSub: {
        fontSize: 11,
        marginTop: 2,
      },
      infoCard: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 16,
        marginBottom: 14,
      },
      infoCardTitle: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.8,
        marginBottom: 10,
      },
      infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 9,
        borderBottomWidth: 1,
      },
      infoKey: {
        fontSize: 13,
      },
      infoVal: {
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
        borderTopWidth: 1,
      },
      doneBtn: {
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
      },
      doneBtnText: {
        fontSize: 14,
        fontWeight: '700',
      },
      pill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 20,
        borderWidth: 1.5,
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
      },
      inlinePill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: 16,
        borderWidth: 1.5,
      },
      pillText: {
        fontWeight: '600',
        fontSize: 13,
        marginLeft: 8,
      },
      inlinePillText: {
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
