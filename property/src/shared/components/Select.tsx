import { useState } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { Button, HelperText, Menu, Text } from 'react-native-paper';

interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  label?: string;
  value?: string | number | null;
  onValueChange: (value: string | number) => void;
  options?: SelectOption[];
  placeholder?: string;
  error?: boolean;
  errorText?: string;
  style?: ViewStyle;
  disabled?: boolean;
  required?: boolean;
  [key: string]: any;
}

const Select = ({
  label,
  value,
  onValueChange,
  options = [],
  placeholder = 'Select an option',
  error = false,
  errorText,
  style,
  disabled = false,
  required = false,
  ...props
}: SelectProps) => {
  const [menuVisible, setMenuVisible] = useState(false);

  const handleSelect = (optionValue: string | number) => {
    onValueChange(optionValue);
    setMenuVisible(false);
  };

  const getDisplayValue = (): string => {
    if (!value) return placeholder;
    const selectedOption = options.find(option => option.value === value);
    return selectedOption ? selectedOption.label : String(value);
  };

  return (
    <>
      {label && (
        <Text variant="bodyMedium" style={styles.label}>
          {label}
          {required && <Text style={styles.required}> *</Text>}
        </Text>
      )}

      <Menu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        anchor={
          <Button
            mode="outlined"
            onPress={() => !disabled && setMenuVisible(true)}
            style={[styles.button, style]}
            contentStyle={styles.buttonContent}
            disabled={disabled}
            {...props}
          >
            {getDisplayValue()}
          </Button>
        }
      >
        {options.map((option, index) => (
          <Menu.Item
            key={option.value || index}
            onPress={() => handleSelect(option.value)}
            title={option.label}
            disabled={option.disabled}
          />
        ))}
      </Menu>

      {error && errorText && <HelperText type="error">{errorText}</HelperText>}
    </>
  );
};

const styles = StyleSheet.create({
  label: {
    marginBottom: 8,
  },
  required: {},
  button: {
    marginBottom: 8,
  },
  buttonContent: {
    justifyContent: 'flex-start',
  },
});

export default Select;
