import React, { useState, useEffect } from 'react';
import { LocalFirstClient } from '../core/client.js';
import { useSyncStatus } from './status.js';

let RN: any;
try {
  RN = require('react-native');
} catch {
  // Web / DOM environment
}

export interface SyncInspectorProps {
  client: LocalFirstClient | null | undefined;
  position?:
    | 'bottom-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'top-right'
    | 'top-left'
    | 'top-center'
    | 'top'
    | 'bottom';
  initialOpen?: boolean;
  fullWidth?: boolean;
}

/**
 * Universal Developer Inspector Component for local-lite.
 * Provides real-time visibility into outbox state, connection status,
 * failed mutations, and triggers manual sync pushes and pulls.
 * Works seamlessly in both React Native / Expo and React Web.
 */
export function SyncInspector({
  client,
  position = 'bottom-right',
  initialOpen = false,
  fullWidth = false,
}: SyncInspectorProps) {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const status = useSyncStatus(client);
  const [metrics, setMetrics] = useState<any>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !isOpen) return;
    client.getMetrics().then(setMetrics).catch(() => {});
  }, [client, isOpen, status.isSyncing, status.pendingCount]);

  if (!client) return null;

  const handlePush = async () => {
    setActionMessage('Pushing...');
    try {
      await client.syncWorker.pushLocalChanges();
      setActionMessage('Push complete');
    } catch (err: any) {
      setActionMessage(`Push failed: ${err.message || err}`);
    }
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handlePull = async () => {
    setActionMessage('Pulling...');
    try {
      await client.syncWorker.pullRemoteChanges();
      setActionMessage('Pull complete');
    } catch (err: any) {
      setActionMessage(`Pull failed: ${err.message || err}`);
    }
    setTimeout(() => setActionMessage(null), 3000);
  };

  const handleResetCursor = async () => {
    setActionMessage('Resetting cursor...');
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
    setActionMessage('Retrying failed...');
    try {
      const count = await client.retryFailedMutations();
      setActionMessage(`Re-queued ${count} mutations`);
    } catch (err: any) {
      setActionMessage(`Retry failed: ${err.message || err}`);
    }
    setTimeout(() => setActionMessage(null), 3000);
  };

  const statusColor = !status.isOnline ? '#EF4444' : status.isSyncing ? '#F59E0B' : '#10B981';
  const statusLabel = !status.isOnline ? 'Offline' : status.isSyncing ? 'Syncing' : 'Online';

  const isFullWidth = Boolean(fullWidth || position === 'top' || position === 'bottom');

  // React Native renderer
  if (RN && RN.View) {
    const { View, Text, TouchableOpacity, ScrollView } = RN;

    const isTop = position.startsWith('top') || position === 'top';
    const isLeft = position.includes('left');
    const isCenter = position.includes('center') || position === 'top' || position === 'bottom';

    const containerPosStyle = {
      left: 12,
      right: 12,
      ...(isTop ? { top: 40 } : { bottom: 20 }),
    };

    return (
      <View style={[rnStyles.container, containerPosStyle]} pointerEvents="box-none">
        {isOpen ? (
          <View
            style={[
              rnStyles.panel,
              {
                alignSelf: isCenter ? 'center' : isLeft ? 'flex-start' : 'flex-end',
                maxWidth: isFullWidth ? '100%' : 480,
              },
            ]}
          >
            <View style={rnStyles.panelHeader}>
              <View style={rnStyles.row}>
                <View style={[rnStyles.dot, { backgroundColor: statusColor }]} />
                <Text style={rnStyles.title}>local-lite DevTools</Text>
              </View>
              <TouchableOpacity onPress={() => setIsOpen(false)} style={rnStyles.closeBtn}>
                <Text style={rnStyles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={rnStyles.panelBody}>
              <View style={rnStyles.statGrid}>
                <View style={rnStyles.statBox}>
                  <Text style={rnStyles.statNum}>{status.pendingCount}</Text>
                  <Text style={rnStyles.statLabel}>Pending</Text>
                </View>
                <View style={rnStyles.statBox}>
                  <Text style={[rnStyles.statNum, { color: metrics?.outboxFailedCount ? '#EF4444' : '#10B981' }]}>
                    {metrics?.outboxFailedCount || 0}
                  </Text>
                  <Text style={rnStyles.statLabel}>Failed</Text>
                </View>
                <View style={rnStyles.statBox}>
                  <Text style={rnStyles.statNum}>{metrics?.totalPushedOperations || 0}</Text>
                  <Text style={rnStyles.statLabel}>Pushed</Text>
                </View>
                <View style={rnStyles.statBox}>
                  <Text style={rnStyles.statNum}>{metrics?.totalPulledDeltas || 0}</Text>
                  <Text style={rnStyles.statLabel}>Pulled</Text>
                </View>
              </View>

              <Text style={rnStyles.subInfo}>
                Status: {statusLabel} | Last Sync: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleTimeString() : 'Never'}
              </Text>

              {actionMessage && (
                <Text style={rnStyles.actionMsg}>{actionMessage}</Text>
              )}

              <View style={rnStyles.btnRow}>
                <TouchableOpacity onPress={handlePush} style={rnStyles.btn}>
                  <Text style={rnStyles.btnText}>Push Now</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handlePull} style={rnStyles.btn}>
                  <Text style={rnStyles.btnText}>Pull Now</Text>
                </TouchableOpacity>
              </View>

              <View style={rnStyles.btnRow}>
                <TouchableOpacity onPress={handleRetryFailed} style={rnStyles.btnSecondary}>
                  <Text style={rnStyles.btnSecText}>Retry Failed</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleResetCursor} style={rnStyles.btnSecondary}>
                  <Text style={rnStyles.btnSecText}>Reset Cursor</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setIsOpen(true)}
            style={[
              rnStyles.pill,
              {
                borderColor: statusColor,
                alignSelf: isCenter ? 'center' : isLeft ? 'flex-start' : 'flex-end',
              },
            ]}
            activeOpacity={0.8}
          >
            <View style={[rnStyles.dot, { backgroundColor: statusColor }]} />
            <Text style={rnStyles.pillText}>Local-Lite</Text>
            {status.pendingCount > 0 && (
              <View style={rnStyles.badge}>
                <Text style={rnStyles.badgeText}>{status.pendingCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // Web / DOM renderer fallback
  const isTop = position.startsWith('top') || position === 'top';
  const isLeft = position.includes('left');
  const isCenter = position.includes('center') || position === 'top' || position === 'bottom';
  return (
    <div
      style={{
        position: 'fixed',
        zIndex: 99999,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        left: 16,
        right: 16,
        width: 'calc(100% - 32px)',
        ...(isTop ? { top: 20 } : { bottom: 20 }),
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: isTop ? 'column' : 'column-reverse',
        alignItems: isCenter ? 'center' : isLeft ? 'flex-start' : 'flex-end',
      }}
    >
      {isOpen ? (
        <div
          style={{
            width: isFullWidth ? '100%' : 'min(480px, 100%)',
            background: '#1F2937',
            color: '#F9FAFB',
            borderRadius: 12,
            boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
            marginBottom: 10,
            overflow: 'hidden',
            border: '1px solid #374151',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: '1px solid #374151',
              background: '#111827',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
              <strong>local-lite DevTools</strong>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 16 }}
            >
              ✕
            </button>
          </div>
          <div style={{ padding: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
              <div style={{ background: '#374151', padding: 8, borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 'bold' }}>{status.pendingCount}</div>
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>Pending</div>
              </div>
              <div style={{ background: '#374151', padding: 8, borderRadius: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: metrics?.outboxFailedCount ? '#EF4444' : '#10B981' }}>
                  {metrics?.outboxFailedCount || 0}
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>Failed</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 10 }}>
              Status: {statusLabel} | Last Sync: {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleTimeString() : 'Never'}
            </div>
            {actionMessage && (
              <div style={{ background: '#374151', padding: '4px 8px', borderRadius: 4, marginBottom: 8, fontSize: 11 }}>
                {actionMessage}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <button
                onClick={handlePush}
                style={{ flex: 1, padding: '6px 8px', background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >
                Push Now
              </button>
              <button
                onClick={handlePull}
                style={{ flex: 1, padding: '6px 8px', background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >
                Pull Now
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={handleRetryFailed}
                style={{ flex: 1, padding: '5px 8px', background: '#4B5563', color: '#E5E7EB', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}
              >
                Retry Failed
              </button>
              <button
                onClick={handleResetCursor}
                style={{ flex: 1, padding: '5px 8px', background: '#4B5563', color: '#E5E7EB', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}
              >
                Reset Cursor
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: '#1F2937',
            color: '#F9FAFB',
            border: `1px solid ${statusColor}`,
            padding: '8px 14px',
            borderRadius: 20,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            pointerEvents: 'auto',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
          <span style={{ fontWeight: 600 }}>local-lite</span>
          {status.pendingCount > 0 && (
            <span
              style={{
                background: '#EF4444',
                color: '#fff',
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 10,
                fontWeight: 'bold',
              }}
            >
              {status.pendingCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

const rnStyles = RN && RN.StyleSheet ? RN.StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 99999,
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
  pillText: {
    color: '#F9FAFB',
    fontWeight: '600',
    fontSize: 13,
    marginLeft: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 4,
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
  panel: {
    width: '100%',
    backgroundColor: '#1F2937',
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#374151',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    overflow: 'hidden',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    color: '#F9FAFB',
    fontWeight: '700',
    fontSize: 13,
    marginLeft: 8,
  },
  closeBtn: {
    padding: 4,
  },
  closeText: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  panelBody: {
    padding: 12,
    maxHeight: 280,
  },
  statGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#374151',
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  statNum: {
    color: '#F9FAFB',
    fontSize: 15,
    fontWeight: '700',
  },
  statLabel: {
    color: '#9CA3AF',
    fontSize: 9,
    marginTop: 2,
  },
  subInfo: {
    color: '#9CA3AF',
    fontSize: 11,
    marginBottom: 8,
  },
  actionMsg: {
    backgroundColor: '#374151',
    color: '#60A5FA',
    fontSize: 11,
    padding: 6,
    borderRadius: 6,
    marginBottom: 8,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  btn: {
    flex: 1,
    backgroundColor: '#3B82F6',
    paddingVertical: 7,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  btnSecondary: {
    flex: 1,
    backgroundColor: '#4B5563',
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnSecText: {
    color: '#E5E7EB',
    fontSize: 11,
    fontWeight: '500',
  },
}) : {};
