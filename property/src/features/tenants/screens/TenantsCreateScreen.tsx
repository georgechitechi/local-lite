import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import TenantForm, {
  type NextOfKin,
  type TenantErrors,
  type TenantFormData,
} from '@/features/tenants/components/TenantForm';
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
import { validateFields, validations } from '@/shared/utils/validations';

export default function CreateTenantScreen() {
  const { user } = useAuth();

  // ... state and hooks ...
  const router = useRouter();
  const { name, phone } = useLocalSearchParams<{ name?: string; phone?: string }>();
  const { showSnackbar } = useSnackbar();
  const { selectedBusiness, requireBusiness } = useBusiness();
  const tenants = useTenants(selectedBusiness?.id);
  const { insert } = useCoreMutations();

  const colors = useThemeColors();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<TenantFormData>({
    name: '',
    phone: '',
    email: '',
    address: '',
    gender: 'male',
    marital_status: 'single',
    nationality: 'Kenyan',
    next_of_kin: [],
  });

  React.useEffect(() => {
    if (name || phone) {
      setForm(prev => ({
        ...prev,
        name: name ? decodeURIComponent(name) : prev.name,
        phone: phone ? decodeURIComponent(phone) : prev.phone,
      }));
    }
  }, [name, phone]);
  const [errors, setErrors] = useState<TenantErrors>({});

  const validateForm = (): boolean => {
    const result = validateFields(form, {
      name: validations.required,
      phone: validations.combine(validations.required, validations.phone),
      email: form.email?.trim() ? validations.email : () => '',
      gender: validations.required,
      marital_status: validations.required,
      nationality: validations.required,
    });
    setErrors(result.errors);
    return result.isValid;
  };

  const resetForm = () => {
    // ... reset logic ...
    setForm({
      name: '',
      phone: '',
      email: '',
      address: '',
      gender: 'male',
      marital_status: 'single',
      nationality: 'Kenyan',
      next_of_kin: [],
    });
    setErrors({});
  };

  // ... helper functions ...
  const addNextOfKin = () => {
    setForm(prev => ({
      ...prev,
      next_of_kin: [
        ...prev.next_of_kin,
        { id: generateUUID(), name: '', relationship: '', phone: '', is_primary: false },
      ],
    }));
  };

  const removeNextOfKin = (index: number) => {
    setForm(prev => ({
      ...prev,
      next_of_kin: prev.next_of_kin.filter((_, i) => i !== index),
    }));
  };

  const updateNextOfKin = (
    index: number,
    field: keyof NextOfKin,
    value: string | boolean,
  ) => {
    setForm(prev => {
      const updatedKin = prev.next_of_kin.map((kin, i) => {
        if (i === index) {
          if (field === 'is_primary' && value === true) {
            return { ...kin, [field]: value };
          }
          return { ...kin, [field]: value };
        }
        if (field === 'is_primary' && value === true) {
          return { ...kin, is_primary: false };
        }
        return kin;
      });

      return {
        ...prev,
        next_of_kin: updatedKin,
      };
    });
  };

  const handleSubmit = async () => {
    // ... submit logic ...
    if (!validateForm() || !requireBusiness()) return;
    setLoading(true);
    try {
      if (!user) throw new Error('User not authenticated');
      const filteredKin = form.next_of_kin
        .filter(kin => kin.name || kin.phone || kin.relationship)
        .map(({ name, relationship, phone, is_primary }) => ({
          name: capitalizeEachWord(name),
          relationship: capitalizeEachWord(relationship),
          phone: normalizePhoneNumber(phone),
          is_primary,
        }));

      const id = generateUUID();

      if (form.email?.trim()) {
        const emailToCheck = form.email.trim().toLowerCase();
        const existingTenant = tenants.find(t => t.email?.toLowerCase() === emailToCheck);

        if (existingTenant) {
          showSnackbar(
            'A tenant with this email already exists in this business.',
            'error',
          );
          setLoading(false);
          return;
        }
      }

      if (form.phone?.trim()) {
        const phoneToCheck = normalizePhoneNumber(form.phone);
        const existingTenant = tenants.find(
          t => normalizePhoneNumber(t.phone) === phoneToCheck,
        );

        if (existingTenant) {
          showSnackbar(
            'A tenant with this phone number already exists in this business.',
            'error',
          );
          setLoading(false);
          return;
        }
      }

      const tenantData = {
        id,
        name: capitalizeEachWord(form.name),
        phone: normalizePhoneNumber(form.phone),
        email: form.email?.trim() ? form.email.toLowerCase() : null,
        address: form.address,
        gender: form.gender,
        marital_status: form.marital_status,
        nationality: form.nationality,
        next_of_kin: filteredKin,
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

  const updateForm = (field: keyof TenantFormData, value: string | NextOfKin[]) => {
    setForm(prev => ({
      ...prev,
      [field]: value,
    }));
    if (errors[field as keyof TenantErrors]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field as keyof TenantErrors];
        return newErrors;
      });
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
