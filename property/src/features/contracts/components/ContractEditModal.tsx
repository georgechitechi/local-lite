import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { TextInput } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import { useContracts, useCoreMutations } from '@/shared/hooks/useStore';
import { formatDateForDB } from '@/shared/utils/formatters';

interface ContractEditModalProps {
  visible: boolean;
  onDismiss: () => void;
  contractId: string | null;
}

export default function ContractEditModal({
  visible,
  onDismiss,
  contractId,
}: ContractEditModalProps) {
  const { selectedBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const contracts = useContracts(selectedBusiness?.id);
  const { update } = useCoreMutations();

  const [saving, setSaving] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rentAmount, setRentAmount] = useState('');
  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const handleDismiss = () => {
    setStartDate('');
    setEndDate('');
    setRentAmount('');
    setInitializedKey(null);
    onDismiss();
  };

  useEffect(() => {
    if (!visible || !contractId) return;
    if (initializedKey === contractId) return;

    const contract = contracts.find(c => c.id === contractId);
    if (contract) {
      setStartDate(formatDateForDB(contract.start_date) || '');
      setEndDate(formatDateForDB(contract.end_date) || '');
      setRentAmount(String(contract.rent_amount || ''));
      setInitializedKey(contractId);
    }
  }, [visible, contractId, contracts, initializedKey]);

  const handleSave = async () => {
    if (!contractId) return;

    setSaving(true);
    try {
      await update('contracts', contractId, {
        start_date: startDate,
        end_date: endDate,
        rent_amount: Number.parseFloat(rentAmount) || 0,
      });
      showSnackbar('Contract updated successfully', 'success');
      handleDismiss();
    } catch (error) {
      console.error('Error updating contract:', error);
      showSnackbar('Failed to update contract', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={handleDismiss}
      title="Edit Contract"
      subtitle="Update core contract details for housekeeping"
      scrollable={true}
      actions={[
        {
          label: 'Cancel',
          onPress: handleDismiss,
          mode: 'outlined',
          disabled: saving,
        },
        {
          label: saving ? 'Saving...' : 'Save Changes',
          onPress: handleSave,
          mode: 'contained',
          loading: saving,
          disabled: saving,
        },
      ]}
    >
      <View style={{ gap: 16, paddingBottom: 16 }}>
        <DatePicker
          label="Start Date"
          value={startDate}
          onChange={date => setStartDate(date || '')}
        />
        <DatePicker
          label="End Date"
          value={endDate}
          onChange={date => setEndDate(date || '')}
        />
        <TextInput
          label="Rent Amount"
          value={rentAmount}
          onChangeText={setRentAmount}
          keyboardType="decimal-pad"
          mode="outlined"
          left={<TextInput.Affix text="KSh " />}
        />
      </View>
    </BaseModal>
  );
}
