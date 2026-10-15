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

interface AccessGuardProps {
  children: React.ReactNode;
  action?: Action;
  resource?: Resource;
  roles?: string[];
  fallback?: React.ReactNode;
}

export default function AccessGuard({
  children,
  action,
  resource,
  roles,
  fallback,
}: AccessGuardProps) {
  const { can, hasAccess, loading } = useAccessControl();
  const router = useRouter();
  const theme = useTheme();

  if (loading) {
    return null; // Or a loading spinner if preferred, but null avoids flash of unstyled content
  }

  let isAllowed = false;
  if (action && resource) {
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
          Access Denied
        </Text>
        <Text variant="titleMedium" style={styles.message}>
          You do not have permission to view this page.
        </Text>
        <Button
          mode="contained"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/');
            }
          }}
          style={styles.button}
          labelStyle={{ fontSize: 16 }}
        >
          Go Back
        </Button>
      </View>
    );
  }

  return <>{children}</>;
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
