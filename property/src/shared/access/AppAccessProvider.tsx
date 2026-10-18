import type React from 'react';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { AccessProvider } from './policies';

export function AppAccessProvider({ children }: { children: React.ReactNode }) {
  const { userRoles, isOwner, loading } = useAccessControl();
  return (
    <AccessProvider roles={userRoles as any} isSuperUser={isOwner} loading={loading}>
      {children}
    </AccessProvider>
  );
}
