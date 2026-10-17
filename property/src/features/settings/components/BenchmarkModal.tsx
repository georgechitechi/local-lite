import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import * as Clipboard from 'expo-clipboard';
import Storage from 'expo-sqlite/kv-store';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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

interface BenchmarkResult {
  name: string;
  category: 'SQLite' | 'Storage' | 'Memory / JSON';
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
      // Step 0: Prepare isolated temp table
      // -----------------------------------------------------------------------
      setCurrentStep('Preparing benchmark environment...');
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

      // -----------------------------------------------------------------------
      // Test 1: SQLite Batch Writes (Transaction)
      // -----------------------------------------------------------------------
      setCurrentStep('Testing SQLite batch transaction writes (500 rows)...');
      setProgress(0.15);
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
        description: '500 bulk rows inserted inside a single SQLite transaction',
        operations: batchCount,
        durationMs: t1Duration,
        opsPerSec: t1Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 2: SQLite Individual Writes
      // -----------------------------------------------------------------------
      setCurrentStep('Testing individual SQLite writes (50 rows)...');
      setProgress(0.35);
      const indivCount = 50;
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
        description: '50 standalone queries without transaction wrapping',
        operations: indivCount,
        durationMs: t2Duration,
        opsPerSec: t2Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 3: Indexed Point Lookups
      // -----------------------------------------------------------------------
      setCurrentStep('Testing indexed primary key lookups (500 queries)...');
      setProgress(0.55);
      const readCount = 500;
      const t3Start = performance.now();

      for (let i = 0; i < readCount; i++) {
        const targetId = `b-batch-${i % batchCount}`;
        await db.execute('SELECT * FROM "_benchmark_temp" WHERE id = ?', [targetId]);
      }
      const t3End = performance.now();
      const t3Duration = Math.max(1, Math.round(t3End - t3Start));
      const t3Ops = Math.round((readCount / t3Duration) * 1000);

      benchmarkList.push({
        name: 'Indexed Point Lookups',
        category: 'SQLite',
        description: '500 point-selects by primary key index',
        operations: readCount,
        durationMs: t3Duration,
        opsPerSec: t3Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 4: Complex Table Scan & Sort
      // -----------------------------------------------------------------------
      setCurrentStep('Testing table scans and sort filtering (50 iterations)...');
      setProgress(0.7);
      const scanCount = 50;
      const t4Start = performance.now();

      for (let i = 0; i < scanCount; i++) {
        await db.execute(
          'SELECT * FROM "_benchmark_temp" WHERE score > 50 ORDER BY created_at DESC LIMIT 20',
        );
      }
      const t4End = performance.now();
      const t4Duration = Math.max(1, Math.round(t4End - t4Start));
      const t4Ops = Math.round((scanCount / t4Duration) * 1000);

      benchmarkList.push({
        name: 'Filtered Scan & Sorting',
        category: 'SQLite',
        description: '50 complex SELECTs with WHERE clause, index range & ORDER BY',
        operations: scanCount,
        durationMs: t4Duration,
        opsPerSec: t4Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 5: JSON Serialization & Parsing (Hydration)
      // -----------------------------------------------------------------------
      setCurrentStep('Testing JSON hydration & serialization (1,000 items)...');
      setProgress(0.85);
      const jsonCount = 1000;
      const sampleObjects = Array.from({ length: jsonCount }, (_, i) => ({
        id: `uuid-${i}`,
        business_id: 'sample-biz',
        tenant: {
          name: `Tenant ${i}`,
          phone: '+254712345678',
          email: `tenant${i}@example.com`,
        },
        next_of_kin: {
          name: 'Emergency Contact',
          relation: 'Brother',
          phone: '+254700000000',
        },
        amenities: ['wifi', 'parking', 'gym', 'pool'],
        created_at: new Date().toISOString(),
      }));

      const t5Start = performance.now();
      for (let i = 0; i < jsonCount; i++) {
        const serialized = JSON.stringify(sampleObjects[i]);
        JSON.parse(serialized);
      }
      const t5End = performance.now();
      const t5Duration = Math.max(1, Math.round(t5End - t5Start));
      const t5Ops = Math.round((jsonCount / t5Duration) * 1000);

      benchmarkList.push({
        name: 'JSON Hydration & Serialization',
        category: 'Memory / JSON',
        description: '1,000 complex domain object stringify and parse cycles',
        operations: jsonCount,
        durationMs: t5Duration,
        opsPerSec: t5Ops,
        status: 'success',
      });
      setResults([...benchmarkList]);

      // -----------------------------------------------------------------------
      // Test 6: KV-Store Storage Speed
      // -----------------------------------------------------------------------
      setCurrentStep('Testing KV-Store access speed (100 cycles)...');
      setProgress(0.95);
      const kvCount = 100;
      const t6Start = performance.now();

      for (let i = 0; i < kvCount; i++) {
        await Storage.setItem(`__bench_key_${i}`, `value_${i}`);
        await Storage.getItem(`__bench_key_${i}`);
      }
      for (let i = 0; i < kvCount; i++) {
        await Storage.removeItem(`__bench_key_${i}`).catch(() => {});
      }
      const t6End = performance.now();
      const t6Duration = Math.max(1, Math.round(t6End - t6Start));
      const t6Ops = Math.round((kvCount / t6Duration) * 1000);

      benchmarkList.push({
        name: 'KV-Store (Storage) Cycles',
        category: 'Storage',
        description: '100 set, get, and delete operations in SQLite KV storage',
        operations: kvCount,
        durationMs: t6Duration,
        opsPerSec: t6Ops,
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
      // Clean up isolated temporary benchmark table
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
    if (r.opsPerSec > 1000) return { label: 'Fast ⚡', color: colors.secondary };
    return { label: 'Normal 👍', color: colors.outline };
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Performance Benchmark"
      subtitle="Measure local SQLite throughput, storage speed, and hydration latency."
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
              Test Real-Time Throughput
            </Text>
            <Text
              variant="bodySmall"
              style={{
                textAlign: 'center',
                color: colors.onSurfaceVariant,
                marginBottom: 16,
              }}
            >
              Executes isolated read/write batches in a temporary SQLite table without
              affecting your data.
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

const _styles = StyleSheet.create({});
