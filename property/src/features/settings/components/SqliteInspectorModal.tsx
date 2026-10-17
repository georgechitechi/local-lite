import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Badge,
  Button,
  Card,
  Chip,
  Divider,
  IconButton,
  Searchbar,
  SegmentedButtons,
  Text,
} from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { getSyncClient } from '@/shared/services/sync/client';

export interface TableSummary {
  name: string;
  rowCount: number;
  columns: Array<{ name: string; type: string; pk: boolean }>;
  sampleRows?: Record<string, any>[];
  isLoadingRows?: boolean;
}

interface SqliteInspectorModalProps {
  visible: boolean;
  onDismiss: () => void;
}

export default function SqliteInspectorModal({
  visible,
  onDismiss,
}: SqliteInspectorModalProps) {
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();

  const [loading, setLoading] = useState(false);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableRecords, setTableRecords] = useState<Record<string, any>[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'json'>('cards');
  const [recordLimit, setRecordLimit] = useState<number>(10);
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<'tables' | 'all'>('tables');

  // Load list of all SQLite tables and row counts safely and rapidly
  const loadDatabaseOverview = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    try {
      const client = await getSyncClient();

      // 1. Fetch table names from sqlite_master
      const rawTables = await client.db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_%' ORDER BY name ASC;",
      );
      const tableNames: string[] = (rawTables || [])
        .map((t: any) => t.name)
        .filter(Boolean);

      if (tableNames.length === 0) {
        setTables([]);
        setLoading(false);
        return;
      }

      // Count rows table by table with simple, bulletproof queries
      const tableList: TableSummary[] = [];
      for (const name of tableNames) {
        let rowCount = 0;
        try {
          const res = await client.db.execute(
            `SELECT count(*) as count FROM "${name.replace(/"/g, '""')}";`,
          );
          rowCount = Number(res?.[0]?.count ?? 0);
        } catch {
          rowCount = 0;
        }
        tableList.push({
          name,
          rowCount,
          columns: [],
        });
      }

      setTables(tableList);
    } catch (err: any) {
      console.error('Failed to inspect SQLite database:', err);
      showSnackbar(err?.message || 'Failed to inspect SQLite tables', 'error');
    } finally {
      setLoading(false);
    }
  }, [visible, showSnackbar]);

  useEffect(() => {
    if (visible) {
      loadDatabaseOverview();
    } else {
      setSelectedTable(null);
      setTableRecords([]);
      setSearchQuery('');
      setExpandedTables({});
    }
  }, [visible, loadDatabaseOverview]);

  // Load records for a selected table
  const loadTableRecords = useCallback(
    async (tableName: string, limit: number = 10) => {
      setRecordsLoading(true);
      try {
        const client = await getSyncClient();
        const rows = await client.db.execute(
          `SELECT * FROM "${tableName.replace(/"/g, '""')}" LIMIT ${limit};`,
        );
        const recordList = rows || [];
        setTableRecords(recordList);

        if (recordList.length > 0) {
          const sample = recordList[0];
          const cols = Object.keys(sample).map(key => {
            const val = sample[key];
            let type = 'TEXT';
            if (typeof val === 'number') {
              type = Number.isInteger(val) ? 'INTEGER' : 'REAL';
            } else if (typeof val === 'boolean') {
              type = 'BOOLEAN';
            }
            return {
              name: key,
              type,
              pk: key === 'id',
            };
          });
          setTables(prev =>
            prev.map(t => (t.name === tableName ? { ...t, columns: cols } : t)),
          );
        }
      } catch (err: any) {
        console.error(`Error loading records for ${tableName}:`, err);
        showSnackbar(`Error loading ${tableName}: ${err?.message || err}`, 'error');
        setTableRecords([]);
      } finally {
        setRecordsLoading(false);
      }
    },
    [showSnackbar],
  );

  // When a table is selected in detail view
  const handleSelectTable = (tableName: string) => {
    setSelectedTable(tableName);
    loadTableRecords(tableName, recordLimit);
  };

  // Toggle table accordion in "all tables" feed
  const toggleTableExpand = async (tableName: string) => {
    const isNowExpanded = !expandedTables[tableName];
    setExpandedTables(prev => ({ ...prev, [tableName]: isNowExpanded }));

    if (isNowExpanded) {
      // Find if we already have sample rows loaded
      const target = tables.find(t => t.name === tableName);
      if (target && (!target.sampleRows || target.sampleRows.length === 0)) {
        try {
          const client = await getSyncClient();
          const rows = await client.db.execute(
            `SELECT * FROM "${tableName.replace(/"/g, '""')}" LIMIT 10;`,
          );
          setTables(prev =>
            prev.map(t => (t.name === tableName ? { ...t, sampleRows: rows || [] } : t)),
          );
        } catch {
          // ignore
        }
      }
    }
  };

  // Copy text to clipboard
  const handleCopy = async (data: any, label: string = 'Data') => {
    try {
      const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      await Clipboard.setStringAsync(text);
      showSnackbar(`${label} copied to clipboard!`, 'success');
    } catch {
      showSnackbar('Failed to copy to clipboard', 'error');
    }
  };

  // Force re-pull all records from cloud into local SQLite
  const handleForcePull = async () => {
    setLoading(true);
    try {
      const client = await getSyncClient();
      await client.resetSyncCursor();
      (client.remote as any)?.reset?.();
      if (client.syncWorker) {
        await client.syncWorker.pullRemoteChanges();
      }
      showSnackbar('Successfully re-pulled all cloud tables into SQLite', 'success');
      await loadDatabaseOverview();
      if (selectedTable) {
        await loadTableRecords(selectedTable, recordLimit);
      }
    } catch (err: any) {
      console.error('Force pull failed:', err);
      showSnackbar(`Re-pull failed: ${err?.message || err}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredTables = useMemo(() => {
    if (!searchQuery.trim()) return tables;
    const query = searchQuery.toLowerCase().trim();
    return tables.filter(t => t.name.toLowerCase().includes(query));
  }, [tables, searchQuery]);

  const totalRecordsCount = useMemo(() => {
    return tables.reduce((acc, t) => acc + (t.rowCount || 0), 0);
  }, [tables]);

  const currentTableMeta = useMemo(() => {
    return tables.find(t => t.name === selectedTable);
  }, [tables, selectedTable]);

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title={selectedTable ? `Table: ${selectedTable}` : 'SQLite Data Inspector'}
      subtitle={
        selectedTable
          ? `${currentTableMeta?.rowCount ?? 0} total rows · showing ${tableRecords.length} records`
          : `${tables.length} tables · ${totalRecordsCount} total rows (property_admin.db)`
      }
      maxHeight="92%"
      scrollable={false}
      edgeToEdge
      actions={[
        ...(selectedTable
          ? [
              {
                label: 'Back to Tables',
                icon: 'arrow-left',
                mode: 'outlined' as const,
                onPress: () => setSelectedTable(null),
              },
              {
                label: 'Copy JSON (10 rows)',
                icon: 'content-copy',
                mode: 'contained-tonal' as const,
                onPress: () => handleCopy(tableRecords, `${selectedTable} records`),
              },
            ]
          : [
              {
                label: 'Re-pull Cloud',
                icon: 'cloud-download',
                mode: 'contained-tonal' as const,
                onPress: handleForcePull,
              },
              {
                label: 'Refresh',
                icon: 'refresh',
                mode: 'outlined' as const,
                onPress: loadDatabaseOverview,
              },
              {
                label: 'Done',
                mode: 'contained' as const,
                onPress: onDismiss,
              },
            ]),
      ]}
    >
      <View style={styles.container}>
        {/* Loading Indicator */}
        {loading && (
          <View style={styles.loadingBanner}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text
              variant="bodySmall"
              style={{ marginLeft: 8, color: colors.onSurfaceVariant }}
            >
              Scanning SQLite database tables...
            </Text>
          </View>
        )}

        {/* DETAIL VIEW: Single Table Selected */}
        {selectedTable ? (
          <View style={styles.detailContainer}>
            {/* Controls Bar */}
            <View
              style={[styles.detailControls, { backgroundColor: colors.surfaceVariant }]}
            >
              <View style={styles.limitPicker}>
                <Text
                  variant="labelSmall"
                  style={{ color: colors.onSurfaceVariant, marginRight: 6 }}
                >
                  Limit:
                </Text>
                {[10, 25, 50].map(lim => (
                  <Chip
                    key={lim}
                    selected={recordLimit === lim}
                    onPress={() => {
                      setRecordLimit(lim);
                      loadTableRecords(selectedTable, lim);
                    }}
                    compact
                    style={styles.chip}
                    textStyle={{ fontSize: 11 }}
                  >
                    {lim}
                  </Chip>
                ))}
              </View>

              <SegmentedButtons
                value={viewMode}
                onValueChange={v => setViewMode(v as 'cards' | 'json')}
                density="small"
                style={styles.segmentedButtons}
                buttons={[
                  { value: 'cards', icon: 'card-text-outline', label: 'Cards' },
                  { value: 'json', icon: 'code-json', label: 'JSON' },
                ]}
              />
            </View>

            {/* Column Schema Badges */}
            {currentTableMeta && currentTableMeta.columns.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.schemaScroll}
                contentContainerStyle={styles.schemaContainer}
              >
                {currentTableMeta.columns.map(col => (
                  <Chip
                    key={col.name}
                    compact
                    icon={col.pk ? 'key-variant' : undefined}
                    style={{
                      backgroundColor: col.pk ? colors.primaryContainer : colors.surface,
                      borderColor: colors.outlineVariant,
                      borderWidth: 1,
                    }}
                    textStyle={{ fontSize: 11 }}
                  >
                    {col.name}: {col.type}
                  </Chip>
                ))}
              </ScrollView>
            )}

            {/* Records Content */}
            {recordsLoading ? (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text
                  variant="bodySmall"
                  style={{ marginTop: 8, color: colors.onSurfaceVariant }}
                >
                  Loading {selectedTable} records...
                </Text>
              </View>
            ) : tableRecords.length === 0 ? (
              <View style={styles.centerBox}>
                <MaterialCommunityIcons
                  name="database-off"
                  size={44}
                  color={colors.outline}
                />
                <Text
                  variant="titleSmall"
                  style={{ marginTop: 8, color: colors.onSurfaceVariant }}
                >
                  Table is currently empty (0 records)
                </Text>
              </View>
            ) : viewMode === 'json' ? (
              <ScrollView
                style={styles.jsonContainer}
                contentContainerStyle={{ padding: 12 }}
              >
                <Text
                  variant="bodySmall"
                  style={[
                    styles.codeText,
                    { color: colors.onSurface, backgroundColor: colors.surface },
                  ]}
                  selectable
                >
                  {JSON.stringify(tableRecords, null, 2)}
                </Text>
              </ScrollView>
            ) : (
              <FlatList
                data={tableRecords}
                keyExtractor={(item, index) => String(item.id || item.key || index)}
                contentContainerStyle={styles.recordsList}
                renderItem={({ item, index }) => (
                  <Card
                    style={[styles.recordCard, { backgroundColor: colors.surface }]}
                    mode="outlined"
                  >
                    <Card.Content style={styles.recordContent}>
                      <View style={styles.recordHeader}>
                        <Chip compact textStyle={{ fontSize: 10, fontWeight: '700' }}>
                          #{index + 1}
                        </Chip>
                        <Text
                          variant="labelMedium"
                          style={{
                            flex: 1,
                            marginLeft: 8,
                            fontWeight: '700',
                            color: colors.primary,
                          }}
                          numberOfLines={1}
                        >
                          {item.id ? `ID: ${item.id}` : `Row ${index + 1}`}
                        </Text>
                        <IconButton
                          icon="content-copy"
                          size={18}
                          onPress={() => handleCopy(item, `Row #${index + 1}`)}
                        />
                      </View>

                      <Divider style={{ marginVertical: 6 }} />

                      {/* Field Key-Values */}
                      <View style={styles.fieldGrid}>
                        {Object.entries(item).map(([k, v]) => {
                          const isNull = v === null || v === undefined;
                          const displayVal = isNull
                            ? 'NULL'
                            : typeof v === 'object'
                              ? JSON.stringify(v)
                              : String(v);

                          return (
                            <View key={k} style={styles.fieldRow}>
                              <Text
                                variant="labelSmall"
                                style={[
                                  styles.fieldKey,
                                  { color: colors.onSurfaceVariant },
                                ]}
                              >
                                {k}:
                              </Text>
                              <Text
                                variant="bodySmall"
                                style={[
                                  styles.fieldValue,
                                  isNull && {
                                    color: colors.outline,
                                    fontStyle: 'italic',
                                  },
                                  typeof v === 'boolean' && {
                                    color: colors.tertiary,
                                    fontWeight: '700',
                                  },
                                ]}
                                numberOfLines={2}
                                selectable
                              >
                                {displayVal}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </Card.Content>
                  </Card>
                )}
              />
            )}
          </View>
        ) : (
          /* ALL TABLES OVERVIEW */
          <View style={{ flex: 1 }}>
            {/* Search Bar & Mode Switch */}
            <View style={styles.searchRow}>
              <Searchbar
                placeholder="Search tables..."
                value={searchQuery}
                onChangeText={setSearchQuery}
                style={[styles.searchBar, { backgroundColor: colors.surfaceVariant }]}
                inputStyle={{ minHeight: 0, fontSize: 14 }}
              />
            </View>

            <View style={styles.tabToggleRow}>
              <SegmentedButtons
                value={mode}
                onValueChange={v => setMode(v as 'tables' | 'all')}
                density="small"
                style={{ flex: 1 }}
                buttons={[
                  {
                    value: 'tables',
                    icon: 'table',
                    label: `Tables (${filteredTables.length})`,
                  },
                  {
                    value: 'all',
                    icon: 'format-list-bulleted-type',
                    label: '10 Rows Preview Feed',
                  },
                ]}
              />
            </View>

            {/* List of Tables */}
            {mode === 'tables' ? (
              <FlatList
                data={filteredTables}
                keyExtractor={item => item.name}
                contentContainerStyle={styles.tableList}
                renderItem={({ item }) => {
                  const hasData = item.rowCount > 0;
                  return (
                    <TouchableOpacity
                      onPress={() => handleSelectTable(item.name)}
                      activeOpacity={0.7}
                      style={[
                        styles.tableCard,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.outlineVariant,
                        },
                      ]}
                    >
                      <View style={styles.tableRow}>
                        <MaterialCommunityIcons
                          name={
                            item.name.startsWith('sync_')
                              ? 'sync'
                              : item.name === 'businesses'
                                ? 'domain'
                                : item.name === 'tenants'
                                  ? 'account-group'
                                  : 'table-large'
                          }
                          size={24}
                          color={hasData ? colors.primary : colors.outline}
                          style={{ marginRight: 12 }}
                        />

                        <View style={{ flex: 1 }}>
                          <View
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                          >
                            <Text variant="titleSmall" style={{ fontWeight: '700' }}>
                              {item.name}
                            </Text>
                            {item.name.startsWith('sync_') && (
                              <Chip compact textStyle={{ fontSize: 9 }}>
                                internal
                              </Chip>
                            )}
                          </View>
                          <Text
                            variant="bodySmall"
                            style={{ color: colors.onSurfaceVariant, marginTop: 2 }}
                          >
                            {item.columns.length > 0
                              ? `${item.columns.length} cols · ${item.columns
                                  .map(c => c.name)
                                  .slice(0, 3)
                                  .join(', ')}${item.columns.length > 3 ? '...' : ''}`
                              : `${item.rowCount} record${item.rowCount === 1 ? '' : 's'} in SQLite`}
                          </Text>
                        </View>

                        <Badge
                          style={[
                            styles.countBadge,
                            {
                              backgroundColor: hasData
                                ? colors.primaryContainer
                                : colors.surfaceVariant,
                              color: hasData
                                ? colors.onPrimaryContainer
                                : colors.onSurfaceVariant,
                            },
                          ]}
                          size={24}
                        >
                          {item.rowCount}
                        </Badge>

                        <MaterialCommunityIcons
                          name="chevron-right"
                          size={20}
                          color={colors.onSurfaceVariant}
                          style={{ marginLeft: 6 }}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            ) : (
              /* All Tables 10-Rows Feed (Accordion) */
              <FlatList
                data={filteredTables}
                keyExtractor={item => item.name}
                contentContainerStyle={styles.tableList}
                renderItem={({ item }) => {
                  const isExpanded = Boolean(expandedTables[item.name]);
                  const sampleRows = item.sampleRows || [];

                  return (
                    <Card
                      style={[styles.accordionCard, { backgroundColor: colors.surface }]}
                      mode="outlined"
                    >
                      <TouchableOpacity
                        style={styles.accordionHeader}
                        onPress={() => toggleTableExpand(item.name)}
                        activeOpacity={0.7}
                      >
                        <MaterialCommunityIcons
                          name={isExpanded ? 'chevron-down' : 'chevron-right'}
                          size={22}
                          color={colors.primary}
                        />
                        <Text
                          variant="titleSmall"
                          style={{ flex: 1, fontWeight: '700', marginLeft: 6 }}
                        >
                          {item.name}
                        </Text>
                        <Chip compact textStyle={{ fontSize: 10, fontWeight: '600' }}>
                          {item.rowCount} rows
                        </Chip>
                        <Button
                          mode="text"
                          compact
                          onPress={() => handleSelectTable(item.name)}
                          style={{ marginLeft: 4 }}
                        >
                          View Full
                        </Button>
                      </TouchableOpacity>

                      {isExpanded && (
                        <View style={styles.accordionBody}>
                          {item.rowCount === 0 ? (
                            <Text
                              variant="bodySmall"
                              style={{
                                color: colors.outline,
                                fontStyle: 'italic',
                                padding: 8,
                              }}
                            >
                              No records found in {item.name}.
                            </Text>
                          ) : sampleRows.length === 0 ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.primary}
                              style={{ padding: 12 }}
                            />
                          ) : (
                            sampleRows.slice(0, 10).map((row, idx) => (
                              <View
                                key={row.id || idx}
                                style={[
                                  styles.feedRow,
                                  { backgroundColor: colors.surfaceVariant },
                                ]}
                              >
                                <View
                                  style={{
                                    flexDirection: 'row',
                                    justifyContent: 'space-between',
                                    marginBottom: 4,
                                  }}
                                >
                                  <Text
                                    variant="labelSmall"
                                    style={{ fontWeight: '700', color: colors.primary }}
                                  >
                                    Record #{idx + 1} {row.id ? `(${row.id})` : ''}
                                  </Text>
                                  <IconButton
                                    icon="content-copy"
                                    size={14}
                                    style={{ margin: 0 }}
                                    onPress={() => handleCopy(row, `${item.name} record`)}
                                  />
                                </View>
                                <Text
                                  variant="bodySmall"
                                  style={{
                                    fontFamily: 'monospace',
                                    fontSize: 11,
                                    color: colors.onSurface,
                                  }}
                                  numberOfLines={5}
                                >
                                  {JSON.stringify(row, null, 1)}
                                </Text>
                              </View>
                            ))
                          )}
                        </View>
                      )}
                    </Card>
                  );
                }}
              />
            )}
          </View>
        )}
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 480,
  },
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchRow: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  searchBar: {
    borderRadius: 8,
    height: 40,
    elevation: 0,
  },
  tabToggleRow: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  tableList: {
    paddingHorizontal: 14,
    paddingBottom: 24,
    gap: 8,
  },
  tableCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countBadge: {
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: '700',
  },
  detailContainer: {
    flex: 1,
  },
  detailControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  limitPicker: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    marginRight: 4,
    height: 28,
  },
  segmentedButtons: {
    maxWidth: 180,
  },
  schemaScroll: {
    maxHeight: 38,
  },
  schemaContainer: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    gap: 6,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  jsonContainer: {
    flex: 1,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 12,
    padding: 12,
    borderRadius: 8,
    lineHeight: 18,
  },
  recordsList: {
    padding: 14,
    gap: 10,
    paddingBottom: 30,
  },
  recordCard: {
    borderRadius: 8,
  },
  recordContent: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  recordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fieldGrid: {
    gap: 4,
  },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  fieldKey: {
    fontWeight: '600',
    minWidth: 90,
  },
  fieldValue: {
    flex: 1,
    textAlign: 'right',
  },
  accordionCard: {
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
  },
  accordionBody: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 6,
  },
  feedRow: {
    padding: 8,
    borderRadius: 6,
    marginBottom: 4,
  },
});
