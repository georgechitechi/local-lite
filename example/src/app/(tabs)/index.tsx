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
import { useLiveQuery } from 'local-lite/react';
import { useSync } from '../../context/SyncContext';
import { HeaderBar } from '../../components/HeaderBar';

export interface Property {
  id: string;
  name: string;
  unit: string;
  address: string;
  rent: number;
  status: 'Occupied' | 'Vacant' | 'Renovating';
  bedrooms: number;
  bathrooms: number;
}

export default function PropertiesScreen() {
  const { client, setStatusMessage } = useSync();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [address, setAddress] = useState('');
  const [rent, setRent] = useState('');
  const [bedrooms, setBedrooms] = useState('2');
  const [bathrooms, setBathrooms] = useState('1');

  // Reactive Live Query (Zero SQL required!)
  const { data: properties } = useLiveQuery<Property>(client, 'properties', {
    orderBy: 'name',
    order: 'asc',
  });

  const totalRentRoll = properties.reduce(
    (sum, p) => sum + (p.status === 'Occupied' ? p.rent : 0),
    0
  );
  const occupiedCount = properties.filter((p) => p.status === 'Occupied').length;
  const occupancyRate =
    properties.length > 0 ? Math.round((occupiedCount / properties.length) * 100) : 0;

  const handleOpenAdd = () => {
    setEditingProperty(null);
    setName('');
    setUnit('');
    setAddress('');
    setRent('');
    setBedrooms('2');
    setBathrooms('1');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: Property) => {
    setEditingProperty(item);
    setName(item.name || '');
    setUnit(item.unit || '');
    setAddress(item.address || '');
    setRent(item.rent ? String(item.rent) : '');
    setBedrooms(item.bedrooms ? String(item.bedrooms) : '1');
    setBathrooms(item.bathrooms ? String(item.bathrooms) : '1');
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!client || !name.trim() || !rent.trim()) return;
    const rentNum = parseFloat(rent) || 1200;

    if (editingProperty && editingProperty.id) {
      await client.update('properties', editingProperty.id, {
        name: name.trim(),
        unit: unit.trim() || 'Unit 1',
        address: address.trim() || 'Main St',
        rent: rentNum,
        status: editingProperty.status || 'Vacant',
        bedrooms: parseInt(bedrooms, 10) || 1,
        bathrooms: parseFloat(bathrooms) || 1,
      });
      setStatusMessage(`✏️ Updated property "${name.trim()}"`);
    } else {
      await client.insert('properties', {
        name: name.trim(),
        unit: unit.trim() || 'Unit 1',
        address: address.trim() || 'Main St',
        rent: rentNum,
        status: 'Vacant',
        bedrooms: parseInt(bedrooms, 10) || 1,
        bathrooms: parseFloat(bathrooms) || 1,
      });
      setStatusMessage(`🏠 Created unit "${name.trim()}"`);
    }

    setName('');
    setUnit('');
    setAddress('');
    setRent('');
    setIsModalOpen(false);
    setEditingProperty(null);
  };

  const handleToggleStatus = async (item: Property) => {
    if (!client) return;
    const nextStatus: Property['status'] = item.status === 'Occupied' ? 'Vacant' : 'Occupied';
    await client.update('properties', item.id, { status: nextStatus });
    setStatusMessage(`Updated ${item.name} status to ${nextStatus}`);
  };

  const handleDelete = async (id: string, propName: string) => {
    if (!client) return;
    await client.delete('properties', id);
    setStatusMessage(`🗑️ Removed property "${propName}"`);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#090D16" />
      <HeaderBar />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* KPI Summary Cards */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>RENT ROLL</Text>
            <Text style={styles.kpiValue}>${totalRentRoll.toLocaleString()}</Text>
            <Text style={styles.kpiSub}>Monthly occupied</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>OCCUPANCY</Text>
            <Text style={styles.kpiValue}>{occupancyRate}%</Text>
            <Text style={styles.kpiSub}>
              {occupiedCount}/{properties.length} units
            </Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>TOTAL UNITS</Text>
            <Text style={styles.kpiValue}>{properties.length}</Text>
            <Text style={styles.kpiSub}>Managed</Text>
          </View>
        </View>

        {/* Section Header */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Rental Properties & Units</Text>
          <View style={styles.actionButtonsRow}>
            <TouchableOpacity style={styles.addBtn} onPress={handleOpenAdd}>
              <Text style={styles.addBtnText}>+ Add Unit</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Units List */}
        {properties.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No properties yet</Text>
            <Text style={styles.emptyText}>
              Add your first rental unit above to test offline sync.
            </Text>
          </View>
        ) : (
          properties.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.card}
              onPress={() => handleOpenEdit(p)}
              activeOpacity={0.85}
            >
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleCol}>
                  <Text style={styles.cardTitle}>{p.name}</Text>
                  <Text style={styles.cardSubtitle}>
                    {p.unit} • {p.address}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleToggleStatus(p)}
                  style={[
                    styles.statusBadge,
                    p.status === 'Occupied' ? styles.statusOccupied : styles.statusVacant,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      p.status === 'Occupied'
                        ? styles.statusOccupiedText
                        : styles.statusVacantText,
                    ]}
                  >
                    {p.status}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.cardSpecs}>
                <Text style={styles.specLabel}>Rent:</Text>
                <Text style={styles.specVal}>${p.rent.toLocaleString()}/mo</Text>
                <Text style={[styles.specLabel, { marginLeft: 16 }]}>Layout:</Text>
                <Text style={styles.specVal}>
                  {p.bedrooms} Bed, {p.bathrooms} Bath
                </Text>
              </View>

              <View style={styles.cardActions}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={styles.actionPill}
                    onPress={() => handleToggleStatus(p)}
                  >
                    <Text style={styles.actionPillText}>
                      {p.status === 'Occupied' ? 'Mark Vacant' : 'Mark Occupied'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.editPill}
                    onPress={() => handleOpenEdit(p)}
                  >
                    <Text style={styles.editPillText}>✏️ Edit</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.deletePill}
                  onPress={() => handleDelete(p.id, p.name)}
                >
                  <Text style={styles.deletePillText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Add / Edit Modal */}
      <Modal visible={isModalOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {editingProperty ? 'Edit Rental Unit' : 'Add Rental Unit'}
            </Text>

            {editingProperty && (
              <View style={styles.editingBadge}>
                <Text style={styles.editingBadgeText}>
                  ✏️ Editing Property{editingProperty.name ? ` • ${editingProperty.name}` : ''}
                </Text>
              </View>
            )}

            <TextInput
              style={styles.input}
              placeholder="Building / Property Name"
              placeholderTextColor="#64748B"
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={styles.input}
              placeholder="Unit # (e.g. Penthouse 4B)"
              placeholderTextColor="#64748B"
              value={unit}
              onChangeText={setUnit}
            />
            <TextInput
              style={styles.input}
              placeholder="Street Address"
              placeholderTextColor="#64748B"
              value={address}
              onChangeText={setAddress}
            />
            <TextInput
              style={styles.input}
              placeholder="Monthly Rent ($ USD)"
              placeholderTextColor="#64748B"
              keyboardType="numeric"
              value={rent}
              onChangeText={setRent}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Bedrooms"
                placeholderTextColor="#64748B"
                keyboardType="numeric"
                value={bedrooms}
                onChangeText={setBedrooms}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Bathrooms"
                placeholderTextColor="#64748B"
                keyboardType="numeric"
                value={bathrooms}
                onChangeText={setBathrooms}
              />
            </View>

            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsModalOpen(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.saveText}>
                  {editingProperty ? 'Update Unit' : 'Save Unit'}
                </Text>
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
  kpiSub: { fontSize: 10, color: '#9CA3AF', marginTop: 2 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#F8FAFC' },
  actionButtonsRow: { flexDirection: 'row', gap: 8 },
  seedBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  seedBtnText: { color: '#38BDF8', fontSize: 12, fontWeight: '700' },
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
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusOccupied: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  statusOccupiedText: { color: '#10B981', fontSize: 11, fontWeight: '700' },
  statusVacant: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  statusVacantText: { color: '#F59E0B', fontSize: 11, fontWeight: '700' },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  cardSpecs: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  specLabel: { fontSize: 12, color: '#6B7280' },
  specVal: { fontSize: 12, fontWeight: '600', color: '#E5E7EB', marginLeft: 4 },
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
  editPill: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  editPillText: { color: '#38BDF8', fontSize: 11, fontWeight: '700' },
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
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#F9FAFB', marginBottom: 12 },
  editingBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  editingBadgeText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
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
