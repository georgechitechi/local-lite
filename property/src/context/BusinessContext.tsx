import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { useAuth } from '@/providers/AuthProvider';
import { preCacheGallery } from '@/shared/components/CachedImage';
import { useBusinesses } from '@/shared/hooks/useStore';
import { OFFLINE_USER_ID } from '@/shared/services/auth';
import { getSyncClient, getSyncClientSync } from '@/shared/services/sync/client';
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
  const businesses = useBusinesses();
  const { user, loading: authLoading } = useAuth();

  // Load persisted selectedBusinessId from Storage on mount
  useEffect(() => {
    Storage.getItem('selectedBusinessId').then(storedId => {
      if (storedId) {
        setSelectedBusinessId(storedId);
      }
    });
  }, []);

  const findDefaultBusiness = useCallback(
    (bList: Business[]) => {
      if (!bList || bList.length === 0) return null;
      if (!user) return null;

      const isOffline = user.id === OFFLINE_USER_ID;
      // 1. Prioritize a business owned by the user or created offline
      const owned = bList.find(
        b => !b.deleted && (isOffline || b.user_id === user.id || b.user_id === OFFLINE_USER_ID),
      );
      if (owned) return owned;

      // 2. useBusinesses already restricts this list to active user access.
      return bList.find(b => !b.deleted) ?? null;
    },
    [user],
  );

  const selectedBusiness = useMemo(() => {
    if (!selectedBusinessId) {
      return findDefaultBusiness(businesses);
    }
    const found = businesses.find(b => b.id === selectedBusinessId);
    if (found && !found.deleted) return found;
    return findDefaultBusiness(businesses);
  }, [businesses, selectedBusinessId, findDefaultBusiness]);

  useEffect(() => {
    if (businesses.length > 0) {
      const exists = businesses.some(b => b.id === selectedBusinessId && !b.deleted);
      if (!exists) {
        const defaultBiz = findDefaultBusiness(businesses);
        if (defaultBiz) {
          setSelectedBusinessId(defaultBiz.id);
          Storage.setItem('selectedBusinessId', defaultBiz.id).catch(() => {});
        }
      }
    }
  }, [selectedBusinessId, businesses, findDefaultBusiness]);

  // Pre-cache gallery images when business changes
  useEffect(() => {
    if (selectedBusiness) {
      const client = getSyncClientSync();
      if (client) {
        client
          .findMany('gallery_images', {
            where: { business_id: selectedBusiness.id },
          })
          .then(images => {
            if (images && images.length > 0) {
              preCacheGallery(images).catch(e =>
                console.log('Pre-cache initial failed:', e.message),
              );
            }
          })
          .catch(() => {});
      }
    }
  }, [selectedBusiness]);

  // Offline businesses remain claimable, but only after selection passed the
  // same reactive ownership/share/tenant checks as every other business.
  useEffect(() => {
    if (authLoading || !user || !selectedBusiness ||
        user.id === OFFLINE_USER_ID || selectedBusiness.user_id !== OFFLINE_USER_ID) return;
    getSyncClient()
      .then(client => client.update('businesses', selectedBusiness.id, { user_id: user.id }))
      .catch(error => console.error('Failed to claim offline business:', error));
  }, [authLoading, user, selectedBusiness]);

  const selectBusiness = useCallback((business: Business) => {
    if (!isValidBusiness(business)) throw new Error('Invalid business data');
    if (!businesses.some(candidate => candidate.id === business.id)) {
      throw new Error('You do not have access to this business');
    }
    setSelectedBusinessId(business.id);
    Storage.setItem('selectedBusinessId', business.id).catch(() => {});
  }, [businesses]);

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
      loading: authLoading,
      isAuthenticated: !!user,
    }),
    [
      selectedBusiness,
      selectBusiness,
      clearSelectedBusiness,
      requireBusiness,
      refreshBusiness,
      authLoading,
      user,
    ]
  );

  return (
    <BusinessContext.Provider value={contextValue}>
      {children}
    </BusinessContext.Provider>
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
