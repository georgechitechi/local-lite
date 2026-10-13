import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  StatusBar,
} from 'react-native';
import * as SQLite from 'expo-sqlite';
import { createClient } from '@supabase/supabase-js';
import {
  LocalFirstClient,
  ExpoSQLiteAdapter,
  SupabaseRemoteAdapter,
  DefaultNetworkStatusProvider,
  RemoteDBAdapter,
  SyncOperation,
  DeltaChanges,
} from 'outbox-sync';
import { SUPABASE_URL as CONFIG_URL, SUPABASE_ANON_KEY as CONFIG_KEY } from '../supabaseConfig';

interface Todo {
  id: string;
  title: string;
  completed: number;
}

interface OutboxItem {
  id: string;
  table_name: string;
  row_id: string;
  operation: string;
  status: string;
  retry_count: number;
  timestamp: number;
}

// Fallback Mock Remote Adapter for offline testing without credentials
class DemoRemoteAdapter implements RemoteDBAdapter {
  public pushedItems: SyncOperation[] = [];
  private liveSubscribers: ((changes: DeltaChanges) => void)[] = [];

  async pushChanges(operations: SyncOperation[]): Promise<boolean> {
    await new Promise((r) => setTimeout(r, 400));
    this.pushedItems.push(...operations);
    return true;
  }

  async fetchChanges(sinceTimestamp: number): Promise<DeltaChanges> {
    return { timestamp: Date.now(), changes: [] };
  }

  subscribeToLiveChanges(callback: (changes: DeltaChanges) => void): void {
    this.liveSubscribers.push(callback);
  }

  simulateIncomingServerDelta(changes: DeltaChanges): void {
    for (const sub of this.liveSubscribers) {
      sub(changes);
    }
  }
}

