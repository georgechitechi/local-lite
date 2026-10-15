import { Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme, useThemeColors } from '@/shared/hooks/useThemeProvider';
import { properCase } from '@/shared/utils/helper';

interface Difference {
  field: string;
  label: string;
  tenant: any;
  booking: any;
  displayTenant?: string;
  displayBooking?: string;
}

interface DiffViewerProps {
  differences: Difference[];
}

export default function DiffViewer({ differences }: DiffViewerProps) {
  const colors = useThemeColors();
  const { isDarkMode } = useTheme();

  const formatValue = (value: any, field: string): string => {
    if (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim() === '')
    )
      return '';

    if (field === 'next_of_kin') {
      let kinArray = value;
      if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
        try {
          kinArray = JSON.parse(value);
        } catch {
          kinArray = [];
        }
      }

      if (Array.isArray(kinArray)) {
        if (kinArray.length === 0) return '';
        return kinArray
          .map(
            (kin: any) =>
              `${kin.name || 'N/A'} (${kin.relationship || 'N/A'}): ${kin.phone || 'N/A'}`,
          )
          .join('\n');
      }
    }

    if (field === 'gender' || field === 'marital_status') {
      return properCase(String(value));
    }

    return String(value);
  };

  const renderDiffLine = (content: string, type: 'removed' | 'added') => {
    const isRemoved = type === 'removed';
    const bgColor = isRemoved ? '#ffeef0' : '#e6ffed';
    const textColor = isRemoved ? '#b31d28' : '#22863a';
    const marker = isRemoved ? '-' : '+';
    const label = isRemoved ? 'Tenant' : 'Booking';

    // In dark mode, we adjust the colors
    const themedBg = isDarkMode ? (isRemoved ? '#3e1b1d' : '#1b3e21') : bgColor;
    const themedText = isDarkMode
      ? isRemoved
        ? colors.error
        : colors.success
      : textColor;

    const lines = content.split('\n');

    return (
      <View style={{ backgroundColor: themedBg }}>
        {lines.length > 0 && content !== '' ? (
          lines.map((line, i) => (
            <View key={i} style={styles.diffLine}>
              <Text style={[styles.marker, { color: themedText }]}>{marker}</Text>
              <Text style={[styles.codeText, { color: themedText }]}>{line}</Text>
              <Text style={[styles.rightLabel, { color: themedText }]}>{label}</Text>
            </View>
          ))
        ) : (
          <View style={styles.diffLine}>
            <Text style={[styles.marker, { color: themedText }]}>{marker}</Text>
            <Text
              style={[
                styles.codeText,
                { color: themedText, fontStyle: 'italic', opacity: 0.5 },
              ]}
            >
              (empty)
            </Text>
            <Text style={[styles.rightLabel, { color: themedText }]}>{label}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {differences.map((diff, index) => (
        <View
          key={index}
          style={[styles.diffBlock, { borderColor: colors.outlineVariant }]}
        >
          <View
            style={[
              styles.fieldHeader,
              {
                backgroundColor: colors.surfaceVariant,
                borderBottomColor: colors.outlineVariant,
              },
            ]}
          >
            <Text style={[styles.fieldName, { color: colors.onSurfaceVariant }]}>
              {diff.label}
            </Text>
          </View>
          <View style={styles.diffContent}>
            {renderDiffLine(
              diff.displayTenant !== undefined
                ? diff.displayTenant
                : formatValue(diff.tenant, diff.field),
              'removed',
            )}
            {renderDiffLine(
              diff.displayBooking !== undefined
                ? diff.displayBooking
                : formatValue(diff.booking, diff.field),
              'added',
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  diffBlock: {
    marginBottom: 16,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  fieldHeader: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  fieldName: {
    fontWeight: 'bold',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  diffContent: {
    backgroundColor: 'transparent',
  },
  diffLine: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  marker: {
    width: 20,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center',
  },
  codeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  rightLabel: {
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    opacity: 0.6,
    marginLeft: 8,
    alignSelf: 'center',
  },
});
