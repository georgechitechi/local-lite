import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Divider,
  IconButton,
  List,
  Menu,
  Surface,
  Switch,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import LoadingCard from '@/shared/components/LoadingCard';
import { useCoreMutations, useSettings } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { getUser } from '@/shared/services/auth';
import { defaultCurrencies } from '@/shared/utils/formatters';
import { generateUUID } from '@/shared/utils/helper';

interface Currency {
  code: string;
  symbol: string;
  name: string;
  default: boolean;
}

interface NewCurrency {
  code: string;
  symbol: string;
  name: string;
  default: boolean;
}

export default function CurrencySettingsScreen() {
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const { selectedBusiness, requireBusiness } = useBusiness();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newCurrency, setNewCurrency] = useState<NewCurrency>({
    code: '',
    symbol: '',
    name: '',
    default: false,
  });
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectedCurrencyIndex, setSelectedCurrencyIndex] = useState<number | null>(null);
  const [editingCurrencyIndex, setEditingCurrencyIndex] = useState<number | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);

  // Local-Lite SQLite store
  const allSettings = useSettings(selectedBusiness?.id);
  const { insert, update } = useCoreMutations();

  // Current user ID
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    getUser().then(u => setUserId(u?.id || null));
  }, []);

  // Compute currencies from settings in store
  const currencies = useMemo<Currency[]>(() => {
    const currencySetting = allSettings.find(s => s?.setting_key === 'currency_settings');

    if (currencySetting?.setting_value) {
      let val = currencySetting.setting_value;
      if (typeof val === 'string') {
        try {
          val = JSON.parse(val);
        } catch {
          return defaultCurrencies;
        }
      }
      if (Array.isArray(val)) {
        return val as unknown as Currency[];
      }
    }

    return defaultCurrencies;
  }, [allSettings]);

  useEffect(() => {
    if (requireBusiness() && selectedBusiness?.id) {
      setLoading(false);
    }
  }, [selectedBusiness, requireBusiness]);

  const saveCurrenciesToStore = async (updatedCurrencies: Currency[]) => {
    if (!selectedBusiness?.id || !userId) return;

    try {
      setSaving(true);
      const existingSetting = allSettings.find(
        s => s.setting_key === 'currency_settings',
      );

      if (existingSetting) {
        await update('settings', existingSetting.id, {
          setting_value: updatedCurrencies,
        });
      } else {
        const newId = generateUUID();
        await insert('settings', {
          id: newId,
          business_id: selectedBusiness.id,
          user_id: userId,
          setting_key: 'currency_settings',
          setting_value: updatedCurrencies,
        });
      }
    } catch (error: any) {
      console.error('Error saving currency settings:', error);
      showSnackbar('Failed to save currency settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (index: number) => {
    const updatedCurrencies = currencies.map((currency, i) => ({
      ...currency,
      default: i === index,
    }));
    await saveCurrenciesToStore(updatedCurrencies);
    showSnackbar('Default currency updated', 'success');
  };

  const handleDelete = async (index: number) => {
    const isDefault = currencies[index].default;
    if (isDefault) {
      showSnackbar(
        'Cannot delete default currency. Please set another currency as default first.',
        'error',
      );
      return;
    }

    const updatedCurrencies = currencies.filter((_, i) => i !== index);
    await saveCurrenciesToStore(updatedCurrencies);
  };

  const handleSaveCurrency = async () => {
    if (!newCurrency.code || !newCurrency.symbol || !newCurrency.name) {
      showSnackbar('Please fill in all fields', 'error');
      return;
    }

    if (editingCurrencyIndex === null) {
      // Create New
      const exists = currencies.some(c => c.code === newCurrency.code);
      if (exists) {
        showSnackbar('Currency code already exists', 'error');
        return;
      }
      const updatedCurrencies = [...currencies, newCurrency];
      await saveCurrenciesToStore(updatedCurrencies);
    } else {
      // Update Existing
      const exists = currencies.some(
        (c, i) => i !== editingCurrencyIndex && c.code === newCurrency.code,
      );
      if (exists) {
        showSnackbar('Currency code already exists', 'error');
        return;
      }
      const updatedCurrencies = [...currencies];
      updatedCurrencies[editingCurrencyIndex] = {
        ...newCurrency,
        default: currencies[editingCurrencyIndex].default,
      };
      await saveCurrenciesToStore(updatedCurrencies);
    }

    setShowAddDialog(false);
    setNewCurrency({ code: '', symbol: '', name: '', default: false });
    setEditingCurrencyIndex(null);
  };

  const handleEdit = (index: number) => {
    const currency = currencies[index];
    setNewCurrency({ ...currency });
    setEditingCurrencyIndex(index);
    setShowAddDialog(true);
  };

  const handleResetDefaults = async () => {
    setShowResetDialog(true);
  };

  const openMenu = (index: number) => {
    setSelectedCurrencyIndex(index);
    setMenuVisible(true);
  };

  const closeMenu = () => {
    setMenuVisible(false);
    setSelectedCurrencyIndex(null);
  };

  if (loading) {
    return <LoadingCard iconName="currency-usd" text="Loading currencies..." />;
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Surface style={styles.surface} elevation={2}>
          <List.Subheader>Available Currencies</List.Subheader>
          {currencies.map((currency, index) => (
            <React.Fragment key={currency.code}>
              <List.Item
                title={currency.name}
                description={`${currency.code} • ${currency.symbol}`}
                right={props => (
                  <View style={styles.actionButtons}>
                    <Switch
                      value={currency.default}
                      onValueChange={() => handleSetDefault(index)}
                    />
                    <Menu
                      visible={menuVisible && selectedCurrencyIndex === index}
                      onDismiss={closeMenu}
                      anchor={
                        <IconButton
                          {...props}
                          icon="dots-vertical"
                          onPress={() => openMenu(index)}
                        />
                      }
                    >
                      <Menu.Item
                        onPress={() => {
                          closeMenu();
                          handleEdit(index);
                        }}
                        title="Edit"
                        leadingIcon="pencil"
                      />
                      <Menu.Item
                        onPress={() => {
                          closeMenu();
                          handleDelete(index);
                        }}
                        title="Delete"
                        leadingIcon="delete"
                        disabled={currency.default}
                      />
                    </Menu>
                  </View>
                )}
              />
              {index < currencies.length - 1 && <Divider />}
            </React.Fragment>
          ))}
        </Surface>

        <Button
          mode="outlined"
          onPress={() => {
            setNewCurrency({ code: '', symbol: '', name: '', default: false });
            setEditingCurrencyIndex(null);
            setShowAddDialog(true);
          }}
          style={styles.addButton}
          icon="plus"
        >
          Add Currency
        </Button>

        <Button
          mode="outlined"
          loading={saving}
          onPress={handleResetDefaults}
          style={styles.resetButton}
          icon="refresh"
        >
          Reset to Defaults
        </Button>

        <BaseModal
          mode="confirm"
          visible={showResetDialog}
          onDismiss={() => setShowResetDialog(false)}
          onConfirm={async () => {
            setShowResetDialog(false);
            await saveCurrenciesToStore(defaultCurrencies);
            showSnackbar('Currency settings reset to defaults', 'success');
          }}
          title="Reset to Defaults"
          message="This will reset all currency settings to default values. Continue?"
          confirmText="Reset"
          destructive={true}
        />

        <BaseModal
          visible={showAddDialog}
          onDismiss={() => setShowAddDialog(false)}
          title={editingCurrencyIndex !== null ? 'Edit Currency' : 'Add Currency'}
          subtitle="Manage your properties"
          scrollable={true}
          actions={[
            {
              label: 'Cancel',
              onPress: () => setShowAddDialog(false),
              mode: 'outlined',
            },
            {
              label: editingCurrencyIndex !== null ? 'Save' : 'Add',
              onPress: handleSaveCurrency,
              mode: 'contained',
            },
          ]}
        >
          <TextInput
            label="Currency Code (e.g., USD)"
            value={newCurrency.code}
            onChangeText={text =>
              setNewCurrency(prev => ({
                ...prev,
                code: text.toUpperCase(),
              }))
            }
            style={styles.input}
            autoCapitalize="characters"
            maxLength={3}
          />
          <TextInput
            label="Symbol (e.g., $)"
            value={newCurrency.symbol}
            onChangeText={text => setNewCurrency(prev => ({ ...prev, symbol: text }))}
            style={styles.input}
          />
          <TextInput
            label="Name (e.g., US Dollar)"
            value={newCurrency.name}
            onChangeText={text => setNewCurrency(prev => ({ ...prev, name: text }))}
            style={styles.input}
          />
        </BaseModal>
      </View>
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
    borderRadius: 8,
    marginBottom: 16,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addButton: {
    marginBottom: 8,
  },
  resetButton: {
    marginBottom: 24,
  },
  input: {
    marginBottom: 16,
  },
});
