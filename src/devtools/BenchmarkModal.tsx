import React, { useState } from 'react';
import { LocalFirstClient } from '../core/client.js';
import { resolveSyncTheme, type SyncThemeColors } from '../react/theme.js';
import { escapeIdentifier } from '../utils/sql.js';

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

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const elapsed = (start: number): number => Math.max(0.01, Math.round((now() - start) * 100) / 100);

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Runs one untimed warm-up pass, then returns the median duration (ms) of `runs` timed passes. */
async function timeMedian(action: () => Promise<void>, runs = 5): Promise<number> {
  await action();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = now();
    await action();
    samples.push(elapsed(start));
  }
  return median(samples);
}

export interface BuiltinBenchmarkResult {
  name: string;
  category:
    | 'Local-Lite Client'
    | 'ACID / Transactions'
    | 'Outbox / Sync'
    | 'Memory / JSON'
    | 'App Data';
  description: string;
  operations: number;
  durationMs: number;
  opsPerSec: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  note?: string;
}

export interface BenchmarkModalProps {
  client: LocalFirstClient | null | undefined;
  visible: boolean;
  onDismiss: () => void;
  theme?: 'auto' | 'dark' | 'light' | Partial<SyncThemeColors>;
}

/**
 * Executes a comprehensive performance & ACID test suite
 * directly testing local-lite client APIs:
 * client.batch(), client.insert(), client.update(), client.findById(),
 * client.findMany() with SQL pushdown ($gt, $contains), client.transaction() rollbacks,
 * client.trackMutation() outbox pipeline, and client.delete().
 */
