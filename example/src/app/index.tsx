import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LocalFirstClient, generateUUID } from 'outbox-sync';
import { useLiveQuery, useOutboxStatus } from 'outbox-sync/react';
import { getSyncClient } from '../sync.config';

interface Todo {
  id: string;
  title: string;
  completed: number;
}

export default function Index() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [inputText, setInputText] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [statusMessage, setStatusMessage] = useState('Initializing client from sync.config.ts...');

  // 1. Initialize client using config file
  useEffect(() => {
    let mounted = true;
    getSyncClient()
      .then((c) => {
        if (mounted) {
          setClient(c);
          setStatusMessage('Engine ready! Local SQLite & SyncWorker active from config.');
        }
      })
      .catch((err) => {
        setStatusMessage(`Config error: ${err.message}`);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // 2. Built-in outbox-sync hooks for live table queries and outbox inspection
  const { data: todos } = useLiveQuery<Todo>(client, 'todos', async (c) => {
    return (await c.db.execute('SELECT * FROM todos ORDER BY id DESC')) as Todo[];
  });

  const { pendingCount, pendingRecords } = useOutboxStatus(client);

  // Add Todo (Atomic Dual-Write)
  const handleAddTodo = async () => {
    if (!client || !inputText.trim()) return;
    const id = generateUUID();
    const title = inputText.trim();
    setInputText('');

    setStatusMessage(`Mutating local SQLite for "${title}"...`);

    await client.mutate('todos', id, 'INSERT', {
      title,
      completed: 0,
    });

    setStatusMessage(`Added "${title}". Instant optimistic write complete!`);
  };

  // Toggle Todo completion
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
    if (!client) return;
    const nextState = !isOnline;
    setIsOnline(nextState);

    // Toggle client network provider safely
    const net = (client.syncWorker as any)?.network;
    if (net && typeof net.setOnline === 'function') {
      net.setOnline(nextState);
    }

    setStatusMessage(
      nextState
        ? 'Device connected: Outbox flushing immediately!'
        : 'Device offline: Mutations will queue in Outbox.'
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>⚡ outbox-sync</Text>
          <Text style={styles.subtitle}>Configured via src/sync.config.ts</Text>

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

          {/* Status Message */}
          <View style={styles.statusBox}>
            <Text style={styles.statusText}>{statusMessage}</Text>
          </View>
        </View>

        {/* Add Record Card */}
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
        </View>

        {/* Live Todos List */}
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
                { backgroundColor: pendingCount > 0 ? '#F59E0B' : '#10B981' },
              ]}
            >
              <Text style={styles.counterBadgeText}>
                {pendingCount} pending
              </Text>
            </View>
          </View>

          <Text style={styles.outboxDescription}>
            Powered by useOutboxStatus() hook. Automatically tracked in real time.
          </Text>

          {pendingCount === 0 ? (
            <Text style={styles.outboxEmpty}>
              ✅ Outbox is clean! All mutations synced to remote.
            </Text>
          ) : (
            pendingRecords.map((row) => (
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
  networkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 12,
    marginTop: 14,
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
