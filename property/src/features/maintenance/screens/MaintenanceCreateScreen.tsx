import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import MaintenanceForm, {
  type MaintenanceFormData,
  validateMaintenanceForm,
} from '@/features/maintenance/components/MaintenanceForm';
import { useAuth } from '@/providers/AuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import { Protect } from '@/shared/access';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import {
  useContracts,
  useCoreMutations,
  useHouses,
  useProperties,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { pickDocument, uploadImage } from '@/shared/services/fileUpload';
import { sendNotification } from '@/shared/services/notifications';
import { generateUUID } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';

export default function CreateMaintenanceScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();
  const { tenantId, isTenantOnly: isTenant } = useAccessControl();

  const [saving, setSaving] = useState(false);
  const { insert } = useCoreMutations();
  const storeHouses = useHouses(selectedBusiness?.id);
  const storeTenants = useTenants(selectedBusiness?.id);
  const storeContracts = useContracts(selectedBusiness?.id);
  const storeProperties = useProperties(selectedBusiness?.id);

  const getTenantName = (houseId: string) => {
    const contract = storeContracts.find(
      c => c.house_id === houseId && isActiveContractStatus(c.status),
    );
    if (!contract) return null;
    const tenant = storeTenants.find(t => t.id === contract.tenant_id);
    return tenant ? tenant.name : null;
  };

  const [form, setForm] = useState<MaintenanceFormData>(() => {
    let initialHouseId = '';
    if (isTenant && tenantId) {
      const tenantContract =
        storeContracts.find(
          c => c.tenant_id === tenantId && isActiveContractStatus(c.status),
        ) || storeContracts.find(c => c.tenant_id === tenantId);
      initialHouseId = tenantContract?.house_id || '';
    }

    return {
      description: '',
      priority: 'medium',
      scope: 'single_house',
      property_id: '',
      house_id: initialHouseId,
      affected_houses: [],
      tenant_id: isTenant ? tenantId || '' : '',
      images: [],
      event_date: new Date(),
    };
  });

  React.useEffect(() => {
    if (isTenant && tenantId && !form.house_id && storeContracts.length > 0) {
      const tenantContract =
        storeContracts.find(
          c => c.tenant_id === tenantId && isActiveContractStatus(c.status),
        ) || storeContracts.find(c => c.tenant_id === tenantId);

      if (tenantContract?.house_id) {
        setForm((f: MaintenanceFormData) => ({
          ...f,
          house_id: tenantContract.house_id || '',
        }));
      }
    }
  }, [isTenant, tenantId, form.house_id, storeContracts]);

  const houses = storeHouses.sort((a, b) =>
    a.house_number.localeCompare(b.house_number, undefined, { numeric: true }),
  );

  const handleImageUpload = async () => {
    try {
      pauseAutoLock();
      const file = await pickDocument();
      if (!file) return;

      const result = await uploadImage(
        { uri: file.uri, mimeType: file.mimeType },
        'private-assets',
        'maintenance-docs',
        form.house_id || 'temp',
        { offlineSupport: true },
      );

      setForm((prev: MaintenanceFormData) => ({
        ...prev,
        images: [...prev.images, result.publicUrl],
      }));
    } catch (error) {
      console.error(error);
      showSnackbar('Failed to upload image', 'error');
    } finally {
      resumeAutoLock();
    }
  };

  const removeImage = (index: number) => {
    setForm((prev: MaintenanceFormData) => ({
      ...prev,
      images: prev.images.filter((_: any, i: number) => i !== index),
    }));
  };

  const handleSubmit = async () => {
    const errorMsg = validateMaintenanceForm(form);
    if (errorMsg) {
      showSnackbar(errorMsg, 'error');
      return;
    }

    setSaving(true);
    try {
      if (!user) throw new Error('User not authenticated');

      let targetTenantId = form.tenant_id;
      if (!isTenant && form.scope === 'single_house' && form.house_id) {
        const activeContract = storeContracts.find(
          c => c.house_id === form.house_id && isActiveContractStatus(c.status),
        );
        targetTenantId = activeContract?.tenant_id || '';
      }

      const id = generateUUID();
      const requestData = {
        id,
        description: form.description,
        priority: form.priority,
        property_id: form.scope === 'property' ? form.property_id : null,
        house_id: form.scope === 'single_house' ? form.house_id : null,
        affected_houses: form.scope === 'multi_house' ? form.affected_houses : null,
        tenant_id: targetTenantId || null,
        images: form.images.length > 0 ? form.images : null,
        business_id: selectedBusiness?.id || '',
        user_id: user.id,
        status: 'pending',
        event_date: form.event_date.toISOString(),
      } as any;

      await insert('maintenance_requests', requestData);

      let houseDisplay = 'a house';
      if (form.scope === 'single_house') {
        const house = houses.find(h => h.id === form.house_id);
        if (house) houseDisplay = `House ${house.house_number}`;
      } else if (form.scope === 'property') {
        const prop = storeProperties.find(p => p.id === form.property_id);
        if (prop) houseDisplay = prop.name;
      } else if (form.scope === 'multi_house') {
        houseDisplay = `${form.affected_houses.length} houses`;
      }

      sendNotification(
        'New Maintenance Request',
        `A new maintenance request has been submitted for ${houseDisplay}.`,
        { type: 'maintenance', maintenanceId: id },
      ).catch(() => {});

      showSnackbar('Maintenance request created successfully', 'success');
      router.replace('/(tabs)/maintenance');
    } catch (error: any) {
      console.error(error);
      showSnackbar(`Failed to create request: ${error.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Protect action="create" resource="maintenance">
      <KeyboardScroll
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <MaintenanceForm
          form={form}
          setForm={setForm}
          isTenant={isTenant}
          tenantId={tenantId}
          storeProperties={storeProperties}
          houses={houses}
          getTenantName={getTenantName}
          handleImageUpload={handleImageUpload}
          removeImage={removeImage}
          colors={colors}
        />

        <Button
          mode="contained"
          onPress={handleSubmit}
          style={styles.button}
          loading={saving}
          disabled={saving}
        >
          Submit Request
        </Button>
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
    marginTop: 24,
    marginBottom: 40,
  },
});
