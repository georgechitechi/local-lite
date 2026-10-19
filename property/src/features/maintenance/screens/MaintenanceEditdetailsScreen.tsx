import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import LoadingCard from '@/shared/components/LoadingCard';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import {
  useContracts,
  useCoreMutations,
  useHouses,
  useMaintenanceRequests,
  useProperties,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { pickDocument, uploadImage } from '@/shared/services/fileUpload';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';

export default function EditMaintenanceScreen() {
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();
  const { tenantId, isTenantOnly: isTenant } = useAccessControl();

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initializedId, setInitializedId] = useState<string | null>(null);

  const { update } = useCoreMutations();
  const storeHouses = useHouses(selectedBusiness?.id);
  const storeTenants = useTenants(selectedBusiness?.id);
  const storeContracts = useContracts(selectedBusiness?.id);
  const storeProperties = useProperties(selectedBusiness?.id);
  const maintenanceRequests = useMaintenanceRequests(selectedBusiness?.id);

  const [form, setForm] = useState<MaintenanceFormData>({
    description: '',
    priority: 'medium',
    scope: 'single_house',
    property_id: '',
    house_id: '',
    affected_houses: [],
    tenant_id: '',
    images: [],
    event_date: new Date(),
  });

  useEffect(() => {
    if (!maintenanceRequests || !id) return;
    if (initializedId === id) return;

    const request = maintenanceRequests.find(r => r.id === id);
    if (request) {
      let scope: 'property' | 'multi_house' | 'single_house' = 'single_house';
      if (request.property_id) scope = 'property';
      else if (request.affected_houses && request.affected_houses.length > 0)
        scope = 'multi_house';

      setForm({
        description: request.description || '',
        priority: (request.priority as 'low' | 'medium' | 'high' | 'urgent') || 'medium',
        scope,
        property_id: request.property_id || '',
        house_id: request.house_id || '',
        affected_houses: request.affected_houses || [],
        tenant_id: request.tenant_id || '',
        images: request.images || [],
        event_date: request.event_date
          ? new Date(request.event_date)
          : new Date(Date.now()),
      });
      setLoading(false);
      setInitializedId(id);
    } else if (maintenanceRequests.length > 0) {
      showSnackbar('Maintenance request not found', 'error');
      router.push(`/(tabs)/maintenance`);
      setLoading(false);
      setInitializedId(id);
    }
  }, [id, maintenanceRequests, initializedId, router, showSnackbar]);

  const houses = storeHouses.sort((a, b) =>
    a.house_number.localeCompare(b.house_number, undefined, { numeric: true }),
  );

  const getTenantName = (houseId: string) => {
    const contract = storeContracts.find(
      c => c.house_id === houseId && isActiveContractStatus(c.status),
    );
    if (!contract) return null;
    const tenant = storeTenants.find(t => t.id === contract.tenant_id);
    return tenant ? tenant.name : null;
  };

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

      await update('maintenance_requests', id, {
        description: form.description,
        priority: form.priority,
        property_id: form.scope === 'property' ? form.property_id : null,
        house_id: form.scope === 'single_house' ? form.house_id : null,
        affected_houses: form.scope === 'multi_house' ? form.affected_houses : null,
        tenant_id: targetTenantId || null,
        images: form.images.length > 0 ? form.images : null,
        event_date: form.event_date.toISOString(),
      });

      showSnackbar('Maintenance request updated successfully', 'success');
      router.push(`/(tabs)/maintenance`);
    } catch (error: any) {
      console.error(error);
      showSnackbar(`Failed to update request: ${error.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingCard iconName="tools" text="Loading maintenance request..." />;
  }

  return (
    <Protect action="edit" resource="maintenance">
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
          Update Request
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
