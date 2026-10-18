import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Button,
  Checkbox,
  Divider,
  IconButton,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import BaseModal from '@/shared/components/BaseModal';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import SPressable from '@/shared/components/SlightPressable';
import { useCoreMutations, useSettings } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { generateUUID, properCase } from '@/shared/utils/helper';

interface MaintenanceItem {
  id: string;
  label: string;
  tenant: boolean;
  landlord: boolean;
}

interface Restriction {
  allowed: boolean;
  details: string;
}

interface ContractSettings {
  securityDeposit: {
    required: boolean;
    amount: number;
    refundable: boolean;
  };
  paymentTerms: {
    dueDate: number;
    gracePeriod: number;
    lateFee: number;
  };
  restrictions: {
    pets: Restriction;
    subletting: Restriction;
    modifications: Restriction;
  };
  maintenance: {
    utilities: MaintenanceItem[];
    extras: MaintenanceItem[];
  };
  appendSignature?: boolean;
  customSignatureSVG?: string;
  termination: {
    noticePeriod: number;
  };
}

const DEFAULT_SETTINGS: ContractSettings = {
  securityDeposit: { required: false, amount: 1, refundable: true },
  paymentTerms: { dueDate: 5, gracePeriod: 3, lateFee: 100 },
  restrictions: {
    pets: { allowed: true, details: 'Only Domesticated pets are allowed' },
    subletting: { allowed: false, details: 'No subletting' },
    modifications: { allowed: false, details: 'No structural modifications' },
  },
  maintenance: {
    utilities: [
      { id: 'water', label: 'Water Supply', tenant: false, landlord: true },
      { id: 'electricity', label: 'Electricity', tenant: false, landlord: true },
      { id: 'internet', label: 'Internet', tenant: true, landlord: false },
      { id: 'garbage', label: 'Garbage Collection', tenant: false, landlord: true },
      { id: 'parking', label: 'Parking', tenant: true, landlord: false },
    ],
    extras: [
      { id: 'repairs', label: 'Repairs (Major / Minor)', tenant: false, landlord: true },
      { id: 'plumbing', label: 'Plumbing Issues', tenant: false, landlord: true },
      { id: 'electrical', label: 'Electrical Issues', tenant: false, landlord: true },
      { id: 'light_bulbs', label: 'Light Bulbs', tenant: true, landlord: false },
      { id: 'cleaning', label: 'Cleaning', tenant: true, landlord: false },
    ],
  },
  appendSignature: true,
  termination: { noticePeriod: 30 },
};

type TabId = 'financial' | 'policy' | 'logistics' | 'legal';

