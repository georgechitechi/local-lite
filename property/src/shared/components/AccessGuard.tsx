import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import {
  AdminOnly,
  Can,
  Cannot,
  StaffOrAdmin,
  TenantOnly,
} from '@/shared/access/policies';
import type { Action, Resource } from '@/shared/access/types';
import { useAccessControl } from '@/shared/hooks/useAccessControl';

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
    if (fallback !== undefined) return fallback as React.ReactElement | null;

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

  return children as React.ReactElement | null;
}

export const Protect = AccessGuard;
export { AdminOnly, Can, Cannot, StaffOrAdmin, TenantOnly };

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
