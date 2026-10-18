import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import MaintenanceForm, {
  type MaintenanceFormData,
} from '@/features/maintenance/components/MaintenanceForm';
import { useAuth } from '@/providers/AuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import { Protect } from '@/shared/access';
import EmptyState from '@/shared/components/EmptyState';
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
  const [showHouseModal, setShowHouseModal] = useState(false);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [showMultiHouseModal, setShowMultiHouseModal] = useState(false);
  const [houseSearch, setHouseSearch] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const [multiHouseSearch, setMultiHouseSearch] = useState('');

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

  // ... (logic in component)

  const [form, setForm] = useState<MaintenanceFormData>(() => {
    // If tenant, try to find their house
    let initialHouseId = '';
    if (isTenant && tenantId) {
      // Try active contract first, then any contract
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

  // Sync tenant's house ID when data loads
  React.useEffect(() => {
    if (isTenant && tenantId && !form.house_id && storeContracts.length > 0) {
      // Try active contract first, then any contract
      const tenantContract =
        storeContracts.find(
          c => c.tenant_id === tenantId && isActiveContractStatus(c.status),
        ) || storeContracts.find(c => c.tenant_id === tenantId);

      if (tenantContract?.house_id) {
        setForm((f: MaintenanceFormData) => ({
          ...f,
          house_id: tenantContract.house_id as string,
          tenant_id: tenantId,
        }));
      }
    }
  }, [isTenant, tenantId, storeContracts, form.house_id]);

  if (isTenant && !tenantId) {
    return (
      <EmptyState
        icon="account-lock-outline"
        title="Permission Denied"
        description="You do not have permission to create maintenance requests. Please contact your administrator to be assigned as a tenant."
        style={{ backgroundColor: colors.background }}
      />
    );
  }

  // Reactive Lists
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
        form.house_id || 'temp', // Use house ID or temp if not selected
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
    if (!form.description) {
      showSnackbar('Description is required', 'error');
      return;
    }

    // Validate based on scope
    if (form.scope === 'property' && !form.property_id) {
      showSnackbar('Property is required for property-wide maintenance', 'error');
      return;
    }
    if (form.scope === 'single_house' && !form.house_id) {
      showSnackbar('House is required for single house maintenance', 'error');
      return;
    }
    if (form.scope === 'multi_house' && form.affected_houses.length === 0) {
      showSnackbar(
        'Please select at least one house for multi-house maintenance',
        'error',
      );
      return;
    }

    setSaving(true);
    try {
      if (!user) throw new Error('User not authenticated');

      const id = generateUUID();
      await insert('maintenance_requests', {
        id,
        business_id: selectedBusiness?.id || '',
        property_id: form.scope === 'property' ? form.property_id || null : null,
        house_id: form.scope === 'single_house' ? form.house_id || null : null,
        affected_houses:
          form.scope === 'multi_house' && form.affected_houses.length > 0
            ? form.affected_houses
            : null,
        tenant_id: form.tenant_id || null,
        description: form.description || null,
        status: 'pending',
        priority: form.priority,
        images: form.images.length > 0 ? form.images : null,
        expense_id: null,
        event_date: form.event_date.toISOString(),
        user_id: user.id,
      });

      showSnackbar('Request submitted successfully', 'success');

      sendNotification(
        'Maintenance Request Submitted',
        `Your ${form.priority} priority request has been submitted successfully.`,
        { type: 'maintenance', maintenanceId: id, status: 'pending' },
      ).catch(() => {});

      // Clear fields
      setForm({
        description: '',
        priority: 'medium',
        scope: 'single_house',
        property_id: '',
        house_id: isTenant ? form.house_id : '',
        affected_houses: [],
        tenant_id: isTenant ? tenantId || '' : '',
        images: [],
        event_date: new Date(),
      });

      router.replace('/(tabs)/maintenance');
    } catch (error) {
      console.error('Error creating request:', error);
      showSnackbar('Failed to submit request', 'error');
    } finally {
      setSaving(false);
    }
  };

  const selectedHouse = houses.find(h => h.id === form.house_id);
  return (
    <Protect action="create" resource="maintenance">
      <KeyboardScroll
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        {/* Maintenance Scope - Moved to Top */}
        <MaintenanceForm
          form={form}
          setForm={setForm}
          isTenant={isTenant}
          tenantId={tenantId}
          storeProperties={storeProperties}
          houses={houses}
          getTenantName={getTenantName}
          selectedHouse={selectedHouse}
          handleImageUpload={handleImageUpload}
          removeImage={removeImage}
          colors={colors}
          showHouseModal={showHouseModal}
          setShowHouseModal={setShowHouseModal}
          showPropertyModal={showPropertyModal}
          setShowPropertyModal={setShowPropertyModal}
          showMultiHouseModal={showMultiHouseModal}
          setShowMultiHouseModal={setShowMultiHouseModal}
          houseSearch={houseSearch}
          setHouseSearch={setHouseSearch}
          propertySearch={propertySearch}
          setPropertySearch={setPropertySearch}
          multiHouseSearch={multiHouseSearch}
          setMultiHouseSearch={setMultiHouseSearch}
        />
        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={saving}
          disabled={saving}
          style={styles.submitBtn}
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
  submitBtn: {
    marginTop: 24,
  },
});