export default function ContractSettingsModal({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const rawSettings = useSettings(selectedBusiness?.id);
  const { insert, update } = useCoreMutations();
  const { showSnackbar } = useSnackbar();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();
  const { user } = useAuth();

  const [settings, setSettings] = useState<ContractSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<TabId>('financial');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const handleDismiss = () => {
    setSettings(DEFAULT_SETTINGS);
    setActiveTab('financial');
    setInitializedKey(null);
    onDismiss();
  };

  const loadSettings = React.useCallback(() => {
    try {
      setLoading(true);
      const contractSetting = (rawSettings || []).find(
        (s: any) => s.setting_key === 'contract_settings',
      ) as any;

      if (contractSetting?.setting_value) {
        let saved = contractSetting.setting_value as any;
        if (typeof saved === 'string') {
          try {
            saved = JSON.parse(saved);
          } catch {}
        }
        setSettings({
          ...DEFAULT_SETTINGS,
          ...saved,
          securityDeposit: {
            ...DEFAULT_SETTINGS.securityDeposit,
            ...saved.securityDeposit,
          },
          paymentTerms: { ...DEFAULT_SETTINGS.paymentTerms, ...saved.paymentTerms },
          restrictions: { ...DEFAULT_SETTINGS.restrictions, ...saved.restrictions },
          maintenance: {
            utilities:
              saved.maintenance?.utilities ?? DEFAULT_SETTINGS.maintenance.utilities,
            extras: saved.maintenance?.extras ?? DEFAULT_SETTINGS.maintenance.extras,
          },
          termination: { ...DEFAULT_SETTINGS.termination, ...saved.termination },
        });
      }
    } finally {
      setLoading(false);
    }
  }, [rawSettings]);

  useEffect(() => {
    if (!visible || !selectedBusiness?.id) return;
    if (initializedKey === selectedBusiness.id) return;

    loadSettings();
    setInitializedKey(selectedBusiness.id);
  }, [visible, selectedBusiness?.id, loadSettings, initializedKey]);

  const handleSave = async () => {
    if (!selectedBusiness?.id) return;
    try {
      setSaving(true);

      if (!user) throw new Error('Not authenticated');

      const existingSetting = (rawSettings || []).find(
        (s: any) => s.setting_key === 'contract_settings',
      ) as any;

      if (existingSetting) {
        await update('settings', existingSetting.id, {
          setting_value: settings as any,
        });
      } else {
        const id = generateUUID();
        await insert('settings', {
          id,
          business_id: selectedBusiness.id,
          user_id: user.id,
          setting_key: 'contract_settings',
          setting_value: settings as any,
          deleted: false,
        } as any);
      }

      showSnackbar('Settings saved', 'success');
      handleDismiss();
    } catch (_error) {
      showSnackbar('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'financial', label: 'Financial', icon: 'cash' },
    { id: 'policy', label: 'Policy', icon: 'gavel' },
    { id: 'logistics', label: 'Logistics', icon: 'wrench' },
    { id: 'legal', label: 'Legal', icon: 'file-document' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'financial':
        return (
          <View style={styles.tabContent}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Security Deposit
            </Text>
            <View style={styles.row}>
              <Text variant="bodyLarge">Require Security Deposit</Text>
              <Switch
                value={settings.securityDeposit.required}
                onValueChange={v =>
                  setSettings(p => ({
                    ...p,
                    securityDeposit: { ...p.securityDeposit, required: v },
                  }))
                }
              />
            </View>
            {settings.securityDeposit.required && (
              <View style={[styles.nested, { borderLeftColor: colors.outlineVariant }]}>
                <TextInput
                  label="Amount Multiplier"
                  value={settings.securityDeposit.amount.toString()}
                  onChangeText={v =>
                    setSettings(p => ({
                      ...p,
                      securityDeposit: {
                        ...p.securityDeposit,
                        amount: parseFloat(v) || 0,
                      },
                    }))
                  }
                  mode="outlined"
                  keyboardType="numeric"
                  style={styles.input}
                />
                <View style={styles.row}>
                  <Text variant="bodyLarge">Refundable</Text>
                  <Switch
                    value={settings.securityDeposit.refundable}
                    onValueChange={v =>
                      setSettings(p => ({
                        ...p,
                        securityDeposit: { ...p.securityDeposit, refundable: v },
                      }))
                    }
                  />
                </View>
              </View>
            )}
            <Divider style={styles.divider} />
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Payment Terms
            </Text>
            <TextInput
              label="Due Date (Day of Month)"
              value={settings.paymentTerms.dueDate.toString()}
              onChangeText={v =>
                setSettings(p => ({
                  ...p,
                  paymentTerms: { ...p.paymentTerms, dueDate: parseInt(v, 10) || 0 },
                }))
              }
              mode="outlined"
              keyboardType="numeric"
              style={styles.input}
            />
            <TextInput
              label="Grace Period (Days)"
              value={settings.paymentTerms.gracePeriod.toString()}
              onChangeText={v =>
                setSettings(p => ({
                  ...p,
                  paymentTerms: { ...p.paymentTerms, gracePeriod: parseInt(v, 10) || 0 },
                }))
              }
              mode="outlined"
              keyboardType="numeric"
              style={styles.input}
            />
            <TextInput
              label="Late Fee"
              value={settings.paymentTerms.lateFee.toString()}
              onChangeText={v =>
                setSettings(p => ({
                  ...p,
                  paymentTerms: { ...p.paymentTerms, lateFee: parseFloat(v) || 0 },
                }))
              }
              mode="outlined"
              keyboardType="numeric"
              style={styles.input}
            />
          </View>
        );

      case 'policy':
        return (
          <View style={styles.tabContent}>
            {Object.entries(settings.restrictions).map(([key, value]) => (
              <View key={key} style={styles.itemBlock}>
                <View style={styles.row}>
                  <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>
                    {properCase(key)}
                  </Text>
                  <Switch
                    value={value.allowed}
                    onValueChange={v =>
                      setSettings(p => ({
                        ...p,
                        restrictions: {
                          ...p.restrictions,
                          [key]: { ...value, allowed: v },
                        },
                      }))
                    }
                  />
                </View>
                <TextInput
                  label="Details & Conditions"
                  value={value.details}
                  onChangeText={t =>
                    setSettings(p => ({
                      ...p,
                      restrictions: {
                        ...p.restrictions,
                        [key]: { ...value, details: t },
                      },
                    }))
                  }
                  mode="outlined"
                  dense
                  style={{ fontSize: 13, marginTop: 4 }}
                />
                <Divider style={styles.divider} />
              </View>
            ))}
          </View>
        );

      case 'logistics':
        return (
          <View style={styles.tabContent}>
            <Text variant="labelLarge" style={styles.groupHeader}>
              UTILITIES
            </Text>
            {settings.maintenance.utilities.map(u => (
              <View key={u.id} style={styles.maintenanceRow}>
                <Text style={styles.tableLabel}>{u.label}</Text>
                <View style={styles.tableCheck}>
                  <Checkbox
                    status={u.tenant ? 'checked' : 'unchecked'}
                    onPress={() => {
                      const next = settings.maintenance.utilities.map(x =>
                        x.id === u.id ? { ...x, tenant: !x.tenant } : x,
                      );
                      setSettings(p => ({
                        ...p,
                        maintenance: { ...p.maintenance, utilities: next },
                      }));
                    }}
                  />
                </View>
                <View style={styles.tableCheck}>
                  <Checkbox
                    status={u.landlord ? 'checked' : 'unchecked'}
                    onPress={() => {
                      const next = settings.maintenance.utilities.map(x =>
                        x.id === u.id ? { ...x, landlord: !x.landlord } : x,
                      );
                      setSettings(p => ({
                        ...p,
                        maintenance: { ...p.maintenance, utilities: next },
                      }));
                    }}
                  />
                </View>
              </View>
            ))}
            <Text variant="labelLarge" style={[styles.groupHeader, { marginTop: 20 }]}>
              MAINTENANCE
            </Text>
            {settings.maintenance.extras.map(e => (
              <View key={e.id} style={styles.maintenanceRow}>
                <Text style={styles.tableLabel}>{e.label}</Text>
                <View style={styles.tableCheck}>
                  <Checkbox
                    status={e.tenant ? 'checked' : 'unchecked'}
                    onPress={() => {
                      const next = settings.maintenance.extras.map(x =>
                        x.id === e.id ? { ...x, tenant: !x.tenant } : x,
                      );
                      setSettings(p => ({
                        ...p,
                        maintenance: { ...p.maintenance, extras: next },
                      }));
                    }}
                  />
                </View>
                <View style={styles.tableCheck}>
                  <Checkbox
                    status={e.landlord ? 'checked' : 'unchecked'}
                    onPress={() => {
                      const next = settings.maintenance.extras.map(x =>
                        x.id === e.id ? { ...x, landlord: !x.landlord } : x,
                      );
                      setSettings(p => ({
                        ...p,
                        maintenance: { ...p.maintenance, extras: next },
                      }));
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
        );

      case 'legal':
        return (
          <View style={styles.tabContent}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Termination
            </Text>
            <TextInput
              label="Notice Period (Days)"
              value={settings.termination.noticePeriod.toString()}
              onChangeText={v =>
                setSettings(p => ({
                  ...p,
                  termination: { noticePeriod: parseInt(v, 10) || 0 },
                }))
              }
              mode="outlined"
              keyboardType="numeric"
              style={styles.input}
            />
            <Divider style={styles.divider} />
            <Text variant="titleMedium" style={styles.sectionTitle}>
              E-Signature
            </Text>
            <View style={styles.row}>
              <Text variant="bodyLarge">Append Signature</Text>
              <Switch
                value={settings.appendSignature ?? true}
                onValueChange={v => setSettings(p => ({ ...p, appendSignature: v }))}
              />
            </View>
            {settings.customSignatureSVG && (
              <View style={[styles.fileCard, { borderColor: colors.outlineVariant }]}>
                <View style={styles.fileInfo}>
                  <MaterialCommunityIcons
                    name="file-image-outline"
                    size={24}
                    color={colors.primary}
                  />
                  <Text variant="bodyMedium" style={styles.fileName}>
                    Signature.svg
                  </Text>
                </View>
                <IconButton
                  icon="delete-outline"
                  iconColor={colors.error}
                  onPress={() =>
                    setSettings(p => ({ ...p, customSignatureSVG: undefined }))
                  }
                />
              </View>
            )}
            <Button
              mode="outlined"
              icon="upload"
              disabled={!!settings.customSignatureSVG}
              onPress={async () => {
                pauseAutoLock();
                try {
                  const r = await DocumentPicker.getDocumentAsync({
                    type: 'image/svg+xml',
                  });
                  if (!r.canceled) {
                    const f = new File(r.assets[0].uri);
                    const b64 = await f.base64();
                    if (b64)
                      setSettings(p => ({
                        ...p,
                        customSignatureSVG: b64,
                        appendSignature: true,
                      }));
                  }
                } finally {
                  resumeAutoLock();
                }
              }}
              style={{ marginTop: 12 }}
            >
              Upload SVG
            </Button>
          </View>
        );
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={handleDismiss}
      title="Contract Settings"
      subtitle="Manage property contracts"
      maxHeight="80%"
      actions={[
        {
          label: 'Save Changes',
          onPress: handleSave,
          loading: saving,
          disabled: saving,
          mode: 'contained' as const,
        },
      ]}
    >
      <View style={[styles.navBar, { borderBottomColor: colors.outlineVariant }]}>
        {tabs.map(tab => (
          <SPressable
            key={tab.id}
            style={[
              styles.navItem,
              activeTab === tab.id && { borderBottomColor: colors.primary },
            ]}
            onPress={() => setActiveTab(tab.id)}
          >
            <MaterialCommunityIcons
              name={tab.icon as any}
              size={20}
              color={activeTab === tab.id ? colors.primary : colors.onSurfaceVariant}
            />
            <Text
              variant="labelSmall"
              style={{
                color: activeTab === tab.id ? colors.primary : colors.onSurfaceVariant,
                marginTop: 2,
              }}
            >
              {tab.label}
            </Text>
          </SPressable>
        ))}
      </View>

      {activeTab === 'logistics' && !loading && (
        <View
          style={[
            styles.tableHeader,
            styles.stickyHeader,
            { borderBottomColor: colors.outlineVariant },
          ]}
        >
          <Text style={styles.tableLabel}>Responsibility</Text>
          <View style={styles.tableCheck}>
            <Text variant="labelSmall" style={{ fontWeight: 'bold' }}>
              Tenant
            </Text>
          </View>
          <View style={styles.tableCheck}>
            <Text variant="labelSmall" style={{ fontWeight: 'bold' }}>
              Landlord
            </Text>
          </View>
        </View>
      )}

      <KeyboardScroll
        style={[styles.container, { backgroundColor: colors.surface }]}
        contentContainerStyle={styles.content}
        useSafeArea={false}
      >
        {loading ? (
          <View style={styles.center}>
            <Text>Loading...</Text>
          </View>
        ) : (
          renderContent()
        )}
      </KeyboardScroll>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingVertical: 4,
  },
  center: {
    padding: 12,
    alignItems: 'center',
  },
  navBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  navItem: {
    paddingVertical: 8,
    alignItems: 'center',
    flex: 1,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabContent: {
    flex: 1,
  },
  sectionTitle: {
    fontWeight: 'bold',
    marginVertical: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nested: {
    paddingLeft: 12,
    borderLeftWidth: 1,
    marginBottom: 8,
  },
  input: {
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  divider: {
    marginVertical: 8,
    opacity: 0.5,
  },
  itemBlock: {
    marginBottom: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    marginBottom: 8,
    opacity: 0.5,
  },
  tableLabel: {
    flex: 2,
  },
  tableCheck: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  maintenanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  groupHeader: {
    opacity: 0.5,
    letterSpacing: 1,
    marginBottom: 4,
  },
  stickyHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    backgroundColor: 'transparent',
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 12,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  fileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileName: {
    marginLeft: 12,
    fontWeight: '500',
  },
});
