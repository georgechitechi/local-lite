import type React from 'react';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import {
  Button,
  HelperText,
  IconButton,
  List,
  Menu,
  Text,
  TextInput,
} from 'react-native-paper';
import SelectTenantModal from '@/features/tenants/components/SelectTenantModal';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { formatDateForDB, parseLocalDate } from '@/shared/utils/formatters';
import { properCase } from '@/shared/utils/helper';
import SelectHouseModal from './SelectHouseModal';
import SelectPropertyModal from './SelectPropertyModal';

export const CONTRACT_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'expiring_soon', label: 'Expiring Soon' },
  { value: 'expired', label: 'Expired' },
  { value: 'terminated', label: 'Terminated' },
] as const;

export interface Property {
  id: string;
  name: string;
  location?: string | null;
  [key: string]: any;
}

export interface House {
  id: string;
  house_number: string;
  monthly_rent: number;
  property_id: string | null;
  status?: string | null;
  [key: string]: any;
}

export interface Tenant {
  id: string;
  name: string;
  phone?: string | null;
  [key: string]: any;
}

export interface Document {
  name: string;
  file: any;
}

export interface ContractsFormData {
  property_id: string;
  property_name: string;
  house_id: string;
  house_number: string;
  tenant_id: string;
  tenant_name: string;
  start_date: Date | null;
  end_date: Date | null;
  rent_amount: string;
  remarks: string;
  documents: any[];
  status: string;
  newDocuments?: any[];
  original_house_id?: string;
  original_status?: string;
  house?: any;
  tenant?: any;
  metadata?: any;
}

export interface Errors {
  property?: string;
  house?: string;
  tenant?: string;
  rent_amount?: string;
  start_date?: string;
  end_date?: string;
}

export interface ContractsFormProps {
  form: ContractsFormData;
  setForm: React.Dispatch<React.SetStateAction<ContractsFormData>>;
  errors: Errors;
  colors: any;
  defaultCurrency: any;
  properties: Property[];
  houses: House[];
  storeTenants: any[];
  storeContracts: any[];
  storeHouses: any[];
  storeProperties: any[];
  isOnline: boolean;
  isEdit?: boolean;
  handleDocumentUpload?: () => void;
  removeDocument?: (index: number) => void;
  onRemoveExistingDocument?: (doc: string, index: number) => void;
  onRemoveNewDocument?: (index: number) => void;
  selectProperty?: (property: Property) => void;
  selectHouse?: (house: House) => void;
  selectTenant?: (tenant: Tenant) => void;
}