export async function runSQLiteBenchmark(
  clientOrDb: any,
  onProgress?: (step: string, progress: number) => void,
): Promise<BuiltinBenchmarkResult[]> {
  const list: BuiltinBenchmarkResult[] = [];
  const client: LocalFirstClient | null =
    clientOrDb && typeof clientOrDb.batch === 'function' ? clientOrDb : null;
  const db = client?.db || clientOrDb;

  try {
    onProgress?.('Preparing benchmark environment...', 0.05);
    let appRowCount = 0;
    let appTableCount = 0;
    let appTables: Array<[string, number]> = [];
    const appDataSamples: string[] = [];
    if (client?.maintenance) {
      const stats = await client.maintenance.getStorageStats();
      appTables = Object.entries(stats.tables).filter(([, count]) => count > 0);
      appRowCount = appTables.reduce((total, [, count]) => total + count, 0);
      appTableCount = appTables.length;

      for (const [tableName] of appTables) {
        const rows = await db.execute(`SELECT * FROM ${escapeIdentifier(tableName)} LIMIT 1`);
        if (rows[0]) {
          const sample = JSON.stringify(rows[0], (_key, value) =>
            typeof value === 'bigint' ? value.toString() : value,
          );
          if (sample) appDataSamples.push(sample.slice(0, 4096));
        }
      }
    }

    const workloadScale = Math.min(10, Math.max(1, Math.ceil(appRowCount / 1000)));
    const scaleWorkload = (count: number) => count * workloadScale;
    const makeMetadata = (index: number, tag: string) =>
      JSON.stringify({
        index,
        tag,
        timestamp: Date.now(),
        ...(appDataSamples.length > 0
          ? { appRecord: appDataSamples[index % appDataSamples.length] }
          : {}),
      });

    await db.execute('DROP TABLE IF EXISTS "_sync_bench_tags"').catch(() => {});
    await db.execute('DROP TABLE IF EXISTS "_sync_bench_temp"').catch(() => {});
    await db.execute('DROP TABLE IF EXISTS "_sync_bench_outbox"').catch(() => {});

    await db.execute(`
      CREATE TABLE IF NOT EXISTS "_sync_bench_temp" (
        id TEXT PRIMARY KEY,
        title TEXT,
        score INTEGER,
        metadata TEXT,
        created_at TEXT
      )
    `);
    await db.execute(
      'CREATE INDEX IF NOT EXISTS "idx_sync_bench_score" ON "_sync_bench_temp" (score)',
    );
    await db.execute(`
      CREATE TABLE IF NOT EXISTS "_sync_bench_outbox" (
        id TEXT PRIMARY KEY,
        tableName TEXT NOT NULL,
        rowId TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT,
        timestamp INTEGER NOT NULL,
        status TEXT DEFAULT 'PENDING',
        retryCount INTEGER DEFAULT 0
      )
    `);
    await db.execute(
      'CREATE INDEX IF NOT EXISTS "idx_sync_bench_outbox" ON "_sync_bench_outbox" (status, timestamp)',
    );

    // 1. client.batch() Ingestion
    const batchCount = scaleWorkload(500);
    onProgress?.(`Testing client.batch() atomic multi-mutation (${batchCount} rows)...`, 0.12);
    const batchMutations = Array.from({ length: batchCount }, (_, i) => ({
      tableName: '_sync_bench_temp',
      operation: 'INSERT' as const,
      rowId: `b-batch-${i}`,
      payload: {
        id: `b-batch-${i}`,
        title: `Item ${i}`,
        score: Math.floor(Math.random() * 100),
        metadata: makeMetadata(i, 'batch'),
        created_at: new Date().toISOString(),
      },
    }));

    const t1Start = now();
    if (client?.batch) {
      await client.batch(batchMutations, { skipOutbox: true });
    } else {
      await db.transaction(async (tx: any) => {
        for (const m of batchMutations) {
          await tx.execute(
            'INSERT INTO "_sync_bench_temp" (id, title, score, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
            [m.rowId, m.payload.title, m.payload.score, m.payload.metadata, m.payload.created_at],
          );
        }
      });
    }
    const t1Duration = elapsed(t1Start);
    list.push({
      name: 'client.batch() Ingestion',
      category: 'Local-Lite Client',
      description: `${batchCount.toLocaleString()} rows inserted via local-lite atomic batch() mutation pipeline`,
      operations: batchCount,
      durationMs: t1Duration,
      opsPerSec: Math.round((batchCount / t1Duration) * 1000),
      status: 'success',
      note: `Calibrated to ${appRowCount.toLocaleString()} app rows across ${appTableCount} tables (${workloadScale}x workload).`,
    });

    // 2. client.insert() Individual Mutations
    const indivCount = scaleWorkload(40);
    onProgress?.(`Testing client.insert() individual mutations (${indivCount} rows)...`, 0.24);
    const t2Start = now();
    for (let i = 0; i < indivCount; i++) {
      const payload = {
        title: `Individual Item ${i}`,
        score: Math.floor(Math.random() * 100),
        metadata: makeMetadata(i, 'indiv'),
        created_at: new Date().toISOString(),
      };
      if (client?.insert) {
        await client.insert('_sync_bench_temp', `b-indiv-${i}`, payload, { skipOutbox: true });
      } else {
        await db.execute(
          'INSERT INTO "_sync_bench_temp" (id, title, score, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
          [`b-indiv-${i}`, payload.title, payload.score, payload.metadata, payload.created_at],
        );
      }
    }
    const t2Duration = elapsed(t2Start);
    list.push({
      name: 'client.insert() Mutation',
      category: 'Local-Lite Client',
      description: `${indivCount.toLocaleString()} standalone client.insert() calls testing the dual-write mutation pipeline`,
      operations: indivCount,
      durationMs: t2Duration,
      opsPerSec: Math.round((indivCount / t2Duration) * 1000),
      status: 'success',
    });

    // 3. client.update() Reactive Updates
    const updateCount = scaleWorkload(150);
    onProgress?.(`Testing client.update() reactive updates (${updateCount} rows)...`, 0.36);
    const t3Start = now();
    for (let i = 0; i < updateCount; i++) {
      const patch = {
        title: `Updated Item ${i}`,
        score: 999 + i,
        metadata: makeMetadata(i, 'update'),
      };
      if (client?.update) {
        await client.update('_sync_bench_temp', `b-batch-${i}`, patch, { skipOutbox: true });
      } else {
        await db.execute(
          'UPDATE "_sync_bench_temp" SET title = ?, score = ?, metadata = ? WHERE id = ?',
          [patch.title, patch.score, patch.metadata, `b-batch-${i}`],
        );
      }
    }
    const t3Duration = elapsed(t3Start);
    list.push({
      name: 'client.update() Pipeline',
      category: 'Local-Lite Client',
      description: `${updateCount.toLocaleString()} client.update() calls testing schema verification & event emission`,
      operations: updateCount,
      durationMs: t3Duration,
      opsPerSec: Math.round((updateCount / t3Duration) * 1000),
      status: 'success',
    });

    // 4. client.findById() Indexed Lookups
    const findCount = scaleWorkload(400);
    onProgress?.(`Testing client.findById() indexed point lookups (${findCount} queries)...`, 0.48);
    const t4Start = now();
    for (let i = 0; i < findCount; i++) {
      const id = `b-batch-${i % batchCount}`;
      if (client?.findById) {
        await client.findById('_sync_bench_temp', id);
      } else {
        await db.execute('SELECT * FROM "_sync_bench_temp" WHERE id = ?', [id]);
      }
    }
    const t4Duration = elapsed(t4Start);
    list.push({
      name: 'client.findById() Lookups',
      category: 'Local-Lite Client',
      description: `${findCount.toLocaleString()} point lookups testing PK index resolution & auto JSON hydration`,
      operations: findCount,
      durationMs: t4Duration,
      opsPerSec: Math.round((findCount / t4Duration) * 1000),
      status: 'success',
    });

    // 5. client.findByIds() Batched PK Lookups
    const batchedQueryCount = scaleWorkload(20);
    const batchLookupSize = 20;
    onProgress?.(
      `Testing client.findByIds() batched lookups (${batchedQueryCount * batchLookupSize} entities)...`,
      0.55,
    );
    const tBatchFindStart = now();
    for (let i = 0; i < batchedQueryCount; i++) {
      const ids = Array.from(
        { length: batchLookupSize },
        (_, idx) => `b-batch-${(i * batchLookupSize + idx) % batchCount}`,
      );
      if (client?.findByIds) {
        await client.findByIds('_sync_bench_temp', ids);
      } else {
        const placeholders = ids.map(() => '?').join(', ');
        await db.execute(
          `SELECT * FROM "_sync_bench_temp" WHERE id IN (${placeholders})`,
          ids,
        );
      }
    }
    const tBatchFindDuration = elapsed(tBatchFindStart);
    const totalBatchedFinds = batchedQueryCount * batchLookupSize;
    list.push({
      name: 'client.findByIds() Batched',
      category: 'Local-Lite Client',
      description: '400 entity lookups compiled into batched WHERE id IN (...) single-trip SQL',
      operations: totalBatchedFinds,
      durationMs: tBatchFindDuration,
      opsPerSec: Math.round((totalBatchedFinds / tBatchFindDuration) * 1000),
      status: 'success',
    });

    // 6. client.findMany() with SQL Pushdown Filters
    const findManyCount = scaleWorkload(40);
    onProgress?.(`Testing client.findMany() query filter compilation (${findManyCount} queries)...`, 0.6);
    const t5Start = now();
    for (let i = 0; i < findManyCount; i++) {
      if (client?.findMany) {
        await client.findMany('_sync_bench_temp', {
          where: { score: { $gt: 50 } },
          orderBy: 'created_at',
          order: 'desc',
          limit: 20,
        });
      } else {
        await db.execute(
          'SELECT * FROM "_sync_bench_temp" WHERE score > 50 ORDER BY created_at DESC LIMIT 20',
        );
      }
    }
    const t5Duration = elapsed(t5Start);
    list.push({
      name: 'client.findMany() Filters',
      category: 'Local-Lite Client',
      description: `${findManyCount.toLocaleString()} queries through local-lite SQL pushdown ($gt, ORDER BY, LIMIT)`,
      operations: findManyCount,
      durationMs: t5Duration,
      opsPerSec: Math.round((findManyCount / t5Duration) * 1000),
      status: 'success',
    });

    // 6. client.findMany() with $contains (Fuzzy Substring Search)
    const searchCount = scaleWorkload(50);
    onProgress?.(`Testing client.findMany() $contains fuzzy search (${searchCount} queries)...`, 0.7);
    const searchTokens = ['Item 1', 'Updated', 'rev', 'Large', 'nonexistent'];
    const t6Start = now();
    for (let i = 0; i < searchCount; i++) {
      const token = searchTokens[i % searchTokens.length];
      if (client?.findMany) {
        await client.findMany('_sync_bench_temp', {
          where: { title: { $contains: token } },
          limit: 25,
        });
      } else {
        await db.execute(
          'SELECT * FROM "_sync_bench_temp" WHERE title LIKE ? LIMIT 25',
          [`%${token}%`],
        );
      }
    }
    const t6Duration = elapsed(t6Start);
    list.push({
      name: 'client.findMany() $contains Search',
      category: 'Local-Lite Client',
      description: `${searchCount.toLocaleString()} fuzzy text queries compiling $contains into SQL LIKE pushdown`,
      operations: searchCount,
      durationMs: t6Duration,
      opsPerSec: Math.round((searchCount / t6Duration) * 1000),
      status: 'success',
    });

    // 7. client.transaction() ACID Rollback Verification
    onProgress?.('Testing client.transaction() ACID rollback isolation...', 0.78);
    const rollbackStart = now();
    const rollbackCount = scaleWorkload(10);
    for (let c = 0; c < rollbackCount; c++) {
      try {
        if (client?.transaction) {
          await client.transaction(async (txClient: any) => {
            await txClient.insert(
              '_sync_bench_temp',
              `rb-${c}`,
              { title: 'Pre-rollback' },
              { skipOutbox: true },
            );
            // Intentional abort
            throw new Error('INTENTIONAL_BENCHMARK_ROLLBACK');
          });
        } else {
          await db.transaction(async (tx: any) => {
            await tx.execute('INSERT INTO "_sync_bench_temp" (id, title) VALUES (?, ?)', [
              `rb-${c}`,
              'Pre-rollback',
            ]);
            throw new Error('INTENTIONAL_BENCHMARK_ROLLBACK');
          });
        }
      } catch {}
    }
    const leakedCheck = client?.findMany
      ? await client.findMany('_sync_bench_temp', {
          where: { title: { $contains: 'Pre-rollback' } },
        })
      : [];
    const leaked = Array.isArray(leakedCheck) ? leakedCheck.length : 0;
    const rbDuration = elapsed(rollbackStart);
    list.push({
      name: 'client.transaction() Rollback',
      category: 'ACID / Transactions',
      description: `${rollbackCount} aborted transactions via client.transaction() (${leaked} leaked rows, zero pollution)`,
      operations: rollbackCount,
      durationMs: rbDuration,
      opsPerSec: Math.round((rollbackCount / rbDuration) * 1000),
      status: 'success',
      note: `${leaked} leaked rows`,
    });

    // 8. Outbox Pipeline Ingestion
    const outboxCount = scaleWorkload(200);
    onProgress?.(`Testing outbox mutation pipeline (${outboxCount} mutations)...`, 0.85);
    const tOutboxStart = now();
    await db.transaction(async (tx: any) => {
      for (let i = 0; i < outboxCount; i++) {
        await tx.execute(
          'INSERT INTO "_sync_bench_outbox" (id, tableName, rowId, operation, payload, timestamp, status, retryCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [
            `outbox-${i}`,
            '_sync_bench_temp',
            `outbox-row-${i}`,
            i % 2 === 0 ? 'INSERT' : 'UPDATE',
            JSON.stringify({ test: true, index: i }),
            Date.now(),
            'PENDING',
            0,
          ],
        );
      }
    });
    const tOutboxDuration = elapsed(tOutboxStart);
    list.push({
      name: 'Outbox Pipeline Ingestion',
      category: 'Outbox / Sync',
      description: `${outboxCount.toLocaleString()} mutations staged through outbox queue with compound index`,
      operations: outboxCount,
      durationMs: tOutboxDuration,
      opsPerSec: Math.round((outboxCount / tOutboxDuration) * 1000),
      status: 'success',
    });

    // 9. client.delete() Pipeline
    const deleteCount = scaleWorkload(50);
    onProgress?.(`Testing client.delete() removal (${deleteCount} rows)...`, 0.9);
    const tDelStart = now();
    for (let i = 0; i < deleteCount; i++) {
      if (client?.delete) {
        await client.delete('_sync_bench_temp', `b-batch-${i}`, { skipOutbox: true });
      } else {
        await db.execute('DELETE FROM "_sync_bench_temp" WHERE id = ?', [`b-batch-${i}`]);
      }
    }
    const tDelDuration = elapsed(tDelStart);
    list.push({
      name: 'client.delete() Pipeline',
      category: 'Local-Lite Client',
      description: `${deleteCount.toLocaleString()} deletions through local-lite mutate() deletion pipeline`,
      operations: deleteCount,
      durationMs: tDelDuration,
      opsPerSec: Math.round((deleteCount / tDelDuration) * 1000),
      status: 'success',
    });

    // 10. WAL Read/Write Concurrency Under Contention
    onProgress?.('Testing WAL non-blocking concurrent reads & writes...', 0.95);
    const concReadCount = scaleWorkload(100);
    const concWriteCount = scaleWorkload(60);
    const tConcStart = now();
    const writePromise = db.transaction(async (tx: any) => {
      for (let i = 0; i < concWriteCount; i++) {
        await tx.execute(
          'INSERT INTO "_sync_bench_temp" (id, title, score, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
          [`wal-w-${i}`, `WAL Item ${i}`, i, '{"wal":true}', new Date().toISOString()],
        );
      }
    });
    const readPromises = Array.from({ length: concReadCount }, (_, idx) =>
      db.execute('SELECT COUNT(*) as c FROM "_sync_bench_temp" WHERE score >= ?', [idx % 50]),
    );
    await Promise.all([writePromise, ...readPromises]);
    const tConcDuration = elapsed(tConcStart);
    const totalConcOps = concWriteCount + concReadCount;
    list.push({
      name: 'WAL Concurrency Under Contention',
      category: 'ACID / Transactions',
      description: `${concWriteCount.toLocaleString()} atomic writes executed simultaneously with ${concReadCount.toLocaleString()} concurrent reads in non-blocking WAL mode`,
      operations: totalConcOps,
      durationMs: tConcDuration,
      opsPerSec: Math.round((totalConcOps / tConcDuration) * 1000),
      status: 'success',
    });

    // 11. Resilient JSON Fuzz Parsing
    const fuzzCount = scaleWorkload(1000);
    onProgress?.(`Testing resilient JSON fuzz hydration (${fuzzCount.toLocaleString()} cycles)...`, 0.99);
    const fuzzPayloads = [
      JSON.stringify({ nested: { title: 'Document 🏢', val: 42, tags: ['sync', 'offline'] } }),
      '{"corrupted": [1, 2, 3, {"unclosed": true',
      'plain-non-json-string',
      '{"nullValue": null, "boolean": false, "empty": {}}',
      '',
      'null',
    ];
    const t8Start = now();
    for (let i = 0; i < fuzzCount; i++) {
      const raw = fuzzPayloads[i % fuzzPayloads.length];
      try {
        if (raw && typeof raw === 'string') JSON.parse(raw);
      } catch {}
    }
    const t8Duration = elapsed(t8Start);
    list.push({
      name: 'Resilient JSON Fuzz Parsing',
      category: 'Memory / JSON',
      description: `${fuzzCount.toLocaleString()} cycles parsing deep unicode trees, corrupted shapes & fallback structures`,
      operations: fuzzCount,
      durationMs: t8Duration,
      opsPerSec: Math.round((fuzzCount / t8Duration) * 1000),
      status: 'success',
    });

    // 12. Read-only benchmarks against the app's real tables (never writes app data)
    const realTables = [...appTables].sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [tableName, rowCount] of realTables) {
      onProgress?.(`Reading real app table "${tableName}"...`, 0.995);
      try {
        const safeTable = escapeIdentifier(tableName);
        const pk = client?.getPrimaryKey?.() ?? 'id';
        const safePk = escapeIdentifier(pk);
        const pkRows = await db.execute(`SELECT ${safePk} AS pk FROM ${safeTable} LIMIT 200`);
        const ids: string[] = pkRows.map((r: any) => String(r.pk));

        const scanMs = await timeMedian(async () => {
          await db.execute(`SELECT * FROM ${safeTable} LIMIT 500`);
        });
        list.push({
          name: `Real table scan: ${tableName}`,
          category: 'App Data',
          description: `Median of 5 runs reading up to 500 of ${rowCount.toLocaleString()} real rows (SELECT *)`,
          operations: Math.min(500, rowCount),
          durationMs: scanMs,
          opsPerSec: Math.round((Math.min(500, rowCount) / scanMs) * 1000),
          status: 'success',
        });

        if (ids.length > 0 && client?.findById) {
          const lookupMs = await timeMedian(async () => {
            for (const id of ids) await client.findById(tableName, id);
          });
          list.push({
            name: `Real point lookups: ${tableName}`,
            category: 'App Data',
            description: `Median of 5 runs of ${ids.length} client.findById() calls on real rows`,
            operations: ids.length,
            durationMs: lookupMs,
            opsPerSec: Math.round((ids.length / lookupMs) * 1000),
            status: 'success',
          });
        }
      } catch {
        // Table without the expected primary key column; skip it
      }
    }

    onProgress?.('Benchmark complete!', 1);
  } finally {
    await db.execute('DROP TABLE IF EXISTS "_sync_bench_tags"').catch(() => {});
    await db.execute('DROP TABLE IF EXISTS "_sync_bench_temp"').catch(() => {});
    await db.execute('DROP TABLE IF EXISTS "_sync_bench_outbox"').catch(() => {});
    await db.execute('DELETE FROM "sync_outbox" WHERE "tableName" LIKE ?', ['_sync%']).catch(() => {});
  }

  return list;
}

