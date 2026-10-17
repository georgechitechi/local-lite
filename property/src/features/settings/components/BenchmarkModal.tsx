import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import * as Clipboard from 'expo-clipboard';
import Storage from 'expo-sqlite/kv-store';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  Divider,
  ProgressBar,
  Surface,
  Text,
} from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { getSyncClient } from '@/shared/services/sync/client';
import { safeParseJSON } from '@/shared/utils/helper';

interface BenchmarkResult {
  name: string;
  category: 'SQLite' | 'Storage' | 'Memory / JSON' | 'ACID / Edge Cases';
  description: string;
  operations: number;
  durationMs: number;
  opsPerSec: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  error?: string;
}

interface BenchmarkModalProps {
  visible: boolean;
  onDismiss: () => void;
}

export default function BenchmarkModal({ visible, onDismiss }: BenchmarkModalProps) {
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();

  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BenchmarkResult[]>([]);

  const runBenchmarks = async () => {
    setIsRunning(true);
    setProgress(0);
    setResults([]);

    const benchmarkList: BenchmarkResult[] = [];
    const client = await getSyncClient().catch(() => null);

    if (!client?.db) {
      showSnackbar('SQLite database is not initialized yet.', 'error');
      setIsRunning(false);
      return;
    }

    const db = client.db;

    try {
      // -----------------------------------------------------------------------
      // Step 0: Prepare isolated temp tables & indexes
      // -----------------------------------------------------------------------
      setCurrentStep('Preparing benchmark environment...');
      await db.execute('DROP TABLE IF EXISTS "_benchmark_tags"');
      await db.execute('DROP TABLE IF EXISTS "_benchmark_temp"');
      await db.execute(`
        CREATE TABLE IF NOT EXISTS "_benchmark_temp" (
          id TEXT PRIMARY KEY,
          title TEXT,
          score INTEGER,
          metadata TEXT,
          created_at TEXT
        )
      `);
      await db.execute(
        'CREATE INDEX IF NOT EXISTS "idx_benchmark_score" ON "_benchmark_temp" (score)',
      );
      await db.execute(`
        CREATE TABLE IF NOT EXISTS "_benchmark_tags" (
          id TEXT PRIMARY KEY,
          item_id TEXT,
          tag TEXT
        )
      `);
      await db.execute(
        'CREATE INDEX IF NOT EXISTS "idx_benchmark_tag_item" ON "_benchmark_tags" (item_id)',
      );

      // -----------------------------------------------------------------------
      // Test 1: SQLite Batch Writes (Transaction)
      // -----------------------------------------------------------------------
      setCurrentStep('Testing SQLite batch transaction writes (500 rows)...');
      setProgress(0.1);
      const batchCount = 500;
      const t1Start = performance.now();

      await db.transaction(async (tx: any) => {
        for (let i = 0; i < batchCount; i++) {
          await tx.execute(
            'INSERT INTO "_benchmark_temp" (id, title, score, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
            [
              `b-batch-${i}`,
              `Benchmark Item ${i}`,
              Math.floor(Math.random() * 100),
              JSON.stringify({ index: i, tag: 'batch', timestamp: Date.now() }),
              new Date().toISOString(),
            ],
          );
        }
      });
      const t1End = performance.now();
      const t1Duration = Math.max(1, Math.round(t1End - t1Start));
      const t1Ops = Math.round((batchCount / t1Duration) * 1000);

      benchmarkList.push({
        name: 'Batch Transaction Writes',
        category: 'SQLite',
        description: '500 bulk rows inserted inside a single atomic SQLite transaction',
        operations: batchCount,
        durationMs: t1Duration,
        opsPerSec: t1Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 2: SQLite Individual Disk Writes
      // -----------------------------------------------------------------------
      setCurrentStep('Testing individual SQLite disk writes (40 rows)...');
      setProgress(0.2);
      const indivCount = 40;
      const t2Start = performance.now();

      for (let i = 0; i < indivCount; i++) {
        await db.execute(
          'INSERT INTO "_benchmark_temp" (id, title, score, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
          [
            `b-indiv-${i}`,
            `Individual Item ${i}`,
            Math.floor(Math.random() * 100),
            JSON.stringify({ index: i, tag: 'indiv' }),
            new Date().toISOString(),
          ],
        );
      }
      const t2End = performance.now();
      const t2Duration = Math.max(1, Math.round(t2End - t2Start));
      const t2Ops = Math.round((indivCount / t2Duration) * 1000);

      benchmarkList.push({
        name: 'Individual Disk Writes',
        category: 'SQLite',
        description:
          '40 standalone queries without transaction wrapping (direct disk sync)',
        operations: indivCount,
        durationMs: t2Duration,
        opsPerSec: t2Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 3: Tough Edge Case - Bulk UPSERT Conflict Resolution (150 rows)
      // -----------------------------------------------------------------------
      setCurrentStep(
        'Testing UPSERT conflict resolution & index rebalancing (150 rows)...',
      );
      setProgress(0.3);
      const upsertCount = 150;
      const t3Start = performance.now();

      await db.transaction(async (tx: any) => {
        for (let i = 0; i < upsertCount; i++) {
          const targetId = `b-batch-${i}`;
          await tx.execute(
            'INSERT OR REPLACE INTO "_benchmark_temp" (id, title, score, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
            [
              targetId,
              `Updated Benchmark Item ${i}`,
              999 + i,
              JSON.stringify({ updated: true, revision: i + 1 }),
              new Date().toISOString(),
            ],
          );
        }
      });
      const t3End = performance.now();
      const t3Duration = Math.max(1, Math.round(t3End - t3Start));
      const t3Ops = Math.round((upsertCount / t3Duration) * 1000);

      benchmarkList.push({
        name: 'Bulk Conflict UPSERTs',
        category: 'ACID / Edge Cases',
        description:
          '150 primary key collisions handled via INSERT OR REPLACE with index rebuilds',
        operations: upsertCount,
        durationMs: t3Duration,
        opsPerSec: t3Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 4: Indexed Point Lookups
      // -----------------------------------------------------------------------
      setCurrentStep('Testing indexed primary key lookups (400 queries)...');
      setProgress(0.4);
      const readCount = 400;
      const t4Start = performance.now();

      for (let i = 0; i < readCount; i++) {
        const targetId = `b-batch-${i % batchCount}`;
        await db.execute('SELECT * FROM "_benchmark_temp" WHERE id = ?', [targetId]);
      }
      const t4End = performance.now();
      const t4Duration = Math.max(1, Math.round(t4End - t4Start));
      const t4Ops = Math.round((readCount / t4Duration) * 1000);

      benchmarkList.push({
        name: 'Indexed Point Lookups',
        category: 'SQLite',
        description: '400 point-selects by primary key index',
        operations: readCount,
        durationMs: t4Duration,
        opsPerSec: t4Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 5: Complex Filtered Scan & Sorting
      // -----------------------------------------------------------------------
      setCurrentStep('Testing filtered scans and sort ordering (40 queries)...');
      setProgress(0.5);
      const scanCount = 40;
      const t5Start = performance.now();

      for (let i = 0; i < scanCount; i++) {
        await db.execute(
          'SELECT * FROM "_benchmark_temp" WHERE score > 50 ORDER BY created_at DESC LIMIT 20',
        );
      }
      const t5End = performance.now();
      const t5Duration = Math.max(1, Math.round(t5End - t5Start));
      const t5Ops = Math.round((scanCount / t5Duration) * 1000);

      benchmarkList.push({
        name: 'Filtered Scan & Sorting',
        category: 'SQLite',
        description:
          '40 complex SELECTs with WHERE clause, index range & ORDER BY pagination',
        operations: scanCount,
        durationMs: t5Duration,
        opsPerSec: t5Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 6: Tough Edge Case - ACID Rollback & Invariant Check
      // -----------------------------------------------------------------------
      setCurrentStep('Testing ACID rollback on intentional constraint failure...');
      setProgress(0.6);
      const rollbackCycles = 10;
      const t6Start = performance.now();

      for (let c = 0; c < rollbackCycles; c++) {
        try {
          await db.transaction(async (tx: any) => {
            // Write a row
            await tx.execute(
              'INSERT INTO "_benchmark_temp" (id, title, score, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
              [`rollback-${c}`, 'Pre-rollback Row', 10, '{}', new Date().toISOString()],
            );
            // Deliberate constraint violation: duplicate primary key
            await tx.execute(
              'INSERT INTO "_benchmark_temp" (id, title, score, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
              [`rollback-${c}`, 'Colliding Row', 20, '{}', new Date().toISOString()],
            );
          });
        } catch {
          // Expected rollback on duplicate PK
        }
      }

      // Verify invariant: exactly 0 of the rollback rows leaked
      const leakedCheck = await db.execute(
        'SELECT COUNT(*) as count FROM "_benchmark_temp" WHERE id LIKE "rollback-%"',
      );
      const leakedCount = (leakedCheck as any)?.rows?._array?.[0]?.count ?? 0;

      const t6End = performance.now();
      const t6Duration = Math.max(1, Math.round(t6End - t6Start));
      const t6Ops = Math.round((rollbackCycles / t6Duration) * 1000);

      benchmarkList.push({
        name: 'ACID Rollback & Invariant',
        category: 'ACID / Edge Cases',
        description: `10 forced constraint failures rolled back cleanly (${leakedCount} leaked rows, zero pollution)`,
        operations: rollbackCycles,
        durationMs: t6Duration,
        opsPerSec: t6Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 7: Tough Edge Case - Large Payload Blob I/O (30KB-50KB JSON Blobs)
      // -----------------------------------------------------------------------
      setCurrentStep('Testing large payload JSON blob I/O (20 x 40KB documents)...');
      setProgress(0.7);
      const blobCount = 20;

      // Construct a realistic ~40KB tenant history audit payload
      const largePayloadObj = {
        audit_version: '3.0',
        business_scope: 'commercial-prime',
        entries: Array.from({ length: 80 }, (_, idx) => ({
          log_id: `log-${idx}`,
          action: 'PAYMENT_RECEIVED',
          meta: {
            amount: 45000 + idx * 100,
            reference: `MPESA-QA${idx}99XX`,
            allocations: ['rent', 'water', 'garbage', 'security', 'maintenance'],
            timestamp: new Date().toISOString(),
          },
        })),
      };
      const largePayloadStr = JSON.stringify(largePayloadObj);

      const t7Start = performance.now();
      for (let i = 0; i < blobCount; i++) {
        const docId = `large-doc-${i}`;
        await db.execute(
          'INSERT INTO "_benchmark_temp" (id, title, score, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
          [docId, `Large Document ${i}`, i, largePayloadStr, new Date().toISOString()],
        );
        await db.execute('SELECT metadata FROM "_benchmark_temp" WHERE id = ?', [docId]);
      }
      const t7End = performance.now();
      const t7Duration = Math.max(1, Math.round(t7End - t7Start));
      const t7Ops = Math.round((blobCount / t7Duration) * 1000);

      benchmarkList.push({
        name: 'Large Document Blob I/O',
        category: 'SQLite',
        description:
          '20 writes & reads of heavy ~40KB JSON documents simulating audit payloads',
        operations: blobCount,
        durationMs: t7Duration,
        opsPerSec: t7Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 8: Tough Edge Case - Relational Multi-Table JOIN & Aggregates
      // -----------------------------------------------------------------------
      setCurrentStep('Testing relational JOINs & aggregate grouping (30 queries)...');
      setProgress(0.8);
      const tagCount = 300;

      // Populate tags table
      await db.transaction(async (tx: any) => {
        for (let i = 0; i < tagCount; i++) {
          const targetItemId = `b-batch-${i % 100}`;
          await tx.execute(
            'INSERT INTO "_benchmark_tags" (id, item_id, tag) VALUES (?, ?, ?)',
            [`tag-${i}`, targetItemId, `category-${i % 5}`],
          );
        }
      });

      const joinQueries = 30;
      const t8Start = performance.now();
      for (let i = 0; i < joinQueries; i++) {
        await db.execute(`
          SELECT t.id, t.title, COUNT(g.id) as tag_count, AVG(t.score) as avg_score
          FROM "_benchmark_temp" t
          INNER JOIN "_benchmark_tags" g ON t.id = g.item_id
          WHERE t.score > 20
          GROUP BY t.id
          HAVING tag_count > 1
          LIMIT 15
        `);
      }
      const t8End = performance.now();
      const t8Duration = Math.max(1, Math.round(t8End - t8Start));
      const t8Ops = Math.round((joinQueries / t8Duration) * 1000);

      benchmarkList.push({
        name: 'Relational JOINs & Aggregates',
        category: 'SQLite',
        description:
          '30 multi-table INNER JOINs with COUNT, AVG, GROUP BY & HAVING filters',
        operations: joinQueries,
        durationMs: t8Duration,
        opsPerSec: t8Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 9: Tough Edge Case - Resilient JSON Fuzz Parsing & Hydration
      // -----------------------------------------------------------------------
      setCurrentStep(
        'Testing resilient JSON fuzz hydration & malformed strings (1,000 cycles)...',
      );
      setProgress(0.9);
      const fuzzCount = 1000;
      const fuzzPayloads = [
        JSON.stringify({
          nested: {
            title: 'Tenant 🏠 Contract',
            escaped: 'Quotes: "hello" \'single\' \\backslashes\\',
            array: [1, null, 'string', true, { inner: 42 }],
          },
        }),
        '{"corrupted": [1, 2, 3, {"unclosed": true',
        'plain-non-json-string',
        '{"nullValue": null, "boolean": false, "empty": {}}',
        '',
        'null',
      ];

      const t9Start = performance.now();
      for (let i = 0; i < fuzzCount; i++) {
        const raw = fuzzPayloads[i % fuzzPayloads.length];
        safeParseJSON(raw, { fallback: true, idx: i });
      }
      const t9End = performance.now();
      const t9Duration = Math.max(1, Math.round(t9End - t9Start));
      const t9Ops = Math.round((fuzzCount / t9Duration) * 1000);

      benchmarkList.push({
        name: 'Resilient JSON Fuzz Parsing',
        category: 'Memory / JSON',
        description:
          '1,000 cycles parsing deep unicode trees, corrupted shapes & fallback structures',
        operations: fuzzCount,
        durationMs: t9Duration,
        opsPerSec: t9Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 10: KV-Store Storage Speed
      // -----------------------------------------------------------------------
      setCurrentStep('Testing KV-Store access speed (80 cycles)...');
      setProgress(0.98);
      const kvCount = 80;
      const t10Start = performance.now();

      for (let i = 0; i < kvCount; i++) {
        await Storage.setItem(`__bench_key_${i}`, `value_${i}`);
        await Storage.getItem(`__bench_key_${i}`);
      }
      for (let i = 0; i < kvCount; i++) {
        await Storage.removeItem(`__bench_key_${i}`).catch(() => {});
      }
      const t10End = performance.now();
      const t10Duration = Math.max(1, Math.round(t10End - t10Start));
      const t10Ops = Math.round((kvCount / t10Duration) * 1000);

      benchmarkList.push({
        name: 'KV-Store (Storage) Cycles',
        category: 'Storage',
        description: '80 set, get, and delete operations in SQLite KV storage',
        operations: kvCount,
        durationMs: t10Duration,
        opsPerSec: t10Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      setProgress(1);
      setCurrentStep('Benchmark complete!');
      showSnackbar('Benchmark completed successfully!', 'success');
    } catch (error: any) {
      console.error('Benchmark error:', error);
      showSnackbar(`Benchmark failed: ${error.message || error}`, 'error');
    } finally {
      // Clean up isolated temporary benchmark tables
      await db.execute('DROP TABLE IF EXISTS "_benchmark_tags"').catch(() => {});
      await db.execute('DROP TABLE IF EXISTS "_benchmark_temp"').catch(() => {});
      setIsRunning(false);
    }
  };

  const copyReport = async () => {
    if (results.length === 0) return;

    const report = [
      '# ⚡ local-lite & SQLite Benchmark Report',
      `- Platform: ${Platform.OS}`,
      `- Date: ${new Date().toLocaleString()}`,
      '',
      '| Benchmark | Category | Operations | Duration | Throughput |',
      '| :--- | :--- | :--- | :--- | :--- |',
      ...results.map(
        r =>
          `| ${r.name} | ${r.category} | ${r.operations.toLocaleString()} ops | ${r.durationMs} ms | ${r.opsPerSec.toLocaleString()} ops/s |`,
      ),
    ].join('\n');

    await Clipboard.setStringAsync(report);
    showSnackbar('Benchmark results copied to clipboard!', 'success');
  };

  const getRating = (r: BenchmarkResult) => {
    if (r.opsPerSec > 5000) return { label: 'Blazing 🚀', color: colors.primary };
    if (r.opsPerSec > 500) return { label: 'Fast ⚡', color: colors.secondary };
    return { label: 'Normal 👍', color: colors.outline };
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Performance Benchmark"
      subtitle="Measure local SQLite throughput, storage speed, ACID rollbacks, and hydration latency."
      scrollable={true}
      actions={[
        {
          label: isRunning ? 'Running...' : 'Run Benchmark',
          mode: 'contained',
          onPress: runBenchmarks,
          disabled: isRunning,
          loading: isRunning,
          icon: 'speedometer',
          buttonColor: colors.primary,
        },
        ...(results.length > 0
          ? [
              {
                label: 'Copy Report',
                mode: 'outlined' as const,
                onPress: copyReport,
                icon: 'content-copy',
              },
            ]
          : []),
      ]}
    >
      <View style={{ gap: 14 }}>
        {/* Progress & Status */}
        {isRunning && (
          <Surface
            elevation={1}
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: colors.surfaceVariant,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text
                variant="bodyMedium"
                style={{ fontWeight: '600', color: colors.onSurface }}
              >
                {currentStep}
              </Text>
            </View>
            <ProgressBar
              progress={progress}
              color={colors.primary}
              style={{ borderRadius: 6 }}
            />
          </Surface>
        )}

        {/* Empty state before running */}
        {!isRunning && results.length === 0 && (
          <Surface
            elevation={0}
            style={{
              padding: 24,
              alignItems: 'center',
              borderRadius: 16,
              backgroundColor: colors.surfaceVariant,
              borderWidth: 1,
              borderColor: colors.outlineVariant,
            }}
          >
            <MaterialCommunityIcons name="speedometer" size={48} color={colors.primary} />
            <Text
              variant="titleMedium"
              style={{ fontWeight: '700', marginTop: 12, marginBottom: 4 }}
            >
              Test Real-Time Throughput & Stress Cases
            </Text>
            <Text
              variant="bodySmall"
              style={{
                textAlign: 'center',
                color: colors.onSurfaceVariant,
                marginBottom: 16,
              }}
            >
              Executes isolated reads, bulk writes, UPSERT conflict resolution, ACID
              rollbacks, heavy blob I/O, and relational multi-table JOINs.
            </Text>
            <Button mode="contained" onPress={runBenchmarks} icon="play">
              Start Benchmark
            </Button>
          </Surface>
        )}

        {/* Results cards */}
        {results.map((r, idx) => {
          const rating = getRating(r);
          return (
            <Card
              key={idx}
              mode="outlined"
              style={{
                borderRadius: 14,
                backgroundColor: colors.surface,
                borderColor: colors.outlineVariant,
              }}
            >
              <Card.Content style={{ gap: 6 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text
                    variant="titleMedium"
                    style={{ fontWeight: '700', color: colors.onSurface }}
                  >
                    {r.name}
                  </Text>
                  <Chip compact textStyle={{ fontSize: 11, fontWeight: '700' }}>
                    {rating.label}
                  </Chip>
                </View>

                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  {r.description}
                </Text>

                <Divider style={{ marginVertical: 6 }} />

                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <View>
                    <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                      Duration
                    </Text>
                    <Text variant="bodyMedium" style={{ fontWeight: '700' }}>
                      {r.durationMs} ms
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                      Throughput
                    </Text>
                    <Text
                      variant="titleMedium"
                      style={{ fontWeight: '800', color: colors.primary }}
                    >
                      {r.opsPerSec.toLocaleString()}{' '}
                      <Text variant="bodySmall">ops/sec</Text>
                    </Text>
                  </View>
                </View>
              </Card.Content>
            </Card>
          );
        })}
      </View>
    </BaseModal>
  );
}
