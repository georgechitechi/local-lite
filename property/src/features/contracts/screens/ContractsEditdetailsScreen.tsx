import { useLocalSearchParams, useRouter } from 'expo-router';
import type { BatchMutation } from 'local-lite';
import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import {
  Button,
  Divider,
  HelperText,
  IconButton,
  List,
  Menu,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import {
  CONTRACT_STATUSES,
  type ContractsFormData,
  type Errors,
  type House,
  type Property,
} from '@/features/contracts/components/ContractsForm';
import { useAuth } from '@/providers/AuthProvider';
import AccessGuard from '@/shared/components/AccessGuard';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import EmptyState from '@/shared/components/EmptyState';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import LoadingCard from '@/shared/components/LoadingCard';
import { useCurrency } from '@/shared/hooks/useCurrency';
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
import {
  formatDateForDB,
  formatWithCurrency,
  parseLocalDate,
} from '@/shared/utils/formatters';
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [initializedId, setInitializedId] = useState<string | null>(null);
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [showHouseModal, setShowHouseModal] = useState(false);
  const [houseSearch, setHouseSearch] = useState('');
  const [statusMenuVisible, setStatusMenuVisible] = useState(false);
  const [occupiedInfo, setOccupiedInfo] = useState<{
    contractId: string;
    tenantName: string;
  } | null>(null);

  // Local-Lite Live Queries & Mutations
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

    if (!loading) {
      setLoading(true);
    }

    const contract = storeContracts.find(c => c.id === id);
    if (contract) {
      const house = storeHouses.find(h => h.id === contract.house_id);
      const property = house
        ? storeProperties.find(p => p.id === house.property_id)
        : undefined;
      const tenant = storeTenants.find(t => t.id === contract.tenant_id);

      // Construct full house object with property
      const fullHouse = house
        ? {
            ...house,
            property: property,
          }
        : null;

      setForm({
        property_id: property ? property.id : '',
        property_name: property ? property.name : '',
        house_id: contract.house_id || '',
        house_number: house ? house.house_number : '',
        tenant_id: contract.tenant_id || '',
        tenant_name: tenant ? tenant.name : '',
        start_date: new Date(contract.start_date),
        end_date: new Date(contract.end_date),
        rent_amount: contract.rent_amount.toString(),
        remarks: contract.remarks || '',
        documents: contract.documents || [],
        newDocuments: [],
        house: fullHouse as any,
        tenant: (tenant as any) || null,
        original_house_id: contract.house_id || '',
        status: contract.status || 'active',
        original_status: contract.status || 'active',
        metadata: (contract.metadata as any) || {},
      });
      setLoading(false);
      setInitializedId(id);
    } else if (storeContracts.length > 0) {
      // Contract not found but data loaded
      showSnackbar('Contract not found', 'error');
      router.push(`/(tabs)/contracts`);
      setLoading(false);
      setInitializedId(id);
    }
  }, [
    id,
    loading,
    selectedBusiness?.id,
    storeContracts,
    storeHouses,
    storeProperties,
    storeTenants,
    showSnackbar,
    router,
    initializedId,
  ]);

  const validateForm = (): boolean => {
    const newErrors: Errors = {};
    const rentErr = validations.combine(
      validations.required,
      validations.amount,
    )(form.rent_amount);
    if (rentErr) newErrors.rent_amount = 'Rent amount is required';

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
      // Changes will be saved on submit
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

      // Check if changing to active status and if house already has active contract
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

      // Upload new documents first
      let allDocuments = [...form.documents];
      if (form.newDocuments && form.newDocuments.length > 0) {
        try {
          const uploadResults = await Promise.all(
            form.newDocuments.map((doc: any) =>
              uploadContractDocument(id, doc.file, { offlineSupport: true }),
            ),
          );
          const newDocumentUrls = uploadResults.map(result => result.publicUrl);
          allDocuments = [...allDocuments, ...newDocumentUrls];
        } catch (e) {
          console.error('Document upload failed', e);
          throw e;
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

      // Update contract
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

  const selectProperty = (property: Property) => {
    setForm((prev: ContractsFormData) => ({
      ...prev,
      house: prev.house
        ? {
            ...prev.house,
            property: property,
          }
        : null,
      house_id: '',
    }));
    setShowPropertyModal(false);
  };

  const selectHouse = (house: House) => {
    // Just update form state. Status changes happen on submit.
    setForm((prev: ContractsFormData) => ({
      ...prev,
      house: {
        ...house,
        property: prev.house?.property,
      },
      house_id: house.id,
      rent_amount: house.monthly_rent.toString(),
    }));

    setHouseSearch('');
    setShowHouseModal(false);
  };

  if (loading) {
    return <LoadingCard iconName="file-document-edit" text="Loading contract..." />;
  }

  return (
    <AccessGuard roles={['admin']}>
      <KeyboardScroll
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <View style={styles.infoSection}>
          <Text variant="titleMedium">Property Information</Text>
          <Button
            mode="outlined"
            onPress={() => {
              setShowPropertyModal(true);
            }}
            style={{ ...styles.input, backgroundColor: colors.surface }}
          >
            Property: {form.house?.property?.name || 'Select Property'}
          </Button>
          <Button
            mode="outlined"
            onPress={() => {
              if (form.house?.property?.id) {
                setShowHouseModal(true);
              } else {
                showSnackbar('Please select a property first', 'info');
              }
            }}
            style={{ ...styles.input, backgroundColor: colors.surface }}
          >
            House: {form.house?.house_number || 'Select House'}
          </Button>
        </View>

        <View style={styles.infoSection}>
          <Text variant="titleMedium">Tenant Information</Text>
          <Text>Name: {form.tenant?.name || 'Unknown'}</Text>
        </View>

        <Menu
          visible={statusMenuVisible}
          onDismiss={() => setStatusMenuVisible(false)}
          anchor={
            <Button
              mode="outlined"
              onPress={() => setStatusMenuVisible(true)}
              style={{ ...styles.input, backgroundColor: colors.surface }}
            >
              Status:{' '}
              {CONTRACT_STATUSES.find(s => s.value === form.status)?.label || 'Active'}
            </Button>
          }
        >
          {CONTRACT_STATUSES.map(status => (
            <Menu.Item
              key={status.value}
              onPress={() => {
                setForm((prev: ContractsFormData) => ({ ...prev, status: status.value }));
                setStatusMenuVisible(false);
              }}
              title={status.label}
            />
          ))}
        </Menu>

        <DatePicker
          label="Start Date"
          value={
            form.start_date instanceof Date
              ? formatDateForDB(form.start_date)
              : form.start_date
          }
          onChange={date => {
            setForm((prev: ContractsFormData) => ({
              ...prev,
              start_date: date ? parseLocalDate(date) : null,
            }));
          }}
          style={styles.input}
          maximumDate={null}
        />

        <DatePicker
          label="End Date"
          value={
            form.end_date instanceof Date ? formatDateForDB(form.end_date) : form.end_date
          }
          onChange={date => {
            setForm((prev: ContractsFormData) => ({
              ...prev,
              end_date: date ? parseLocalDate(date) : null,
            }));
          }}
          style={styles.input}
          maximumDate={null}
        />

        <TextInput
          label={`Rent Amount (${defaultCurrency?.symbol || '$'})`}
          value={form.rent_amount}
          onChangeText={text =>
            setForm((prev: ContractsFormData) => ({ ...prev, rent_amount: text }))
          }
          keyboardType="decimal-pad"
          style={{ ...styles.input, backgroundColor: colors.surface }}
          error={!!errors.rent_amount}
        />
        {errors.rent_amount && <HelperText type="error">{errors.rent_amount}</HelperText>}

        <TextInput
          label="Remarks (Optional)"
          value={form.remarks}
          onChangeText={text =>
            setForm((prev: ContractsFormData) => ({ ...prev, remarks: text }))
          }
          multiline
          numberOfLines={4}
          style={{
            ...styles.input,
            ...styles.remarksInput,
            backgroundColor: colors.surface,
          }}
        />

        <View style={styles.documentsSection}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Documents
          </Text>

          {/* Existing Documents */}
          {Array.isArray(form.documents) &&
            form.documents.map((url, index) => {
              const fileName = url.split('/').pop();
              return (
                <View key={`existing-${index}`} style={styles.documentItem}>
                  <IconButton
                    icon="file-document"
                    size={24}
                    onPress={() => Linking.openURL(url)}
                  />
                  <Text style={styles.documentName} onPress={() => Linking.openURL(url)}>
                    {fileName}
                  </Text>
                  <IconButton
                    icon="delete"
                    size={20}
                    onPress={() => removeExistingDocument(url, index)}
                  />
                </View>
              );
            })}

          {/* New Documents */}
          {Array.isArray(form.newDocuments) &&
            form.newDocuments.map((doc: any, index: number) => (
              <View key={`new-${index}`} style={styles.documentItem}>
                <IconButton icon="file-document" size={24} />
                <Text style={styles.documentName}>{doc.name}</Text>
                <IconButton
                  icon="close"
                  size={20}
                  onPress={() => removeNewDocument(index)}
                />
              </View>
            ))}

          <Button
            mode="outlined"
            icon="file-upload"
            onPress={handleDocumentUpload}
            style={styles.uploadButton}
          >
            Upload New Document
          </Button>
        </View>

        <Button
          mode="contained"
          onPress={handleSubmit}
          style={styles.submitButton}
          loading={saving}
          disabled={saving}
        >
          Update Contract
        </Button>

        <BaseModal
          visible={showPropertyModal}
          onDismiss={() => setShowPropertyModal(false)}
          title="Select Property"
          subtitle="Manage your properties"
          edgeToEdge
          maxHeight="80%"
          scrollable
        >
          {storeProperties.length === 0 ? (
            <EmptyState icon="home-city-outline" title="No properties found" />
          ) : (
            storeProperties.map(property => (
              <React.Fragment key={property.id}>
                <List.Item
                  title={property.name}
                  description={property.location}
                  onPress={() => selectProperty(property)}
                />
                <Divider />
              </React.Fragment>
            ))
          )}
        </BaseModal>

        <BaseModal
          visible={showHouseModal}
          onDismiss={() => setShowHouseModal(false)}
          title="Select House"
          subtitle="Manage your properties"
          edgeToEdge
          maxHeight="80%"
          scrollable
          search={{
            placeholder: 'Search houses...',
            value: houseSearch,
            onChangeText: setHouseSearch,
            onClear: () => setHouseSearch(''),
          }}
        >
          {(() => {
            const filteredHouses = storeHouses.filter(
              house =>
                house.property_id === form.house?.property?.id &&
                (house.status === 'available' || house.id === form.original_house_id) &&
                house.house_number.toLowerCase().includes(houseSearch.toLowerCase()),
            );

            if (filteredHouses.length === 0) {
              return <EmptyState icon="home-outline" title="No houses found" />;
            }

            return filteredHouses.map(house => (
              <React.Fragment key={house.id}>
                <List.Item
                  title={`House ${house.house_number}`}
                  description={
                    defaultCurrency
                      ? `Rent: ${formatWithCurrency(house.monthly_rent, defaultCurrency)}`
                      : `Rent: ${formatWithCurrency(house.monthly_rent, defaultCurrency as any)}`
                  }
                  onPress={() => selectHouse(house)}
                />
                <Divider />
              </React.Fragment>
            ));
          })()}
        </BaseModal>

        <BaseModal
          visible={!!occupiedInfo}
          onDismiss={() => setOccupiedInfo(null)}
          mode="confirm"
          title="House Already Occupied"
          message={`This house already has an active contract with ${occupiedInfo?.tenantName}. Please terminate, expire, or cancel that contract first.`}
          confirmText="Edit Other Contract"
          onConfirm={() => {
            const cid = occupiedInfo?.contractId;
            setOccupiedInfo(null);
            if (cid) router.push(`/(tabs)/contracts/edit/${cid}`);
          }}
        />
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
  infoSection: {
    borderRadius: 8,
    marginBottom: 16,
    gap: 4,
  },
  input: {
    marginBottom: 8,
  },
  documentsSection: {
    marginTop: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  uploadButton: {
    marginTop: 8,
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    marginBottom: 8,
  },
  documentName: {
    flex: 1,
    marginLeft: 8,
    textDecorationLine: 'underline',
  },
  submitButton: {
    marginTop: 24,
    marginBottom: 40,
    paddingVertical: 6,
  },
  remarksInput: {
    height: 100,
    textAlignVertical: 'top',
  },
});
