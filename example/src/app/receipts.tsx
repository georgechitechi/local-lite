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
import { getClient } from '../lib/sync';

export default function ReceiptsScreen() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [amount, setAmount] = useState('25000');
  const [method, setMethod] = useState('M-Pesa');
  const [totalCollected, setTotalCollected] = useState(0);

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
    if (!selectedContractId && contracts.length > 0) {
      setSelectedContractId(contracts[0].id);
    }
  }, [client, contracts, selectedContractId]);

  useEffect(() => {
    void refreshTotal();
  }, [refreshTotal, receipts]);

  const handleRecordPayment = async () => {
    if (!client || !selectedContractId) return;
    const numericAmount = Number(amount) || 0;
    if (numericAmount <= 0) return;

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
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>Total Rent Collected</Text>
        <Text style={styles.bannerAmount}>KES {totalCollected.toLocaleString()}</Text>
        <Text style={styles.bannerSub}>{receipts.length} receipts recorded</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Record Rent Payment</Text>
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
        <TextInput style={styles.input} placeholder="Amount" keyboardType="numeric" value={amount} onChangeText={setAmount} />
        <TextInput style={styles.input} placeholder="Payment Method (M-Pesa, Bank, Cash)" value={method} onChangeText={setMethod} />
        <TouchableOpacity style={styles.primaryBtn} onPress={handleRecordPayment}>
          <Text style={styles.primaryBtnText}>Record Receipt</Text>
        </TouchableOpacity>
      </View>

      {receipts.map((r: any) => (
        <View key={r.id} style={styles.card}>
          <Text style={styles.itemTitle}>KES {Number(r.amount).toLocaleString()} — {r.method}</Text>
          <Text style={styles.itemMeta}>
            Contract: {String(r.contract_id).slice(0, 8)} • {new Date(r.paid_at).toLocaleString()}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, gap: 12 },
  banner: { backgroundColor: '#0f172a', padding: 16, borderRadius: 12, gap: 4 },
  bannerTitle: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  bannerAmount: { color: '#ffffff', fontSize: 24, fontWeight: '800' },
  bannerSub: { color: '#38bdf8', fontSize: 12 },
  card: { backgroundColor: '#ffffff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { backgroundColor: '#e2e8f0', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  pillActive: { backgroundColor: '#0284c7' },
  pillText: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
  pillTextActive: { color: '#ffffff' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#f8fafc' },
  primaryBtn: { backgroundColor: '#0284c7', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  itemMeta: { fontSize: 12, color: '#64748b' },
});
