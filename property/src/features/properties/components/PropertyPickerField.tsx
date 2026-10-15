import { StyleSheet } from 'react-native';
import { Button, HelperText, Text } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface PropertyPickerFieldProps {
  selectedName: string | null;
  onPress: () => void;
  error?: string;
}

export default function PropertyPickerField({
  selectedName,
  onPress,
  error,
}: PropertyPickerFieldProps) {
  const colors = useThemeColors();

  return (
    <>
      <Text variant="labelLarge" style={styles.label}>
        Property
      </Text>
      <Button
        mode="outlined"
        onPress={onPress}
        style={[styles.input, error ? { borderColor: colors.error } : undefined]}
        contentStyle={styles.buttonContent}
        icon="office-building-outline"
      >
        {selectedName ?? 'Select Property'}
      </Button>
      {error ? <HelperText type="error">{error}</HelperText> : null}
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    marginBottom: 14,
  },
  buttonContent: {
    justifyContent: 'flex-start',
  },
});
