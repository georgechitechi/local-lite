import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { LocalFirstClient } from 'local-lite';
import { useSyncStatus } from 'local-lite/react';
import { exportTablesToJson } from 'local-lite/portability';
import { getClient } from '../lib/sync';

export default function SettingsScreen() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [statsText, setStatsText] = useState('Loading...');

  useEffect(() => {
    getClient().then(setClient);
  }, []);

  const { isOnline, pendingCount } = useSyncStatus(client);

  const refreshStats = useCallback(async () => {
    if (!client) return;
    try {
      const stats = await client.maintenance.getStorageStats();
      setStatsText(
        `DB Size: ${(stats.databaseSizeBytes / 1024).toFixed(1)} KB • Tables: ${Object.keys(stats.tables).length}`,
      );
    } catch {
      setStatsText('Stats unavailable');
    }
  }, [client]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const handleSeedDemo = async () => {
    if (!client) return;
    const existing = await client.findById('properties', 'demo-prop-1');
    if (existing) {
      setStatusMessage('Demo data already seeded.');
      return;
    }

    const now = Date.now();
    await client.insertMany('properties', [
      {
        id: 'demo-prop-1',
        name: 'Kilimani Heights',
        location: 'Nairobi',
        manager_contact: '+254 700 111 222',
        created_at: now,
      },
    ]);
    await client.insertMany('houses', [
      {
        id: 'demo-house-1',
        property_id: 'demo-prop-1',
        house_number: 'A-101',
        rent: 25000,
        status: 'OCCUPIED',
        amenities: ['wifi', 'balcony', 'parking'],
        created_at: now,
      },
      {
        id: 'demo-house-2',
        property_id: 'demo-prop-1',
        house_number: 'A-102',
        rent: 28000,
        status: 'VACANT',
        amenities: ['wifi', 'solar'],
        created_at: now + 1,
      },
    ]);
    await client.insertMany('tenants', [
      {
        id: 'demo-tenant-1',
        name: 'Alice Wanjiku',
        phone: '+254 712 345 678',
        email: 'alice@example.com',
        emergency_contact: 'Bob Wanjiku (+254 722 000 111)',
        created_at: now,
      },
    ]);
    await client.insertMany('contracts', [
      {
        id: 'demo-contract-1',
        house_id: 'demo-house-1',
        tenant_id: 'demo-tenant-1',
        rent_amount: 25000,
        balance_due: 0,
        status: 'ACTIVE',
        start_date: '2026-11-01',
        created_at: now,
      },
    ]);
    await client.insertMany('receipts', [
      {
        id: 'demo-receipt-1',
        contract_id: 'demo-contract-1',
        amount: 25000,
        method: 'M-Pesa',
        paid_at: now,
      },
    ]);

    await refreshStats();
    setStatusMessage('Demo data seeded.');
  };

  const handleClearDemo = async () => {
    if (!client) return;
    const demoTargets: Array<[string, string]> = [
      ['receipts', 'demo-receipt-1'],
      ['contracts', 'demo-contract-1'],
      ['houses', 'demo-house-1'],
      ['houses', 'demo-house-2'],
      ['tenants', 'demo-tenant-1'],
      ['properties', 'demo-prop-1'],
    ];

    let removed = 0;
    for (const [table, id] of demoTargets) {
      try {
        const row = await client.findById(table, id);
        if (row) {
          await client.delete(table, id);
          removed++;
        }
      } catch {
        // Ignore if already deleted or restricted
      }
    }

    await refreshStats();
    setStatusMessage(
      removed > 0 ? `Cleared ${removed} demo record(s).` : 'No demo data found.',
    );
  };

  const handleResetAll = async () => {
    if (!client) return;
    await client.reset();
    await refreshStats();
    setStatusMessage('All local tables and sync state reset.');
  };

  const handleVacuum = async () => {
    if (!client) return;
    await client.maintenance.vacuum();
    await refreshStats();
    setStatusMessage('SQLite VACUUM completed.');
  };

  const handleExportPreview = async () => {
    if (!client) return;
    const json = await exportTablesToJson(client, [
      'properties',
      'houses',
      'tenants',
      'contracts',
      'receipts',
    ]);
    setStatusMessage(`Exported JSON snapshot (${json.length} chars).`);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>App & Sync Settings</Text>
        <Text style={styles.bannerSub}>
          {isOnline ? 'Online' : 'Offline'} • {pendingCount} queued • {statsText}
        </Text>
        <Text style={styles.statusText}>{statusMessage}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Demo Data</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleSeedDemo}>
          <Text style={styles.primaryBtnText}>Seed Demo Data</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleClearDemo}>
          <Text style={styles.secondaryBtnText}>Clear Demo Data</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Database Maintenance</Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleVacuum}>
          <Text style={styles.secondaryBtnText}>Run SQLite VACUUM</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleExportPreview}>
          <Text style={styles.secondaryBtnText}>Export Portfolio JSON</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dangerBtn} onPress={handleResetAll}>
          <Text style={styles.dangerBtnText}>Reset Entire Database</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, gap: 12 },
  banner: { backgroundColor: '#0f172a', padding: 14, borderRadius: 12, gap: 4 },
  bannerTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
  bannerSub: { color: '#94a3b8', fontSize: 12 },
  statusText: { color: '#38bdf8', fontSize: 12, marginTop: 4 },
  card: { backgroundColor: '#ffffff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  primaryBtn: { backgroundColor: '#0284c7', paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  secondaryBtn: { backgroundColor: '#e2e8f0', paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  secondaryBtnText: { color: '#0f172a', fontWeight: '600', fontSize: 13 },
  dangerBtn: { backgroundColor: '#fee2e2', paddingVertical: 11, borderRadius: 8, alignItems: 'center' },
  dangerBtnText: { color: '#dc2626', fontWeight: '700', fontSize: 13 },
});
