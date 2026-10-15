import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import SPressable from '@/shared/components/SlightPressable';
import { type AuditLogTarget, useAuditLog } from '@/shared/hooks/useAuditLog';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { AuditLog } from '@/shared/types/types';
import { formatDateTime } from '@/shared/utils/formatters';
import { addOpacity, snakeCaseToTitleCase } from '@/shared/utils/helper';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HistoryModalProps {
  entityType?: string;
  entityId?: string;
  targets?: AuditLogTarget[];
  title?: string;
  containerStyle?: any;
  visible?: boolean;
  onDismiss?: () => void;
  hideTrigger?: boolean;
}

// ─── Action Config ─────────────────────────────────────────────────────────────

interface ActionConfig {
  icon: string;
  color: string;
  label: string;
}

function getActionConfig(
  action: AuditLog['action'],
  colors: any,
  entityType?: string,
): ActionConfig {
  const entityName = entityType
    ? entityType.endsWith('s')
      ? entityType.slice(0, -1)
      : entityType
    : '';
  const prefix = entityName ? `${snakeCaseToTitleCase(entityName)} ` : '';

  switch (action) {
    case 'insert':
      return { icon: 'plus-circle', color: colors.success, label: `${prefix}Created` };
    case 'delete':
      return { icon: 'trash-can', color: colors.error, label: `${prefix}Deleted` };
    default:
      return { icon: 'pencil', color: colors.primary, label: `${prefix}Updated` };
  }
}

// ─── Value Formatter ───────────────────────────────────────────────────────────

function formatValue(key: string, raw: any): string {
  if (raw === null || raw === undefined) return 'N/A';

  const str = typeof raw === 'string' ? raw : JSON.stringify(raw);

  // Date-like fields
  if (
    key.endsWith('_at') ||
    key.endsWith('_date') ||
    key === 'start_date' ||
    key === 'end_date'
  ) {
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
  }

  // Numeric currency fields
  if (
    (key.includes('amount') || key.includes('rent') || key.includes('price')) &&
    typeof raw === 'number'
  ) {
    return `KSh ${raw.toLocaleString()}`;
  }

  // Boolean
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';

  // Snake-case string → Title Case
  if (typeof raw === 'string' && raw.includes('_')) return snakeCaseToTitleCase(raw);

  return str;
}

// ─── Date Grouping ─────────────────────────────────────────────────────────────

