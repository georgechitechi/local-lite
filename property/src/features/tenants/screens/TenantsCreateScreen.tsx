import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import TenantForm from '@/features/tenants/components/TenantForm';
import { useTenantForm } from '@/features/tenants/hooks/useTenantForm';
import { useAuth } from '@/providers/AuthProvider';
import { Protect } from '@/shared/access';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import { useCoreMutations, useTenants } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { sendNotification } from '@/shared/services/notifications';
import {
  capitalizeEachWord,
  generateUUID,
  normalizePhoneNumber,
} from '@/shared/utils/helper';

export default function CreateTenantScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { name, phone } = useLocalSearchParams<{ name?: string; phone?: string }>();
  const { showSnackbar } = useSnackbar();
  const { selectedBusiness, requireBusiness } = useBusiness();
  const tenants = useTenants(selectedBusiness?.id);
  const { insert } = useCoreMutations();
  const colors = useThemeColors();
  const [loading, setLoading] = useState(false);

  const {
    form,
    setForm,
    errors,
    resetForm,
    updateForm,
    addNextOfKin,
    removeNextOfKin,
    updateNextOfKin,
    validateForm,
    cleanNextOfKin,
    checkDuplicates,
  } = useTenantForm();

  React.useEffect(() => {
    if (name || phone) {
      setForm(prev => ({
        ...prev,
        name: name ? decodeURIComponent(name) : prev.name,
        phone: phone ? decodeURIComponent(phone) : prev.phone,
      }));
    }
  }, [name, phone, setForm]);

  const handleSubmit = async () => {
    if (!validateForm() || !requireBusiness()) return;

    const duplicateError = checkDuplicates(tenants);
    if (duplicateError) {
      showSnackbar(duplicateError, 'error');
      return;
    }

    setLoading(true);
    try {
      if (!user) throw new Error('User not authenticated');

      const id = generateUUID();
      const tenantData = {
        id,
        name: capitalizeEachWord(form.name),
        phone: normalizePhoneNumber(form.phone),
        email: form.email?.trim() ? form.email.toLowerCase() : null,
        address: form.address,
        gender: form.gender,
        marital_status: form.marital_status,
        nationality: form.nationality,
        next_of_kin: cleanNextOfKin(),
        business_id: selectedBusiness?.id || '',
        user_id: user.id,
        status: 'active',
      } as any;

      await insert('tenants', tenantData);

      sendNotification(
        'New Tenant Added',
        `${tenantData.name} has been successfully added as a tenant.`,
        { type: 'tenant', tenantId: id },
      ).catch(() => {});

      showSnackbar('Tenant created successfully', 'success');
      resetForm();
      router.replace('/(tabs)/tenants');
    } catch (error: any) {
      console.error('Error creating tenant:', error);
      showSnackbar(`Failed to create tenant: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Protect action="create" resource="tenant">
      <KeyboardScroll
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <View>
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
            icon="check"
            loading={loading}
            disabled={loading}
          >
            Create Tenant
          </Button>
        </View>
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
  button: {
    marginTop: 20,
    marginBottom: 40,
  },
});
