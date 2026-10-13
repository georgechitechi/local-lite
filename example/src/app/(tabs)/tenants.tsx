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

export interface Tenant {
  id: string;
  name: string;
  email: string;
  phone: string;
  property_id?: string;
  property_name: string;
  lease_start: string;
  lease_end: string;
  rent_amount: number;
  status: 'ACTIVE' | 'PENDING' | 'FORMER';
}

export interface SimpleProperty {
  id: string;
  name: string;
  unit: string;
}

export default function TenantsScreen() {
  const { client, setStatusMessage } = useSync();
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [selectedPropertyName, setSelectedPropertyName] = useState('');
  const [rentAmount, setRentAmount] = useState('');
  const [leaseEnd, setLeaseEnd] = useState('2027-12-31');

  // Live Query: Tenants (Sorted by name with zero SQL)
  const { data: tenants } = useLiveQuery<Tenant>(client, 'tenants', {
    orderBy: 'name',
    order: 'asc',
  });

  // Live Query: Available Properties (Just the table name!)
  const { data: properties } = useLiveQuery<SimpleProperty>(client, 'properties');

  const activeCount = tenants.filter((t) => t.status === 'ACTIVE').length;
  const pendingCount = tenants.filter((t) => t.status === 'PENDING').length;

  const handleSave = async () => {
    if (!client || !name.trim()) return;

    const propName = selectedPropertyName || (properties[0] ? `${properties[0].name} ${properties[0].unit}` : 'Unit 1');
    const propId = selectedPropertyId || (properties[0]?.id ?? '');
    const rentNum = parseFloat(rentAmount) || 1800;

    // 1. Insert Tenant record
    await client.insert('tenants', {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      property_id: propId,
      property_name: propName,
      lease_start: new Date().toISOString().split('T')[0],
      lease_end: leaseEnd || '2027-12-31',
      rent_amount: rentNum,
      status: 'ACTIVE',
    });

    // 2. If property selected, mark that unit as Occupied
    if (propId) {
      await client.update('properties', propId, { status: 'Occupied' });
    }

    setName('');
    setEmail('');
    setPhone('');
    setSelectedPropertyId('');
    setSelectedPropertyName('');
    setRentAmount('');
    setIsAddOpen(false);
    setStatusMessage(`👤 Registered resident "${name}" (0ms local write)`);
  };

  const handleCycleStatus = async (item: Tenant) => {
    if (!client) return;
    const nextStatus: Tenant['status'] =
      item.status === 'ACTIVE'
        ? 'FORMER'
        : item.status === 'FORMER'
        ? 'PENDING'
        : 'ACTIVE';

    await client.update('tenants', item.id, { status: nextStatus });
    setStatusMessage(`Updated ${item.name} to ${nextStatus}`);
  };

  const handleDelete = async (id: string, tenantName: string) => {
    if (!client) return;
    await client.delete('tenants', id);
    setStatusMessage(`Removed tenant "${tenantName}"`);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#090D16" />
      <HeaderBar />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* KPI Summary */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>ACTIVE RESIDENTS</Text>
            <Text style={styles.kpiValue}>{activeCount}</Text>
            <Text style={styles.kpiSub}>Under active lease</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>APPLICANTS</Text>
            <Text style={[styles.kpiValue, pendingCount > 0 ? styles.kpiHighlight : null]}>
              {pendingCount}
            </Text>
            <Text style={styles.kpiSub}>Pending approval</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>TOTAL DIRECTORY</Text>
            <Text style={styles.kpiValue}>{tenants.length}</Text>
            <Text style={styles.kpiSub}>Residents on file</Text>
          </View>
        </View>

        {/* Section Header */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Tenant Directory</Text>
          <TouchableOpacity style={styles.addBtn} onPress={() => setIsAddOpen(true)}>
            <Text style={styles.addBtnText}>+ New Tenant</Text>
          </TouchableOpacity>
        </View>

        {/* Tenants List */}
        {tenants.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No tenants registered</Text>
            <Text style={styles.emptyText}>
              Add tenants to assign them to rental units and track leases offline.
            </Text>
            <TouchableOpacity style={styles.addBtn} onPress={() => setIsAddOpen(true)}>
              <Text style={styles.addBtnText}>+ Add First Tenant</Text>
            </TouchableOpacity>
          </View>
        ) : (
          tenants.map((t) => (
            <View key={t.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleCol}>
                  <Text style={styles.cardTitle}>{t.name}</Text>
                  <Text style={styles.cardSubtitle}>
                    {t.property_name || 'Unassigned Unit'}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => handleCycleStatus(t)}
                  style={[
                    styles.statusBadge,
                    t.status === 'ACTIVE'
                      ? styles.statusActive
                      : t.status === 'PENDING'
                      ? styles.statusPending
                      : styles.statusFormer,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      t.status === 'ACTIVE'
                        ? styles.statusActiveText
                        : t.status === 'PENDING'
                        ? styles.statusPendingText
                        : styles.statusFormerText,
                    ]}
                  >
                    {t.status}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.contactRow}>
                {t.email ? <Text style={styles.contactText}>✉️ {t.email}</Text> : null}
                {t.phone ? (
                  <Text style={[styles.contactText, { marginLeft: 12 }]}>📞 {t.phone}</Text>
                ) : null}
              </View>

              <View style={styles.leaseRow}>
                <Text style={styles.leaseLabel}>Rent:</Text>
                <Text style={styles.leaseVal}>${(t.rent_amount || 0).toLocaleString()}/mo</Text>
                <Text style={[styles.leaseLabel, { marginLeft: 16 }]}>Lease Ends:</Text>
                <Text style={styles.leaseVal}>{t.lease_end || 'Month-to-month'}</Text>
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.actionPill}
                  onPress={() => handleCycleStatus(t)}
                >
                  <Text style={styles.actionPillText}>Status: {t.status} (Tap to change)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deletePill}
                  onPress={() => handleDelete(t.id, t.name)}
                >
                  <Text style={styles.deletePillText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Add Tenant Modal */}
      <Modal visible={isAddOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Register Resident / Tenant</Text>

            <TextInput
              style={styles.input}
              placeholder="Full Name (e.g. Alexander Wright)"
              placeholderTextColor="#64748B"
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={styles.input}
              placeholder="Email Address"
              placeholderTextColor="#64748B"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="Phone Number"
              placeholderTextColor="#64748B"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <TextInput
              style={styles.input}
              placeholder="Monthly Rent ($ USD)"
              placeholderTextColor="#64748B"
              keyboardType="numeric"
              value={rentAmount}
              onChangeText={setRentAmount}
            />
            <TextInput
              style={styles.input}
              placeholder="Lease End Date (YYYY-MM-DD)"
              placeholderTextColor="#64748B"
              value={leaseEnd}
              onChangeText={setLeaseEnd}
            />

            {/* Select Unit */}
            {properties.length > 0 ? (
              <View style={{ marginBottom: 10 }}>
                <Text style={styles.selectLabel}>Assign to Rental Unit:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                  {properties.map((p) => {
                    const label = `${p.name} ${p.unit}`;
                    const isSelected = selectedPropertyId === p.id;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.unitChip, isSelected ? styles.unitChipActive : null]}
                        onPress={() => {
                          setSelectedPropertyId(p.id);
                          setSelectedPropertyName(label);
                        }}
                      >
                        <Text style={[styles.unitChipText, isSelected ? styles.unitChipTextActive : null]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsAddOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.saveText}>Save Resident (0ms Write)</Text>
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
  kpiHighlight: { color: '#38BDF8' },
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
  cardSubtitle: { fontSize: 12, color: '#38BDF8', marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  statusActiveText: { color: '#10B981', fontSize: 11, fontWeight: '700' },
  statusPending: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  statusPendingText: { color: '#38BDF8', fontSize: 11, fontWeight: '700' },
  statusFormer: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    borderWidth: 1,
    borderColor: '#64748B',
  },
  statusFormerText: { color: '#94A3B8', fontSize: 11, fontWeight: '700' },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  contactText: { fontSize: 12, color: '#94A3B8' },
  leaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  leaseLabel: { fontSize: 12, color: '#6B7280' },
  leaseVal: { fontSize: 12, fontWeight: '600', color: '#E2E8F0', marginLeft: 4 },
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
  deletePill: { paddingHorizontal: 8, paddingVertical: 6 },
  deletePillText: { color: '#EF4444', fontSize: 11, fontWeight: '600' },
  selectLabel: { fontSize: 12, color: '#94A3B8', fontWeight: '600' },
  unitChip: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  unitChipActive: { backgroundColor: '#2563EB', borderColor: '#3B82F6' },
  unitChipText: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  unitChipTextActive: { color: '#FFFFFF', fontWeight: '700' },
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
