import { useCallback, useState } from 'react';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { supabase } from '@/shared/services/supabase';
import { getAuthStateSnapshot } from '@/stores/authStore';

export function useAccountDeletion() {
  const { user, refreshUser } = useAuth();
  const { showSnackbar } = useSnackbar();
  const { checkOnline } = useOfflineCheck();
  const { requireCloudSync } = useLocalSync();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deletionRequestedAt = user?.user_metadata?.deletion_requested_at;
  const scheduledDeletionAt = user?.user_metadata?.scheduled_deletion_at;
  const isDeletionPending = !!deletionRequestedAt;

  const requestDeletion = useCallback(async () => {
    if (!checkOnline('Account deletion') || !requireCloudSync('Account deletion')) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        'delete-user-data',
        {
          headers: getAuthStateSnapshot().session
            ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
            : undefined,
          body: { action: 'request' },
        },
      );

      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);

      showSnackbar('Account deletion requested successfully', 'success');
      await refreshUser();
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to request account deletion';
      setError(errMsg);
      showSnackbar(errMsg, 'error');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refreshUser, showSnackbar, checkOnline, requireCloudSync]);

  const cancelDeletion = useCallback(async () => {
    if (
      !checkOnline('Cancel account deletion') ||
      !requireCloudSync('Cancel account deletion')
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        'delete-user-data',
        {
          headers: getAuthStateSnapshot().session
            ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
            : undefined,
          body: { action: 'cancel' },
        },
      );

      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);

      showSnackbar('Account deletion request cancelled successfully', 'success');
      await refreshUser();
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to cancel deletion request';
      setError(errMsg);
      showSnackbar(errMsg, 'error');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refreshUser, showSnackbar, checkOnline, requireCloudSync]);

  return {
    isDeletionPending,
    deletionRequestedAt,
    scheduledDeletionAt,
    requestDeletion,
    cancelDeletion,
    loading,
    error,
  };
}
