import { useSyncExternalStore } from 'react';

export interface UIState {
  contractSettingsModalVisible: boolean;
  paymentMessagesListModalVisible: boolean;
  expensesListModalVisible: boolean;
  expenseModalVisible: boolean;
  expenseModalInitialData: any;
  businessSelectModalVisible: boolean;
  contractManagementModalVisible: boolean;
  bookingsListModalVisible: boolean;
  mpesaPaymentModalVisible: boolean;
  propertyFormModalVisible: boolean;
  propertyFormPropertyId: string | null;
  houseFormModalVisible: boolean;
  houseFormHouseId: string | null;
  houseFormPropertyId: string | null;
  houseFormPropertyName: string | null;
  houseViewModalVisible: boolean;
  houseViewHouseId: string | null;
  bulkHouseFormModalVisible: boolean;
  bulkHouseFormPropertyId: string | null;
  bulkHouseFormPropertyName: string | null;
}

const initialUIState: UIState = {
  contractSettingsModalVisible: false,
  paymentMessagesListModalVisible: false,
  expensesListModalVisible: false,
  expenseModalVisible: false,
  expenseModalInitialData: null,
  businessSelectModalVisible: false,
  contractManagementModalVisible: false,
  bookingsListModalVisible: false,
  mpesaPaymentModalVisible: false,
  propertyFormModalVisible: false,
  propertyFormPropertyId: null,
  houseFormModalVisible: false,
  houseFormHouseId: null,
  houseFormPropertyId: null,
  houseFormPropertyName: null,
  houseViewModalVisible: false,
  houseViewHouseId: null,
  bulkHouseFormModalVisible: false,
  bulkHouseFormPropertyId: null,
  bulkHouseFormPropertyName: null,
};

let currentUIState: UIState = { ...initialUIState };
const uiListeners = new Set<() => void>();

export const subscribeUIState = (cb: () => void) => {
  uiListeners.add(cb);
  return () => {
    uiListeners.delete(cb);
  };
};

export const getUIStateSnapshot = (): UIState => currentUIState;

export const setUIState = (patch: Partial<UIState>) => {
  currentUIState = { ...currentUIState, ...patch };
  uiListeners.forEach(cb => {
    cb();
  });
};

export const setUIField = <K extends keyof UIState>(key: K, value: UIState[K]) => {
  setUIState({ [key]: value });
};

export function useUIState<T>(selector: (state: UIState) => T): T {
  return useSyncExternalStore(
    subscribeUIState,
    () => selector(currentUIState),
    () => selector(initialUIState),
  );
}