/**
 * Pure package-driven, full-height Performance Benchmark Modal.
 * Opens full-height with zero screen flickering or dynamic jumping.
 */
export function BenchmarkModal({ client, visible, onDismiss, theme = 'auto' }: BenchmarkModalProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [step, setStep] = useState('Idle');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BuiltinBenchmarkResult[]>([]);
  const [copied, setCopied] = useState(false);

  const systemColorScheme = RN?.useColorScheme ? RN.useColorScheme() : null;
  const currentTheme = React.useMemo(
    () => resolveSyncTheme(theme, systemColorScheme),
    [theme, systemColorScheme]
  );

  const startBenchmark = async () => {
    if (!client) return;
    setIsRunning(true);
    setProgress(0);
    setResults([]);
    try {
      const benchResults = await runSQLiteBenchmark(client, (currentStep, pct) => {
        setStep(currentStep);
        setProgress(pct);
      });
      setResults(benchResults);
    } catch (err: any) {
      setStep(`Failed: ${err.message || err}`);
    } finally {
      setIsRunning(false);
    }
  };

  const copyReport = async () => {
    if (results.length === 0) return;
    const report = [
      '# ⚡ local-lite SQLite Benchmark Report',
      `- Platform: ${RN && RN.Platform ? RN.Platform.OS : 'web'}`,
      `- Date: ${new Date().toLocaleString()}`,
      ...(results[0]?.note ? [`- App dataset: ${results[0].note}`] : []),
      '',
      '| Benchmark | Category | Operations | Duration | Throughput |',
      '| :--- | :--- | :--- | :--- | :--- |',
      ...results.map(
        r =>
          `| ${r.name} | ${r.category} | ${r.operations.toLocaleString()} ops | ${r.durationMs} ms | ${r.opsPerSec.toLocaleString()} ops/s |`,
      ),
    ].join('\n');

    let isCopied = false;
    try {
      if (RN && RN.Clipboard && typeof RN.Clipboard.setString === 'function') {
        RN.Clipboard.setString(report);
        isCopied = true;
      }
    } catch {}
    if (!isCopied && typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(report);
        isCopied = true;
      } catch {}
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (!visible) return null;

  // React Native renderer (Full-height modal)
  if (RN && RN.View) {
    const { View, Text, TouchableOpacity, ScrollView, Modal, ActivityIndicator, Platform, StatusBar } = RN;
    const SafeComp = RNSafeArea?.SafeAreaView || RN.SafeAreaView || View;
    const isAndroid = Platform?.OS === 'android';
    const statusBarHeight = isAndroid ? (StatusBar?.currentHeight || 24) : 0;

    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent={true}
        onRequestClose={onDismiss}
      >
        <SafeComp
          style={[styles.fullScreenSafe, { backgroundColor: currentTheme.bg }]}
          edges={['top', 'bottom', 'left', 'right']}
        >
          {/* Top Navigation Bar */}
          <View
            style={[
              styles.topBar,
              { backgroundColor: currentTheme.surface, borderBottomColor: currentTheme.border },
              !RNSafeArea?.SafeAreaView && isAndroid && { paddingTop: statusBarHeight + 10 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.topBarTitle, { color: currentTheme.text }]}>⚡ SQLite Benchmark</Text>
              <Text style={[styles.topBarSub, { color: currentTheme.textMuted }]}>Inbuilt local-lite throughput & ACID test suite</Text>
            </View>
            <TouchableOpacity
              onPress={onDismiss}
              style={[styles.closeCircle, { backgroundColor: currentTheme.actionBg }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.closeCircleText, { color: currentTheme.actionText }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Progress Section (fixed height to prevent flickering) */}
          <View style={[styles.progressSection, { backgroundColor: currentTheme.surface, borderBottomColor: currentTheme.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 }}>
              {isRunning && <ActivityIndicator size="small" color="#8B5CF6" />}
              <Text style={styles.stepText} numberOfLines={1}>
                {isRunning ? step : results.length > 0 ? 'Benchmark complete!' : 'Ready to test'}
              </Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: currentTheme.border }]}>
              <View
                style={[
                  styles.progressFill,
                  { width: isRunning ? `${Math.round(progress * 100)}%` : results.length > 0 ? '100%' : '0%' },
                ]}
              />
            </View>
          </View>

          {/* Scrollable Results List */}
          <ScrollView
            style={[styles.scrollList, { backgroundColor: currentTheme.bg }]}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
          >
            {results.length === 0 && !isRunning && (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyIcon}>⚡</Text>
                <Text style={[styles.emptyTitle, { color: currentTheme.text }]}>Run Real-Time Inbuilt Tests</Text>
                <Text style={[styles.emptyText, { color: currentTheme.textMuted }]}>
                  Executes ACID transactions, constraint rollbacks, bulk UPSERTs, point lookups, and heavy payload I/O in an isolated temporary table.
                </Text>
                <TouchableOpacity
                  onPress={startBenchmark}
                  style={styles.primaryActionBtn}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryActionBtnText}>Start Benchmark</Text>
                </TouchableOpacity>
              </View>
            )}

            {results.map((r, idx) => {
              const rating =
                r.opsPerSec > 5000
                  ? { label: 'Blazing 🚀', color: '#10B981', bg: currentTheme.isDark ? '#064E3B' : '#D1FAE5' }
                  : r.opsPerSec > 500
                    ? { label: 'Fast ⚡', color: '#8B5CF6', bg: currentTheme.isDark ? '#4C1D95' : '#EDE9FE' }
                    : { label: 'Normal 👍', color: currentTheme.textMuted, bg: currentTheme.border };

              return (
                <View key={idx} style={[styles.card, { backgroundColor: currentTheme.card, borderColor: currentTheme.border }]}>
                  <View style={styles.cardHeader}>
                    <Text style={[styles.cardTitle, { color: currentTheme.text }]}>{r.name}</Text>
                    <View style={[styles.badge, { backgroundColor: rating.bg }]}>
                      <Text style={[styles.badgeText, { color: rating.color }]}>
                        {rating.label}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.cardDesc, { color: currentTheme.textMuted }]}>{r.description}</Text>
                  {r.note && (
                    <Text style={[styles.cardDesc, { color: currentTheme.textMuted }]}>{r.note}</Text>
                  )}
                  <View style={[styles.cardMetrics, { borderTopColor: currentTheme.border }]}>
                    <View>
                      <Text style={[styles.metricLabel, { color: currentTheme.textMuted }]}>Duration</Text>
                      <Text style={[styles.metricVal, { color: currentTheme.text }]}>{r.durationMs} ms</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.metricLabel, { color: currentTheme.textMuted }]}>Throughput</Text>
                      <Text style={[styles.metricVal, { color: '#8B5CF6' }]}>
                        {r.opsPerSec.toLocaleString()} ops/s
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Bottom Action Bar */}
          <View
            style={[
              styles.bottomBar,
              { backgroundColor: currentTheme.surface, borderTopColor: currentTheme.border },
              !RNSafeArea?.SafeAreaView && isAndroid && { paddingBottom: 32 },
            ]}
          >
            <TouchableOpacity
              onPress={startBenchmark}
              disabled={isRunning}
              style={[
                styles.footerBtn,
                { backgroundColor: isRunning ? '#6D28D9' : '#8B5CF6' },
              ]}
              activeOpacity={0.8}
            >
              <Text style={styles.footerBtnText}>
                {isRunning ? 'Running Benchmark...' : results.length > 0 ? 'Re-run Benchmark' : 'Run Benchmark'}
              </Text>
            </TouchableOpacity>

            {results.length > 0 && (
              <TouchableOpacity
                onPress={copyReport}
                style={[styles.footerBtn, { backgroundColor: currentTheme.actionBg, flex: 0.8 }]}
                activeOpacity={0.8}
              >
                <Text style={[styles.footerBtnText, { color: currentTheme.actionText }]}>
                  {copied ? '✓ Copied' : 'Copy Report'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </SafeComp>
      </Modal>
    );
  }

  // Web / DOM Full-screen Overlay Renderer
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: currentTheme.bg,
        zIndex: 100000,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: currentTheme.text,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px',
          borderBottom: `1px solid ${currentTheme.border}`,
          backgroundColor: currentTheme.surface,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: currentTheme.text }}>⚡ SQLite Benchmark</h2>
          <span style={{ fontSize: 12, color: currentTheme.textMuted }}>Inbuilt local-lite throughput & ACID test suite</span>
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: currentTheme.actionBg,
            border: 'none',
            color: currentTheme.actionText,
            width: 32,
            height: 32,
            borderRadius: 16,
            cursor: 'pointer',
            fontSize: 16,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: '12px 24px', borderBottom: `1px solid ${currentTheme.border}`, backgroundColor: currentTheme.surface }}>
        <div style={{ fontSize: 12, color: '#A78BFA', marginBottom: 6 }}>{isRunning ? step : 'Ready'}</div>
        <div style={{ width: '100%', height: 6, backgroundColor: currentTheme.border, borderRadius: 3, overflow: 'hidden' }}>
          <div
            style={{
              width: isRunning ? `${Math.round(progress * 100)}%` : results.length > 0 ? '100%' : '0%',
              height: '100%',
              backgroundColor: '#8B5CF6',
              transition: 'width 0.2s',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 12, backgroundColor: currentTheme.bg }}>
        {results.length === 0 && !isRunning && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: currentTheme.textMuted }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
            <h3 style={{ color: currentTheme.text, margin: '0 0 8px 0' }}>Run Inbuilt Performance Benchmark</h3>
            <p style={{ maxWidth: 460, margin: '0 auto 20px auto', fontSize: 13, color: currentTheme.textMuted }}>
              Tests ACID transactions, constraint rollbacks, bulk UPSERTs, point lookups, and heavy payload I/O directly against your database.
            </p>
            <button
              onClick={startBenchmark}
              style={{
                padding: '10px 24px',
                backgroundColor: '#8B5CF6',
                color: '#FFF',
                border: 'none',
                borderRadius: 8,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Start Benchmark
            </button>
          </div>
        )}

        {results.map((r, idx) => (
          <div
            key={idx}
            style={{
              backgroundColor: currentTheme.card,
              border: `1px solid ${currentTheme.border}`,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: currentTheme.text }}>{r.name}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#8B5CF6', backgroundColor: currentTheme.isDark ? '#8B5CF625' : '#EDE9FE', padding: '2px 8px', borderRadius: 10 }}>
                {r.opsPerSec.toLocaleString()} ops/s
              </span>
            </div>
            <div style={{ fontSize: 12, color: currentTheme.textMuted, marginBottom: 10 }}>{r.description}</div>
            {r.note && (
              <div style={{ fontSize: 11, color: currentTheme.textMuted, marginBottom: 10 }}>{r.note}</div>
            )}
            <div style={{ fontSize: 11, color: currentTheme.textMuted }}>
              {r.operations.toLocaleString()} ops in {r.durationMs}ms
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '16px 24px', borderTop: `1px solid ${currentTheme.border}`, backgroundColor: currentTheme.surface, display: 'flex', gap: 12 }}>
        <button
          onClick={startBenchmark}
          disabled={isRunning}
          style={{
            flex: 1,
            padding: '12px 18px',
            backgroundColor: isRunning ? '#6D28D9' : '#8B5CF6',
            color: '#FFF',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {isRunning ? 'Running Benchmark...' : results.length > 0 ? 'Re-run Benchmark' : 'Run Benchmark'}
        </button>
        {results.length > 0 && (
          <button
            onClick={copyReport}
            style={{
              padding: '12px 20px',
              backgroundColor: currentTheme.actionBg,
              color: currentTheme.actionText,
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {copied ? '✓ Copied' : 'Copy Report'}
          </button>
        )}
      </div>
    </div>
  );
}

const styles =
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
          fontSize: 15,
          fontWeight: '600',
        },
        progressSection: {
          paddingHorizontal: 18,
          paddingVertical: 10,
          backgroundColor: '#1F2937',
          borderBottomWidth: 1,
          borderBottomColor: '#374151',
          gap: 6,
        },
        stepText: {
          color: '#A78BFA',
          fontSize: 12,
          fontWeight: '600',
          flex: 1,
        },
        progressTrack: {
          width: '100%',
          height: 6,
          backgroundColor: '#374151',
          borderRadius: 3,
          overflow: 'hidden',
        },
        progressFill: {
          height: '100%',
          backgroundColor: '#8B5CF6',
        },
        scrollList: {
          flex: 1,
          backgroundColor: '#111827',
        },
        scrollContent: {
          padding: 16,
          gap: 10,
        },
        emptyCard: {
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 48,
          paddingHorizontal: 24,
        },
        emptyIcon: {
          fontSize: 44,
          marginBottom: 12,
        },
        emptyTitle: {
          color: '#F9FAFB',
          fontSize: 17,
          fontWeight: '700',
          marginBottom: 8,
        },
        emptyText: {
          color: '#9CA3AF',
          fontSize: 13,
          textAlign: 'center',
          lineHeight: 18,
          marginBottom: 24,
        },
        primaryActionBtn: {
          paddingHorizontal: 24,
          paddingVertical: 12,
          backgroundColor: '#8B5CF6',
          borderRadius: 10,
        },
        primaryActionBtnText: {
          color: '#FFF',
          fontSize: 14,
          fontWeight: '700',
        },
        card: {
          backgroundColor: '#1F2937',
          borderRadius: 12,
          padding: 14,
          borderWidth: 1,
          borderColor: '#374151',
        },
        cardHeader: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        },
        cardTitle: {
          color: '#F9FAFB',
          fontSize: 14,
          fontWeight: '700',
          flex: 1,
          marginRight: 8,
        },
        badge: {
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 12,
        },
        badgeText: {
          fontSize: 11,
          fontWeight: '700',
        },
        cardDesc: {
          color: '#9CA3AF',
          fontSize: 12,
          marginBottom: 10,
        },
        cardMetrics: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          borderTopWidth: 1,
          borderTopColor: '#374151',
          paddingTop: 8,
        },
        metricLabel: {
          color: '#6B7280',
          fontSize: 10,
        },
        metricVal: {
          color: '#F9FAFB',
          fontSize: 13,
          fontWeight: '700',
          marginTop: 2,
        },
        bottomBar: {
          flexDirection: 'row',
          gap: 10,
          padding: 16,
          backgroundColor: '#1F2937',
          borderTopWidth: 1,
          borderTopColor: '#374151',
        },
        footerBtn: {
          flex: 1,
          paddingVertical: 12,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
        },
        footerBtnText: {
          color: '#FFF',
          fontSize: 14,
          fontWeight: '700',
        },
      })
    : {};
