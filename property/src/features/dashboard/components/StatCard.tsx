import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { StyleSheet } from 'react-native';
import { Surface, Text } from 'react-native-paper';
import { useTheme, useThemeColors } from '@/shared/hooks/useThemeProvider';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: string;
  color: string;
  subtitle?: string;
  isDark?: boolean;
}

export const StatCard = ({ title, value, icon, color, subtitle }: StatCardProps) => {
  const colors = useThemeColors();
  const { isDarkMode } = useTheme();
  const isDark = isDarkMode || false;

  return (
    <Surface
      style={[
        styles.statCard,
        {
          backgroundColor: colors.surface,
          ...(isDark && {
            borderColor: colors.outline,
            borderWidth: 1,
          }),
        },
      ]}
    >
      <MaterialCommunityIcons name={icon as any} size={24} color={color} />
      <Text style={[styles.statValue, { color: colors.onSurface }]}>{value}</Text>
      <Text style={[styles.statTitle, { color: colors.onSurfaceVariant }]}>{title}</Text>
      {subtitle && (
        <Text style={[styles.statSubtitle, { color: colors.onSurfaceVariant }]}>
          {subtitle}
        </Text>
      )}
    </Surface>
  );
};

const styles = StyleSheet.create({
  statCard: {
    width: '48%',
    padding: 10,
    marginBottom: 10,
    borderRadius: 8,
    elevation: 2,
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: 'bold', marginVertical: 4 },
  statTitle: { fontSize: 12 },
  statSubtitle: { fontSize: 10, textAlign: 'center', marginTop: 2 },
});
