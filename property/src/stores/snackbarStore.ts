export type SnackbarType = 'info' | 'error' | 'success' | 'warning';

export interface SnackbarAction {
  label: string;
  onPress: () => void;
}

export interface SnackbarState {
  visible: boolean;
  message: string;
  type: SnackbarType;
  action?: SnackbarAction;
}

let currentState: SnackbarState = {
  visible: false,
  message: '',
  type: 'info',
  action: undefined,
};

const listeners = new Set<(state: SnackbarState) => void>();

export const subscribeSnackbar = (cb: (state: SnackbarState) => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const getSnackbarSnapshot = (): SnackbarState => currentState;

export const showSnackbar = (
  message: string,
  type: SnackbarType = 'info',
  action?: SnackbarAction,
) => {
  currentState = {
    message,
    type,
    action,
    visible: true,
  };
  listeners.forEach(cb => {
    cb(currentState);
  });
};

export const hideSnackbar = () => {
  currentState = {
    ...currentState,
    visible: false,
    action: undefined,
  };
  listeners.forEach(cb => {
    cb(currentState);
  });
};

export const useSnackbar = () => ({
  showSnackbar,
  hideSnackbar,
});

