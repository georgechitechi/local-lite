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
      {ui.businessSelectModalVisible && (
        <BusinessSelectModal
          visible={true}
          onDismiss={() => setUIField('businessSelectModalVisible', false)}
        />
      )}
      {ui.contractSettingsModalVisible && (
        <ContractSettingsModal
          visible={true}
          onDismiss={() => setUIField('contractSettingsModalVisible', false)}
        />
      )}
      {ui.contractManagementModalVisible && (
        <ContractManagementModal
          visible={true}
          onDismiss={() => setUIField('contractManagementModalVisible', false)}
        />
      )}
      {ui.paymentMessagesListModalVisible && (
        <PaymentMessagesListModal
          visible={true}
          onDismiss={() => setUIField('paymentMessagesListModalVisible', false)}
        />
      )}
      {ui.propertyFormModalVisible && (
        <PropertyFormModal
          visible={true}
          onDismiss={() => {
            setUIState({
              propertyFormModalVisible: false,
              propertyFormPropertyId: null,
            });
          }}
          propertyId={ui.propertyFormPropertyId}
        />
      )}
      {ui.houseFormModalVisible && (
        <HouseFormModal
          visible={true}
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
      )}
      {ui.bulkHouseFormModalVisible && (
        <HouseFormModal
          visible={true}
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
      )}
      {ui.houseViewModalVisible && (
        <HouseViewModal
          visible={true}
          onDismiss={() => {
            setUIState({
              houseViewModalVisible: false,
              houseViewHouseId: null,
            });
          }}
          houseId={ui.houseViewHouseId}
        />
      )}
      {ui.bookingsListModalVisible && (
        <BookingsListModal
          visible={true}
          onDismiss={() => setUIField('bookingsListModalVisible', false)}
        />
      )}
      {ui.expensesListModalVisible && (
        <ExpensesListModal
          visible={true}
          onDismiss={() => setUIField('expensesListModalVisible', false)}
        />
      )}
      {ui.expenseModalVisible && (
        <ExpenseModal
          visible={true}
          onDismiss={() => {
            setUIState({
              expenseModalVisible: false,
              expenseModalInitialData: null,
            });
          }}
          initialData={ui.expenseModalInitialData}
        />
      )}
    </React.Fragment>
  );
};
