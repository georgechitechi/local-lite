import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AuditManager,
  generateUUID,
  type LocalFirstClient,
} from 'local-lite';
import { useLiveQuery, useSyncStatus } from 'local-lite/react';
import { getClient } from '../lib/sync';

interface PropertyWithHouses {
  id: string;
  name: string;
  location: string;
  manager_contact: string;
  houses?: Array<{
    id: string;
    property_id: string;
    house_number: string;
    rent: number;
    status: string;
    amenities: string[];
  }>;
}

export default function PropertiesScreen() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [audit, setAudit] = useState<AuditManager | null>(null);
  const [propertiesWithHouses, setPropertiesWithHouses] = useState<PropertyWithHouses[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [statusMessage, setStatusMessage] = useState('Ready');

  const [propName, setPropName] = useState('');
  const [propLocation, setPropLocation] = useState('');
  const [propContact, setPropContact] = useState('');

  const [houseNumber, setHouseNumber] = useState('');
  const [houseRent, setHouseRent] = useState('20000');

  useEffect(() => {
    let mounted = true;
    getClient().then(async (c) => {
      if (!mounted) return;
      setClient(c);
      const am = new AuditManager(c.db);
      await am.initialize();
      setAudit(am);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const { data: properties } = useLiveQuery(client, 'properties', {
    orderBy: 'created_at',
    order: 'desc',
  });
  const { data: houses } = useLiveQuery(client, 'houses', {
    orderBy: 'house_number',
    order: 'asc',
  });
  const { isOnline, pendingCount } = useSyncStatus(client);

  const loadWithHouses = useCallback(async () => {
    if (!client) return;
    const rows = await client
      .from<PropertyWithHouses>('properties')
      .with('houses')
      .orderBy('created_at', 'desc')
      .execute();
    setPropertiesWithHouses(rows);
    if (!selectedPropertyId && rows.length > 0) {
      setSelectedPropertyId(rows[0].id);
    }
  }, [client, selectedPropertyId]);

  useEffect(() => {
    void loadWithHouses();
  }, [loadWithHouses, properties, houses]);

  const showAlert = (title: string, msg: string) => {
    if (Platform.OS === 'web') {
      setStatusMessage(`${title}: ${msg}`);
    } else {
      Alert.alert(title, msg);
    }
  };

  const handleSeedDemo = async () => {
    if (!client) return;
    const now = Date.now();
    const p1 = generateUUID();
    const h1 = generateUUID();
    const h2 = generateUUID();
    const t1 = generateUUID();
    const c1 = generateUUID();
    const r1 = generateUUID();

    await client.insertMany('properties', [
      {
        id: p1,
        name: 'Kilimani Heights',
        location: 'Nairobi',
        manager_contact: '+254 700 111 222',
        created_at: now,
      },
    ]);
    await client.insertMany('houses', [
      {
        id: h1,
        property_id: p1,
        house_number: 'A-101',
        rent: 25000,
        status: 'OCCUPIED',
        amenities: ['wifi', 'balcony', 'parking'],
        created_at: now,
      },
      {
        id: h2,
        property_id: p1,
        house_number: 'A-102',
        rent: 28000,
        status: 'VACANT',
        amenities: ['wifi', 'solar'],
        created_at: now + 1,
      },
    ]);
    await client.insertMany('tenants', [
      {
        id: t1,
        name: 'Alice Wanjiku',
        phone: '+254 712 345 678',
        email: 'alice@example.com',
        emergency_contact: 'Bob Wanjiku (+254 722 000 111)',
        created_at: now,
      },
    ]);
    await client.insertMany('contracts', [
      {
        id: c1,
        house_id: h1,
        tenant_id: t1,
        rent_amount: 25000,
        balance_due: 0,
        status: 'ACTIVE',
        start_date: '2026-11-01',
        created_at: now,
      },
    ]);
    await client.insertMany('receipts', [
      {
        id: r1,
        contract_id: c1,
        amount: 25000,
        method: 'M-Pesa',
        paid_at: now,
      },
    ]);

    setSelectedPropertyId(p1);
    setStatusMessage('Seeded demo property, 2 houses, tenant, contract & receipt.');
  };

  const handleAddProperty = async () => {
    if (!client || !propName.trim()) return;
    const id = generateUUID();
    const payload = {
      id,
      name: propName.trim(),
      location: propLocation.trim() || 'Main District',
      manager_contact: propContact.trim() || 'N/A',
      created_at: Date.now(),
    };
    await client.insert('properties', payload);
    await audit?.record({ tableName: 'properties', rowId: id, operation: 'INSERT', after: payload });
    setSelectedPropertyId(id);
    setPropName('');
    setPropLocation('');
    setPropContact('');
    setStatusMessage(`Added property "${payload.name}"`);
  };

  const handleAddHouse = async () => {
    if (!client || !selectedPropertyId || !houseNumber.trim()) return;
    const id = generateUUID();
    const payload = {
      id,
      property_id: selectedPropertyId,
      house_number: houseNumber.trim(),
      rent: Number(houseRent) || 20000,
      status: 'VACANT',
      amenities: ['water', 'security'],
      created_at: Date.now(),
    };
    await client.insert('houses', payload);
    await audit?.record({ tableName: 'houses', rowId: id, operation: 'INSERT', after: payload });
    setHouseNumber('');
    setStatusMessage(`Added unit ${payload.house_number}`);
  };

  const handleDeleteHouse = async (houseId: string, unit: string) => {
    if (!client) return;
    try {
      await client.delete('houses', houseId);
      setStatusMessage(`Deleted house ${unit}`);
    } catch (err: any) {
      showAlert('Restricted Delete', err?.message || 'Cannot delete house with contracts.');
    }
  };

  const handleUndo = async () => {
    if (!client || !audit) return;
    const entry = await audit.undo(client);
    setStatusMessage(entry ? `Undid ${entry.operation} on ${entry.tableName}` : 'Nothing to undo');
  };

  const handleRedo = async () => {
    if (!client || !audit) return;
    const entry = await audit.redo(client);
    setStatusMessage(entry ? `Redid ${entry.operation} on ${entry.tableName}` : 'Nothing to redo');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.banner}>
        <View style={styles.rowBetween}>
          <Text style={styles.bannerTitle}>Property Portfolio</Text>
          <TouchableOpacity style={styles.seedBtn} onPress={handleSeedDemo}>
            <Text style={styles.seedBtnText}>Seed Demo</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.bannerSub}>
          {isOnline ? 'Online' : 'Offline'} • {pendingCount} queued • {properties.length} properties • {houses.length} houses
        </Text>
        <Text style={styles.statusText}>{statusMessage}</Text>
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={styles.chipBtn} onPress={handleUndo}>
          <Text style={styles.chipText}>Undo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.chipBtn} onPress={handleRedo}>
          <Text style={styles.chipText}>Redo</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add Property</Text>
        <TextInput style={styles.input} placeholder="Property Name" value={propName} onChangeText={setPropName} />
        <TextInput style={styles.input} placeholder="Location" value={propLocation} onChangeText={setPropLocation} />
        <TextInput style={styles.input} placeholder="Manager Contact" value={propContact} onChangeText={setPropContact} />
        <TouchableOpacity style={styles.primaryBtn} onPress={handleAddProperty}>
          <Text style={styles.primaryBtnText}>Save Property</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add House / Unit</Text>
        <Text style={styles.helperText}>
          Property: {properties.find((p: any) => p.id === selectedPropertyId)?.name ?? 'Tap a property below'}
        </Text>
        <View style={styles.row}>
          <TextInput style={[styles.input, { flex: 1 }]} placeholder="Unit (e.g. B-204)" value={houseNumber} onChangeText={setHouseNumber} />
          <TextInput style={[styles.input, { width: 100 }]} placeholder="Rent" keyboardType="numeric" value={houseRent} onChangeText={setHouseRent} />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleAddHouse}>
            <Text style={styles.primaryBtnText}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      {propertiesWithHouses.map((prop) => (
        <View key={prop.id} style={styles.card}>
          <TouchableOpacity onPress={() => setSelectedPropertyId(prop.id)}>
            <Text style={styles.itemTitle}>
              {prop.name} — {prop.location} {selectedPropertyId === prop.id ? '✓' : ''}
            </Text>
            <Text style={styles.itemMeta}>Manager: {prop.manager_contact}</Text>
          </TouchableOpacity>
          {(prop.houses ?? []).map((h) => (
            <View key={h.id} style={styles.subRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.subTitle}>
                  Unit {h.house_number} • KES {h.rent.toLocaleString()} [{h.status}]
                </Text>
                <Text style={styles.itemMeta}>Amenities: {(h.amenities ?? []).join(', ')}</Text>
              </View>
              <TouchableOpacity onPress={() => handleDeleteHouse(h.id, h.house_number)}>
                <Text style={styles.dangerText}>Delete</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, gap: 12 },
  banner: { backgroundColor: '#0f172a', padding: 14, borderRadius: 12, gap: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bannerTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
  bannerSub: { color: '#94a3b8', fontSize: 12 },
  statusText: { color: '#38bdf8', fontSize: 12, marginTop: 4 },
  seedBtn: { backgroundColor: '#0284c7', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  seedBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  chipBtn: { backgroundColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  chipText: { color: '#0f172a', fontSize: 12, fontWeight: '600' },
  card: { backgroundColor: '#ffffff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  helperText: { fontSize: 12, color: '#475569' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#f8fafc' },
  primaryBtn: { backgroundColor: '#0284c7', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  itemMeta: { fontSize: 12, color: '#64748b' },
  subRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  subTitle: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  dangerText: { color: '#dc2626', fontSize: 12, fontWeight: '700', paddingHorizontal: 8 },
});
