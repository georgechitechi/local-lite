import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Divider, List, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import EmptyState from '@/shared/components/EmptyState';
import {
  useContracts,
  useCoreMutations,
  useHouses,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDateForDB } from '@/shared/utils/formatters';
import { generateUUID } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';

interface SwapHouseModalProps {
  visible: boolean;
  onDismiss: () => void;
  contractId: string | null;
}

export default function SwapHouseModal({
  visible,
  onDismiss,
  contractId,
}: SwapHouseModalProps) {
  const { user } = useAuth();
  const { selectedBusiness } = useBusiness();
  const contracts = useContracts(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const tenants = useTenants(selectedBusiness?.id);
  const { batch } = useCoreMutations();
  const { showSnackbar } = useSnackbar();
  const colors = useThemeColors() as any;

  const [saving, setSaving] = useState(false);
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [swapDate, setSwapDate] = useState<string>(formatDateForDB(new Date()));

  // The contract we are swapping out
  const myContract = contracts.find(c => c.id === contractId);

  // List of eligible partner contracts
  const partnerOptions = contracts
    .filter(c => {
      // Must be active, different from current contract, and not in the same house
      return (
        c.id !== contractId &&
        isActiveContractStatus(c.status) &&
        c.house_id !== myContract?.house_id
      );
    })
    .map(c => {
      const t = tenants.find(t => t.id === c.tenant_id);
      const h = houses.find(h => h.id === c.house_id);
      return {
        ...c,
        tenantName: t?.name || 'Unknown Tenant',
        houseNumber: h?.house_number || 'Unknown',
      };
    });

  const selectedPartner = partnerOptions.find(c => c.id === selectedPartnerId);

  const handlePartnerSelect = (partnerId: string) => {
    setSelectedPartnerId(partnerId);
    setShowPartnerModal(false);
  };

  const addYear = (dateStr: string) => {
    const d = new Date(dateStr);
    d.setFullYear(d.getFullYear() + 1);
    return formatDateForDB(d);
  };

  const handleSubmit = async () => {
    if (!myContract || !selectedPartnerId) {
      showSnackbar('Please select a partner contract first', 'error');
      return;
    }
    const partnerContract = contracts.find(c => c.id === selectedPartnerId);
    if (!partnerContract) return;

    try {
      setSaving(true);
      const swapDateStr = swapDate;

      const newIdA = generateUUID();
      const newIdB = generateUUID();

      await batch([
        {
          tableName: 'contracts',
          operation: 'UPDATE',
          rowId: myContract.id,
          payload: {
            status: 'terminated',
            end_date: swapDateStr,
            remarks: `Swapped with contract ${partnerContract.id}`,
            updated_at: new Date().toISOString(),
          },
        },
        {
          tableName: 'contracts',
          operation: 'UPDATE',
          rowId: partnerContract.id,
          payload: {
            status: 'terminated',
            end_date: swapDateStr,
            remarks: `Swapped with contract ${myContract.id}`,
          },
        },
        {
          tableName: 'contracts',
          operation: 'INSERT',
          payload: {
            id: newIdA,
            business_id: selectedBusiness?.id,
            house_id: partnerContract.house_id,
            tenant_id: myContract.tenant_id,
            user_id: user?.id,
            start_date: swapDateStr,
            end_date: formatDateForDB(addYear(swapDateStr)),
            rent_amount: partnerContract.rent_amount,
            status: 'active',
            metadata: {
              is_swap: true,
              swap_partner_contract_id: newIdB,
            },
            deleted: false,
          },
        },
        {
          tableName: 'contracts',
          operation: 'INSERT',
          payload: {
            id: newIdB,
            business_id: selectedBusiness?.id,
            house_id: myContract.house_id,
            tenant_id: partnerContract.tenant_id,
            user_id: user?.id,
            start_date: swapDateStr,
            end_date: formatDateForDB(addYear(swapDateStr)),
            rent_amount: myContract.rent_amount,
            status: 'active',
            metadata: {
              is_swap: true,
              swap_partner_contract_id: newIdA,
            },
            deleted: false,
          },
        },
      ]);

      showSnackbar('Houses swapped successfully!', 'success');
      onDismiss();
    } catch (err: any) {
      console.error('Swap error:', err);
      showSnackbar(err.message || 'Swap failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title="Swap Houses"
        subtitle="Exchange houses between two tenants"
        scrollable
        maxHeight="85%"
        actions={[
          { label: 'Cancel', onPress: onDismiss, disabled: saving },
          {
            label: 'Swap',
            onPress: handleSubmit,
            mode: 'contained',
            loading: saving,
          },
        ]}
      >
        <View style={styles.container}>
          <Text variant="bodyMedium" style={styles.description}>
            This action will terminate both current contracts on the selected date and
            create two new active contracts for the swapped houses.
          </Text>

          <Button
            mode="outlined"
            onPress={() => setShowPartnerModal(true)}
            style={{ ...styles.input, backgroundColor: colors.surface }}
            contentStyle={styles.buttonContent}
          >
            {selectedPartner
              ? `Partner: ${selectedPartner.tenantName} (House ${selectedPartner.houseNumber})`
              : 'Select Partner Contract'}
          </Button>

          <View style={styles.dateContainer}>
            <DatePicker
              label="Swap Date"
              value={swapDate}
              onChange={date => setSwapDate(date || formatDateForDB(new Date()))}
            />
          </View>
        </View>
      </BaseModal>

      <BaseModal
        visible={showPartnerModal}
        onDismiss={() => setShowPartnerModal(false)}
        title="Choose Partner Contract"
        edgeToEdge
        maxHeight="80%"
        scrollable
      >
        {partnerOptions.length === 0 ? (
          <EmptyState icon="account-switch-outline" title="No eligible contracts" />
        ) : (
          partnerOptions.map(c => (
            <React.Fragment key={c.id}>
              <List.Item
                title={c.tenantName}
                description={`House ${c.houseNumber} – Rent ${c.rent_amount}`}
                onPress={() => handlePartnerSelect(c.id)}
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
    opacity: 0.7,
  },
  input: {
    marginVertical: 8,
  },
  buttonContent: {
    height: 48,
  },
  dateContainer: {
    marginTop: 12,
  },
});
