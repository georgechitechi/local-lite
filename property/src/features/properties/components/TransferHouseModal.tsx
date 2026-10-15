import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Divider, HelperText, List, Text, TextInput } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import EmptyState from '@/shared/components/EmptyState';
import { useContracts, useCoreMutations, useHouses } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateForDB, parseLocalDate } from '@/shared/utils/formatters';
import { generateUUID } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import PropertySelectModal, { type SelectedProperty } from './PropertySelectModal';

interface TransferHouseModalProps {
  visible: boolean;
  onDismiss: () => void;
  contractId: string | null;
}

export default function TransferHouseModal({
  visible,
  onDismiss,
  contractId,
}: TransferHouseModalProps) {
  const { user } = useAuth();
  const { selectedBusiness } = useBusiness();
  const houses = useHouses(selectedBusiness?.id);
  const contracts = useContracts(selectedBusiness?.id);
  const { batch } = useCoreMutations();
  const { showSnackbar } = useSnackbar();
  const colors = useThemeColors() as any;
  const [saving, setSaving] = useState(false);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [showHouseModal, setShowHouseModal] = useState(false);

  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [selectedPropertyName, setSelectedPropertyName] = useState<string | null>(null);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  const [selectedHouseNumber, setSelectedHouseNumber] = useState<string | null>(null);
  const [transferDate, setTransferDate] = useState<string>(formatDateForDB(new Date()));
  const [newRentAmount, setNewRentAmount] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});

  const contract = contracts.find(c => c.id === contractId);

  useEffect(() => {
    if (visible && contract) {
      // Reset form on open
      setSelectedPropertyId(null);
      setSelectedPropertyName(null);
      setSelectedHouseId(null);
      setSelectedHouseNumber(null);
      setTransferDate(formatDateForDB(new Date()));
      setNewRentAmount('');
      setErrors({});
    }
  }, [visible, contract]);

  const availableHouses = useMemo(() => {
    if (!selectedPropertyId) return [];
    return houses
      .filter(
        h =>
          h.property_id === selectedPropertyId &&
          h.status === 'available' &&
          !contracts.some(c => c.house_id === h.id && isActiveContractStatus(c.status)),
      )
      .sort((a, b) =>
        a.house_number.localeCompare(b.house_number, undefined, { numeric: true }),
      );
  }, [houses, contracts, selectedPropertyId]);

  const handlePropertySelect = (property: SelectedProperty) => {
    setSelectedPropertyId(property.id);
    setSelectedPropertyName(property.name);
    setSelectedHouseId(null); // Reset house when property changes
    setSelectedHouseNumber(null);
    setNewRentAmount('');
  };

  const selectHouse = (house: any) => {
    setSelectedHouseId(house.id);
    setSelectedHouseNumber(house.house_number);
    setNewRentAmount(house.monthly_rent.toString());
    setShowHouseModal(false);
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!selectedPropertyId) newErrors.property = 'Please select a property';
    if (!selectedHouseId) newErrors.house = 'Please select a house';
    if (!transferDate) newErrors.transferDate = 'Please select a transfer date';
    if (!newRentAmount || Number.isNaN(Number(newRentAmount)))
      newErrors.rent = 'Valid rent amount is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate() || !contract || !selectedBusiness || !user) return;

    setSaving(true);
    try {
      const dateStr = transferDate;

      const newContractId = generateUUID();
      const newEndDate = parseLocalDate(transferDate);
      newEndDate.setFullYear(newEndDate.getFullYear() + 1);

      await batch([
        {
          tableName: 'contracts',
          operation: 'UPDATE',
          rowId: contract.id,
          payload: {
            status: 'terminated',
            end_date: dateStr,
            remarks: `Transferred to a new house on ${dateStr}. ${contract.remarks || ''}`,
          },
        },
        {
          tableName: 'contracts',
          operation: 'INSERT',
          payload: {
            id: newContractId,
            business_id: selectedBusiness.id,
            house_id: selectedHouseId,
            tenant_id: contract.tenant_id,
            user_id: user.id,
            start_date: dateStr,
            end_date: formatDateForDB(newEndDate),
            rent_amount: Number(newRentAmount),
            status: 'active',
            metadata: { is_transfer: true, previous_contract_id: contract.id },
            deleted: false,
          },
        },
      ]);

      showSnackbar('Tenant transferred successfully!', 'success');
      onDismiss();
    } catch (err: any) {
      console.error('Transfer Error:', err);
      showSnackbar(err.message || 'Failed to transfer tenant', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title="Transfer House"
        subtitle="Move tenant to a different house"
        scrollable
        maxHeight={'85%'}
        actions={[
          { label: 'Cancel', onPress: onDismiss, disabled: saving },
          {
            label: 'Transfer',
            onPress: handleSubmit,
            mode: 'contained',
            loading: saving,
          },
        ]}
      >
        <View style={styles.container}>
          <Text variant="bodyMedium" style={styles.description}>
            This action will terminate the current contract on the selected date and
            create a new contract for the new house.
          </Text>

          <Button
            mode="outlined"
            onPress={() => setShowPropertyModal(true)}
            style={{ ...styles.input, backgroundColor: colors.surface }}
            contentStyle={styles.buttonContent}
          >
            {selectedPropertyName || 'Select Property'}
          </Button>
          {errors.property && <HelperText type="error">{errors.property}</HelperText>}

          <Button
            mode="outlined"
            onPress={() => setShowHouseModal(true)}
            style={{ ...styles.input, backgroundColor: colors.surface }}
            contentStyle={styles.buttonContent}
            disabled={!selectedPropertyId}
          >
            {selectedHouseNumber ? `House ${selectedHouseNumber}` : 'Select House'}
          </Button>
          {errors.house && <HelperText type="error">{errors.house}</HelperText>}

          <View style={styles.dateContainer}>
            <DatePicker
              label="Transfer Date"
              value={transferDate}
              onChange={date => setTransferDate(date || formatDateForDB(new Date()))}
            />
            {errors.transferDate ? (
              <HelperText type="error" visible style={{ paddingHorizontal: 0 }}>
                {errors.transferDate}
              </HelperText>
            ) : (
              <HelperText type="info" visible style={{ paddingHorizontal: 0 }}>
                The current contract will end on this date.
              </HelperText>
            )}
          </View>

          <TextInput
            label="New Monthly Rent"
            value={newRentAmount}
            onChangeText={setNewRentAmount}
            keyboardType="numeric"
            mode="outlined"
            error={!!errors.rent}
            style={styles.input}
          />
          {errors.rent && <HelperText type="error">{errors.rent}</HelperText>}
        </View>
      </BaseModal>

      <PropertySelectModal
        visible={showPropertyModal}
        onDismiss={() => setShowPropertyModal(false)}
        onSelect={handlePropertySelect}
        selectedId={selectedPropertyId}
      />
      <BaseModal
        visible={showHouseModal}
        onDismiss={() => setShowHouseModal(false)}
        title="Select House"
        subtitle="Choose an available house"
        edgeToEdge
        maxHeight="80%"
        scrollable
      >
        {availableHouses.length === 0 ? (
          <EmptyState icon="home-outline" title="No available houses found" />
        ) : (
          availableHouses.map(house => (
            <React.Fragment key={house.id}>
              <List.Item
                title={`House ${house.house_number}`}
                description={`Rent: ${house.monthly_rent}`}
                onPress={() => selectHouse(house)}
              />
              <Divider />
            </React.Fragment>
          ))
        )}
      </BaseModal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  description: {
    marginBottom: 16,
    opacity: 0.8,
  },
  dateContainer: {
    marginTop: 8,
    marginBottom: 12,
  },
  input: {
    marginBottom: 4,
    marginTop: 8,
  },
  buttonContent: {
    justifyContent: 'flex-start',
  },
});
