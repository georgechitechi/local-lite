import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLiveQuery } from 'outbox-sync/react';
import { useSync } from '../../context/SyncContext';
import { HeaderBar } from '../../components/HeaderBar';

export interface MaintenanceTicket {
  id: string;
  property_name: string;
  title: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED';
  estimated_cost: number;
  reported_date: string;
}

export default function MaintenanceScreen() {
  const { client, setStatusMessage } = useSync();
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Form State
  const [property, setProperty] = useState('');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');
  const [cost, setCost] = useState('');

  // Live Query: Maintenance Requests
  const { data: tickets } = useLiveQuery<MaintenanceTicket>(client, 'maintenance_requests', async (c) => {
    const rows = (await c.db.execute('SELECT * FROM maintenance_requests')) as MaintenanceTicket[];
    return rows.sort((a, b) => (b.priority === 'HIGH' ? 1 : 0) - (a.priority === 'HIGH' ? 1 : 0));
  });

  const highPriorityCount = tickets.filter((t) => t.priority === 'HIGH' && t.status !== 'RESOLVED').length;
  const inProgressCount = tickets.filter((t) => t.status === 'IN_PROGRESS').length;
  const resolvedCount = tickets.filter((t) => t.status === 'RESOLVED').length;

  const handleSave = async () => {
    if (!client || !title.trim()) return;

    await client.insert('maintenance_requests', {
      property_name: property.trim() || 'Unit 4B',
      title: title.trim(),
      priority,
      status: 'PENDING',
      estimated_cost: parseFloat(cost) || 120,
      reported_date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      }),
    });

    setProperty('');
    setTitle('');
    setCost('');
    setIsAddOpen(false);
    setStatusMessage(`🔧 Logged maintenance request "${title}" (0ms write)`);
  };

  const handleCycleStatus = async (item: MaintenanceTicket) => {
    if (!client) return;
    const nextStatus: MaintenanceTicket['status'] =
      item.status === 'PENDING'
        ? 'IN_PROGRESS'
        : item.status === 'IN_PROGRESS'
        ? 'RESOLVED'
        : 'PENDING';

    await client.update('maintenance_requests', item.id, { status: nextStatus });
    setStatusMessage(`Work order updated to ${nextStatus}`);
  };

  const handleDelete = async (id: string) => {
    if (!client) return;
    await client.delete('maintenance_requests', id);
    setStatusMessage(`Deleted repair ticket.`);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#090D16" />
      <HeaderBar />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* KPI Summary */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>HIGH PRIORITY</Text>
            <Text style={[styles.kpiValue, highPriorityCount > 0 ? styles.kpiAlert : null]}>
              {highPriorityCount}
            </Text>
            <Text style={styles.kpiSub}>Urgent attention</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>IN PROGRESS</Text>
            <Text style={styles.kpiValue}>{inProgressCount}</Text>
            <Text style={styles.kpiSub}>Under repair</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>RESOLVED</Text>
            <Text style={styles.kpiValue}>{resolvedCount}</Text>
            <Text style={styles.kpiSub}>Completed</Text>
          </View>
        </View>

        {/* Section Header */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Maintenance & Work Orders</Text>
          <TouchableOpacity style={styles.addBtn} onPress={() => setIsAddOpen(true)}>
            <Text style={styles.addBtnText}>+ Log Ticket</Text>
          </TouchableOpacity>
        </View>

        {/* Tickets List */}
        {tickets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No repairs requested</Text>
            <Text style={styles.emptyText}>
              All rental units are currently running with zero maintenance issues.
            </Text>
            <TouchableOpacity style={styles.addBtn} onPress={() => setIsAddOpen(true)}>
              <Text style={styles.addBtnText}>+ Log First Ticket</Text>
            </TouchableOpacity>
          </View>
        ) : (
          tickets.map((t) => (
            <View key={t.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleCol}>
                  <Text style={styles.cardTitle}>{t.title}</Text>
                  <Text style={styles.cardSubtitle}>{t.property_name}</Text>
                </View>
                <View
                  style={[
                    styles.priorityBadge,
                    t.priority === 'HIGH'
                      ? styles.priorityHigh
                      : t.priority === 'MEDIUM'
                      ? styles.priorityMed
                      : styles.priorityLow,
                  ]}
                >
                  <Text style={styles.priorityText}>{t.priority}</Text>
                </View>
              </View>

              <View style={styles.detailsRow}>
                <Text style={styles.detailLabel}>Est. Cost:</Text>
                <Text style={styles.detailVal}>${t.estimated_cost}</Text>
                <Text style={[styles.detailLabel, { marginLeft: 16 }]}>Date:</Text>
                <Text style={styles.detailVal}>{t.reported_date}</Text>
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={[
                    styles.actionPill,
                    t.status === 'RESOLVED' ? styles.statusSuccess : styles.actionPill,
                  ]}
                  onPress={() => handleCycleStatus(t)}
                >
                  <Text
                    style={[
                      styles.actionPillText,
                      t.status === 'RESOLVED' ? styles.statusSuccessText : null,
                    ]}
                  >
                    Status: {t.status} (Tap to advance)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.deletePill} onPress={() => handleDelete(t.id)}>
                  <Text style={styles.deletePillText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Modal: Add Maintenance */}
      <Modal visible={isAddOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Log Work Order</Text>

            <TextInput
              style={styles.input}
              placeholder="Unit / Property Name"
              placeholderTextColor="#64748B"
              value={property}
              onChangeText={setProperty}
            />
            <TextInput
              style={styles.input}
              placeholder="Issue Description (e.g. AC fan motor failure)"
              placeholderTextColor="#64748B"
              value={title}
              onChangeText={setTitle}
            />
            <TextInput
              style={styles.input}
              placeholder="Estimated Cost ($ USD)"
              placeholderTextColor="#64748B"
              keyboardType="numeric"
              value={cost}
              onChangeText={setCost}
            />

            <View style={styles.prioritySelector}>
              {(['LOW', 'MEDIUM', 'HIGH'] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.priorityOption,
                    priority === p ? styles.priorityOptionActive : null,
                  ]}
                  onPress={() => setPriority(p)}
                >
                  <Text
                    style={[
                      styles.priorityOptionText,
                      priority === p ? styles.priorityOptionTextActive : null,
                    ]}
                  >
                    {p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsAddOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.saveText}>Log Ticket (0ms Write)</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#090D16' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  kpiRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  kpiCard: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  kpiLabel: { fontSize: 10, fontWeight: '700', color: '#6B7280' },
  kpiValue: { fontSize: 18, fontWeight: '800', color: '#F9FAFB', marginTop: 4 },
  kpiAlert: { color: '#EF4444' },
  kpiSub: { fontSize: 10, color: '#9CA3AF', marginTop: 2 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#F8FAFC' },
  addBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  emptyCard: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1F2937',
    borderStyle: 'dashed',
    marginTop: 8,
  },
  emptyTitle: { color: '#F9FAFB', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  emptyText: { color: '#9CA3AF', fontSize: 13, textAlign: 'center', marginBottom: 16 },
  card: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitleCol: { flex: 1, marginRight: 10 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#F9FAFB' },
  cardSubtitle: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  priorityHigh: { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
  priorityMed: { backgroundColor: 'rgba(245, 158, 11, 0.2)' },
  priorityLow: { backgroundColor: 'rgba(59, 130, 246, 0.2)' },
  priorityText: { fontSize: 10, fontWeight: '800', color: '#F8FAFC' },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  detailLabel: { fontSize: 12, color: '#6B7280' },
  detailVal: { fontSize: 12, fontWeight: '600', color: '#E2E8F0', marginLeft: 4 },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  actionPill: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionPillText: { color: '#E2E8F0', fontSize: 11, fontWeight: '600' },
  statusSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  statusSuccessText: { color: '#10B981', fontWeight: '700' },
  deletePill: { paddingHorizontal: 8, paddingVertical: 6 },
  deletePillText: { color: '#EF4444', fontSize: 11, fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#F9FAFB', marginBottom: 16 },
  input: {
    backgroundColor: '#1F2937',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#F9FAFB',
    fontSize: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#374151',
  },
  prioritySelector: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  priorityOption: {
    flex: 1,
    backgroundColor: '#1F2937',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  priorityOptionActive: { backgroundColor: '#2563EB', borderColor: '#3B82F6' },
  priorityOptionText: { color: '#9CA3AF', fontWeight: '700', fontSize: 12 },
  priorityOptionTextActive: { color: '#FFFFFF' },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 10 },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#374151',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelText: { color: '#E5E7EB', fontWeight: '700', fontSize: 14 },
  saveBtn: {
    flex: 2,
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
});
