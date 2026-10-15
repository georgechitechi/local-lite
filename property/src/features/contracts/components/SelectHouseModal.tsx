import React from 'react';
import { Divider, List } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import { formatWithCurrency } from '@/shared/utils/formatters';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import type { ContractsFormData, House } from './ContractsForm';

interface SelectHouseModalProps {
  visible: boolean;
  onDismiss: () => void;
  houses: House[];
  storeContracts: any[];
  form: ContractsFormData;
  houseSearch: string;
  setHouseSearch: (v: string) => void;
  onSelectHouse: (house: House) => void;
  defaultCurrency: any;
}

export default function SelectHouseModal({
  visible,
  onDismiss,
  houses,
  storeContracts,
  form,
  houseSearch,
  setHouseSearch,
  onSelectHouse,
  defaultCurrency,
}: SelectHouseModalProps) {
  const filteredHouses = houses.filter(house => {
    const matchesSearch = house.house_number
      .toLowerCase()
      .includes(houseSearch.toLowerCase());
    const matchesProperty = form.property_id
      ? house.property_id === form.property_id
      : true;

    const hasActiveContract = storeContracts.some(
      c =>
        c.house_id === house.id &&
        isActiveContractStatus(c.status) &&
        (!form.original_house_id || house.id !== form.original_house_id),
    );

    return matchesSearch && matchesProperty && !hasActiveContract;
  });

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
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
      {filteredHouses.length === 0 ? (
        <EmptyState icon="home-outline" title="No houses found" />
      ) : (
        filteredHouses.map(house => (
          <React.Fragment key={house.id}>
            <List.Item
              title={`House ${house.house_number}`}
              description={
                defaultCurrency
                  ? `Rent: ${formatWithCurrency(house.monthly_rent, defaultCurrency as any)}`
                  : `Rent: ${formatWithCurrency(house.monthly_rent, defaultCurrency)}`
              }
              onPress={() => onSelectHouse(house)}
            />
            <Divider />
          </React.Fragment>
        ))
      )}
    </BaseModal>
  );
}
