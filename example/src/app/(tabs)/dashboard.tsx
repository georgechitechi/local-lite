import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LocalFirstClient } from 'local-lite';
import { useLiveQuery, useSyncStatus } from 'local-lite/react';
import { getClient } from '../../lib/sync';

export default function DashboardScreen() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [totalCollected, setTotalCollected] = useState(0);
  const [totalBalanceDue, setTotalBalanceDue] = useState(0);
  const [recentContracts, setRecentContracts] = useState<any[]>([]);

  useEffect(() => {
    getClient().then(setClient);
  }, []);

  const { data: properties } = useLiveQuery(client, 'properties');
  const { data: houses } = useLiveQuery(client, 'houses');
  const { data: tenants } = useLiveQuery(client, 'tenants');
  const { data: contracts } = useLiveQuery(client, 'contracts', {
    where: { status: 'ACTIVE' },
  });
  const { data: receipts } = useLiveQuery(client, 'receipts', {
    orderBy: 'paid_at',
    order: 'desc',
    limit: 5,
  });
  const { isOnline, pendingCount } = useSyncStatus(client);

  const loadAggregates = useCallback(async () => {
    if (!client) return;
    const [collected, due, activeContracts] = await Promise.all([
      client.from('receipts').sum('amount'),
      client.from('contracts').where({ status: 'ACTIVE' }).sum('balance_due'),
      client
        .from('contracts')
        .where({ status: 'ACTIVE' })
        .with('houses', 'tenants')
        .orderBy('created_at', 'desc')
        .limit(5)
        .execute(),
    ]);
    setTotalCollected(collected);
    setTotalBalanceDue(due);
    setRecentContracts(activeContracts);
  }, [client]);

  useEffect(() => {
    void loadAggregates();
  }, [loadAggregates, properties, houses, tenants, contracts, receipts]);

  const occupiedCount = houses.filter((h: any) => h.status === 'OCCUPIED').length;
  const vacantCount = houses.length - occupiedCount;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.statsCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.statsHeader}>Portfolio Overview</Text>
          <Text style={styles.syncBadge}>
            {isOnline ? '● Online' : '○ Offline'} • {pendingCount} queued
          </Text>
        </View>
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{properties.length}</Text>
            <Text style={styles.statLabel}>Properties</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>
              {occupiedCount} / {vacantCount}
            </Text>
            <Text style={styles.statLabel}>Occupied / Vacant</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{tenants.length}</Text>
            <Text style={styles.statLabel}>Tenants</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{contracts.length}</Text>
            <Text style={styles.statLabel}>Active Leases</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>KES {totalCollected.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Rent Collected</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>KES {totalBalanceDue.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Balance Due</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Active Leases</Text>
        {recentContracts.length === 0 ? (
          <Text style={styles.emptyText}>No active leases yet.</Text>
        ) : (
          recentContracts.map((c: any) => (
            <View key={c.id} style={styles.listRow}>
              <Text style={styles.itemTitle}>
                Unit {c.houses?.house_number ?? c.house_id} — {c.tenants?.name ?? 'Unassigned'}
              </Text>
              <Text style={styles.itemMeta}>
                Rent: KES {Number(c.rent_amount).toLocaleString()} • Due: KES {Number(c.balance_due ?? 0).toLocaleString()}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent Receipts</Text>
        {receipts.length === 0 ? (
          <Text style={styles.emptyText}>No receipts recorded yet.</Text>
        ) : (
          receipts.map((r: any) => (
            <View key={r.id} style={styles.listRow}>
              <Text style={styles.itemTitle}>
                KES {Number(r.amount).toLocaleString()} — {r.method}
              </Text>
              <Text style={styles.itemMeta}>
                {new Date(r.paid_at).toLocaleString()}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, gap: 12 },
  statsCard: { backgroundColor: '#0f172a', padding: 14, borderRadius: 14, gap: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statsHeader: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  syncBadge: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statBox: { flexBasis: '48%', flexGrow: 1, backgroundColor: '#1e293b', padding: 10, borderRadius: 10 },
  statValue: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  statLabel: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  card: { backgroundColor: '#ffffff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  emptyText: { fontSize: 12, color: '#64748b' },
  listRow: { paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9', gap: 2 },
  itemTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  itemMeta: { fontSize: 12, color: '#64748b' },
});
