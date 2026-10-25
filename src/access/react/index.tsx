import React, { createContext, useContext, ReactNode, useMemo } from 'react';
import { AccessGuard } from '../guard.js';
import { AccessAction, AccessSubject } from '../types.js';

export interface AccessContextValue<TUser = any> {
  guard: AccessGuard<TUser> | null;
  user: TUser | null;
  can: (action: AccessAction, subject: AccessSubject, record?: any) => boolean;
  cannot: (action: AccessAction, subject: AccessSubject, record?: any) => boolean;
  assertCan: (action: AccessAction, subject: AccessSubject, record?: any) => void;
}

const AccessContext = createContext<AccessContextValue | null>(null);

export interface AccessProviderProps<TUser = any> {
  guard: AccessGuard<TUser>;
  children: ReactNode;
}

export function AccessProvider<TUser = any>({
  guard,
  children,
}: AccessProviderProps<TUser>) {
  const value = useMemo<AccessContextValue<TUser>>(() => {
    return {
      guard,
      user: guard.user,
      can: (action, subject, record) => guard.can(action, subject, record),
      cannot: (action, subject, record) => guard.cannot(action, subject, record),
      assertCan: (action, subject, record) => guard.assertCan(action, subject, record),
    };
  }, [guard]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess<TUser = any>(): AccessContextValue<TUser> {
  const context = useContext(AccessContext);
  if (!context) {
    throw new Error('useAccess must be used within an <AccessProvider>');
  }
  return context as AccessContextValue<TUser>;
}

export interface CanProps {
  I: AccessAction;
  a: AccessSubject;
  this?: any;
  fallback?: ReactNode;
  children: ReactNode;
}

export function Can({ I, a, this: record, fallback = null, children }: CanProps) {
  const { can } = useAccess();
  if (can(I, a, record)) {
    return <>{children}</>;
  }
  return <>{fallback}</>;
}

export interface CannotProps {
  I: AccessAction;
  a: AccessSubject;
  this?: any;
  fallback?: ReactNode;
  children: ReactNode;
}

export function Cannot({ I, a, this: record, fallback = null, children }: CannotProps) {
  const { cannot } = useAccess();
  if (cannot(I, a, record)) {
    return <>{children}</>;
  }
  return <>{fallback}</>;
}
