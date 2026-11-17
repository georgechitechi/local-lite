import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { generateUUID, type LocalFirstClient } from 'local-lite';
import { useLiveQuery } from 'local-lite/react';
import { getClient } from '../lib/sync';

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
  const [selectedHouseId, setSelectedHouseId] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

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
    if (!selectedHouseId && houses.length > 0) setSelectedHouseId(houses[0].id);
    if (!selectedTenantId && tenants.length > 0) setSelectedTenantId(tenants[0].id);
  }, [activeOnly, client, houses, selectedHouseId, selectedTenantId, tenants]);

  useEffect(() => {
    void loadContracts();
  }, [loadContracts, contracts, receipts]);

  const handleCreateContract = async () => {
    if (!client || !selectedHouseId || !selectedTenantId) return;
    const house = houses.find((h: any) => h.id === selectedHouseId);
    const rent = house?.rent ?? 20000;
    await client.insert('contracts', {
      id: generateUUID(),
      house_id: selectedHouseId,
      tenant_id: selectedTenantId,
      rent_amount: rent,
      balance_due: rent,
      status: 'ACTIVE',
      start_date: new Date().toISOString().slice(0, 10),
      created_at: Date.now(),
    });
    await client.update('houses', selectedHouseId, { status: 'OCCUPIED' });
  };

  const handleToggleStatus = async (c: ContractWithRelations) => {
    if (!client) return;
    const next = c.status === 'ACTIVE' ? 'TERMINATED' : 'ACTIVE';
    await client.update('contracts', c.id, { status: next });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>New Lease Contract</Text>
        <Text style={styles.label}>Select House:</Text>
        <View style={styles.wrapRow}>
          {houses.map((h: any) => (
            <TouchableOpacity
              key={h.id}
              style={[styles.pill, selectedHouseId === h.id && styles.pillActive]}
              onPress={() => setSelectedHouseId(h.id)}
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

        <TouchableOpacity style={styles.primaryBtn} onPress={handleCreateContract}>
          <Text style={styles.primaryBtnText}>Create Lease Contract</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.pill, activeOnly && styles.pillActive, { alignSelf: 'flex-start' }]}
        onPress={() => setActiveOnly(!activeOnly)}
      >
        <Text style={[styles.pillText, activeOnly && styles.pillTextActive]}>
          {activeOnly ? 'Active Only (.whereNot) ✓' : 'Filter Active (.whereNot)'}
        </Text>
      </TouchableOpacity>

      {items.map((c) => (
        <View key={c.id} style={styles.card}>
          <Text style={styles.itemTitle}>
            Unit {c.houses?.house_number ?? c.house_id} — {c.tenants?.name ?? 'Unassigned'} [{c.status}]
          </Text>
          <Text style={styles.itemMeta}>
            Rent: KES {c.rent_amount.toLocaleString()} • Balance: KES {(c.balance_due ?? 0).toLocaleString()} • Receipts: {c.receipts?.length ?? 0}
          </Text>
          <TouchableOpacity style={styles.pill} onPress={() => handleToggleStatus(c)}>
            <Text style={styles.pillText}>
              {c.status === 'ACTIVE' ? 'Terminate Lease' : 'Reactivate Lease'}
            </Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: '#ffffff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  label: { fontSize: 12, fontWeight: '600', color: '#475569' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { backgroundColor: '#e2e8f0', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start' },
  pillActive: { backgroundColor: '#0284c7' },
  pillText: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
  pillTextActive: { color: '#ffffff' },
  primaryBtn: { backgroundColor: '#0284c7', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  primaryBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  itemMeta: { fontSize: 12, color: '#64748b' },
});
