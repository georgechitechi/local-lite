import type React from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { IconButton, Surface, Text } from 'react-native-paper';
import SPressable from '@/shared/components/SlightPressable';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface SectionGroupProps {
  title: string;
  subtitle?: string | React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  rightContent?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  headerStyle?: StyleProp<ViewStyle>;
  backgroundColor?: string;
  titleColor?: string;
}

const SectionGroup: React.FC<SectionGroupProps> = ({
  title,
  subtitle,
  isExpanded,
  onToggle,
  rightContent,
  containerStyle,
  headerStyle,
  backgroundColor,
  titleColor,
}) => {
  const colors = useThemeColors() as any;

  return (
    <Surface
      style={[
        styles.sectionHeader,
        backgroundColor ? { backgroundColor } : null,
        containerStyle,
      ]}
    >
      <SPressable onPress={onToggle} style={[styles.pressable, headerStyle]}>
        <View style={styles.headerContent}>
          <View style={styles.titleContainer}>
            <Text variant="titleMedium" style={{ color: titleColor || colors.onSurface }}>
              {title}
            </Text>
            {subtitle &&
              (typeof subtitle === 'string' ? (
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  {subtitle}
                </Text>
              ) : (
                subtitle
              ))}
          </View>
          <View style={styles.rightContainer}>
            {rightContent}
            <IconButton
              icon={isExpanded ? 'chevron-up' : 'chevron-down'}
              onPress={undefined} // Handled by SPressable
              style={styles.chevron}
            />
          </View>
        </View>
      </SPressable>
    </Surface>
  );
};

const styles = StyleSheet.create({
  sectionHeader: {
    marginBottom: 1,
  },
  pressable: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleContainer: {
    flex: 1,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chevron: {
    margin: 0,
    marginLeft: 4,
  },
});

export default SectionGroup;
