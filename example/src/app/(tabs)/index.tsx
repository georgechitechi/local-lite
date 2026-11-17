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
import { useLiveQuery } from 'local-lite/react';
import { BottomSheetModal } from '../../components/BottomSheetModal';
import { ActionMenuSheet, type ActionMenuItem } from '../../components/ActionMenuSheet';
import { getClient } from '../../lib/sync';

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
  const [statusMessage, setStatusMessage] = useState('Ready');

  // Property modal state (create / edit)
  const [propModalVisible, setPropModalVisible] = useState(false);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [propName, setPropName] = useState('');
  const [propLocation, setPropLocation] = useState('');
  const [propContact, setPropContact] = useState('');

  // House modal state (create / edit)
  const [houseModalVisible, setHouseModalVisible] = useState(false);
  const [editingHouseId, setEditingHouseId] = useState<string | null>(null);
  const [housePropertyId, setHousePropertyId] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [houseRent, setHouseRent] = useState('20000');

  const [menuState, setMenuState] = useState<{
    visible: boolean;
    title: string;
    actions: ActionMenuItem[];
  }>({ visible: false, title: '', actions: [] });

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

  const loadWithHouses = useCallback(async () => {
    if (!client) return;
    const rows = await client
      .from<PropertyWithHouses>('properties')
      .with('houses')
      .orderBy('created_at', 'desc')
      .execute();
    setPropertiesWithHouses(rows);
  }, [client]);

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

  const openCreateProperty = () => {
    setEditingPropertyId(null);
    setPropName('');
    setPropLocation('');
    setPropContact('');
    setPropModalVisible(true);
  };

  const openEditProperty = (prop: PropertyWithHouses) => {
    setEditingPropertyId(prop.id);
    setPropName(prop.name);
    setPropLocation(prop.location);
    setPropContact(prop.manager_contact);
    setPropModalVisible(true);
  };

  const handleSaveProperty = async () => {
    if (!client || !propName.trim()) return;
    if (editingPropertyId) {
      const existing = properties.find((p: any) => p.id === editingPropertyId);
      const patch = {
        name: propName.trim(),
        location: propLocation.trim() || 'Main District',
        manager_contact: propContact.trim() || 'N/A',
      };
      await client.update('properties', editingPropertyId, patch);
      await audit?.record({
        tableName: 'properties',
        rowId: editingPropertyId,
        operation: 'UPDATE',
        before: existing,
        after: patch,
      });
      setStatusMessage(`Updated property "${patch.name}"`);
    } else {
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
      setStatusMessage(`Added property "${payload.name}"`);
    }
    setPropModalVisible(false);
  };

  const handleDeleteProperty = async (prop: PropertyWithHouses) => {
    if (!client) return;
    try {
      await client.delete('properties', prop.id);
      setStatusMessage(`Deleted property "${prop.name}"`);
    } catch (err: any) {
      showAlert('Restricted Delete', err?.message || 'Cannot delete property while houses have contracts.');
    }
  };

  const openCreateHouse = (propertyId: string) => {
    setEditingHouseId(null);
    setHousePropertyId(propertyId);
    setHouseNumber('');
    setHouseRent('20000');
    setHouseModalVisible(true);
  };

  const openEditHouse = (h: NonNullable<PropertyWithHouses['houses']>[number]) => {
    setEditingHouseId(h.id);
    setHousePropertyId(h.property_id);
    setHouseNumber(h.house_number);
    setHouseRent(String(h.rent));
    setHouseModalVisible(true);
  };

  const handleSaveHouse = async () => {
    if (!client || !housePropertyId || !houseNumber.trim()) return;
    if (editingHouseId) {
      const patch = {
        house_number: houseNumber.trim(),
        rent: Number(houseRent) || 20000,
      };
      await client.update('houses', editingHouseId, patch);
      setStatusMessage(`Updated unit ${patch.house_number}`);
    } else {
      const id = generateUUID();
      const payload = {
        id,
        property_id: housePropertyId,
        house_number: houseNumber.trim(),
        rent: Number(houseRent) || 20000,
        status: 'VACANT',
        amenities: ['water', 'security'],
        created_at: Date.now(),
      };
      await client.insert('houses', payload);
      await audit?.record({ tableName: 'houses', rowId: id, operation: 'INSERT', after: payload });
      setStatusMessage(`Added unit ${payload.house_number}`);
    }
    setHouseModalVisible(false);
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
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <TouchableOpacity style={styles.primaryBtn} onPress={openCreateProperty}>
            <Text style={styles.primaryBtnText}>+ Add Property</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chipBtn} onPress={handleUndo}>
            <Text style={styles.chipText}>Undo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chipBtn} onPress={handleRedo}>
            <Text style={styles.chipText}>Redo</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.statusText}>{statusMessage}</Text>

        {propertiesWithHouses.map((prop) => (
          <View key={prop.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>
                  {prop.name} — {prop.location}
                </Text>
                <Text style={styles.itemMeta}>Manager: {prop.manager_contact}</Text>
        </View>
              <TouchableOpacity
                style={styles.ellipsisBtn}
                onPress={() =>
                  setMenuState({
                    visible: true,
                    title: prop.name,
                    actions: [
                      { label: 'Add Unit', onPress: () => openCreateHouse(prop.id) },
                      { label: 'Edit Property', onPress: () => openEditProperty(prop) },
                      {
                        label: 'Delete Property',
                        destructive: true,
                        onPress: () => handleDeleteProperty(prop),
                      },
                    ],
                  })
                }
              >
                <Text style={styles.ellipsisText}>⋮</Text>
              </TouchableOpacity>
      </View>

            {(prop.houses ?? []).map((h) => (
              <View key={h.id} style={styles.subRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subTitle}>
                    Unit {h.house_number} • KES {h.rent.toLocaleString()} [{h.status}]
                  </Text>
                  <Text style={styles.itemMeta}>Amenities: {(h.amenities ?? []).join(', ')}</Text>
          </View>
                <TouchableOpacity
                  style={styles.ellipsisBtn}
                  onPress={() =>
                    setMenuState({
                      visible: true,
                      title: `Unit ${h.house_number}`,
                      actions: [
                        { label: 'Edit Unit', onPress: () => openEditHouse(h) },
                        {
                          label: 'Delete Unit',
                          destructive: true,
                          onPress: () => handleDeleteHouse(h.id, h.house_number),
                        },
                      ],
                    })
                  }
                >
                  <Text style={styles.ellipsisText}>⋮</Text>
                </TouchableOpacity>
        </View>
            ))}
    </View>
        ))}
      </ScrollView>

      <BottomSheetModal
        visible={propModalVisible}
        onClose={() => setPropModalVisible(false)}
        title={editingPropertyId ? 'Edit Property' : 'New Property'}
      >
        <View style={styles.modalBody}>
          <TextInput style={styles.input} placeholder="Property Name" value={propName} onChangeText={setPropName} />
          <TextInput style={styles.input} placeholder="Location" value={propLocation} onChangeText={setPropLocation} />
          <TextInput style={styles.input} placeholder="Manager Contact" value={propContact} onChangeText={setPropContact} />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveProperty}>
            <Text style={styles.primaryBtnText}>
              {editingPropertyId ? 'Update Property' : 'Create Property'}
            </Text>
          </TouchableOpacity>
    </View>
      </BottomSheetModal>

      <BottomSheetModal
        visible={houseModalVisible}
        onClose={() => setHouseModalVisible(false)}
        title={editingHouseId ? 'Edit House / Unit' : 'New House / Unit'}
      >
        <View style={styles.modalBody}>
          <TextInput style={styles.input} placeholder="Unit Number (e.g. B-204)" value={houseNumber} onChangeText={setHouseNumber} />
          <TextInput style={styles.input} placeholder="Monthly Rent" keyboardType="numeric" value={houseRent} onChangeText={setHouseRent} />
          <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveHouse}>
            <Text style={styles.primaryBtnText}>
              {editingHouseId ? 'Update Unit' : 'Create Unit'}
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
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  statusText: { color: '#0284c7', fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  chipBtn: { backgroundColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  chipText: { color: '#0f172a', fontSize: 12, fontWeight: '600' },
  card: { backgroundColor: '#ffffff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 },
  modalBody: { padding: 16, gap: 10 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: '#f8fafc' },
  primaryBtn: { backgroundColor: '#0284c7', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  primaryBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  itemMeta: { fontSize: 12, color: '#64748b' },
  subRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9', gap: 8 },
  subTitle: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  ellipsisBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: '#f1f5f9' },
  ellipsisText: { fontSize: 18, fontWeight: '700', color: '#334155', lineHeight: 20 },
});