function getDateGroup(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  if (date >= startOfToday) return 'Today';
  if (date >= startOfYesterday) return 'Yesterday';

  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Skeleton Row ──────────────────────────────────────────────────────────────

function SkeletonRow({ colors }: { colors: any }) {
  return (
    <View style={styles.timelineItem}>
      <View style={styles.timelineSidebar}>
        <View style={[styles.timelineLine, { backgroundColor: colors.outlineVariant }]} />
        <View
          style={[
            styles.timelineDot,
            { backgroundColor: colors.surfaceVariant, borderColor: colors.surface },
          ]}
        />
      </View>
      <View style={[styles.skeletonContent]}>
        <View
          style={[
            styles.skeletonLine,
            { backgroundColor: colors.surfaceVariant, width: '60%' },
          ]}
        />
        <View
          style={[
            styles.skeletonLine,
            { backgroundColor: colors.surfaceVariant, width: '40%', marginTop: 4 },
          ]}
        />
      </View>
    </View>
  );
}

// ─── Change Diff Row ──────────────────────────────────────────────────────────

interface ChangeDiffProps {
  changes: AuditLog['changes'];
  colors: any;
}

function ChangeDiff({ changes, colors }: ChangeDiffProps) {
  const [expanded, setExpanded] = useState(false);

  if (!changes) return null;

  const entries = Object.entries(changes);
  const COLLAPSE_THRESHOLD = 3;
  const displayed = expanded ? entries : entries.slice(0, COLLAPSE_THRESHOLD);
  const hidden = entries.length - COLLAPSE_THRESHOLD;

  return (
    <Surface
      style={[
        styles.changesCard,
        { backgroundColor: addOpacity(colors.surfaceVariant, 0.3) },
      ]}
      elevation={0}
    >
      {displayed.map(([key, change]) => (
        <View key={key} style={styles.changeRow}>
          <Text
            variant="labelSmall"
            style={[styles.changeKey, { color: colors.onSurfaceVariant }]}
          >
            {snakeCaseToTitleCase(key)}
          </Text>
          <View style={styles.changeValues}>
            <Text
              variant="bodySmall"
              style={[styles.oldValue, { color: colors.onSurfaceDisabled }]}
            >
              {formatValue(key, change.old)}
            </Text>
            <MaterialCommunityIcons
              name="arrow-right"
              size={11}
              color={colors.onSurfaceVariant}
            />
            <Text
              variant="bodySmall"
              style={[styles.newValue, { color: colors.primary }]}
            >
              {formatValue(key, change.new)}
            </Text>
          </View>
        </View>
      ))}

      {entries.length > COLLAPSE_THRESHOLD && (
        <SPressable onPress={() => setExpanded(v => !v)} style={styles.expandToggle}>
          <Text variant="labelSmall" style={{ color: colors.primary }}>
            {expanded ? 'Show less' : `+${hidden} more change${hidden !== 1 ? 's' : ''}…`}
          </Text>
        </SPressable>
      )}
    </Surface>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function HistoryModal({
  entityType,
  entityId,
  targets,
  title = 'History & Activity',
  containerStyle,
  visible: externalVisible,
  onDismiss,
  hideTrigger,
}: HistoryModalProps) {
  const colors = useThemeColors() as any;
  const [internalVisible, setInternalVisible] = useState(false);

  const isVisible = externalVisible !== undefined ? externalVisible : internalVisible;

  const handleDismiss = () => {
    setInternalVisible(false);
    onDismiss?.();
  };

  const { logs, loading, loadMore, hasMore, refresh } = useAuditLog(
    entityType,
    entityId,
    isVisible,
    targets,
  );

  // Group logs by calendar date
  const grouped = useMemo(() => {
    const result: { group: string; items: AuditLog[] }[] = [];
    for (const log of logs) {
      const g = getDateGroup(log.created_at ?? '');
      const last = result[result.length - 1];
      if (last && last.group === g) {
        last.items.push(log);
      } else {
        result.push({ group: g, items: [log] });
      }
    }
    return result;
  }, [logs]);

  const totalItems = logs.length;

  return (
    <View style={containerStyle}>
      {!hideTrigger && (
        <Button
          mode="outlined"
          icon="history"
          onPress={() => setInternalVisible(true)}
          style={{ marginVertical: 8, borderColor: colors.outlineVariant }}
          textColor={colors.onSurfaceVariant}
        >
          View History
        </Button>
      )}

      <BaseModal
        visible={isVisible}
        onDismiss={handleDismiss}
        title={title}
        subtitle={
          loading && totalItems === 0
            ? 'Loading…'
            : `${totalItems} event${totalItems !== 1 ? 's' : ''}`
        }
        scrollable
        actions={[
          {
            label: 'Refresh',
            onPress: refresh,
            mode: 'outlined',
            icon: 'refresh',
            textColor: colors.onSurfaceVariant,
          },
          {
            label: 'Close',
            onPress: handleDismiss,
            mode: 'outlined',
          },
        ]}
      >
        <View style={styles.timelineContainer}>
          {/* ── Skeleton loading state ── */}
          {loading && totalItems === 0 && (
            <>
              <SkeletonRow colors={colors} />
              <SkeletonRow colors={colors} />
              <SkeletonRow colors={colors} />
            </>
          )}

          {/* ── Empty state ── */}
          {!loading && totalItems === 0 && (
            <EmptyState icon="history" title="No history records found" />
          )}

          {/* ── Date-grouped timeline ── */}
          {grouped.map(({ group, items }) => (
            <View key={group}>
              {/* Date header */}
              <View style={styles.dateHeader}>
                <View
                  style={[styles.dateLine, { backgroundColor: colors.outlineVariant }]}
                />
                <Text
                  variant="labelSmall"
                  style={[
                    styles.dateLabel,
                    { color: colors.onSurfaceVariant, backgroundColor: colors.surface },
                  ]}
                >
                  {group}
                </Text>
                <View
                  style={[styles.dateLine, { backgroundColor: colors.outlineVariant }]}
                />
              </View>

              {items.map((entry, index) => {
                const cfg = getActionConfig(entry.action, colors, entry.entity_type);
                const isLast = index === items.length - 1;

                const target = targets?.find(
                  t =>
                    t.entityId === entry.entity_id && t.entityType === entry.entity_type,
                );
                const baseLabel = entry.label || cfg.label;
                const finalLabel = target?.label
                  ? `${baseLabel} ${target.label}`
                  : baseLabel;

                return (
                  <View key={entry.id} style={styles.timelineItem}>
                    {/* Sidebar: line + colored dot */}
                    <View style={styles.timelineSidebar}>
                      {!isLast && (
                        <View
                          style={[
                            styles.timelineLine,
                            { backgroundColor: colors.outlineVariant },
                          ]}
                        />
                      )}
                      <View
                        style={[
                          styles.timelineDot,
                          {
                            backgroundColor: cfg.color,
                            borderColor: colors.surface,
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={cfg.icon as any}
                          size={7}
                          color={colors.surface}
                        />
                      </View>
                    </View>

                    {/* Content */}
                    <View style={styles.timelineContent}>
                      <View style={styles.itemHeader}>
                        <View style={{ flex: 1 }}>
                          {/* Label or action summary */}
                          <Text variant="labelMedium" style={{ fontWeight: 'bold' }}>
                            {finalLabel}
                          </Text>
                        </View>
                      </View>

                      {/* Field-level diff card */}
                      {entry.changes && Object.keys(entry.changes).length > 0 && (
                        <ChangeDiff changes={entry.changes} colors={colors} />
                      )}

                      {/* Footer: Time & Actor info */}
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          marginTop: 4,
                        }}
                      >
                        <Text
                          variant="bodySmall"
                          style={{
                            fontStyle: 'italic',
                            fontSize: 11,
                            color: colors.onSurfaceDisabled,
                          }}
                        >
                          {formatDateTime(entry.created_at ?? '')}
                        </Text>
                        <Text
                          variant="labelSmall"
                          style={{
                            fontStyle: 'italic',
                            fontSize: 11,
                            color: colors.onSurfaceDisabled,
                            textAlign: 'right',
                          }}
                        >
                          by {entry.actor_name}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}

          {/* ── Load more ── */}
          {hasMore && totalItems > 0 && (
            <SPressable
              onPress={loadMore}
              style={[styles.loadMoreButton, { borderColor: colors.outlineVariant }]}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text
                  variant="labelSmall"
                  style={{ color: colors.primary, textAlign: 'center' }}
                >
                  Load more…
                </Text>
              )}
            </SPressable>
          )}
        </View>
      </BaseModal>
    </View>
  );
}

const styles = StyleSheet.create({
  timelineContainer: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  // ── Date group header ──────────────────────
  dateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    paddingHorizontal: 4,
  },
  dateLine: {
    flex: 1,
    height: 1,
  },
  dateLabel: {
    marginHorizontal: 8,
    paddingHorizontal: 6,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  // ── Timeline row ───────────────────────────
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  timelineSidebar: {
    width: 22,
    alignItems: 'center',
  },
  timelineLine: {
    position: 'absolute',
    width: 2,
    top: 18,
    bottom: -4,
  },
  timelineDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    marginTop: 2,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineContent: {
    flex: 1,
    paddingBottom: 14,
    marginLeft: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  // ── Change diff card ───────────────────────
  changesCard: {
    padding: 10,
    borderRadius: 8,
    marginTop: 2,
    gap: 5,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  changeKey: {
    width: '30%',
    fontWeight: 'bold',
    fontSize: 9,
    paddingTop: 1,
  },
  changeValues: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  oldValue: {
    textDecorationLine: 'line-through',
    fontSize: 11,
  },
  newValue: {
    fontWeight: '700',
    fontSize: 11,
  },
  expandToggle: {
    paddingTop: 4,
    paddingBottom: 2,
  },
  // ── Load more ─────────────────────────────
  loadMoreButton: {
    padding: 10,
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  // ── Skeleton ──────────────────────────────
  skeletonContent: {
    flex: 1,
    paddingBottom: 14,
    marginLeft: 10,
    paddingTop: 10,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 5,
    opacity: 0.4,
  },
});
