import React, { useEffect, useState } from 'react';
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

export default function TenantsScreen() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredTenants, setFilteredTenants] = useState<any[] | null>(null);

  useEffect(() => {
    getClient().then(setClient);
  }, []);

  const { data: tenants } = useLiveQuery(client, 'tenants', {
    orderBy: 'name',
    order: 'asc',
  });

  const handleAddTenant = async () => {
    if (!client || !name.trim()) return;
    await client.insert('tenants', {
      id: generateUUID(),
      name: name.trim(),
      phone: phone.trim() || 'N/A',
      email: email.trim() || 'N/A',
      emergency_contact: emergencyContact.trim() || 'N/A',
      created_at: Date.now(),
    });
    setName('');
    setPhone('');
    setEmail('');
    setEmergencyContact('');
  };

  const handleSearch = async (text: string) => {
    setSearchQuery(text);
    if (!client || !text.trim()) {
      setFilteredTenants(null);
      return;
    }
    const rows = await client
      .from('tenants')
      .orWhere(
        { name: { $contains: text.trim() } },
        { phone: { $contains: text.trim() } },
        { email: { $contains: text.trim() } },
      )
      .orderBy('name', 'asc')
      .execute();
    setFilteredTenants(rows);
  };

  const handleDeleteTenant = async (id: string) => {
    if (!client) return;
    await client.delete('tenants', id);
    if (searchQuery.trim()) {
      void handleSearch(searchQuery);
    }
  };

  const displayed = filteredTenants ?? tenants;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Search Tenants (.orWhere)</Text>
        <TextInput
          style={styles.input}
          placeholder="Search by name, phone, or email..."
          value={searchQuery}
          onChangeText={handleSearch}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add Tenant & Emergency Contact</Text>
        <TextInput style={styles.input} placeholder="Full Name" value={name} onChangeText={setName} />
        <TextInput style={styles.input} placeholder="Phone Number" value={phone} onChangeText={setPhone} />
        <TextInput style={styles.input} placeholder="Email Address" value={email} onChangeText={setEmail} />
        <TextInput style={styles.input} placeholder="Emergency Contact" value={emergencyContact} onChangeText={setEmergencyContact} />
        <TouchableOpacity style={styles.primaryBtn} onPress={handleAddTenant}>
          <Text style={styles.primaryBtnText}>Save Tenant</Text>
        </TouchableOpacity>
      </View>

      {displayed.map((t: any) => (
        <View key={t.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.itemTitle}>{t.name}</Text>
            <TouchableOpacity onPress={() => handleDeleteTenant(t.id)}>
              <Text style={styles.dangerText}>Remove</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.itemMeta}>Phone: {t.phone} • Email: {t.email}</Text>
          <Text style={styles.itemMeta}>Emergency: {t.emergency_contact}</Text>
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
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#f8fafc' },
  primaryBtn: { backgroundColor: '#0284c7', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  itemMeta: { fontSize: 12, color: '#64748b' },
  dangerText: { color: '#dc2626', fontSize: 12, fontWeight: '700' },
});
