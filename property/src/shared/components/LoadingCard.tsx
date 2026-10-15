import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface LoadingCardProps {
  iconName?: string;
  text?: string;
  backgroundColor?: string;
  iconSize?: number;
  iconColor?: string;
  textColor?: string;
  textVariant?:
    | 'displayLarge'
    | 'displayMedium'
    | 'displaySmall'
    | 'headlineLarge'
    | 'headlineMedium'
    | 'headlineSmall'
    | 'titleLarge'
    | 'titleMedium'
    | 'titleSmall'
    | 'bodyLarge'
    | 'bodyMedium'
    | 'bodySmall'
    | 'labelLarge'
    | 'labelMedium'
    | 'labelSmall';
}

const LoadingCard: React.FC<LoadingCardProps> = ({
  iconName = 'view-dashboard-outline',
  text = 'Loading...',
  backgroundColor,
  iconSize = 64,
  iconColor,
  textColor,
  textVariant = 'titleMedium',
}) => {
  const colors = useThemeColors();
  return (
    <View
      style={[
        styles.container,
        { backgroundColor: backgroundColor || colors.background },
      ]}
    >
      {iconName === 'loading' || !iconName ? (
        <ActivityIndicator size="large" />
      ) : (
        <MaterialCommunityIcons
          name={iconName as any}
          size={iconSize}
          color={iconColor || colors.onSurfaceVariant}
          style={styles.text}
        />
      )}
      <Text
        variant={textVariant}
        style={[styles.text, { color: textColor || colors.onSurfaceVariant }]}
      >
        {text}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    marginTop: 16,
  },
});

export default LoadingCard;
