import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { LocalFirstClient } from 'local-lite/config';
import type { JobRecord, JobRunRecord } from 'local-lite/scheduler';
import type { BlobRecord } from 'local-lite/storage';
import type { StorageStats } from 'local-lite/maintenance';
import {
  exportTablesToJson,
  importTablesFromJson,
} from 'local-lite/portability';
import { BenchmarkModal, SyncInspector } from 'local-lite/devtools';
import {
  createSignedToken,
  verifySignedToken,
  type ApiKeyRecord,
} from 'local-lite/keys';
import { KeyboardScrollView } from 'react-native-keyboard-scroll';
import { BottomSheetModal } from '../components/BottomSheetModal';
import { getClient } from '../lib/sync';

type LabSection = 'scheduler' | 'storage' | 'maintenance' | 'devtools' | 'keys';

const SECTIONS: Array<{ id: LabSection; label: string }> = [
  { id: 'scheduler', label: 'Scheduler' },
  { id: 'storage', label: 'Storage' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'devtools', label: 'DevTools' },
  { id: 'keys', label: 'API Keys' },
];

export default function LabScreen() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [initLoading, setInitLoading] = useState(true);
  const [section, setSection] = useState<LabSection>('scheduler');
  const [toast, setToast] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  // 4. Scheduler state
  const [jobName, setJobName] = useState('cleanup-cache');
  const [jobSchedule, setJobSchedule] = useState('every 15 minutes');
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [jobHistory, setJobHistory] = useState<JobRunRecord[]>([]);

  // 5. Storage state
  const [blobKey, setBlobKey] = useState('notes/hello.txt');
  const [blobText, setBlobText] = useState('Hello from local-lite BlobStorage!');
  const [blobs, setBlobs] = useState<BlobRecord[]>([]);

  // 6. Maintenance & Portability state
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [exportJson, setExportJson] = useState('');

  // 7. DevTools state
  const [benchmarkVisible, setBenchmarkVisible] = useState(false);

  // 8. API Keys & Signed Tokens state
  const [keyName, setKeyName] = useState('Mobile Client Key');
  const [keyPrefix, setKeyPrefix] = useState('ll_test');
  const [lastRawKey, setLastRawKey] = useState('');
  const [verifyKeyInput, setVerifyKeyInput] = useState('');
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [tokenSecret, setTokenSecret] = useState('super-secret-demo-key');
  const [signedToken, setSignedToken] = useState('');
  const [tokenVerifyResult, setTokenVerifyResult] = useState('');

  // Reusable bottom sheet preview
  const [sheetPreview, setSheetPreview] = useState<{
    title: string;
    body: string;
  } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    if (Platform.OS !== 'web') {
      Alert.alert(type === 'success' ? 'Success' : 'Error', text);
    }
  };

  const refreshAll = useCallback(async (c: LocalFirstClient) => {
    const [jobList, historyList, blobList, storageStats, keyList] =
      await Promise.all([
        c.scheduler.getJobs(),
        c.scheduler.getHistory(undefined, 10),
        c.storage.list(),
        c.maintenance.getStorageStats(),
        c.keys.list(),
      ]);
    setJobs(jobList);
    setJobHistory(historyList);
    setBlobs(blobList);
    setStats(storageStats);
    setApiKeys(keyList);
  }, []);

  useEffect(() => {
    let mounted = true;
    getClient()
      .then(async (c) => {
        if (!mounted) return;
        setClient(c);
        await refreshAll(c);
        setInitLoading(false);
      })
      .catch((err) => {
        if (!mounted) return;
        setInitLoading(false);
        showToast('Failed to initialize client: ' + err.message, 'error');
      });

    return () => {
      mounted = false;
    };
  }, [refreshAll]);

  // Scheduler actions
  const handleRegisterJob = async () => {
    if (!client || !jobName.trim() || !jobSchedule.trim()) return;
    try {
      const id = jobName.trim().toLowerCase().replace(/\s+/g, '-');
      await client.scheduler.register({
        id,
        name: jobName.trim(),
        schedule: jobSchedule.trim(),
        handler: async (job) => {
          console.log(`[scheduler] Ran job ${job.id} at ${new Date().toISOString()}`);
        },
      });
      await refreshAll(client);
      showToast(`Registered job "${id}"`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to register job', 'error');
    }
  };

  const handleTriggerJob = async (jobId: string) => {
    if (!client) return;
    try {
      client.scheduler.setHandler(jobId, async () => {});
      const run = await client.scheduler.trigger(jobId);
      await refreshAll(client);
      showToast(`Job "${jobId}" finished: ${run.status} (${run.durationMs ?? 0}ms)`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to trigger job', 'error');
    }
  };

  // Storage actions
  const handleSaveBlob = async () => {
    if (!client || !blobKey.trim()) return;
    try {
      const record = await client.storage.save(blobKey.trim(), blobText, {
        mimeType: 'text/plain',
      });
      await refreshAll(client);
      showToast(`Saved blob "${record.key}" (${record.size} bytes)`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to save blob', 'error');
    }
  };

  const handlePreviewBlob = async (record: BlobRecord) => {
    if (!client) return;
    try {
      const result = await client.storage.get(record.key);
      const textContent = result
        ? new TextDecoder().decode(result.data)
        : '(not found)';
      setSheetPreview({
        title: record.name,
        body: [
          `Key: ${record.key}`,
          `Size: ${record.size} bytes`,
          `Status: ${record.status}`,
          `SHA-256: ${record.sha256}`,
          '',
          '--- Content ---',
          textContent,
        ].join('\n'),
      });
    } catch (err: any) {
      showToast(err?.message || 'Failed to read blob', 'error');
    }
  };

  // Maintenance & Portability actions
  const handleExportJson = async () => {
    if (!client) return;
    try {
      const json = await exportTablesToJson(client, undefined, {
        pretty: true,
        includeInternal: true,
      });
      setExportJson(json);
      setSheetPreview({
        title: 'Exported JSON Snapshot',
        body: json,
      });
    } catch (err: any) {
      showToast(err?.message || 'Export failed', 'error');
    }
  };

  const handleImportJson = async () => {
    if (!client || !exportJson.trim()) {
      showToast('Export JSON first before testing import.', 'error');
      return;
    }
    try {
      const summary = await importTablesFromJson(client, exportJson, {
        mode: 'merge',
        skipOutbox: true,
        includeInternal: true,
      });
      await refreshAll(client);
      showToast(`Imported ${summary.tables.length} tables`);
    } catch (err: any) {
      showToast(err?.message || 'Import failed', 'error');
    }
  };

  // API Keys & Signed Tokens actions
  const handleCreateApiKey = async () => {
    if (!client) return;
    try {
      const { key, record } = await client.keys.create({
        name: keyName.trim() || 'Demo Key',
        prefix: keyPrefix.trim() || 'll_test',
      });
      setLastRawKey(key);
      setVerifyKeyInput(key);
      await refreshAll(client);
      showToast(`Created key "${record.name}"`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to create API key', 'error');
    }
  };

  const handleVerifyApiKey = async () => {
    if (!client || !verifyKeyInput.trim()) return;
    const res = await client.keys.verify(verifyKeyInput.trim());
    await refreshAll(client);
    showToast(
      res.valid
        ? `Valid key: ${res.record?.name}`
        : `Invalid key: ${res.error || res.status}`,
      res.valid ? 'success' : 'error',
    );
  };

  const handleCreateToken = () => {
    try {
      const token = createSignedToken({
        secret: tokenSecret,
        payload: { role: 'admin', demo: true },
        expiresInMs: 5 * 60 * 1000,
      });
      setSignedToken(token);
      setTokenVerifyResult('');
      showToast('Signed token created (5m TTL)');
    } catch (err: any) {
      showToast(err?.message || 'Failed to sign token', 'error');
    }
  };

  const handleVerifyToken = () => {
    const res = verifySignedToken(signedToken, tokenSecret);
    setTokenVerifyResult(JSON.stringify(res, null, 2));
  };

  if (initLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0284c7" />
        <Text style={styles.loadingText}>Initializing local-lite Lab...</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <KeyboardScrollView
        style={[styles.container, sheetPreview !== null && styles.blurredContent]}
        contentContainerStyle={styles.content}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subTabRow}
        >
          {SECTIONS.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.subTab,
                section === item.id && styles.subTabActive,
              ]}
              onPress={() => setSection(item.id)}
            >
              <Text
                style={[
                  styles.subTabText,
                  section === item.id && styles.subTabTextActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {toast && (
          <View
            style={[
              styles.toast,
              toast.type === 'error' ? styles.toastError : styles.toastSuccess,
            ]}
          >
            <Text
              style={[
                styles.toastText,
                toast.type === 'error'
                  ? styles.toastTextError
                  : styles.toastTextSuccess,
              ]}
            >
              {toast.text}
            </Text>
          </View>
        )}

        {section === 'scheduler' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Offline Job Scheduler & Cron</Text>
              <Text style={styles.cardSubtitle}>
                Persistent jobs via client.scheduler (human intervals or 5-part cron).
              </Text>
              <Text style={styles.label}>Job Name / ID</Text>
              <TextInput
                style={styles.input}
                value={jobName}
                onChangeText={setJobName}
                placeholder="cleanup-cache"
              />
              <Text style={styles.label}>Schedule</Text>
              <TextInput
                style={styles.input}
                value={jobSchedule}
                onChangeText={setJobSchedule}
                placeholder="every 15 minutes | hourly | daily"
              />
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleRegisterJob}
              >
                <Text style={styles.primaryButtonText}>Register Job</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Jobs ({jobs.length})</Text>
              {jobs.length === 0 ? (
                <Text style={styles.emptyText}>No scheduled jobs yet.</Text>
              ) : (
                jobs.map((job) => (
                  <View key={job.id} style={styles.listItem}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.itemTitle}>{job.name}</Text>
                      <Text style={styles.badgeText}>
                        {job.enabled ? 'ENABLED' : 'PAUSED'}
                      </Text>
                    </View>
                    <Text style={styles.metaText}>
                      Schedule: {job.schedule} ({job.intervalMs}ms)
                    </Text>
                    <View style={styles.buttonRow}>
                      <TouchableOpacity
                        style={styles.smallBtn}
                        onPress={() => handleTriggerJob(job.id)}
                      >
                        <Text style={styles.smallBtnText}>Run Now</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.smallOutlineBtn}
                        onPress={async () => {
                          if (!client) return;
                          if (job.enabled) {
                            await client.scheduler.disable(job.id);
                          } else {
                            await client.scheduler.enable(job.id);
                          }
                          await refreshAll(client);
                        }}
                      >
                        <Text style={styles.smallOutlineBtnText}>
                          {job.enabled ? 'Disable' : 'Enable'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.smallDangerBtn}
                        onPress={async () => {
                          if (!client) return;
                          await client.scheduler.unregister(job.id);
                          await refreshAll(client);
                        }}
                      >
                        <Text style={styles.smallDangerBtnText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent Runs ({jobHistory.length})</Text>
              {jobHistory.length === 0 ? (
                <Text style={styles.emptyText}>No job runs recorded yet.</Text>
              ) : (
                jobHistory.map((run) => (
                  <View key={run.id} style={styles.listItem}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.itemTitle}>{run.jobId}</Text>
                      <Text style={styles.badgeText}>{run.status}</Text>
                    </View>
                    <Text style={styles.metaText}>
                      Duration: {run.durationMs ?? 0}ms |{' '}
                      {new Date(run.startedAt).toLocaleTimeString()}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </>
        )}

        {section === 'storage' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Offline Media & Blob Storage</Text>
              <Text style={styles.cardSubtitle}>
                Stores blobs locally via client.storage with SHA-256 verification.
              </Text>
              <Text style={styles.label}>Blob Key</Text>
              <TextInput
                style={styles.input}
                value={blobKey}
                onChangeText={setBlobKey}
                autoCapitalize="none"
              />
              <Text style={styles.label}>Content</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={blobText}
                onChangeText={setBlobText}
                multiline
              />
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleSaveBlob}
              >
                <Text style={styles.primaryButtonText}>Save Blob</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Stored Blobs ({blobs.length})</Text>
              {blobs.length === 0 ? (
                <Text style={styles.emptyText}>No blobs saved yet.</Text>
              ) : (
                blobs.map((b) => (
                  <View key={b.id} style={styles.listItem}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.itemTitle}>{b.key}</Text>
                      <Text style={styles.badgeText}>{b.status}</Text>
                    </View>
                    <Text style={styles.metaText}>
                      {b.size} bytes | {b.mimeType}
                    </Text>
                    <View style={styles.buttonRow}>
                      <TouchableOpacity
                        style={styles.smallBtn}
                        onPress={() => handlePreviewBlob(b)}
                      >
                        <Text style={styles.smallBtnText}>Inspect</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.smallDangerBtn}
                        onPress={async () => {
                          if (!client) return;
                          await client.storage.delete(b.key);
                          await refreshAll(client);
                        }}
                      >
                        <Text style={styles.smallDangerBtnText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}

        {section === 'maintenance' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Database Maintenance</Text>
              {stats ? (
                <View style={styles.statsBox}>
                  <Text style={styles.metaText}>
                    Total Size: {(stats.databaseSizeBytes / 1024).toFixed(1)} KB
                  </Text>
                  <Text style={styles.metaText}>
                    Tables: {Object.keys(stats.tables).length} | Outbox:{' '}
                    {stats.outbox.pending} pending,{' '}
                    {stats.outbox.completed} completed,{' '}
                    {stats.outbox.failed} failed
                  </Text>
                </View>
              ) : null}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.smallBtn}
                  onPress={async () => {
                    if (!client) return;
                    await client.maintenance.vacuum();
                    await refreshAll(client);
                    showToast('VACUUM completed');
                  }}
                >
                  <Text style={styles.smallBtnText}>VACUUM</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.smallOutlineBtn}
                  onPress={async () => {
                    if (!client) return;
                    await client.maintenance.checkpoint();
                    await refreshAll(client);
                    showToast('WAL checkpoint completed');
                  }}
                >
                  <Text style={styles.smallOutlineBtnText}>Checkpoint</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.smallOutlineBtn}
                  onPress={async () => {
                    if (!client) return;
                    const count = await client.maintenance.pruneOutbox({
                      beforeTimestamp: Date.now(),
                    });
                    await refreshAll(client);
                    showToast(`Pruned ${count} outbox rows`);
                  }}
                >
                  <Text style={styles.smallOutlineBtnText}>Prune Outbox</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Data Portability (JSON)</Text>
              <Text style={styles.cardSubtitle}>
                Export all SQLite tables to JSON and preview or re-import them.
              </Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleExportJson}
                >
                  <Text style={styles.primaryButtonText}>Export & Preview JSON</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.smallOutlineBtn}
                  onPress={handleImportJson}
                >
                  <Text style={styles.smallOutlineBtnText}>Re-Import</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        {section === 'devtools' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>DevTools & Benchmarks</Text>
            <Text style={styles.cardSubtitle}>
              Live SyncInspector and SQLite ACID/throughput benchmark suite.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setBenchmarkVisible(true)}
            >
              <Text style={styles.primaryButtonText}>Open BenchmarkModal</Text>
            </TouchableOpacity>
            <View style={styles.inspectorWrap}>
              <SyncInspector
                client={client}
                position="inline"
                alwaysVisible
                enableBenchmark
                onOpenBenchmark={() => setBenchmarkVisible(true)}
              />
            </View>
            <BenchmarkModal
              client={client}
              visible={benchmarkVisible}
              onDismiss={() => setBenchmarkVisible(false)}
            />
          </View>
        )}

        {section === 'keys' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>API Keys</Text>
              <Text style={styles.label}>Key Name</Text>
              <TextInput
                style={styles.input}
                value={keyName}
                onChangeText={setKeyName}
              />
              <Text style={styles.label}>Prefix</Text>
              <TextInput
                style={styles.input}
                value={keyPrefix}
                onChangeText={setKeyPrefix}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleCreateApiKey}
              >
                <Text style={styles.primaryButtonText}>Generate API Key</Text>
              </TouchableOpacity>
              {lastRawKey ? (
                <Text style={styles.codeBox}>{lastRawKey}</Text>
              ) : null}

              <Text style={styles.label}>Verify Raw Key</Text>
              <TextInput
                style={styles.input}
                value={verifyKeyInput}
                onChangeText={setVerifyKeyInput}
                autoCapitalize="none"
                placeholder="Paste raw API key..."
              />
              <TouchableOpacity
                style={styles.smallBtn}
                onPress={handleVerifyApiKey}
              >
                <Text style={styles.smallBtnText}>Verify Key</Text>
              </TouchableOpacity>

              {apiKeys.map((k) => (
                <View key={k.id} style={styles.listItem}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.itemTitle}>{k.name}</Text>
                    <Text style={styles.badgeText}>
                      {k.revoked ? 'REVOKED' : 'ACTIVE'}
                    </Text>
                  </View>
                  <Text style={styles.metaText}>{k.display}</Text>
                  {!k.revoked && (
                    <TouchableOpacity
                      style={styles.smallDangerBtn}
                      onPress={async () => {
                        if (!client) return;
                        await client.keys.revoke(k.id);
                        await refreshAll(client);
                      }}
                    >
                      <Text style={styles.smallDangerBtnText}>Revoke</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Signed Tokens (HMAC-SHA256)</Text>
              <Text style={styles.label}>Signing Secret</Text>
              <TextInput
                style={styles.input}
                value={tokenSecret}
                onChangeText={setTokenSecret}
                autoCapitalize="none"
              />
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleCreateToken}
                >
                  <Text style={styles.primaryButtonText}>Sign Token</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.smallOutlineBtn}
                  onPress={handleVerifyToken}
                >
                  <Text style={styles.smallOutlineBtnText}>Verify</Text>
                </TouchableOpacity>
              </View>
              {signedToken ? (
                <Text style={styles.codeBox}>{signedToken}</Text>
              ) : null}
              {tokenVerifyResult ? (
                <Text style={styles.codeBox}>{tokenVerifyResult}</Text>
              ) : null}
            </View>
          </>
        )}
      </KeyboardScrollView>

      <BottomSheetModal
        visible={sheetPreview !== null}
        onClose={() => setSheetPreview(null)}
        title={sheetPreview?.title || 'Preview'}
      >
        <ScrollView style={styles.sheetScroll}>
          <Text style={styles.codeBox}>{sheetPreview?.body}</Text>
        </ScrollView>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  blurredContent: {
    filter: [{ blur: 2 }] as any,
  },
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 16,
    paddingBottom: 36,
    gap: 14,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    gap: 12,
  },
  loadingText: {
    color: '#64748b',
    fontSize: 14,
  },
  subTabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  subTab: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  subTabActive: {
    backgroundColor: '#0284c7',
  },
  subTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  subTabTextActive: {
    color: '#ffffff',
  },
  toast: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  toastSuccess: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  toastError: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  toastText: {
    fontSize: 13,
    fontWeight: '500',
  },
  toastTextSuccess: {
    color: '#166534',
  },
  toastTextError: {
    color: '#991b1b',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748b',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#ffffff',
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: '#0284c7',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  listItem: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 6,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284c7',
  },
  metaText: {
    fontSize: 12,
    color: '#475569',
  },
  emptyText: {
    color: '#64748b',
    fontSize: 13,
    fontStyle: 'italic',
  },
  smallBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
    alignItems: 'center',
  },
  smallBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  smallOutlineBtn: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
    alignItems: 'center',
  },
  smallOutlineBtnText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
  },
  smallDangerBtn: {
    borderWidth: 1,
    borderColor: '#fca5a5',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
    alignSelf: 'flex-start',
  },
  smallDangerBtnText: {
    color: '#dc2626',
    fontSize: 12,
    fontWeight: '600',
  },
  statsBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 4,
  },
  inspectorWrap: {
    marginTop: 8,
  },
  codeBox: {
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    padding: 12,
    borderRadius: 8,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  sheetScroll: {
    padding: 16,
  },
});
