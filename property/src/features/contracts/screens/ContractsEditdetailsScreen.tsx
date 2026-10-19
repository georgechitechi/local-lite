import { useLocalSearchParams, useRouter } from 'expo-router';
import type { BatchMutation } from 'local-lite';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import ContractsForm, {
  type ContractsFormData,
  type Errors,
} from '@/features/contracts/components/ContractsForm';
import { useAuth } from '@/providers/AuthProvider';
import { AdminOnly } from '@/shared/access';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import LoadingCard from '@/shared/components/LoadingCard';
import { useCurrency } from '@/shared/hooks/useCurrency';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import {
  useContracts,
  useCoreMutations,
  useHouses,
  useProperties,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import {
  deleteContractDocument,
  pickDocument,
  uploadContractDocument,
} from '@/shared/services/fileUpload';
import { formatDateForDB, parseLocalDate } from '@/shared/utils/formatters';
import {
  isActiveContractStatus,
  resolveHouseStatusFromContracts,
} from '@/shared/utils/statusHelper';
import { validations } from '@/shared/utils/validations';

export default function EditContractScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { selectedBusiness, requireBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const colors = useThemeColors();
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);
  const { isOnline } = useOfflineCheck();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [initializedId, setInitializedId] = useState<string | null>(null);
  const [occupiedInfo, setOccupiedInfo] = useState<{
    contractId: string;
    tenantName: string;
  } | null>(null);

  const storeProperties = useProperties(selectedBusiness?.id);
  const storeHouses = useHouses(selectedBusiness?.id);
  const storeTenants = useTenants(selectedBusiness?.id);
  const storeContracts = useContracts(selectedBusiness?.id);
  const { batch } = useCoreMutations();

  const [form, setForm] = useState<ContractsFormData>({
    property_id: '',
    property_name: '',
    house_id: '',
    house_number: '',
    tenant_id: '',
    tenant_name: '',
    start_date: new Date(),
    end_date: new Date(),
    rent_amount: '',
    remarks: '',
    documents: [],
    newDocuments: [],
    house: null,
    tenant: null,
    original_house_id: '',
    status: 'active',
    original_status: 'active',
    metadata: {},
  });

  const [errors, setErrors] = useState<Errors>({});

  // Sync form with store data
  useEffect(() => {
    if (!id || !selectedBusiness?.id) return;
    if (initializedId === id) return;

    const contract = storeContracts.find(c => c.id === id);

    if (contract) {
      const house = storeHouses.find(h => h.id === contract.house_id);
      const property = house
        ? storeProperties.find(p => p.id === house.property_id)
        : null;
      const tenant = storeTenants.find(t => t.id === contract.tenant_id);

      const contractWithRelations = {
        ...contract,
        house: house
          ? {
              ...house,
              property: property
                ? {
                    id: property.id,
                    name: property.name,
                    location: property.location,
                  }
                : null,
            }
          : null,
        tenant: tenant
          ? {
              id: tenant.id,
              name: tenant.name,
              phone: tenant.phone,
            }
          : null,
      };

      setForm({
        property_id: property?.id || '',
        property_name: property?.name || '',
        house_id: contract.house_id || '',
        house_number: house?.house_number || '',
        tenant_id: contract.tenant_id || '',
        tenant_name: tenant?.name || '',
        start_date: contract.start_date ? parseLocalDate(contract.start_date) : null,
        end_date: contract.end_date ? parseLocalDate(contract.end_date) : null,
        rent_amount: contract.rent_amount ? contract.rent_amount.toString() : '',
        remarks: contract.remarks || '',
        documents: contract.documents || [],
        newDocuments: [],
        house: contractWithRelations.house,
        tenant: contractWithRelations.tenant,
        original_house_id: contract.house_id || '',
        status: contract.status || 'active',
        original_status: contract.status || 'active',
        metadata: contract.metadata || {},
      });
      setLoading(false);
      setInitializedId(id);
    } else if (storeContracts.length > 0) {
      showSnackbar('Contract not found', 'error');
      router.push(`/(tabs)/contracts`);
      setLoading(false);
      setInitializedId(id);
    }
  }, [
    id,
    selectedBusiness?.id,
    storeContracts,
    storeHouses,
    storeProperties,
    storeTenants,
    initializedId,
    router,
    showSnackbar,
  ]);

  const validateForm = (): boolean => {
    const newErrors: Errors = {};
    if (!form.property_id && !form.house?.property?.id)
      newErrors.property = 'Property is required';
    if (!form.house_id) newErrors.house = 'House is required';

    const rentErr = validations.combine(
      validations.required,
      validations.amount,
    )(form.rent_amount);
    if (rentErr) newErrors.rent_amount = 'Valid rent amount is required';

    if (!form.start_date) newErrors.start_date = 'Start date is required';
    if (!form.end_date) newErrors.end_date = 'End date is required';
    if (form.end_date && form.start_date && form.end_date < form.start_date)
      newErrors.end_date = 'End date must be after start date';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleDocumentUpload = async () => {
    try {
      const file = await pickDocument();
      if (!file) return;

      const tempDocuments = [
        ...(form.newDocuments || []),
        { name: file.name || 'Document', file },
      ];
      setForm((prev: ContractsFormData) => ({ ...prev, newDocuments: tempDocuments }));
    } catch {
      showSnackbar('Failed to pick document', 'error');
    }
  };

  const removeExistingDocument = async (url: string, index: number) => {
    try {
      await deleteContractDocument(url);
      const newDocuments = [...form.documents];
      newDocuments.splice(index, 1);
      setForm((prev: ContractsFormData) => ({ ...prev, documents: newDocuments }));
    } catch {
      showSnackbar('Failed to remove document', 'error');
    }
  };

  const removeNewDocument = (index: number) => {
    const newDocuments = [...(form.newDocuments || [])];
    newDocuments.splice(index, 1);
    setForm((prev: ContractsFormData) => ({ ...prev, newDocuments: newDocuments }));
  };

  const handleSubmit = async () => {
    if (!validateForm() || !requireBusiness() || !id) return;

    setSaving(true);
    try {
      if (!user) throw new Error('User not authenticated');

      if (
        isActiveContractStatus(form.status) &&
        !isActiveContractStatus(form.original_status)
      ) {
        const existingContract = storeContracts.find(
          c =>
            c.house_id === form.house_id &&
            isActiveContractStatus(c.status) &&
            c.id !== id,
        );

        if (existingContract) {
          const tenantName =
            storeTenants.find(t => t.id === existingContract.tenant_id)?.name ||
            'Unknown';
          setOccupiedInfo({
            contractId: existingContract.id,
            tenantName,
          });
          setSaving(false);
          return;
        }
      }

      let allDocuments = [...form.documents];
      if (form.newDocuments && form.newDocuments.length > 0) {
        try {
          const uploadPromises = form.newDocuments.map((doc: any) =>
            uploadContractDocument(id, doc.file, { offlineSupport: true }),
          );
          const uploadResults = await Promise.all(uploadPromises);
          allDocuments = [...allDocuments, ...uploadResults.map(r => r.publicUrl)];
        } catch (uploadError) {
          console.error('Document upload error:', uploadError);
          showSnackbar('Some documents failed to upload', 'info');
        }
      }

      const contractsAfterUpdate = storeContracts.map(c =>
        c.id === id
          ? { ...c, house_id: form.house_id ?? c.house_id, status: form.status }
          : c,
      );

      const houseIdsToUpdate = new Set<string>();
      if (form.original_house_id) houseIdsToUpdate.add(form.original_house_id);
      if (form.house_id) houseIdsToUpdate.add(form.house_id);

      const mutations: BatchMutation[] = [];

      houseIdsToUpdate.forEach(houseId => {
        const houseData = storeHouses.find(h => h.id === houseId);
        if (!houseData) return;
        mutations.push({
          tableName: 'houses',
          operation: 'UPDATE',
          payload: {
            ...houseData,
            status: resolveHouseStatusFromContracts(
              houseData.status,
              contractsAfterUpdate,
              houseId,
            ),
          },
          rowId: houseId,
        });
      });

      mutations.push({
        tableName: 'contracts',
        operation: 'UPDATE',
        payload: {
          start_date: formatDateForDB(form.start_date),
          end_date: formatDateForDB(form.end_date),
          rent_amount: Number.parseFloat(form.rent_amount),
          remarks: form.remarks,
          documents: allDocuments,
          house_id: form.house_id,
          status: form.status,
        },
        rowId: id,
      });

      await batch(mutations);

      showSnackbar('Contract updated successfully', 'success');
      router.push(`/(tabs)/contracts`);
    } catch (error: any) {
      console.error('Error updating contract:', error);
      showSnackbar('Failed to update contract', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingCard iconName="file-document-edit" text="Loading contract..." />;
  }

  return (
    <AdminOnly>
      <KeyboardScroll
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <ContractsForm
          form={form}
          setForm={setForm}
          errors={errors}
          colors={colors}
          defaultCurrency={defaultCurrency}
          properties={storeProperties}
          houses={storeHouses}
          storeTenants={storeTenants}
          storeContracts={storeContracts}
          storeHouses={storeHouses}
          storeProperties={storeProperties}
          isOnline={isOnline}
          isEdit={true}
          handleDocumentUpload={handleDocumentUpload}
          onRemoveExistingDocument={removeExistingDocument}
          onRemoveNewDocument={removeNewDocument}
        />

        <Button
          mode="contained"
          onPress={handleSubmit}
          style={styles.button}
          loading={saving}
          disabled={saving}
        >
          Update Contract
        </Button>

        <Portal>
          <Dialog visible={!!occupiedInfo} onDismiss={() => setOccupiedInfo(null)}>
            <Dialog.Title>House Already Occupied</Dialog.Title>
            <Dialog.Content>
              <Text variant="bodyMedium">
                House {form.house_number} already has an active contract with{' '}
                {occupiedInfo?.tenantName}.
              </Text>
              <Text variant="bodyMedium" style={{ marginTop: 8 }}>
                Please terminate or expire the existing contract first.
              </Text>
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setOccupiedInfo(null)}>Cancel</Button>
              <Button
                onPress={() => {
                  const contractId = occupiedInfo?.contractId;
                  setOccupiedInfo(null);
                  if (contractId) {
                    router.push(`/(tabs)/contracts/edit/${contractId}`);
                  }
                }}
              >
                View Contract
              </Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>
      </KeyboardScroll>
    </AdminOnly>
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