export default function Index() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [demoRemote, setDemoRemote] = useState<DemoRemoteAdapter | null>(null);
  const [networkProvider, setNetworkProvider] = useState<DefaultNetworkStatusProvider | null>(null);
  const expoDbRef = useRef<any>(null);

  // Supabase Configuration State
  const [supabaseUrl, setSupabaseUrl] = useState(CONFIG_URL || '');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(CONFIG_KEY || '');
  const [activeBackendName, setActiveBackendName] = useState('Demo Mock Remote');
  const [showConfig, setShowConfig] = useState(false);

  // App UI State
  const [isOnline, setIsOnline] = useState(true);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [inputText, setInputText] = useState('');
  const [statusMessage, setStatusMessage] = useState('Initializing local database...');

  // Setup client with given remote adapter
  const setupClientWithRemote = useCallback(
    async (remote: RemoteDBAdapter, backendName: string) => {
      if (!expoDbRef.current) return;

      if (client) {
        client.stop();
      }

      const net = networkProvider ?? new DefaultNetworkStatusProvider(true);
      if (!networkProvider) {
        setNetworkProvider(net);
      }

      const newClient = new LocalFirstClient({
        local: new ExpoSQLiteAdapter(expoDbRef.current),
        remote,
        network: net,
        pushIntervalMs: 4000,
        pullIntervalMs: 8000,
        conflictResolver: 'last-write-wins',
      });

      await newClient.initialize();
      setClient(newClient);
      setActiveBackendName(backendName);
      setStatusMessage(`Active Backend: ${backendName}`);
    },
    [client, networkProvider]
  );

  // 1. Initial Local Database Bootstrap
  useEffect(() => {
    async function initDb() {
      try {
        const expoDb = await SQLite.openDatabaseAsync('local_first_example.db');
        expoDbRef.current = expoDb;

        // Create application table
        await expoDb.execAsync(`
          CREATE TABLE IF NOT EXISTS todos (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            completed INTEGER DEFAULT 0
          );
        `);

        // If credentials exist in supabaseConfig.ts, connect to Supabase immediately!
        if (CONFIG_URL.trim() && CONFIG_KEY.trim()) {
          const supabase = createClient(CONFIG_URL.trim(), CONFIG_KEY.trim());
          const sbAdapter = new SupabaseRemoteAdapter(supabase, {
            tables: ['todos'],
            updatedAtColumn: 'updated_at',
            primaryKey: 'id',
          });
          await setupClientWithRemote(sbAdapter, 'Supabase Cloud (Live)');
        } else {
          const demo = new DemoRemoteAdapter();
          setDemoRemote(demo);
          await setupClientWithRemote(demo, 'Demo Mock Remote');
        }
      } catch (err: any) {
        console.error('Initialization error:', err);
        setStatusMessage(`Error initializing: ${err.message}`);
      }
    }

    initDb();
  }, []);

  // 2. Query refresher
  const refreshData = useCallback(async (engine: LocalFirstClient) => {
    try {
      const todoRows = (await engine.db.execute(
        'SELECT * FROM todos ORDER BY id DESC'
      )) as Todo[];
      setTodos(todoRows || []);

      const outboxRows = (await engine.db.execute(
        'SELECT * FROM sync_outbox ORDER BY timestamp DESC'
      )) as OutboxItem[];
      setOutbox(outboxRows || []);
    } catch (e) {
      console.error('Query error:', e);
    }
  }, []);

  // 3. Reactive Event Listeners
  useEffect(() => {
    if (!client) return;

    refreshData(client);

    const unsubTodos = client.events.on('todos', () => {
      refreshData(client);
    });

    const unsubOutbox = client.events.on('sync_outbox', () => {
      refreshData(client);
    });

    return () => {
      unsubTodos();
      unsubOutbox();
    };
  }, [client, refreshData]);

  // Connect to Supabase using entered credentials
  const handleConnectSupabase = async () => {
    if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) {
      setStatusMessage('Please enter both Supabase URL and Anon Key.');
      return;
    }

    try {
      setStatusMessage('Connecting to Supabase...');
      const supabase = createClient(supabaseUrl.trim(), supabaseAnonKey.trim());
      const sbAdapter = new SupabaseRemoteAdapter(supabase, {
        tables: ['todos'],
        updatedAtColumn: 'updated_at',
        primaryKey: 'id',
      });

      await setupClientWithRemote(sbAdapter, `Supabase: ${new URL(supabaseUrl.trim()).hostname}`);
      setShowConfig(false);
      setStatusMessage('✅ Connected to Supabase! Remote push & pull are active.');
    } catch (err: any) {
      setStatusMessage(`Connection failed: ${err.message}`);
    }
  };

  // Switch back to Demo Mock Server
  const handleSwitchToDemo = async () => {
    const demo = demoRemote ?? new DemoRemoteAdapter();
    setDemoRemote(demo);
    await setupClientWithRemote(demo, 'Demo Mock Remote');
    setStatusMessage('Switched to Demo Mock Remote.');
  };

  // Add Todo (Atomic Dual-Write)
  const handleAddTodo = async () => {
    if (!client || !inputText.trim()) return;
    const id = `todo_${Date.now()}`;
    const title = inputText.trim();
    setInputText('');

    setStatusMessage(`Mutating local SQLite for "${title}"...`);

    await client.mutate('todos', id, 'INSERT', {
      title,
      completed: 0,
    });

    setStatusMessage(`Added "${title}". Instant optimistic write complete!`);
  };

  // Toggle Todo
  const handleToggleTodo = async (todo: Todo) => {
    if (!client) return;
    const newStatus = todo.completed ? 0 : 1;
    await client.mutate('todos', todo.id, 'UPDATE', {
      title: todo.title,
      completed: newStatus,
    });
  };

  // Delete Todo
  const handleDeleteTodo = async (id: string) => {
    if (!client) return;
    await client.mutate('todos', id, 'DELETE', null);
  };

  // Toggle Network Online / Offline
  const toggleNetwork = () => {
    if (!networkProvider) return;
    const nextState = !isOnline;
    setIsOnline(nextState);
    networkProvider.setOnline(nextState);
    setStatusMessage(
      nextState
        ? 'Device connected: Outbox flushing immediately!'
        : 'Device offline: Mutations will queue in Outbox.'
    );
  };

  // Simulate Server Delta (for Demo Mode)
  const handleSimulateServerChange = () => {
    if (!demoRemote) {
      setStatusMessage('Only available in Demo Mock Remote mode.');
      return;
    }
    const serverId = `server_${Date.now().toString().slice(-4)}`;
    demoRemote.simulateIncomingServerDelta({
      timestamp: Date.now(),
      changes: [
        {
          tableName: 'todos',
          rowId: serverId,
          operation: 'INSERT',
          payload: {
            title: `🌐 Server Item #${serverId}`,
            completed: 1,
          },
        },
      ],
    });
    setStatusMessage(`Simulated incoming server broadcast for ${serverId}!`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>⚡ outbox-sync</Text>
          <Text style={styles.subtitle}>Expo 57 + Local-First Sync Engine</Text>

          {/* Active Backend Badge & Config Toggle */}
          <View style={styles.backendRow}>
            <View style={styles.backendBadge}>
              <View
                style={[
                  styles.backendDot,
                  {
                    backgroundColor: activeBackendName.includes('Supabase')
                      ? '#3ECF8E'
                      : '#A855F7',
                  },
                ]}
              />
              <Text style={styles.backendText}>{activeBackendName}</Text>
            </View>

            <TouchableOpacity
              style={styles.configToggleBtn}
              onPress={() => setShowConfig(!showConfig)}
            >
              <Text style={styles.configToggleText}>
                {showConfig ? 'Close Settings ▲' : 'Supabase Settings ▼'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Collapsible Supabase Credentials Card */}
          {showConfig && (
            <View style={styles.configCard}>
              <Text style={styles.configTitle}>🔑 Supabase Credentials</Text>
              <Text style={styles.configHelp}>
                Enter your Supabase URL & Anon Key (or set them in{' '}
                <Text style={styles.codeText}>src/supabaseConfig.ts</Text>):
              </Text>

              <Text style={styles.inputLabel}>SUPABASE_URL:</Text>
              <TextInput
                style={styles.configInput}
                placeholder="https://xyzcompany.supabase.co"
                placeholderTextColor="#64748B"
                value={supabaseUrl}
                onChangeText={setSupabaseUrl}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.inputLabel}>SUPABASE_ANON_KEY:</Text>
              <TextInput
                style={styles.configInput}
                placeholder="eyJhbGciOiJIUzI1NiIsIn..."
                placeholderTextColor="#64748B"
                value={supabaseAnonKey}
                onChangeText={setSupabaseAnonKey}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />

              <View style={styles.configActionRow}>
                <TouchableOpacity
                  style={styles.connectButton}
                  onPress={handleConnectSupabase}
                >
                  <Text style={styles.connectButtonText}>Connect to Supabase</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.mockButton}
                  onPress={handleSwitchToDemo}
                >
                  <Text style={styles.mockButtonText}>Use Demo Mock</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Network Bar */}
          <View style={styles.networkBar}>
            <View style={styles.badgeContainer}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isOnline ? '#10B981' : '#EF4444' },
                ]}
              />
              <Text style={styles.badgeText}>
                {isOnline ? 'Online (Auto-Syncing)' : 'Offline (Queued)'}
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.networkButton,
                { backgroundColor: isOnline ? '#374151' : '#2563EB' },
              ]}
              onPress={toggleNetwork}
            >
              <Text style={styles.networkButtonText}>
                {isOnline ? 'Simulate Offline' : 'Go Online'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Status Message Box */}
          <View style={styles.statusBox}>
            <Text style={styles.statusText}>{statusMessage}</Text>
          </View>
        </View>

        {/* Input Section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add Record (Instant Local Mutation)</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Enter note or task..."
              placeholderTextColor="#9CA3AF"
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={handleAddTodo}
            />
            <TouchableOpacity style={styles.addButton} onPress={handleAddTodo}>
              <Text style={styles.addButtonText}>Save</Text>
            </TouchableOpacity>
          </View>

          {activeBackendName.includes('Demo') && (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleSimulateServerChange}
            >
              <Text style={styles.secondaryButtonText}>
                + Simulate Incoming Server Broadcast (Delta)
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Todo List */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Local Table: "todos"</Text>
            <Text style={styles.counterBadge}>{todos.length} items</Text>
          </View>

          {todos.length === 0 ? (
            <Text style={styles.emptyText}>No local records found. Add one above!</Text>
          ) : (
            todos.map((item) => (
              <View key={item.id} style={styles.todoRow}>
                <TouchableOpacity
                  style={styles.todoLeft}
                  onPress={() => handleToggleTodo(item)}
                >
                  <View
                    style={[
                      styles.checkbox,
                      item.completed === 1 && styles.checkboxChecked,
                    ]}
                  >
                    {item.completed === 1 && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text
                    style={[
                      styles.todoTitle,
                      item.completed === 1 && styles.todoCompleted,
                    ]}
                  >
                    {item.title}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => handleDeleteTodo(item.id)}
                >
                  <Text style={styles.deleteButtonText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* Outbox Inspector */}
        <View style={[styles.card, styles.outboxCard]}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Inspector: "sync_outbox"</Text>
            <View
              style={[
                styles.counterBadge,
                { backgroundColor: outbox.length > 0 ? '#F59E0B' : '#10B981' },
              ]}
            >
              <Text style={styles.counterBadgeText}>
                {outbox.length} pending
              </Text>
            </View>
          </View>

          <Text style={styles.outboxDescription}>
            Mutations are written here atomically. When online, SyncWorker pushes
            them to remote and clears successfully sent items.
          </Text>

          {outbox.length === 0 ? (
            <Text style={styles.outboxEmpty}>
              ✅ Outbox is clean! All mutations synced to server.
            </Text>
          ) : (
            outbox.map((row) => (
              <View key={row.id} style={styles.outboxRow}>
                <View style={styles.outboxRowHeader}>
                  <Text style={styles.outboxOp}>{row.operation}</Text>
                  <Text style={styles.outboxStatus}>{row.status}</Text>
                </View>
                <Text style={styles.outboxDetails}>
                  Row: {row.row_id} • Retries: {row.retry_count}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
  },
  backendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  backendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  backendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  backendText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '600',
  },
  configToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  configToggleText: {
    color: '#60A5FA',
    fontSize: 12,
    fontWeight: '600',
  },
  configCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#3E506B',
  },
  configTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  configHelp: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 10,
  },
  codeText: {
    color: '#38BDF8',
    fontFamily: 'monospace',
  },
  inputLabel: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  configInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#F8FAFC',
    fontSize: 12,
    marginBottom: 10,
  },
  configActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  connectButton: {
    backgroundColor: '#10B981',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
  },
  connectButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  mockButton: {
    backgroundColor: '#475569',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  mockButtonText: {
    color: '#E2E8F0',
    fontWeight: '600',
    fontSize: 13,
  },
  networkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  badgeText: {
    color: '#E2E8F0',
    fontWeight: '600',
    fontSize: 13,
  },
  networkButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  networkButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBox: {
    backgroundColor: '#172554',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#3B82F6',
  },
  statusText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F1F5F9',
  },
  counterBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  counterBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    marginTop: 10,
    marginBottom: 10,
  },
  input: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 14,
  },
  addButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 10,
    marginLeft: 8,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  secondaryButton: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#3B82F6',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryButtonText: {
    color: '#60A5FA',
    fontWeight: '600',
    fontSize: 13,
  },
  emptyText: {
    color: '#64748B',
    fontStyle: 'italic',
    paddingVertical: 12,
  },
  todoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  todoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#64748B',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  checkmark: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  todoTitle: {
    fontSize: 15,
    color: '#F8FAFC',
    flex: 1,
  },
  todoCompleted: {
    textDecorationLine: 'line-through',
    color: '#64748B',
  },
  deleteButton: {
    padding: 6,
  },
  deleteButtonText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '700',
  },
  outboxCard: {
    backgroundColor: '#131D31',
  },
  outboxDescription: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 12,
  },
  outboxEmpty: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '500',
    paddingVertical: 8,
  },
  outboxRow: {
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  outboxRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  outboxOp: {
    color: '#FBBF24',
    fontWeight: '700',
    fontSize: 12,
  },
  outboxStatus: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  outboxDetails: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 4,
  },
});