export default function ContractsForm({
  form,
  setForm,
  errors,
  colors,
  defaultCurrency,
  properties,
  houses,
  storeTenants,
  storeContracts,
  storeHouses,
  storeProperties,
  isOnline,
  isEdit = false,
  handleDocumentUpload,
  removeDocument,
  onRemoveExistingDocument,
  onRemoveNewDocument,
  selectProperty,
  selectHouse,
  selectTenant,
}: ContractsFormProps) {
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [showHouseModal, setShowHouseModal] = useState(false);
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [houseSearch, setHouseSearch] = useState('');
  const [statusMenuVisible, setStatusMenuVisible] = useState(false);
  const [existingContractsInfo, setExistingContractsInfo] = useState<{
    tenant: Tenant;
    message: string;
  } | null>(null);

  const onSelectProperty = (property: Property) => {
    if (selectProperty) {
      selectProperty(property);
    } else {
      setForm(prev => ({
        ...prev,
        property_id: property.id,
        property_name: property.name,
        house_id: '',
        house_number: '',
        house: prev.house ? { ...prev.house, property } : null,
      }));
    }
    setShowPropertyModal(false);
  };

  const onSelectHouse = (house: House) => {
    if (selectHouse) {
      selectHouse(house);
    } else {
      setForm(prev => ({
        ...prev,
        house_id: house.id,
        house_number: house.house_number,
        rent_amount: house.monthly_rent?.toString() || prev.rent_amount,
        house: { ...house, property: prev.house?.property },
      }));
    }
    setHouseSearch('');
    setShowHouseModal(false);
  };

  const onSelectTenant = (tenant: Tenant) => {
    if (selectTenant) {
      selectTenant(tenant);
      return;
    }
    const existing = storeContracts.filter(c => c.tenant_id === tenant.id);
    if (existing.length > 0) {
      const contractList = existing
        .map(c => {
          const house = storeHouses.find(h => h.id === c.house_id);
          const prop = house
            ? storeProperties.find(p => p.id === house.property_id)
            : null;
          return `${prop?.name || 'Unknown'} - House ${house?.house_number || 'Unknown'} (${properCase(c.status || 'unknown')})`;
        })
        .join('\n');

      setExistingContractsInfo({
        tenant,
        message: `This tenant already has ${existing.length} contract(s):\n\n${contractList}\n\nDo you want to create another contract for this tenant?`,
      });
    } else {
      setForm(prev => ({
        ...prev,
        tenant_id: tenant.id,
        tenant_name: tenant.name,
      }));
      setShowTenantModal(false);
    }
  };

  const confirmSelectTenant = () => {
    if (existingContractsInfo) {
      setForm(prev => ({
        ...prev,
        tenant_id: existingContractsInfo.tenant.id,
        tenant_name: existingContractsInfo.tenant.name,
      }));
      setExistingContractsInfo(null);
      setShowTenantModal(false);
    }
  };

  const propertyDisplayName =
    form.property_name || form.house?.property?.name || 'Select Property';
  const houseDisplayName =
    form.house_number || form.house?.house_number
      ? `House ${form.house_number || form.house?.house_number}`
      : 'Select House';

  return (
    <View>
      <Button
        mode="outlined"
        onPress={() => setShowPropertyModal(true)}
        style={{ ...styles.input, backgroundColor: colors.surface }}
      >
        {propertyDisplayName}
      </Button>
      {errors.property && <HelperText type="error">{errors.property}</HelperText>}

      <Button
        mode="outlined"
        onPress={() => setShowHouseModal(true)}
        style={{ ...styles.input, backgroundColor: colors.surface }}
        disabled={!form.property_id && !form.house?.property?.id}
      >
        {houseDisplayName}
      </Button>
      {errors.house && <HelperText type="error">{errors.house}</HelperText>}

      {isEdit ? (
        <View style={styles.tenantInfoBox}>
          <Text variant="titleMedium">Tenant Information</Text>
          <Text>Name: {form.tenant?.name || form.tenant_name || 'Unknown'}</Text>
        </View>
      ) : (
        <>
          <Button
            mode="outlined"
            onPress={() => setShowTenantModal(true)}
            style={{ ...styles.input, backgroundColor: colors.surface }}
          >
            {form.tenant_name || 'Select Tenant'}
          </Button>
          {errors.tenant && <HelperText type="error">{errors.tenant}</HelperText>}
        </>
      )}

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
              setForm(prev => ({ ...prev, status: status.value }));
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
            : (form.start_date as any)
        }
        onChange={date => {
          setForm(prev => ({
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
          form.end_date instanceof Date
            ? formatDateForDB(form.end_date)
            : (form.end_date as any)
        }
        onChange={date => {
          setForm(prev => ({ ...prev, end_date: date ? parseLocalDate(date) : null }));
        }}
        style={styles.input}
        maximumDate={null}
      />

      <TextInput
        label={`Rent Amount (${defaultCurrency?.symbol || '$'})`}
        value={form.rent_amount}
        onChangeText={text => setForm(prev => ({ ...prev, rent_amount: text }))}
        keyboardType="decimal-pad"
        style={{ ...styles.input, backgroundColor: colors.surface }}
        error={!!errors.rent_amount}
      />
      {errors.rent_amount && <HelperText type="error">{errors.rent_amount}</HelperText>}

      <TextInput
        label="Remarks (Optional)"
        value={form.remarks}
        onChangeText={text => setForm(prev => ({ ...prev, remarks: text }))}
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
        {handleDocumentUpload && (
          <Button
            mode="outlined"
            icon="file-upload"
            onPress={handleDocumentUpload}
            style={[styles.uploadButton, !isOnline && { opacity: 0.5 }]}
          >
            Upload Document
          </Button>
        )}

        {/* Existing Documents (Edit Mode) */}
        {isEdit &&
          form.documents?.map((doc: any, index: number) => {
            const docUrl = typeof doc === 'string' ? doc : doc?.url;
            const fileName = typeof doc === 'string' ? doc.split('/').pop() : doc?.name;
            return (
              <List.Item
                key={`existing-${index}`}
                title={fileName || 'Document'}
                left={props => <List.Icon {...props} icon="file-document" />}
                right={props => (
                  <View style={styles.documentActions}>
                    {docUrl && (
                      <IconButton
                        {...props}
                        icon="eye"
                        onPress={() => Linking.openURL(docUrl)}
                      />
                    )}
                    {onRemoveExistingDocument && docUrl && (
                      <IconButton
                        {...props}
                        icon="delete"
                        onPress={() => onRemoveExistingDocument(docUrl, index)}
                      />
                    )}
                  </View>
                )}
              />
            );
          })}

        {/* New Documents (Edit Mode) */}
        {isEdit &&
          form.newDocuments?.map((doc: any, index: number) => (
            <List.Item
              key={`new-${index}`}
              title={doc.name}
              left={props => <List.Icon {...props} icon="file-document-outline" />}
              right={props =>
                onRemoveNewDocument ? (
                  <IconButton
                    {...props}
                    icon="close"
                    onPress={() => onRemoveNewDocument(index)}
                  />
                ) : null
              }
            />
          ))}

        {/* Create Mode Documents */}
        {!isEdit &&
          form.documents.map((doc, index) => (
            <View key={index} style={styles.documentItem}>
              <Text numberOfLines={1} style={styles.documentName}>
                {doc.name}
              </Text>
              {removeDocument && (
                <IconButton
                  icon="close"
                  size={20}
                  onPress={() => removeDocument(index)}
                />
              )}
            </View>
          ))}
      </View>

      <SelectPropertyModal
        visible={showPropertyModal}
        onDismiss={() => setShowPropertyModal(false)}
        properties={properties}
        onSelectProperty={onSelectProperty}
      />

      <SelectHouseModal
        visible={showHouseModal}
        onDismiss={() => setShowHouseModal(false)}
        houses={houses}
        storeContracts={storeContracts}
        form={form}
        houseSearch={houseSearch}
        setHouseSearch={setHouseSearch}
        onSelectHouse={onSelectHouse}
        defaultCurrency={defaultCurrency}
      />

      {!isEdit && showTenantModal && (
        <SelectTenantModal
          visible={true}
          onDismiss={() => setShowTenantModal(false)}
          tenants={storeTenants}
          contracts={storeContracts}
          houses={storeHouses}
          properties={storeProperties}
          onSelect={selection => {
            if (Array.isArray(selection)) return;
            onSelectTenant(selection);
          }}
          selectedId={form.tenant_id}
          showAllTenants={true}
          showPhone={true}
        />
      )}

      <BaseModal
        visible={!!existingContractsInfo}
        onDismiss={() => setExistingContractsInfo(null)}
        mode="confirm"
        title="Existing Contract(s) Found"
        message={existingContractsInfo?.message || ''}
        confirmText="Continue"
        onConfirm={confirmSelectTenant}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    marginBottom: 16,
  },
  remarksInput: {
    height: 100,
  },
  tenantInfoBox: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
  },
  documentsSection: {
    marginTop: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 16,
  },
  uploadButton: {
    marginBottom: 16,
  },
  documentActions: {
    flexDirection: 'row',
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  documentName: {
    flex: 1,
    marginRight: 8,
  },
});
