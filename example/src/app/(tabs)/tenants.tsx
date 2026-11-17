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
import { BottomSheetModal } from '../../components/BottomSheetModal';
import { ActionMenuSheet, type ActionMenuItem } from '../../components/ActionMenuSheet';
import { getClient } from '../../lib/sync';

export default function TenantsScreen() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [filteredTenants, setFilteredTenants] = useState<any[] | null>(null);
  const [menuState, setMenuState] = useState<{
    visible: boolean;
    title: string;
    actions: ActionMenuItem[];
  }>({ visible: false, title: '', actions: [] });

  useEffect(() => {
    getClient().then(setClient);
  }, []);

  const { data: tenants } = useLiveQuery(client, 'tenants', {
    orderBy: 'name',
    order: 'asc',
  });

  const openCreate = () => {
    setEditingId(null);
    setName('');
    setPhone('');
    setEmail('');
    setEmergencyContact('');
    setModalVisible(true);
  };

  const openEdit = (t: any) => {
    setEditingId(t.id);
    setName(t.name);
    setPhone(t.phone);
    setEmail(t.email);
    setEmergencyContact(t.emergency_contact);
    setModalVisible(true);
  };

  const handleSaveTenant = async () => {
    if (!client || !name.trim()) return;
    const data = {
      name: name.trim(),
      phone: phone.trim() || 'N/A',
      email: email.trim() || 'N/A',
      emergency_contact: emergencyContact.trim() || 'N/A',
    };
    if (editingId) {
      await client.update('tenants', editingId, data);
    } else {
      await client.insert('tenants', {
        id: generateUUID(),
        ...data,
        created_at: Date.now(),
      });
    }
    setModalVisible(false);
    if (searchQuery.trim()) {
      void handleSearch(searchQuery);
    }
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
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Search name, phone, email (.orWhere)..."
            value={searchQuery}
            onChangeText={handleSearch}
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={openCreate}>
            <Text style={styles.primaryBtnText}>+ Tenant</Text>
          </TouchableOpacity>
        </View>

        {displayed.map((t: any) => (
          <View key={t.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemTitle}>{t.name}</Text>
              <TouchableOpacity
                style={styles.ellipsisBtn}
                onPress={() =>
                  setMenuState({
                    visible: true,
                    title: t.name,
                    actions: [
                      { label: 'Edit Tenant', onPress: () => openEdit(t) },
                      {
                        label: 'Remove Tenant',
                        destructive: true,
                        onPress: () => handleDeleteTenant(t.id),
                      },
                    ],
                  })
                }
              >
                <Text style={styles.ellipsisText}>⋮</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.itemMeta}>Phone: {t.phone} • Email: {t.email}</Text>
            <Text style={styles.itemMeta}>Emergency: {t.emergency_contact}</Text>
          </View>
        ))}
      </ScrollView>

      <BottomSheetModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        title={editingId ? 'Edit Tenant' : 'New Tenant & Contacts'}
      >
        <View style={styles.modalBody}>
          <TextInput style={styles.input} placeholder="Full Name" value={name} onChangeText={setName} />
          <TextInput style={styles.input} placeholder="Phone Number" value={phone} onChangeText={setPhone} />
          <TextInput style={styles.input} placeholder="Email Address" value={email} onChangeText={setEmail} />
          <TextInput style={styles.input} placeholder="Emergency Contact" value={emergencyContact} onChangeText={setEmergencyContact} />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveTenant}>
            <Text style={styles.primaryBtnText}>
              {editingId ? 'Update Tenant' : 'Save Tenant'}
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
  card: { backgroundColor: '#ffffff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 6 },
  modalBody: { padding: 16, gap: 10 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: '#ffffff' },
  primaryBtn: { backgroundColor: '#0284c7', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  itemMeta: { fontSize: 12, color: '#64748b' },
  ellipsisBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: '#f1f5f9' },
  ellipsisText: { fontSize: 18, fontWeight: '700', color: '#334155', lineHeight: 20 },
});
