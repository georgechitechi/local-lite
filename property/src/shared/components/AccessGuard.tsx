import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import {
  type Action,
  type Resource,
  useAccessControl,
} from '@/shared/hooks/useAccessControl';

export interface AccessGuardProps {
  children: React.ReactNode;
  action?: Action;
  resource?: Resource;
  roles?: string | string[];
  condition?: boolean;
  fallback?: React.ReactNode;
  title?: string;
  message?: string;
  showBackButton?: boolean;
}

export default function AccessGuard({
  children,
  action,
  resource,
  roles,
  condition,
  fallback,
  title = 'Access Denied',
  message = 'You do not have permission to view this page.',
  showBackButton = true,
}: AccessGuardProps) {
  const { can, hasAccess, loading } = useAccessControl();
  const router = useRouter();
  const theme = useTheme();

  if (loading) {
    return null;
  }

  let isAllowed = false;
  if (condition !== undefined) {
    isAllowed = condition;
  } else if (action && resource) {
    isAllowed = can(action, resource);
  } else if (roles) {
    isAllowed = hasAccess(roles);
  } else {
    isAllowed = true;
  }

  if (!isAllowed) {
    if (fallback !== undefined) return <>{fallback}</>;

    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <MaterialCommunityIcons
          name="shield-lock-outline"
          size={80}
          color={theme.colors.error}
          style={{ marginBottom: 16, opacity: 0.9 }}
        />
        <Text
          variant="titleLarge"
          style={{ color: theme.colors.error, fontWeight: 'bold' }}
        >
          {title}
        </Text>
        <Text variant="titleMedium" style={styles.message}>
          {message}
        </Text>
        {showBackButton && (
          <Button
            mode="contained"
            onPress={() => router.replace('/')}
            style={styles.button}
            labelStyle={{ fontSize: 16 }}
          >
            Go Back
          </Button>
        )}
      </View>
    );
  }

  return <>{children}</>;
}

export interface CanProps {
  children: React.ReactNode;
  action?: Action;
  resource?: Resource;
  do?: Action;
  on?: Resource;
  roles?: string | string[];
  condition?: boolean;
  fallback?: React.ReactNode;
}

/**
 * Shorthand access check component for inline UI elements (buttons, menus, cards).
 * Defaults fallback to null.
 *
 * Usage:
 * <Can action="edit" resource="house">
 *   <EditButton />
 * </Can>
 *
 * <Can roles={['admin', 'staff']}>
 *   <AdminTools />
 * </Can>
 */
export function Can({
  children,
  action,
  resource,
  do: doAction,
  on: onResource,
  roles,
  condition,
  fallback = null,
}: CanProps) {
  const { can, hasAccess, loading } = useAccessControl();

  if (loading) return null;

  const resolvedAction = action ?? doAction;
  const resolvedResource = resource ?? onResource;

  let isAllowed = false;
  if (condition !== undefined) {
    isAllowed = condition;
  } else if (resolvedAction && resolvedResource) {
    isAllowed = can(resolvedAction, resolvedResource);
  } else if (roles) {
    isAllowed = hasAccess(roles);
  } else {
    isAllowed = true;
  }

  return isAllowed ? <>{children}</> : <>{fallback}</>;
}

export interface RoleGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/** Renders children only if user is owner or has admin role. Defaults fallback to null. */
export function AdminOnly({ children, fallback = null }: RoleGuardProps) {
  const { isAdmin, loading } = useAccessControl();
  if (loading) return null;
  return isAdmin ? <>{children}</> : <>{fallback}</>;
}

/** Renders children only if user is owner, admin, or staff. Defaults fallback to null. */
export function StaffOrAdmin({ children, fallback = null }: RoleGuardProps) {
  const { isAdminOrStaff, loading } = useAccessControl();
  if (loading) return null;
  return isAdminOrStaff ? <>{children}</> : <>{fallback}</>;
}

/** Renders children only if user is exclusively a tenant (not admin/staff). Defaults fallback to null. */
export function TenantOnly({ children, fallback = null }: RoleGuardProps) {
  const { isTenantOnly, loading } = useAccessControl();
  if (loading) return null;
  return isTenantOnly ? <>{children}</> : <>{fallback}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  message: {
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  button: {
    marginTop: 10,
  },
});
