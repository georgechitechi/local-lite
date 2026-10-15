import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useReminderActions } from '@/features/reminders/hooks/useReminderActions';
import { useReminderData } from '@/features/reminders/hooks/useReminderData';
import { useReminderState } from '@/features/reminders/hooks/useReminderState';
import { useAuth } from '@/providers/AuthProvider';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useCurrency } from '@/shared/hooks/useCurrency';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useSettings, useStoreRefresh } from '@/shared/hooks/useStore';

export function useReminders() {
  const { user } = useAuth();
  const { showSnackbar } = useSnackbar();
  const { selectedBusiness } = useBusiness();
  const { checkOnline } = useOfflineCheck();
  const { requireCloudSync } = useLocalSync();
  const business = selectedBusiness;

  const settings = useSettings(selectedBusiness?.id);
  const { refreshing, onRefresh: fetchData } = useStoreRefresh();
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);
  const { hasAccess } = useAccessControl();

  const state = useReminderState(settings);
  const data = useReminderData(selectedBusiness, state);
  const actions = useReminderActions(
    null,
    user,
    business,
    defaultCurrency,
    showSnackbar,
    checkOnline,
    requireCloudSync,
    hasAccess,
    state,
    data,
  );

  return {
    ...state,
    ...data,
    ...actions,

    selectedBusiness,
    business,
    refreshing,
    defaultCurrency,
    hasAccess,
    fetchData,
    store: null,
    showSnackbar,
  };
}
