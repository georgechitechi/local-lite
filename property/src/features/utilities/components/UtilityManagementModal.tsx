import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  Divider,
  IconButton,
  Menu,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import LoadingOverlay from '@/shared/components/LoadingOverlay';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useCoreMutations, useSettings } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { generateUUID } from '@/shared/utils/helper';

export type UtilityType = 'electricity' | 'water' | 'other';

export interface UtilityMeter {
  id: string;
  name: string;
  type: UtilityType;
  meterNumber: string;
  unit: string;
  description?: string;
  active: boolean;
}

interface UtilityManagementModalProps {
  visible: boolean;
  onDismiss: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const UTILITY_TYPES: { value: UtilityType; label: string; icon: string; unit: string }[] =
  [
    { value: 'electricity', label: 'Electricity', icon: 'flash', unit: 'kWh' },
    { value: 'water', label: 'Water', icon: 'water', unit: 'm³' },
    { value: 'other', label: 'Other', icon: 'dots-horizontal-circle', unit: 'units' },
  ];

const BLANK_METER: Omit<UtilityMeter, 'id'> = {
  name: '',
  type: 'electricity',
  meterNumber: '',
  unit: 'kWh',
  description: '',
  active: true,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getUtilityMeta = (type: UtilityType) =>
  UTILITY_TYPES.find(u => u.value === type) ?? UTILITY_TYPES[3];

// ─── Main Modal ──────────────────────────────────────────────────────────────

export default function UtilityManagementModal({
  visible,
  onDismiss,
}: UtilityManagementModalProps) {
  const { user } = useAuth();
  const { selectedBusiness } = useBusiness();

  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const { can } = useAccessControl();

  const canEdit = can('edit', 'maintenance');
  const canCreate = can('create', 'maintenance');
  const canDelete = can('delete', 'maintenance');

  const [meters, setMeters] = useState<UtilityMeter[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list');
  const [editTarget, setEditTarget] = useState<UtilityMeter | null>(null);
  const [menuVisible, setMenuVisible] = useState<Record<string, boolean>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state (lifted out of sub-component so BaseModal actions can access it)
  const [form, setForm] = useState<Omit<UtilityMeter, 'id'>>(BLANK_METER);
  const updateForm = (key: keyof typeof form, value: any) =>
    setForm(f => ({ ...f, [key]: value }));

  const handleTypeSelect = (type: UtilityType) => {
    const meta = getUtilityMeta(type);
    updateForm('type', type);
    updateForm('unit', meta.unit);
    if (!form.name || UTILITY_TYPES.some(u => u.label === form.name)) {
      updateForm('name', meta.label);
    }
  };

  const canSave = form.name.trim().length > 0 && form.meterNumber.trim().length > 0;

  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const handleDismiss = () => {
    setMode('list');
    setEditTarget(null);
    setForm(BLANK_METER);
    setInitializedKey(null);
    onDismiss();
  };

  const rawSettings = useSettings(selectedBusiness?.id);
  const { insert, update } = useCoreMutations();

  // Load meters when modal opens (once per open)
  useEffect(() => {
    if (!visible) return;
    if (initializedKey === 'open') return;

    setLoading(true);
    if (!selectedBusiness?.id) {
      setLoading(false);
      return;
    }

    try {
      const setting = (rawSettings || []).find(
        (s: any) => s.setting_key === 'utility_meters',
      );
      let val = setting?.setting_value;
      if (typeof val === 'string') {
        try {
          val = JSON.parse(val);
        } catch {}
      }
      setMeters(Array.isArray(val) ? (val as unknown as UtilityMeter[]) : []);
    } catch {
      showSnackbar('Failed to load utility meters', 'error');
    } finally {
      setLoading(false);
    }
    setInitializedKey('open');
  }, [visible, showSnackbar, initializedKey, selectedBusiness?.id, rawSettings]);

  // Sync form when switching to edit
  useEffect(() => {
    if (mode === 'edit' && editTarget) {
      setForm({ ...BLANK_METER, ...editTarget });
    } else if (mode === 'add') {
      setForm(BLANK_METER);
    }
  }, [mode, editTarget]);

  const persist = async (updated: UtilityMeter[]) => {
    if (!selectedBusiness?.id || !user) return;
    const existing = (rawSettings || []).find(
      (s: any) => s.setting_key === 'utility_meters',
    );
    if (existing) {
      await update('settings', existing.id, { setting_value: updated as any });
    } else {
      const newId = generateUUID();
      await insert('settings', {
        id: newId,
        business_id: selectedBusiness.id,
        user_id: user.id,
        setting_key: 'utility_meters',
        setting_value: updated as any,
        deleted: false,
      });
    }
    setMeters(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (mode === 'add') {
        const newMeter: UtilityMeter = { ...form, id: generateUUID() };
        await persist([...meters, newMeter]);
        showSnackbar('Utility meter added', 'success');
      } else if (mode === 'edit' && editTarget) {
        await persist(
          meters.map(m => (m.id === editTarget.id ? { ...form, id: m.id } : m)),
        );
        showSnackbar('Utility meter updated', 'success');
      }
      setMode('list');
      setEditTarget(null);
    } catch {
      showSnackbar('Failed to save meter', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    try {
      await persist(meters.filter(m => m.id !== id));
      showSnackbar('Utility meter removed', 'success');
      setDeleteConfirmId(null);
    } catch {
      showSnackbar('Failed to remove meter', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (id: string) => {
    await persist(meters.map(m => (m.id === id ? { ...m, active: !m.active } : m)));
  };

  const cancelForm = () => {
    setMode('list');
    setEditTarget(null);
  };

  // ── Confirm delete sub-modal ───────────────────────────────────────────────
  if (deleteConfirmId) {
    const target = meters.find(m => m.id === deleteConfirmId);
    return (
      <BaseModal
        mode="confirm"
        visible={visible}
        onDismiss={() => setDeleteConfirmId(null)}
        onConfirm={() => handleDelete(deleteConfirmId)}
        title="Remove Meter"
        message={`Are you sure you want to remove "${target?.name}"?`}
        confirmText="Remove"
        destructive
        loading={saving}
      />
    );
  }

  const isForm = mode === 'add' || mode === 'edit';

  return (
    <BaseModal
      visible={visible}
      onDismiss={() => {
        if (isForm) {
          cancelForm();
        } else {
          handleDismiss();
        }
      }}
      title={
        mode === 'add'
          ? 'Add Utility Meter'
          : mode === 'edit'
            ? 'Edit Meter'
            : 'Utility Meters'
      }
      subtitle={
        mode === 'list'
          ? `${meters.filter(m => m.active).length} active meter${meters.filter(m => m.active).length !== 1 ? 's' : ''}`
          : undefined
      }
      edgeToEdge={false}
      scrollable
      maxHeight="90%"
      headerRight={
        mode === 'list' && canCreate ? (
          <IconButton icon="plus" size={22} onPress={() => setMode('add')} />
        ) : undefined
      }
      // ── BaseModal actions (shown only in form mode) ──────────────────────
      actions={
        isForm
          ? [
              {
                label: (mode === 'edit' ? canEdit : canCreate) ? 'Cancel' : 'Close',
                mode: 'outlined',
                onPress: cancelForm,
                disabled: saving,
              },
              ...((mode === 'edit' ? canEdit : canCreate)
                ? [
                    {
                      label: 'Save',
                      mode: 'contained' as const,
                      onPress: handleSave,
                      loading: saving,
                      disabled: !canSave || saving,
                      icon: 'content-save',
                    },
                  ]
                : []),
            ]
          : []
      }
    >
      {/* ── Form view ───────────────────────────────────────────────────── */}
      {isForm ? (
        <View style={{ paddingTop: 4 }}>
          <Text
            variant="labelMedium"
            style={{ color: colors.onSurfaceVariant, marginBottom: 8 }}
          >
            Utility Type
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
          >
            {UTILITY_TYPES.map(u => (
              <Chip
                key={u.value}
                selected={form.type === u.value}
                onPress={() => handleTypeSelect(u.value)}
                icon={u.icon}
                style={
                  form.type === u.value
                    ? { backgroundColor: colors.primaryContainer }
                    : undefined
                }
              >
                {u.label}
              </Chip>
            ))}
          </ScrollView>

          <TextInput
            label="Meter Name *"
            value={form.name}
            onChangeText={v => updateForm('name', v)}
            mode="outlined"
            style={styles.input}
            left={<TextInput.Icon icon={getUtilityMeta(form.type).icon} />}
          />

          <TextInput
            label="Meter Number *"
            value={form.meterNumber}
            onChangeText={v => updateForm('meterNumber', v)}
            mode="outlined"
            style={styles.input}
            left={<TextInput.Icon icon="barcode" />}
            placeholder="e.g. 12345678"
          />

          <TextInput
            label="Unit"
            value={form.unit}
            onChangeText={v => updateForm('unit', v)}
            mode="outlined"
            style={styles.input}
            left={<TextInput.Icon icon="ruler" />}
            placeholder="e.g. kWh, m³"
          />

          <TextInput
            label="Description (optional)"
            value={form.description ?? ''}
            onChangeText={v => updateForm('description', v)}
            mode="outlined"
            style={[styles.input, styles.descriptionInput]}
            left={<TextInput.Icon icon="text" />}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>
      ) : loading ? (
        /* ── Loading ──────────────────────────────────────────────────────── */
        <View
          style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 }}
        >
          <MaterialCommunityIcons
            name="meter-electric"
            size={48}
            color={colors.outline}
          />
          <Text
            variant="bodyMedium"
            style={{ color: colors.onSurfaceVariant, marginTop: 8 }}
          >
            Loading meters...
          </Text>
        </View>
      ) : meters.length === 0 ? (
        /* ── Empty state ──────────────────────────────────────────────────── */
        <EmptyState
          icon="meter-electric-outline"
          title="No meters yet"
          description="Add your electricity, water, internet, or other utility meters here."
          actionLabel={canCreate ? 'Add New Meter' : undefined}
          onAction={() => setMode('add')}
        />
      ) : (
        <View>
          {meters.map((meter, index) => {
            const meta = getUtilityMeta(meter.type);
            return (
              <View key={meter.id}>
                <Card
                  style={[
                    styles.meterCard,
                    {
                      backgroundColor: meter.active
                        ? colors.surface
                        : colors.surfaceVariant,
                    },
                  ]}
                  mode="outlined"
                >
                  <Card.Content style={styles.cardContent}>
                    <TouchableOpacity
                      style={styles.cardBody}
                      onPress={() => handleToggleActive(meter.id)}
                      activeOpacity={0.7}
                    >
                      {/* Icon badge */}
                      <View
                        style={[
                          styles.iconBadge,
                          {
                            backgroundColor: meter.active
                              ? colors.primaryContainer
                              : colors.errorContainer,
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={meta.icon as any}
                          size={22}
                          color={
                            meter.active
                              ? colors.onPrimaryContainer
                              : colors.onErrorContainer
                          }
                        />
                      </View>

                      {/* Info */}
                      <View style={{ flex: 1 }}>
                        <View
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                        >
                          <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>
                            {meter.name}
                          </Text>
                          {!meter.active && (
                            <Chip
                              compact
                              style={styles.inactiveChip}
                              textStyle={{ fontSize: 10 }}
                            >
                              Inactive
                            </Chip>
                          )}
                        </View>

                        <Text
                          variant="labelSmall"
                          style={{ color: colors.onSurfaceVariant }}
                        >
                          {meta.label} • {meter.meterNumber} • {meter.unit}
                        </Text>

                        {meter.description ? (
                          <Text
                            variant="bodySmall"
                            style={{ color: colors.onSurfaceVariant, marginTop: 2 }}
                          >
                            {meter.description}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>

                    {/* Context menu */}
                    {(canEdit || canDelete) && (
                      <Menu
                        visible={!!menuVisible[meter.id]}
                        onDismiss={() =>
                          setMenuVisible(prev => ({ ...prev, [meter.id]: false }))
                        }
                        anchor={
                          <IconButton
                            icon="dots-vertical"
                            size={20}
                            style={{ margin: -8 }}
                            onPress={() =>
                              setMenuVisible(prev => ({ ...prev, [meter.id]: true }))
                            }
                          />
                        }
                      >
                        {canEdit && (
                          <Menu.Item
                            leadingIcon="pencil-outline"
                            title="Edit"
                            onPress={() => {
                              setMenuVisible(prev => ({ ...prev, [meter.id]: false }));
                              setEditTarget(meter);
                              setMode('edit');
                            }}
                          />
                        )}
                        {canEdit && (
                          <Menu.Item
                            leadingIcon={meter.active ? 'eye-off-outline' : 'eye-outline'}
                            title={meter.active ? 'Deactivate' : 'Activate'}
                            onPress={() => {
                              setMenuVisible(prev => ({ ...prev, [meter.id]: false }));
                              handleToggleActive(meter.id);
                            }}
                          />
                        )}
                        {canEdit && canDelete && <Divider />}
                        {canDelete && (
                          <Menu.Item
                            leadingIcon="delete-outline"
                            title="Remove"
                            titleStyle={{ color: colors.error }}
                            onPress={() => {
                              setMenuVisible(prev => ({ ...prev, [meter.id]: false }));
                              setDeleteConfirmId(meter.id);
                            }}
                          />
                        )}
                      </Menu>
                    )}
                  </Card.Content>
                </Card>
                {index < meters.length - 1 && <View style={{ height: 8 }} />}
              </View>
            );
          })}

          {canCreate && (
            <Button
              mode="outlined"
              icon="plus"
              onPress={() => setMode('add')}
              style={{ marginTop: 16 }}
            >
              Add New Meter
            </Button>
          )}
        </View>
      )}
      <LoadingOverlay visible={saving} message="Saving meter..." />
    </BaseModal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  meterCard: {
    borderRadius: 12,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  cardBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactiveChip: {
    height: 20,
    borderRadius: 10,
  },
  input: {
    marginBottom: 12,
  },
  descriptionInput: {
    minHeight: 100,
  },
});
