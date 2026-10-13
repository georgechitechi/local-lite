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

export interface RentPayment {
  id: string;
  property_name: string;
  tenant_name: string;
  amount: number;
  due_date: string;
  status: 'PAID' | 'PENDING' | 'OVERDUE';
}

export default function PaymentsScreen() {
  const { client, setStatusMessage } = useSync();
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Form State
  const [propertyName, setPropertyName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [amount, setAmount] = useState('');

  // Live Query: Payments (Declarative reverse due_date ordering)
  const { data: payments } = useLiveQuery<RentPayment>(client, 'payments', {
    orderBy: 'due_date',
    order: 'desc',
  });

  const totalCollected = payments
    .filter((p) => p.status === 'PAID')
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  const totalPending = payments
    .filter((p) => p.status !== 'PAID')
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  const handleSave = async () => {
    if (!client || !amount.trim()) return;

    await client.insert('payments', {
      property_name: propertyName.trim() || 'Unit 4B',
      tenant_name: tenantName.trim() || 'Resident',
      amount: parseFloat(amount) || 1500,
      due_date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      }),
      status: 'PENDING',
    });

    setPropertyName('');
    setTenantName('');
    setAmount('');
    setIsAddOpen(false);
    setStatusMessage(`💵 Created rent invoice (0ms local write)`);
  };

  const handleToggleStatus = async (item: RentPayment) => {
    if (!client) return;
    const nextStatus: RentPayment['status'] = item.status === 'PAID' ? 'PENDING' : 'PAID';
    await client.update('payments', item.id, { status: nextStatus });
    setStatusMessage(`Payment marked as ${nextStatus}`);
  };

  const handleDelete = async (id: string) => {
    if (!client) return;
    await client.delete('payments', id);
    setStatusMessage(`Deleted payment invoice.`);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#090D16" />
      <HeaderBar />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* KPI Financial Overview */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>COLLECTED</Text>
            <Text style={styles.kpiValue}>${totalCollected.toLocaleString()}</Text>
            <Text style={styles.kpiSub}>Paid to date</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>RECEIVABLES</Text>
            <Text style={[styles.kpiValue, totalPending > 0 ? styles.kpiHighlight : null]}>
              ${totalPending.toLocaleString()}
            </Text>
            <Text style={styles.kpiSub}>Pending collection</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>INVOICES</Text>
            <Text style={styles.kpiValue}>{payments.length}</Text>
            <Text style={styles.kpiSub}>Total records</Text>
          </View>
        </View>

        {/* Section Header */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Rent Invoices & Ledgers</Text>
          <TouchableOpacity style={styles.addBtn} onPress={() => setIsAddOpen(true)}>
            <Text style={styles.addBtnText}>+ New Invoice</Text>
          </TouchableOpacity>
        </View>

        {/* Payments List */}
        {payments.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No payments recorded</Text>
            <Text style={styles.emptyText}>
              Create rent collection invoices to track payments with instant offline synchronization.
            </Text>
            <TouchableOpacity style={styles.addBtn} onPress={() => setIsAddOpen(true)}>
              <Text style={styles.addBtnText}>+ Create First Invoice</Text>
            </TouchableOpacity>
          </View>
        ) : (
          payments.map((p) => (
            <View key={p.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleCol}>
                  <Text style={styles.cardTitle}>{p.property_name}</Text>
                  <Text style={styles.cardSubtitle}>
                    Tenant: {p.tenant_name} • Due: {p.due_date}
                  </Text>
                </View>
                <Text style={styles.amountText}>${(p.amount || 0).toLocaleString()}</Text>
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={[
                    styles.statusPill,
                    p.status === 'PAID' ? styles.statusPaid : styles.statusPending,
                  ]}
                  onPress={() => handleToggleStatus(p)}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      p.status === 'PAID' ? styles.statusPaidText : styles.statusPendingText,
                    ]}
                  >
                    {p.status === 'PAID' ? '✓ PAID' : 'PENDING (Tap to Mark Paid)'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.deletePill} onPress={() => handleDelete(p.id)}>
                  <Text style={styles.deletePillText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Modal: Add Payment */}
      <Modal visible={isAddOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Record Rent Invoice</Text>

            <TextInput
              style={styles.input}
              placeholder="Unit / Building Name"
              placeholderTextColor="#64748B"
              value={propertyName}
              onChangeText={setPropertyName}
            />
            <TextInput
              style={styles.input}
              placeholder="Tenant / Resident Name"
              placeholderTextColor="#64748B"
              value={tenantName}
              onChangeText={setTenantName}
            />
            <TextInput
              style={styles.input}
              placeholder="Amount ($ USD)"
              placeholderTextColor="#64748B"
              keyboardType="numeric"
              value={amount}
              onChangeText={setAmount}
            />

            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsAddOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.saveText}>Save Invoice (0ms Write)</Text>
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
  kpiValue: { fontSize: 18, fontWeight: '800', color: '#10B981', marginTop: 4 },
  kpiHighlight: { color: '#F59E0B' },
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
  amountText: { fontSize: 17, fontWeight: '800', color: '#10B981' },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  statusPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  statusPaid: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  statusPaidText: { color: '#10B981', fontWeight: '700', fontSize: 11 },
  statusPending: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  statusPendingText: { color: '#F59E0B', fontWeight: '700', fontSize: 11 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
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
