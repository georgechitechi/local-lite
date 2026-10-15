import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface DashboardCardHeaderProps {
  title: string;
  subtitle: string;
  onNext?: () => void;
  onPrev?: () => void;
  isNextDisabled?: boolean;
  isPrevDisabled?: boolean;
  rightIcon?: string;
  onRightIconPress?: () => void;
}

const DashboardCardHeader: React.FC<DashboardCardHeaderProps> = ({
  title,
  subtitle,
  onNext,
  onPrev,
  isNextDisabled,
  isPrevDisabled,
  rightIcon,
  onRightIconPress,
}) => {
  const colors = useThemeColors();

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: colors.secondaryContainer,
          borderBottomColor: colors.outlineVariant,
        },
      ]}
    >
      {onPrev && (
        <IconButton
          icon="chevron-left"
          size={22}
          disabled={isPrevDisabled}
          onPress={onPrev}
          style={styles.navButton}
        />
      )}

      <View style={styles.titleContainer}>
        <Text variant="titleLarge" style={[styles.title, { color: colors.onSurface }]}>
          {title}
        </Text>
        <Text
          variant="labelSmall"
          style={[styles.subtitle, { color: colors.onSurfaceVariant }]}
        >
          {subtitle}
        </Text>
      </View>

      {onNext && (
        <IconButton
          icon="chevron-right"
          size={22}
          disabled={isNextDisabled}
          onPress={onNext}
          style={styles.navButton}
        />
      )}

      {rightIcon && onRightIconPress && (
        <IconButton
          icon={rightIcon}
          size={22}
          onPress={onRightIconPress}
          style={styles.rightButton}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontWeight: 'bold',
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    marginTop: 2,
  },
  navButton: {
    margin: 0,
  },
  rightButton: {
    margin: 0,
    position: 'absolute',
    right: 8,
  },
});

export default DashboardCardHeader;
