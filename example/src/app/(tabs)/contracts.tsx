import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { generateUUID, type LocalFirstClient } from 'local-lite';
import { useLiveQuery } from 'local-lite/react';
import { BottomSheetModal } from '../../components/BottomSheetModal';
import { ActionMenuSheet, type ActionMenuItem } from '../../components/ActionMenuSheet';
import { getClient } from '../../lib/sync';

interface ContractWithRelations {
  id: string;
  house_id: string;
  tenant_id: string | null;
  rent_amount: number;
  balance_due: number;
  status: string;
  start_date: string;
  houses?: { id: string; house_number: string } | null;
  tenants?: { id: string; name: string; phone: string } | null;
  receipts?: Array<{ id: string; amount: number }>;
}

export default function ContractsScreen() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [items, setItems] = useState<ContractWithRelations[]>([]);
  const [activeOnly, setActiveOnly] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedHouseId, setSelectedHouseId] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [rentAmount, setRentAmount] = useState('25000');
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    title: string;
    actions: ActionMenuItem[];
  }>({ visible: false, title: '', actions: [] });

  useEffect(() => {
    getClient().then(setClient);
  }, []);

  const { data: houses } = useLiveQuery(client, 'houses', { orderBy: 'house_number', order: 'asc' });
  const { data: tenants } = useLiveQuery(client, 'tenants', { orderBy: 'name', order: 'asc' });
  const { data: contracts } = useLiveQuery(client, 'contracts', { orderBy: 'created_at', order: 'desc' });
  const { data: receipts } = useLiveQuery(client, 'receipts');

  const loadContracts = useCallback(async () => {
    if (!client) return;
    const qb = client
      .from<ContractWithRelations>('contracts')
      .with('houses', 'tenants', 'receipts')
      .orderBy('created_at', 'desc');
    if (activeOnly) {
      qb.whereNot({ status: 'TERMINATED' });
    }
    const rows = await qb.execute();
    setItems(rows);
  }, [activeOnly, client]);

  useEffect(() => {
    void loadContracts();
  }, [loadContracts, contracts, receipts]);

  const openCreate = () => {
    setEditingId(null);
    const defaultHouse = houses[0];
    setSelectedHouseId(defaultHouse?.id ?? '');
    setSelectedTenantId(tenants[0]?.id ?? '');
    setRentAmount(String(defaultHouse?.rent ?? 25000));
    setModalVisible(true);
  };

  const openEdit = (c: ContractWithRelations) => {
    setEditingId(c.id);
    setSelectedHouseId(c.house_id);
    setSelectedTenantId(c.tenant_id ?? '');
    setRentAmount(String(c.rent_amount));
    setModalVisible(true);
  };

  const handleSaveContract = async () => {
    if (!client || !selectedHouseId || !selectedTenantId) return;
    const numericRent = Number(rentAmount) || 20000;
    if (editingId) {
      await client.update('contracts', editingId, {
        house_id: selectedHouseId,
        tenant_id: selectedTenantId,
        rent_amount: numericRent,
      });
    } else {
      await client.insert('contracts', {
        id: generateUUID(),
        house_id: selectedHouseId,
        tenant_id: selectedTenantId,
        rent_amount: numericRent,
        balance_due: numericRent,
        status: 'ACTIVE',
        start_date: new Date().toISOString().slice(0, 10),
        created_at: Date.now(),
      });
      await client.update('houses', selectedHouseId, { status: 'OCCUPIED' });
    }
    setModalVisible(false);
  };

  const handleToggleStatus = async (c: ContractWithRelations) => {
    if (!client) return;
    const next = c.status === 'ACTIVE' ? 'TERMINATED' : 'ACTIVE';
    await client.update('contracts', c.id, { status: next });
  };

  const handleDelete = async (id: string) => {
    if (!client) return;
    await client.delete('contracts', id);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.rowBetween}>
          <TouchableOpacity style={styles.primaryBtn} onPress={openCreate}>
            <Text style={styles.primaryBtnText}>+ New Contract</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pill, activeOnly && styles.pillActive]}
            onPress={() => setActiveOnly(!activeOnly)}
          >
            <Text style={[styles.pillText, activeOnly && styles.pillTextActive]}>
              {activeOnly ? 'Active Only (.whereNot) ✓' : 'Filter Active (.whereNot)'}
            </Text>
          </TouchableOpacity>
        </View>

        {items.map((c) => (
          <View key={c.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemTitle}>
                Unit {c.houses?.house_number ?? c.house_id} — {c.tenants?.name ?? 'Unassigned'} [{c.status}]
              </Text>
              <TouchableOpacity
                style={styles.ellipsisBtn}
                onPress={() =>
                  setMenuState({
                    visible: true,
                    title: `Unit ${c.houses?.house_number ?? c.house_id}`,
                    actions: [
                      { label: 'Edit Contract', onPress: () => openEdit(c) },
                      {
                        label: c.status === 'ACTIVE' ? 'Terminate Lease' : 'Reactivate Lease',
                        onPress: () => handleToggleStatus(c),
                      },
                      {
                        label: 'Delete Contract',
                        destructive: true,
                        onPress: () => handleDelete(c.id),
                      },
                    ],
                  })
                }
              >
                <Text style={styles.ellipsisText}>⋮</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.itemMeta}>
              Rent: KES {c.rent_amount.toLocaleString()} • Balance: KES {(c.balance_due ?? 0).toLocaleString()} • Receipts: {c.receipts?.length ?? 0}
            </Text>
          </View>
        ))}
      </ScrollView>

      <BottomSheetModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        title={editingId ? 'Edit Lease Contract' : 'New Lease Contract'}
      >
        <View style={styles.modalBody}>
          <Text style={styles.label}>Select House:</Text>
          <View style={styles.wrapRow}>
            {houses.map((h: any) => (
              <TouchableOpacity
                key={h.id}
                style={[styles.pill, selectedHouseId === h.id && styles.pillActive]}
                onPress={() => {
                  setSelectedHouseId(h.id);
                  if (!editingId) setRentAmount(String(h.rent));
                }}
              >
                <Text style={[styles.pillText, selectedHouseId === h.id && styles.pillTextActive]}>
                  {h.house_number}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Select Tenant:</Text>
          <View style={styles.wrapRow}>
            {tenants.map((t: any) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.pill, selectedTenantId === t.id && styles.pillActive]}
                onPress={() => setSelectedTenantId(t.id)}
              >
                <Text style={[styles.pillText, selectedTenantId === t.id && styles.pillTextActive]}>
                  {t.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Monthly Rent:</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={rentAmount} onChangeText={setRentAmount} />

          <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveContract}>
            <Text style={styles.primaryBtnText}>
              {editingId ? 'Update Contract' : 'Create Lease Contract'}
            </Text>
          </TouchableOpacity>
        </View>
      </BottomSheetModal>

      <ActionMenuSheet
        visible={menuState.visible}
        title={menuState.title}
        actions={menuState.actions}
        onClose={() => setMenuState((prev) => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  card: { backgroundColor: '#ffffff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 },
  modalBody: { padding: 16, gap: 10 },
  label: { fontSize: 12, fontWeight: '600', color: '#475569' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { backgroundColor: '#e2e8f0', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start' },
  pillActive: { backgroundColor: '#0284c7' },
  pillText: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
  pillTextActive: { color: '#ffffff' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: '#f8fafc' },
  primaryBtn: { backgroundColor: '#0284c7', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', flex: 1 },
  itemMeta: { fontSize: 12, color: '#64748b' },
  ellipsisBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: '#f1f5f9' },
  ellipsisText: { fontSize: 18, fontWeight: '700', color: '#334155', lineHeight: 20 },
});
