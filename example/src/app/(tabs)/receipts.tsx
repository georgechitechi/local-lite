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

export default function ReceiptsScreen() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [amount, setAmount] = useState('25000');
  const [method, setMethod] = useState('M-Pesa');
  const [totalCollected, setTotalCollected] = useState(0);
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    title: string;
    actions: ActionMenuItem[];
  }>({ visible: false, title: '', actions: [] });

  useEffect(() => {
    getClient().then(setClient);
  }, []);

  const { data: contracts } = useLiveQuery(client, 'contracts', {
    where: { status: 'ACTIVE' },
    orderBy: 'created_at',
    order: 'desc',
  });
  const { data: receipts } = useLiveQuery(client, 'receipts', {
    orderBy: 'paid_at',
    order: 'desc',
  });

  const refreshTotal = useCallback(async () => {
    if (!client) return;
    const sum = await client.from('receipts').sum('amount');
    setTotalCollected(sum);
  }, [client]);

  useEffect(() => {
    void refreshTotal();
  }, [refreshTotal, receipts]);

  const openCreate = () => {
    setEditingId(null);
    const first = contracts[0];
    setSelectedContractId(first?.id ?? '');
    setAmount(String(first?.rent_amount ?? 25000));
    setMethod('M-Pesa');
    setModalVisible(true);
  };

  const openEdit = (r: any) => {
    setEditingId(r.id);
    setSelectedContractId(r.contract_id);
    setAmount(String(r.amount));
    setMethod(r.method);
    setModalVisible(true);
  };

  const handleSaveReceipt = async () => {
    if (!client || !selectedContractId) return;
    const numericAmount = Number(amount) || 0;
    if (numericAmount <= 0) return;

    if (editingId) {
      await client.update('receipts', editingId, {
        amount: numericAmount,
        method: method.trim() || 'Cash',
      });
    } else {
      await client.insert('receipts', {
        id: generateUUID(),
        contract_id: selectedContractId,
        amount: numericAmount,
        method: method.trim() || 'Cash',
        paid_at: Date.now(),
      });
      const contract = contracts.find((c: any) => c.id === selectedContractId);
      if (contract) {
        await client.update('contracts', selectedContractId, {
          balance_due: Math.max(0, (contract.balance_due ?? 0) - numericAmount),
        });
      }
    }
    setModalVisible(false);
  };

  const handleDelete = async (id: string) => {
    if (!client) return;
    await client.delete('receipts', id);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>Total Rent Collected</Text>
          <Text style={styles.bannerAmount}>KES {totalCollected.toLocaleString()}</Text>
          <Text style={styles.bannerSub}>{receipts.length} receipts recorded</Text>
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={openCreate}>
          <Text style={styles.primaryBtnText}>+ Record Rent Payment</Text>
        </TouchableOpacity>

        {receipts.map((r: any) => (
          <View key={r.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemTitle}>
                KES {Number(r.amount).toLocaleString()} — {r.method}
              </Text>
              <TouchableOpacity
                style={styles.ellipsisBtn}
                onPress={() =>
                  setMenuState({
                    visible: true,
                    title: `KES ${Number(r.amount).toLocaleString()}`,
                    actions: [
                      { label: 'Edit Receipt', onPress: () => openEdit(r) },
                      {
                        label: 'Delete Receipt',
                        destructive: true,
                        onPress: () => handleDelete(r.id),
                      },
                    ],
                  })
                }
              >
                <Text style={styles.ellipsisText}>⋮</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.itemMeta}>
              Contract: {String(r.contract_id).slice(0, 8)} • {new Date(r.paid_at).toLocaleString()}
            </Text>
          </View>
        ))}
      </ScrollView>

      <BottomSheetModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        title={editingId ? 'Edit Receipt' : 'Record Rent Payment'}
      >
        <View style={styles.modalBody}>
          {!editingId && (
            <View style={styles.wrapRow}>
              {contracts.map((c: any) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.pill, selectedContractId === c.id && styles.pillActive]}
                  onPress={() => {
                    setSelectedContractId(c.id);
                    setAmount(String(c.rent_amount));
                  }}
                >
                  <Text style={[styles.pillText, selectedContractId === c.id && styles.pillTextActive]}>
                    Contract {c.id.slice(0, 6)} (KES {c.rent_amount})
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TextInput style={styles.input} placeholder="Amount" keyboardType="numeric" value={amount} onChangeText={setAmount} />
          <TextInput style={styles.input} placeholder="Payment Method (M-Pesa, Bank, Cash)" value={method} onChangeText={setMethod} />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveReceipt}>
            <Text style={styles.primaryBtnText}>
              {editingId ? 'Update Receipt' : 'Save Receipt'}
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
  banner: { backgroundColor: '#0f172a', padding: 16, borderRadius: 12, gap: 4 },
  bannerTitle: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  bannerAmount: { color: '#ffffff', fontSize: 24, fontWeight: '800' },
  bannerSub: { color: '#38bdf8', fontSize: 12 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  card: { backgroundColor: '#ffffff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 6 },
  modalBody: { padding: 16, gap: 10 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { backgroundColor: '#e2e8f0', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
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
