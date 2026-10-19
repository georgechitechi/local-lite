import { useLocalSearchParams, useRouter } from 'expo-router';
import type { BatchMutation } from 'local-lite';
import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import ContractsForm, {
  type ContractsFormData,
  type Errors,
} from '@/features/contracts/components/ContractsForm';
import { useAuth } from '@/providers/AuthProvider';
import { AdminOnly } from '@/shared/access';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
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
import { pickDocument, uploadContractDocument } from '@/shared/services/fileUpload';
import { sendNotification } from '@/shared/services/notifications';
import { formatDateForDB } from '@/shared/utils/formatters';
import { generateUUID } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import { validations } from '@/shared/utils/validations';

export default function CreateContractScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{
    houseId?: string;
    propertyId?: string;
    propertyName?: string;
    houseNumber?: string;
  }>();
  const { selectedBusiness, requireBusiness } = useBusiness();

  const storeProperties = useProperties(selectedBusiness?.id);
  const storeHouses = useHouses(selectedBusiness?.id);
  const storeTenants = useTenants(selectedBusiness?.id);
  const storeContracts = useContracts(selectedBusiness?.id);
  const { batch } = useCoreMutations();

  const { isOnline } = useOfflineCheck();
  const { showSnackbar } = useSnackbar();
  const colors = useThemeColors();
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<ContractsFormData>({
    property_id: '',
    property_name: '',
    house_id: '',
    house_number: '',
    tenant_id: '',
    tenant_name: '',
    start_date: new Date(),
    end_date: new Date(new Date().setMonth(new Date().getMonth() + 12)),
    rent_amount: '',
    remarks: '',
    documents: [],
    status: 'active',
  });

  const [errors, setErrors] = useState<Errors>({});

  // Initial Data Effect (Params)
  React.useEffect(() => {
    if (params.houseId && storeHouses.length > 0) {
      const house = storeHouses.find(h => h.id === params.houseId);
      if (house && house.id !== form.house_id) {
        const property = storeProperties.find(p => p.id === house.property_id);
        setForm(
          prev =>
            ({
              ...prev,
              property_id: property?.id || '',
              property_name: property?.name || '',
              house_id: house.id,
              house_number: house.house_number,
              rent_amount: house.monthly_rent.toString(),
            }) as ContractsFormData,
        );
      }
    }
  }, [params.houseId, storeHouses, storeProperties, form.house_id]);

  const validateForm = (): boolean => {
    const newErrors: Errors = {};
    if (!form.property_id) newErrors.property = 'Property is required';
    if (!form.house_id) newErrors.house = 'House is required';
    if (!form.tenant_id) newErrors.tenant = 'Tenant is required';

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

      const tempDocuments = [...form.documents, { name: file.name || 'Document', file }];
      setForm((prev: ContractsFormData) => ({ ...prev, documents: tempDocuments }));
    } catch {
      showSnackbar('Failed to pick document', 'error');
    }
  };

  const removeDocument = (index: number) => {
    const newDocuments = [...form.documents];
    newDocuments.splice(index, 1);
    setForm((prev: ContractsFormData) => ({ ...prev, documents: newDocuments }));
  };

  const handleSubmit = async () => {
    if (!validateForm() || !requireBusiness()) return;

    setSaving(true);
    try {
      if (!user) throw new Error('User not authenticated');

      const existingActiveContract = storeContracts.find(
        c => c.house_id === form.house_id && isActiveContractStatus(c.status),
      );

      if (existingActiveContract && isActiveContractStatus(form.status)) {
        const tenant = storeTenants.find(t => t.id === existingActiveContract.tenant_id);
        showSnackbar(
          `This house already has an active contract with ${tenant?.name || 'a tenant'}.\n\nPlease terminate, expire, or cancel the existing contract before creating a new active contract for this house.`,
          'error',
          {
            label: 'Edit Existing Contract',
            onPress: () =>
              router.push(`/(tabs)/contracts/edit/${existingActiveContract.id}`),
          },
        );
        setSaving(false);
        return;
      }

      const contractId = generateUUID();
      let documentUrls: string[] = [];
      if (form.documents.length > 0) {
        try {
          const uploadResults = await Promise.all(
            form.documents.map((doc: any) =>
              uploadContractDocument(contractId, doc.file, {
                offlineSupport: true,
              }),
            ),
          );
          documentUrls = uploadResults.map(result => result.publicUrl);
        } catch (uploadError) {
          console.error('Document upload failed:', uploadError);
          showSnackbar('Contract created but document upload failed', 'info');
        }
      }

      const contractData = {
        id: contractId,
        house_id: form.house_id,
        tenant_id: form.tenant_id,
        start_date: formatDateForDB(form.start_date),
        end_date: formatDateForDB(form.end_date),
        rent_amount: Number.parseFloat(form.rent_amount),
        remarks: form.remarks || null,
        status: form.status,
        documents: documentUrls.length > 0 ? documentUrls : null,
        business_id: selectedBusiness?.id || '',
        user_id: user.id,
        renewal_reminder_sent_at: null,
      } as any;

      const mutations: BatchMutation[] = [
        {
          tableName: 'contracts',
          operation: 'INSERT',
          payload: contractData,
        },
      ];

      if (isActiveContractStatus(form.status) && form.house_id) {
        mutations.push({
          tableName: 'houses',
          operation: 'UPDATE',
          rowId: form.house_id,
          payload: { status: 'occupied' },
        });
      }

      await batch(mutations);

      sendNotification(
        'New Contract Created',
        `A new contract has been created for House ${form.house_number}.`,
        { type: 'contract', contractId },
      ).catch(() => {});

      showSnackbar('Contract created successfully!', 'success');
      router.replace('/(tabs)/contracts');
    } catch (error: any) {
      console.error('Error creating contract:', error);
      showSnackbar('Failed to create contract', 'error');
    } finally {
      setSaving(false);
    }
  };

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
          handleDocumentUpload={handleDocumentUpload}
          removeDocument={removeDocument}
        />

        <Button
          mode="contained"
          onPress={handleSubmit}
          style={styles.button}
          loading={saving}
          disabled={saving}
        >
          Create Contract
        </Button>
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
