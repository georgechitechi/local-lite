import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import TenantForm, {
  type NextOfKin,
  type TenantFormData,
} from '@/features/tenants/components/TenantForm';
import { useTenantForm } from '@/features/tenants/hooks/useTenantForm';
import { updateTenantStatus } from '@/features/tenants/utils/tenantStatus';
import { Protect } from '@/shared/access';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import LoadingCard from '@/shared/components/LoadingCard';
import { useCoreMutations, useTenants } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import {
  capitalizeEachWord,
  generateUUID,
  normalizePhoneNumber,
  properCase,
} from '@/shared/utils/helper';
import { isActiveTenantStatus, isFormerTenantStatus } from '@/shared/utils/statusHelper';

export default function EditTenantScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { showSnackbar } = useSnackbar();
  const { selectedBusiness } = useBusiness();
  const { update } = useCoreMutations();
  const tenants = useTenants(selectedBusiness?.id);
  const colors = useThemeColors();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [initializedId, setInitializedId] = useState<string | null>(null);

  const {
    form,
    setForm,
    errors,
    updateForm,
    addNextOfKin,
    removeNextOfKin,
    updateNextOfKin,
    validateForm,
    cleanNextOfKin,
    checkDuplicates,
  } = useTenantForm();

  useEffect(() => {
    if (initializedId === id) return;

    if (!loading) {
      setLoading(true);
    }

    const tenant = tenants.find(t => t.id === id);

    if (tenant) {
      let parsedKin: NextOfKin[] = [];
      if (tenant.next_of_kin) {
        if (Array.isArray(tenant.next_of_kin)) {
          parsedKin = tenant.next_of_kin.map((k: any) => ({
            id: k.id || generateUUID(),
            name: k.name || '',
            relationship: k.relationship || '',
            phone: k.phone || '',
            is_primary: k.is_primary || false,
          }));
        }
      }

      // Ensure at least one empty field if none exists
      if (parsedKin.length === 0) {
        parsedKin = [
          {
            id: generateUUID(),
            name: '',
            relationship: '',
            phone: '',
            is_primary: false,
          },
        ];
      }

      setForm({
        ...tenant,
        next_of_kin: parsedKin,
      } as unknown as TenantFormData);
      setLoading(false);
      setInitializedId(id);
    } else if (tenants.length > 0) {
      showSnackbar('Tenant not found', 'error');
      router.push(`/(tabs)/tenants`);
      setLoading(false);
      setInitializedId(id);
    }
  }, [id, tenants, router, loading, initializedId, showSnackbar, setForm]);

  const handleSubmit = async () => {
    if (!validateForm() || !id) return;

    const duplicateError = checkDuplicates(tenants, id);
    if (duplicateError) {
      showSnackbar(duplicateError, 'error');
      return;
    }

    setSaving(true);
    try {
      await update('tenants', id, {
        name: capitalizeEachWord(form.name),
        phone: normalizePhoneNumber(form.phone),
        email: form.email?.trim() ? form.email.toLowerCase() : null,
        address: form.address,
        gender: form.gender,
        marital_status: form.marital_status,
        nationality: form.nationality,
        next_of_kin: cleanNextOfKin(),
      } as any);

      showSnackbar('Tenant updated successfully!', 'success');
      router.push('/tenants');
    } catch (error: any) {
      showSnackbar(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!id) return;

    try {
      await updateTenantStatus({
        tenantId: id,
        newStatus,
      });

      setForm(prev => ({
        ...prev,
        status: newStatus,
      }));

      setShowStatusDialog(false);
      showSnackbar('Tenant status updated successfully!', 'success');
    } catch (error: any) {
      console.error('handleStatusChange error:', error);
      showSnackbar(error.message || 'Failed to update tenant status.', 'error');
    }
  };

  const getStatusColor = (status: string): string => {
    if (isActiveTenantStatus(status)) {
      return (colors as any).success;
    }
    if (isFormerTenantStatus(status)) {
      return (colors as any).warning;
    }
    if (status === 'blacklisted') {
      return colors.error;
    }
    return colors.onSurfaceVariant;
  };

  if (loading) {
    return <LoadingCard iconName="account-group" text="Loading tenant..." />;
  }

  return (
    <Protect action="edit" resource="tenant">
      <KeyboardScroll
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <View>
          <View style={styles.header}>
            <Text variant="titleLarge">Edit Tenant</Text>
            <Button
              mode="outlined"
              onPress={() => setShowStatusDialog(true)}
              style={[
                styles.statusButton,
                { borderColor: getStatusColor(form.status || '') },
              ]}
              textColor={getStatusColor(form.status || '')}
            >
              Status: {properCase(form.status || '')}
            </Button>
          </View>

          <TenantForm
            form={form}
            errors={errors}
            updateForm={updateForm}
            addNextOfKin={addNextOfKin}
            removeNextOfKin={removeNextOfKin}
            updateNextOfKin={updateNextOfKin}
          />
          <Button
            mode="contained"
            onPress={handleSubmit}
            style={styles.button}
            icon="content-save"
            loading={saving}
          >
            Save Changes
          </Button>
        </View>

        <Portal>
          <Dialog visible={showStatusDialog} onDismiss={() => setShowStatusDialog(false)}>
            <Dialog.Title>Change Tenant Status</Dialog.Title>
            <Dialog.Content>
              <View style={styles.statusOptions}>
                <Button
                  mode={isActiveTenantStatus(form.status) ? 'contained' : 'outlined'}
                  onPress={() => handleStatusChange('active')}
                  style={[
                    styles.statusOption,
                    isActiveTenantStatus(form.status) && {
                      backgroundColor: getStatusColor('active'),
                    },
                  ]}
                >
                  Active
                </Button>
                <Button
                  mode={isFormerTenantStatus(form.status) ? 'contained' : 'outlined'}
                  onPress={() => handleStatusChange('former')}
                  style={[
                    styles.statusOption,
                    isFormerTenantStatus(form.status) && {
                      backgroundColor: getStatusColor('former'),
                    },
                  ]}
                >
                  Former
                </Button>
                <Button
                  mode={form.status === 'blacklisted' ? 'contained' : 'outlined'}
                  onPress={() => handleStatusChange('blacklisted')}
                  style={[
                    styles.statusOption,
                    form.status === 'blacklisted' && {
                      backgroundColor: getStatusColor('blacklisted'),
                    },
                  ]}
                >
                  Blacklisted
                </Button>
              </View>
            </Dialog.Content>
          </Dialog>
        </Portal>
      </KeyboardScroll>
    </Protect>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  statusButton: {
    minWidth: 120,
  },
  button: {
    marginTop: 20,
    marginBottom: 40,
  },
  statusOptions: {
    gap: 10,
  },
  statusOption: {
    marginVertical: 4,
  },
});
