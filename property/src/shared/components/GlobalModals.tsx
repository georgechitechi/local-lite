import React, { useSyncExternalStore } from 'react';
import ContractManagementModal from '@/features/contracts/components/ContractManagementModal';
import ContractSettingsModal from '@/features/contracts/components/ContractSettingsModal';
import ExpenseModal from '@/features/expenses/components/ExpenseModal';
import ExpensesListModal from '@/features/expenses/components/ExpensesListModal';
import BookingsListModal from '@/features/payments/components/BookingsListModal';
import PaymentMessagesListModal from '@/features/payments/components/PaymentMessagesListModal';
import HouseFormModal from '@/features/properties/components/HouseFormModal';
import HouseViewModal from '@/features/properties/components/HouseViewModal';
import PropertyFormModal from '@/features/properties/components/PropertyFormModal';
import BusinessSelectModal from '@/features/settings/components/BusinessSelectModal';
import {
  getUIStateSnapshot,
  setUIField,
  setUIState,
  subscribeUIState,
} from '@/stores/uiStore';

export const GlobalModals = () => {
  const ui = useSyncExternalStore(subscribeUIState, getUIStateSnapshot);

  return (
    <React.Fragment>
      <BusinessSelectModal
        visible={ui.businessSelectModalVisible}
        onDismiss={() => setUIField('businessSelectModalVisible', false)}
      />
      <ContractSettingsModal
        visible={ui.contractSettingsModalVisible}
        onDismiss={() => setUIField('contractSettingsModalVisible', false)}
      />
      <ContractManagementModal
        visible={ui.contractManagementModalVisible}
        onDismiss={() => setUIField('contractManagementModalVisible', false)}
      />
      <PaymentMessagesListModal
        visible={ui.paymentMessagesListModalVisible}
        onDismiss={() => setUIField('paymentMessagesListModalVisible', false)}
      />
      <PropertyFormModal
        visible={ui.propertyFormModalVisible}
        onDismiss={() => {
          setUIState({
            propertyFormModalVisible: false,
            propertyFormPropertyId: null,
          });
        }}
        propertyId={ui.propertyFormPropertyId}
      />
      <HouseFormModal
        visible={ui.houseFormModalVisible}
        onDismiss={() => {
          setUIState({
            houseFormModalVisible: false,
            houseFormHouseId: null,
            houseFormPropertyId: null,
            houseFormPropertyName: null,
          });
        }}
        houseId={ui.houseFormHouseId}
        propertyId={ui.houseFormPropertyId}
        propertyName={ui.houseFormPropertyName}
      />
      <HouseFormModal
        visible={ui.bulkHouseFormModalVisible}
        onDismiss={() => {
          setUIState({
            bulkHouseFormModalVisible: false,
            bulkHouseFormPropertyId: null,
            bulkHouseFormPropertyName: null,
          });
        }}
        propertyId={ui.bulkHouseFormPropertyId}
        propertyName={ui.bulkHouseFormPropertyName}
        mode="bulk"
      />
      <HouseViewModal
        visible={ui.houseViewModalVisible}
        onDismiss={() => {
          setUIState({
            houseViewModalVisible: false,
            houseViewHouseId: null,
          });
        }}
        houseId={ui.houseViewHouseId}
      />
      <BookingsListModal
        visible={ui.bookingsListModalVisible}
        onDismiss={() => setUIField('bookingsListModalVisible', false)}
      />
      <ExpensesListModal
        visible={ui.expensesListModalVisible}
        onDismiss={() => setUIField('expensesListModalVisible', false)}
      />
      <ExpenseModal
        visible={ui.expenseModalVisible}
        onDismiss={() => {
          setUIState({
            expenseModalVisible: false,
            expenseModalInitialData: null,
          });
        }}
        initialData={ui.expenseModalInitialData}
      />
    </React.Fragment>
  );
};
