import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import MaintenanceForm, {
  type MaintenanceFormData,
} from '@/features/maintenance/components/MaintenanceForm';
import { useAuth } from '@/providers/AuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import AccessGuard from '@/shared/components/AccessGuard';
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
  const { userRoles, tenantId } = useAccessControl();
  const isStaff = userRoles.includes('staff');
  const isTenant = userRoles.includes('tenant') && !isStaff;

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [initializedId, setInitializedId] = useState<string | null>(null);
  const [showHouseModal, setShowHouseModal] = useState(false);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [showMultiHouseModal, setShowMultiHouseModal] = useState(false);
  const [houseSearch, setHouseSearch] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const [multiHouseSearch, setMultiHouseSearch] = useState('');

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

  // Load existing data
  useEffect(() => {
    if (!maintenanceRequests || !id) return;
    if (initializedId === id) return;

    if (!loading) {
      setLoading(true);
    }

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
  }, [maintenanceRequests, id, loading, initializedId, showSnackbar, router]);

  const getTenantName = (houseId: string) => {
    const contract = storeContracts.find(
      c => c.house_id === houseId && isActiveContractStatus(c.status),
    );
    if (!contract) return null;
    const tenant = storeTenants.find(t => t.id === contract.tenant_id);
    return tenant ? tenant.name : null;
  };

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

      // Only set changed fields
      const property_id = form.scope === 'property' ? form.property_id || null : null;
      const house_id = form.scope === 'single_house' ? form.house_id || null : null;
      const affected_houses =
        form.scope === 'multi_house' && form.affected_houses.length > 0
          ? form.affected_houses
          : null;
      const tenant_id = form.tenant_id || null; // Allow tenant change if house changes

      const updateData: any = {
        description: form.description || null,
        priority: form.priority,
        property_id: property_id,
        house_id: house_id,
        affected_houses: affected_houses,
        tenant_id: tenant_id,
        images: form.images.length > 0 ? form.images : null,
        event_date: form.event_date.toISOString(),
      };

      await update('maintenance_requests', id, updateData);

      showSnackbar('Request updated successfully', 'success');
      router.push('/maintenance');
    } catch (error) {
      console.error('Error updating request:', error);
      showSnackbar('Failed to update request', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingCard text="Loading Request..." />;
  }

  const selectedHouse = houses.find(h => h.id === form.house_id);
  return (
    <AccessGuard action="edit" resource="maintenance">
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
          Save Changes
        </Button>
      </KeyboardScroll>
    </AccessGuard>
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
