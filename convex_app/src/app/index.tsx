import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLiveQuery, useSyncStatus } from 'local-lite/react';
import { LocalFirstClient, generateUUID } from 'local-lite';
import { getSyncClient, CONVEX_URL } from '../sync.config';

export interface TaskItem {
  id: string;
  title: string;
  completed: boolean;
  updatedAt?: number;
}

export default function Index() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [inputText, setInputText] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [lastSyncedText, setLastSyncedText] = useState('First sync pending');
  const [statusMsg, setStatusMsg] = useState('Initializing Convex Local-First Engine...');

  // Edit Modal State
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [editTitle, setEditTitle] = useState('');

  useEffect(() => {
    let mounted = true;
    getSyncClient()
      .then((c) => {
        if (mounted) {
          setClient(c);
          setStatusMsg(`⚡ Connected to Convex`);
          updateCursor(c);
        }
      })
      .catch((err) => {
        setStatusMsg(`❌ Initialization error: ${err.message}`);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const updateCursor = async (c: LocalFirstClient) => {
    try {
      const ts = await c.getLastSyncedAt();
      if (ts > 0) {
        const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
        setLastSyncedText(`${secs}s ago`);
      } else {
        setLastSyncedText('First sync pending');
      }
    } catch {
      setLastSyncedText('Local only');
    }
  };

  useEffect(() => {
    if (!client) return;
    const interval = setInterval(() => {
      updateCursor(client);
    }, 2500);
    return () => clearInterval(interval);
  }, [client]);

  // 1. Reactive Live Query on local SQLite 'tasks' table
  const { data: tasks, loading } = useLiveQuery<TaskItem>(client, 'tasks', {
    orderBy: 'updatedAt',
    order: 'desc',
  });

  // 2. Sync status & pending operations queue
  const { pendingCount, pendingRecords, refresh: refreshOutbox } = useSyncStatus(client);

  // Add Task
  const handleAddTask = async () => {
    if (!client || !inputText.trim()) return;
    const title = inputText.trim();
    setInputText('');

    await client.insert('tasks', {
      id: generateUUID(),
      title,
      completed: false,
      updatedAt: Date.now(),
    });
  };

  // Toggle Completion
  const handleToggle = async (task: TaskItem) => {
    if (!client) return;
    await client.update('tasks', task.id, {
      completed: !task.completed,
      updatedAt: Date.now(),
    });
  };

  // Open Edit Modal
  const handleOpenEdit = (task: TaskItem) => {
    setEditingTask(task);
    setEditTitle(task.title);
  };

  // Save Edit in-place
  const handleSaveEdit = async () => {
    if (!client || !editingTask || !editTitle.trim()) return;
    await client.update('tasks', editingTask.id, {
      title: editTitle.trim(),
      updatedAt: Date.now(),
    });
    setEditingTask(null);
  };

  // Delete Task
  const handleDelete = async (taskId: string) => {
    if (!client) return;
    await client.delete('tasks', taskId);
  };

  // Toggle Network State (Simulation)
  const toggleNetwork = () => {
    if (!client) return;
    const nextState = !isOnline;
    setIsOnline(nextState);
    if ((client as any).network && typeof (client as any).network.setOnline === 'function') {
      (client as any).network.setOnline(nextState);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#090D16" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.brandTitle}>Convex • Local-First</Text>
          <View
            style={[
              styles.connectionPill,
              isOnline ? styles.pillOnline : styles.pillOffline,
            ]}
          >
            <Text style={styles.connectionText}>
              {isOnline ? '🟢 Connected' : '🔴 Airplane Mode'}
            </Text>
          </View>
        </View>
        <Text style={styles.statusSubtitle}>{statusMsg}</Text>
      </View>

      {/* Engine Controls & Outbox Card */}
      <View style={styles.statsCard}>
        <View style={styles.statCol}>
          <Text style={styles.statLabel}>Pending Outbox</Text>
          <Text style={styles.statVal}>{pendingCount} mutations</Text>
        </View>
        <View style={styles.statCol}>
          <Text style={styles.statLabel}>Last Pulled</Text>
          <Text style={styles.statVal}>{lastSyncedText}</Text>
        </View>
        <TouchableOpacity style={styles.toggleBtn} onPress={toggleNetwork}>
          <Text style={styles.toggleBtnText}>
            {isOnline ? '✈️ Go Offline' : '📶 Reconnect'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Add Task Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Add a new task..."
          placeholderTextColor="#6B7280"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={handleAddTask}
        />
        <TouchableOpacity
          style={[styles.addBtn, !inputText.trim() && styles.btnDisabled]}
          disabled={!inputText.trim()}
          onPress={handleAddTask}
        >
          <Text style={styles.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* Tasks List */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {loading ? (
          <ActivityIndicator color="#38BDF8" style={{ marginTop: 40 }} />
        ) : tasks.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>⚡</Text>
            <Text style={styles.emptyTitle}>Zero Tasks in SQLite</Text>
            <Text style={styles.emptySubtitle}>
              Type a task above to test atomic dual-writes. Writes commit to local SQLite
            </Text>
          </View>
        ) : (
          tasks.map((task) => {
            const isCompleted = Boolean(task.completed);
            return (
              <View key={task.id} style={styles.taskCard}>
                <TouchableOpacity
                  style={styles.checkArea}
                  onPress={() => handleToggle(task)}
                >
                  <View
                    style={[
                      styles.checkbox,
                      isCompleted && styles.checkboxActive,
                    ]}
                  >
                    {isCompleted ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                  <Text
                    style={[
                      styles.taskTitle,
                      isCompleted && styles.taskTitleDone,
                    ]}
                  >
                    {task.title}
                  </Text>
                </TouchableOpacity>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => handleOpenEdit(task)}
                  >
                    <Text style={styles.editBtnText}>✏️</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.delBtn}
                    onPress={() => handleDelete(task.id)}
                  >
                    <Text style={styles.delBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        {/* Live Outbox Inspector */}
        {pendingRecords.length > 0 ? (
          <View style={styles.outboxSection}>
            <Text style={styles.outboxTitle}>
              Outbox Queue ({pendingRecords.length} waiting to flush)
            </Text>
            {pendingRecords.map((rec) => (
              <View key={rec.id} style={styles.outboxCard}>
                <Text style={styles.outboxOp}>
                  [{rec.operation}] {rec.tableName}
                </Text>
                <Text style={styles.outboxPayload}>
                  {rec.payload ? JSON.stringify(rec.payload) : '(delete)'}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* In-Place Edit Modal */}
      <Modal
        visible={editingTask !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingTask(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>✏️ Edit Task</Text>
            <TextInput
              style={styles.modalInput}
              value={editTitle}
              onChangeText={setEditTitle}
              autoFocus
              onSubmitEditing={handleSaveEdit}
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditingTask(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveEdit}
              >
                <Text style={styles.modalSaveText}>Save Changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#090D16',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F9FAFB',
    letterSpacing: -0.5,
  },
  connectionPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pillOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  pillOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  connectionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F3F4F6',
  },
  statusSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 6,
    lineHeight: 16,
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    marginHorizontal: 16,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  statCol: {
    flex: 1,
  },
  statLabel: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  statVal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E5E7EB',
    marginTop: 2,
  },
  toggleBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  toggleBtnText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 14,
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#F9FAFB',
    fontSize: 14,
  },
  addBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  list: {
    flex: 1,
    marginTop: 14,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F3F4F6',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 18,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  checkArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4B5563',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxActive: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  taskTitle: {
    fontSize: 14,
    color: '#F9FAFB',
    fontWeight: '500',
    flex: 1,
  },
  taskTitleDone: {
    color: '#6B7280',
    textDecorationLine: 'line-through',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editBtn: {
    padding: 6,
  },
  editBtnText: {
    fontSize: 14,
  },
  delBtn: {
    padding: 6,
  },
  delBtnText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '700',
  },
  outboxSection: {
    marginTop: 20,
    padding: 14,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#F59E0B',
  },
  outboxTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F59E0B',
    marginBottom: 8,
  },
  outboxCard: {
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
  },
  outboxOp: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38BDF8',
  },
  outboxPayload: {
    fontSize: 10,
    color: '#94A3B8',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#F9FAFB',
    marginBottom: 14,
  },
  modalInput: {
    backgroundColor: '#090D16',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#F9FAFB',
    fontSize: 14,
    marginBottom: 16,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1F2937',
  },
  modalCancelText: {
    color: '#D1D5DB',
    fontWeight: '600',
    fontSize: 13,
  },
  modalSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#2563EB',
  },
  modalSaveText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
});
