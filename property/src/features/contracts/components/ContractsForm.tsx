import type React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Button,
  HelperText,
  IconButton,
  Menu,
  Text,
  TextInput,
} from 'react-native-paper';
import SelectTenantModal from '@/features/tenants/components/SelectTenantModal';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { formatDateForDB, parseLocalDate } from '@/shared/utils/formatters';
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

interface ContractsFormProps {
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
  statusMenuVisible: boolean;
  setStatusMenuVisible: (v: boolean) => void;
  showPropertyModal: boolean;
  setShowPropertyModal: (v: boolean) => void;
  showHouseModal: boolean;
  setShowHouseModal: (v: boolean) => void;
  showTenantModal: boolean;
  setShowTenantModal: (v: boolean) => void;
  houseSearch: string;
  setHouseSearch: (v: string) => void;
  existingContractsInfo: { tenant: Tenant; message: string } | null;
  setExistingContractsInfo: (v: any) => void;
  handleDocumentUpload: () => void;
  removeDocument: (index: number) => void;
  selectProperty: (property: Property) => void;
  selectHouse: (house: House) => void;
  selectTenant: (tenant: Tenant) => void;
  confirmSelectTenant: () => void;
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
  statusMenuVisible,
  setStatusMenuVisible,
  showPropertyModal,
  setShowPropertyModal,
  showHouseModal,
  setShowHouseModal,
  showTenantModal,
  setShowTenantModal,
  houseSearch,
  setHouseSearch,
  existingContractsInfo,
  setExistingContractsInfo,
  handleDocumentUpload,
  removeDocument,
  selectProperty,
  selectHouse,
  selectTenant,
  confirmSelectTenant,
}: ContractsFormProps) {
  return (
    <View>
      <Button
        mode="outlined"
        onPress={() => setShowPropertyModal(true)}
        style={{ ...styles.input, backgroundColor: colors.surface }}
      >
        {form.property_name || 'Select Property'}
      </Button>
      {errors.property && <HelperText type="error">{errors.property}</HelperText>}

      <Button
        mode="outlined"
        onPress={() => setShowHouseModal(true)}
        style={{ ...styles.input, backgroundColor: colors.surface }}
        disabled={!form.property_id}
      >
        {form.house_number ? `House ${form.house_number}` : 'Select House'}
      </Button>
      {errors.house && <HelperText type="error">{errors.house}</HelperText>}

      <Button
        mode="outlined"
        onPress={() => setShowTenantModal(true)}
        style={{ ...styles.input, backgroundColor: colors.surface }}
      >
        {form.tenant_name || 'Select Tenant'}
      </Button>
      {errors.tenant && <HelperText type="error">{errors.tenant}</HelperText>}

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
        <Button
          mode="outlined"
          icon="file-upload"
          onPress={handleDocumentUpload}
          style={[styles.uploadButton, !isOnline && { opacity: 0.5 }]}
          disabled={false}
        >
          Upload Document
        </Button>
        {form.documents.map((doc, index) => (
          <View key={index} style={styles.documentItem}>
            <Text numberOfLines={1} style={styles.documentName}>
              {doc.name}
            </Text>
            <IconButton icon="close" size={20} onPress={() => removeDocument(index)} />
          </View>
        ))}
      </View>

      <SelectPropertyModal
        visible={showPropertyModal}
        onDismiss={() => setShowPropertyModal(false)}
        properties={properties}
        onSelectProperty={selectProperty}
      />

      <SelectHouseModal
        visible={showHouseModal}
        onDismiss={() => setShowHouseModal(false)}
        houses={houses}
        storeContracts={storeContracts}
        form={form}
        houseSearch={houseSearch}
        setHouseSearch={setHouseSearch}
        onSelectHouse={selectHouse}
        defaultCurrency={defaultCurrency}
      />

      {showTenantModal && (
        <SelectTenantModal
          visible={true}
          onDismiss={() => setShowTenantModal(false)}
          tenants={storeTenants}
          contracts={storeContracts}
          houses={storeHouses}
          properties={storeProperties}
          onSelect={selection => {
            if (Array.isArray(selection)) return;
            selectTenant(selection);
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
