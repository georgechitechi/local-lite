import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';

export default function NotFound() {
  const theme = useTheme();
  const fadeAnim = useMemo(() => new Animated.Value(0), []);
  const scaleAnim = useMemo(() => new Animated.Value(0.85), []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 7,
        tension: 45,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
  }, [fadeAnim, scaleAnim]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <MaterialCommunityIcons
          name="compass-off-outline"
          size={96}
          color={theme.colors.onSurfaceVariant}
        />
        <Text variant="headlineMedium" style={styles.title}>
          Page Not Found
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.message, { color: theme.colors.onSurfaceVariant }]}
        >
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </Text>
        <Button
          mode="contained"
          onPress={() => router.replace('/')}
          style={styles.button}
          icon="home-outline"
        >
          Go to Home
        </Button>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    gap: 12,
    maxWidth: 320,
  },
  title: {
    textAlign: 'center',
    marginTop: 8,
  },
  message: {
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    marginTop: 8,
    minWidth: 160,
    borderRadius: 8,
  },
});
