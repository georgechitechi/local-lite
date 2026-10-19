import Storage from 'expo-sqlite/kv-store';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { preCacheGallery } from '@/shared/components/CachedImage';
import { useBusinesses } from '@/shared/hooks/useStore';
import { OFFLINE_USER_ID } from '@/shared/services/auth';
import { getSyncClient } from '@/shared/services/sync/client';
import type { Business } from '@/shared/types/types';

const isValidBusiness = (business: any): business is Business | { id: string } => {
  return business && typeof business === 'object' && 'id' in business;
};

export interface BusinessContextValue {
  selectedBusiness: Business | null;
  selectBusiness: (business: Business) => void;
  clearSelectedBusiness: () => void;
  requireBusiness: () => boolean;
  refreshBusiness: () => Promise<void>;
  loading: boolean;
  isAuthenticated: boolean;
}

const BusinessContext = createContext<BusinessContextValue | null>(null);

interface BusinessProviderProps {
  children: React.ReactNode;
}

export function BusinessProvider({ children }: BusinessProviderProps) {
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
  const [storageLoading, setStorageLoading] = useState<boolean>(true);
  const businesses = useBusinesses();
  const { user, loading: authLoading } = useAuth();

  // Load persisted selectedBusinessId from Storage on mount
  useEffect(() => {
    let isMounted = true;
    Storage.getItem('selectedBusinessId')
      .then(storedId => {
        if (isMounted) {
          if (storedId) {
            setSelectedBusinessId(storedId);
          }
          setStorageLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setStorageLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const selectedBusiness = useMemo(() => {
    if (!user || !selectedBusinessId) return null;
    const found = businesses.find(b => b.id === selectedBusinessId);
    if (found) return found;
    return null;
  }, [businesses, selectedBusinessId, user]);

  useEffect(() => {
    if (!authLoading && !storageLoading && selectedBusinessId && businesses.length > 0) {
      const exists = businesses.some(b => b.id === selectedBusinessId);
      if (!exists) {
        setSelectedBusinessId('');
        Storage.removeItem('selectedBusinessId').catch(() => {});
      }
    }
  }, [selectedBusinessId, businesses, authLoading, storageLoading]);

  // Pre-cache gallery images, update syncScope, and trigger immediate pull when business changes
  useEffect(() => {
    let mounted = true;
    getSyncClient()
      .then(client => {
        if (!mounted) return;
        if (typeof client.setSyncScope === 'function') {
          client.setSyncScope(
            selectedBusiness ? { business_id: selectedBusiness.id } : undefined,
          );
        }
        if (selectedBusiness) {
          // Immediately pull any pending cloud changes for the selected business in background
          if (typeof client.syncWorker?.pullRemoteChanges === 'function') {
            client.syncWorker.pullRemoteChanges().catch(() => {});
          }

          client
            .findMany('gallery_images', {
              where: { business_id: selectedBusiness.id },
            })
            .then(images => {
              if (mounted && images && images.length > 0) {
                preCacheGallery(images).catch(e =>
                  console.log('Pre-cache initial failed:', e.message),
                );
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [selectedBusiness]);

  // Offline businesses remain claimable, but only after selection passed the
  // same reactive ownership/share/tenant checks as every other business.
  useEffect(() => {
    if (
      authLoading ||
      !user ||
      !selectedBusiness ||
      user.id === OFFLINE_USER_ID ||
      selectedBusiness.user_id !== OFFLINE_USER_ID
    )
      return;
    getSyncClient()
      .then(client =>
        client.update('businesses', selectedBusiness.id, { user_id: user.id }),
      )
      .catch(error => console.error('Failed to claim offline business:', error));
  }, [authLoading, user, selectedBusiness]);

  const selectBusiness = useCallback(
    (business: Business) => {
      if (!isValidBusiness(business)) throw new Error('Invalid business data');
      if (!businesses.some(candidate => candidate.id === business.id)) {
        throw new Error('You do not have access to this business');
      }
      setSelectedBusinessId(business.id);
      Storage.setItem('selectedBusinessId', business.id).catch(() => {});
    },
    [businesses],
  );

  const clearSelectedBusiness = useCallback(() => {
    setSelectedBusinessId('');
    Storage.removeItem('selectedBusinessId').catch(() => {});
  }, []);

  const requireBusiness = useCallback(() => !!selectedBusiness, [selectedBusiness]);

  const refreshBusiness = useCallback(async () => {
    try {
      const client = await getSyncClient().catch(() => null);
      if (client?.syncWorker) {
        await client.syncWorker.pullRemoteChanges().catch(() => {});
      }
    } catch (error) {
      console.error('Error refreshing business:', error);
    }
  }, []);

  const contextValue = useMemo<BusinessContextValue>(
    () => ({
      selectedBusiness: selectedBusiness as Business | null,
      selectBusiness,
      clearSelectedBusiness,
      requireBusiness,
      refreshBusiness,
      loading: authLoading || storageLoading,
      isAuthenticated: !!user,
    }),
    [
      selectedBusiness,
      selectBusiness,
      clearSelectedBusiness,
      requireBusiness,
      refreshBusiness,
      authLoading,
      storageLoading,
      user,
    ],
  );

  return (
    <BusinessContext.Provider value={contextValue}>{children}</BusinessContext.Provider>
  );
}

export function useBusiness(): BusinessContextValue {
  const context = useContext(BusinessContext);
  if (!context) {
    return {
      selectedBusiness: null,
      selectBusiness: () => {},
      clearSelectedBusiness: () => {},
      requireBusiness: () => false,
      refreshBusiness: async () => {},
      loading: false,
      isAuthenticated: false,
    };
  }
  return context;
}
