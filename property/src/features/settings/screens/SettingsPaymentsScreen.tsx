import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import {
  Button,
  Divider,
  IconButton,
  List,
  Menu,
  SegmentedButtons,
  Surface,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import {
  defaultPaymentMethods,
  getPaymentMethodDisplayInfo,
  paymentTypes,
} from '@/features/payments/utils/paymentsHelper';
import BaseModal from '@/shared/components/BaseModal';
import LoadingCard from '@/shared/components/LoadingCard';
import { useCoreMutations, useSettings, useStoreRefresh } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { getUser } from '@/shared/services/auth';
import { generateUUID, properCase } from '@/shared/utils/helper';

interface PaymentMethod {
  id: string;
  type: string;
  paybill_number?: string;
  account_number?: string;
  till_number?: string;
  business_name?: string;
  bank_name?: string;
  account_name?: string;
  default?: boolean;
}

interface PaymentMethodForm {
  type: string;
  paybill_number: string;
  account_number: string;
  till_number: string;
  business_name: string;
  bank_name: string;
  account_name: string;
}

export default function PaymentMethodsScreen() {
  const colors = useThemeColors();
  const { selectedBusiness, requireBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddEditDialog, setShowAddEditDialog] = useState(false);
  const [newPaymentMethod, setNewPaymentMethod] = useState<PaymentMethodForm>({
    type: 'paybill',
    paybill_number: '',
    account_number: '',
    till_number: '',
    business_name: '',
    bank_name: '',
    account_name: '',
  });
  const [editingPaymentMethod, setEditingPaymentMethod] = useState<PaymentMethod | null>(
    null,
  );
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);

  // Local-Lite SQLite store
  const allSettings = useSettings(selectedBusiness?.id);
  const { insert, update } = useCoreMutations();
  const { refreshing, onRefresh } = useStoreRefresh();

  // Current user ID
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    getUser().then(u => setUserId(u?.id || null));
  }, []);

  // Compute payment methods from settings in store
  const paymentMethods = useMemo<PaymentMethod[]>(() => {
    const paymentSetting = allSettings.find(s => s?.setting_key === 'payment_methods');

    if (paymentSetting?.setting_value) {
      let val = paymentSetting.setting_value;
      if (typeof val === 'string') {
        try {
          val = JSON.parse(val);
        } catch {
          return defaultPaymentMethods;
        }
      }
      if (Array.isArray(val)) {
        return val as unknown as PaymentMethod[];
      }
    }

    return defaultPaymentMethods;
  }, [allSettings]);

  useEffect(() => {
    if (requireBusiness() && selectedBusiness?.id) {
      setLoading(false);
    }
  }, [selectedBusiness, requireBusiness]);

  const savePaymentMethodsToStore = async (updatedMethods: PaymentMethod[]) => {
    if (!selectedBusiness?.id || !userId) return;

    try {
      setSaving(true);
      const existingSetting = allSettings.find(s => s.setting_key === 'payment_methods');

      if (existingSetting) {
        await update('settings', existingSetting.id, {
          setting_value: updatedMethods,
        });
      } else {
        const newId = generateUUID();
        await insert('settings', {
          id: newId,
          business_id: selectedBusiness.id,
          user_id: userId,
          setting_key: 'payment_methods',
          setting_value: updatedMethods,
        });
      }
    } catch (error: any) {
      console.error('Error saving payment methods:', error);
      showSnackbar('Failed to save payment methods', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePaymentMethod = async () => {
    const paymentType = paymentTypes[newPaymentMethod.type];
    if (!paymentType) {
      showSnackbar('Invalid payment type.', 'error');
      return;
    }

    const requiredFields = paymentType.fields.filter(field => field.required);

    for (const field of requiredFields) {
      const value = newPaymentMethod[field.key as keyof PaymentMethodForm];
      if (!value?.toString().trim()) {
        showSnackbar(`${field.label} is required.`, 'error');
        return;
      }
    }

    let updatedMethods: PaymentMethod[];
    if (editingPaymentMethod) {
      updatedMethods = paymentMethods.map((m: PaymentMethod) =>
        m.id === editingPaymentMethod.id ? { ...m, ...newPaymentMethod } : m,
      );
    } else {
      updatedMethods = [
        ...paymentMethods,
        {
          id: generateUUID(),
          ...newPaymentMethod,
          default: false,
        } as PaymentMethod,
      ];
    }

    await savePaymentMethodsToStore(updatedMethods);
    showSnackbar(
      `Payment method ${editingPaymentMethod ? 'updated' : 'added'} successfully.`,
      'success',
    );
    setNewPaymentMethod({
      type: 'paybill',
      paybill_number: '',
      account_number: '',
      till_number: '',
      business_name: '',
      bank_name: '',
      account_name: '',
    });
    setEditingPaymentMethod(null);
    setShowAddEditDialog(false);
  };

  const handleDeletePaymentMethod = async (id: string) => {
    const methodToDelete = paymentMethods.find(m => m.id === id);
    if (methodToDelete?.default) {
      showSnackbar(
        'Cannot delete default payment method. Please set another method as default first.',
        'error',
      );
      return;
    }

    setMethodToDeleteId(id);
    setShowDeleteConfirm(true);
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [methodToDeleteId, setMethodToDeleteId] = useState<string | null>(null);

  const handleSetDefault = async (id: string) => {
    const updatedMethods = paymentMethods.map((m: PaymentMethod) => ({
      ...m,
      default: m.id === id,
    }));
    await savePaymentMethodsToStore(updatedMethods);
    showSnackbar('Default payment method updated', 'success');
  };

  const openAddEditDialog = (method: PaymentMethod | null = null) => {
    if (method) {
      setEditingPaymentMethod(method);
      setNewPaymentMethod({
        type: method.type || 'paybill',
        paybill_number: method.paybill_number || '',
        account_number: method.account_number || '',
        till_number: method.till_number || '',
        business_name: method.business_name || '',
        bank_name: method.bank_name || '',
        account_name: method.account_name || '',
      });
    } else {
      setEditingPaymentMethod(null);
      setNewPaymentMethod({
        type: 'paybill',
        paybill_number: '',
        account_number: '',
        till_number: '',
        business_name: '',
        bank_name: '',
        account_name: '',
      });
    }
    setShowAddEditDialog(true);
  };

  const openMenu = (method: PaymentMethod) => {
    setSelectedMethod(method);
    setMenuVisible(true);
  };

  const closeMenu = () => {
    setMenuVisible(false);
    setSelectedMethod(null);
  };

  if (loading) {
    return <LoadingCard iconName="cash-multiple" text="Loading payments..." />;
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.content}>
        <Surface style={styles.surface} elevation={2}>
          <List.Subheader>Available Payment Methods</List.Subheader>
          {paymentMethods.length > 0 ? (
            paymentMethods.map((method: PaymentMethod, index: number) => {
              const displayInfo = getPaymentMethodDisplayInfo(method as any);

              return (
                <React.Fragment key={method.id}>
                  <List.Item
                    title={displayInfo.title}
                    description={`${displayInfo.description} \n${displayInfo.type}`}
                    right={props => (
                      <View style={styles.actionButtons}>
                        <Switch
                          value={method.default || false}
                          onValueChange={() => handleSetDefault(method.id)}
                          thumbColor={method.default ? colors.primary : undefined}
                          trackColor={{ true: colors.primaryContainer }}
                        />
                        <Menu
                          visible={menuVisible && selectedMethod?.id === method.id}
                          onDismiss={closeMenu}
                          anchor={
                            <IconButton
                              {...props}
                              icon="dots-vertical"
                              onPress={() => openMenu(method)}
                              disabled={saving}
                            />
                          }
                        >
                          <Menu.Item
                            onPress={() => {
                              closeMenu();
                              openAddEditDialog(method);
                            }}
                            title="Edit"
                            leadingIcon="pencil"
                          />
                          <Menu.Item
                            onPress={() => {
                              closeMenu();
                              handleDeletePaymentMethod(method.id);
                            }}
                            title="Delete"
                            leadingIcon="delete"
                            disabled={method.default}
                          />
                        </Menu>
                      </View>
                    )}
                  />
                  {index < paymentMethods.length - 1 && <Divider />}
                </React.Fragment>
              );
            })
          ) : (
            <Text style={styles.emptyText}>
              No payment methods added yet. Click &quot;Add Payment Method&quot; to get
              started.
            </Text>
          )}
        </Surface>

        <Button
          mode="outlined"
          onPress={() => openAddEditDialog()}
          style={styles.addButton}
          icon="plus"
          disabled={saving}
        >
          Add Payment Method
        </Button>
      </View>

      <BaseModal
        visible={showAddEditDialog}
        onDismiss={() => setShowAddEditDialog(false)}
        title={editingPaymentMethod ? 'Edit Payment Method' : 'Add Payment Method'}
        subtitle="Manage payments and receipts"
        scrollable={true}
        actions={[
          {
            label: 'Cancel',
            onPress: () => setShowAddEditDialog(false),
            mode: 'outlined',
            disabled: saving,
          },
          {
            label: editingPaymentMethod ? 'Save Changes' : 'Add',
            onPress: handleSavePaymentMethod,
            mode: 'contained',
            loading: saving,
            disabled: saving,
          },
        ]}
      >
        <Text style={{ ...styles.sectionTitle, color: colors.onBackground }}>
          Payment Type
        </Text>
        <SegmentedButtons
          value={newPaymentMethod.type}
          onValueChange={value =>
            setNewPaymentMethod(prev => ({
              ...prev,
              type: value,
              // Clear fields when changing type
              paybill_number: '',
              account_number: '',
              till_number: '',
              business_name: '',
              bank_name: '',
              account_name: '',
            }))
          }
          buttons={Object.entries(paymentTypes).map(([key, type]) => ({
            value: key,
            label: properCase(type.name),
          }))}
          style={styles.segmentedButtons}
        />

        <Text style={{ ...styles.sectionTitle, color: colors.onBackground }}>
          Payment Details
        </Text>
        {paymentTypes[newPaymentMethod.type]?.fields.map(field => (
          <TextInput
            key={field.key}
            label={field.label}
            value={newPaymentMethod[field.key as keyof PaymentMethodForm] || ''}
            onChangeText={text =>
              setNewPaymentMethod(prev => ({
                ...prev,
                [field.key]: text,
              }))
            }
            mode="outlined"
            style={styles.input}
            keyboardType={field.type === 'numeric' ? 'numeric' : 'default'}
          />
        ))}
      </BaseModal>

      <BaseModal
        mode="confirm"
        visible={showDeleteConfirm}
        onDismiss={() => {
          setShowDeleteConfirm(false);
          setMethodToDeleteId(null);
        }}
        onConfirm={async () => {
          if (methodToDeleteId) {
            const updatedMethods = paymentMethods.filter(
              (m: PaymentMethod) => m.id !== methodToDeleteId,
            );
            await savePaymentMethodsToStore(updatedMethods);
            showSnackbar('Payment method deleted successfully', 'success');
          }
          setShowDeleteConfirm(false);
          setMethodToDeleteId(null);
        }}
        title="Delete Payment Method"
        message="Are you sure you want to delete this payment method?"
        confirmText="Delete"
        destructive={true}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  surface: {
    marginBottom: 16,
    borderRadius: 8,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 20,
  },
  addButton: {
    marginTop: 16,
    marginBottom: 16,
  },
  input: {
    marginBottom: 10,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  segmentedButtons: {
    marginBottom: 16,
  },
});
