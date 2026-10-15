import {
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { ActivityIndicator, TextInput } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface BaseSearchProps
  extends Omit<
    TextInputProps,
    | 'value'
    | 'onChangeText'
    | 'selectionColor'
    | 'cursorColor'
    | 'underlineColorAndroid'
    | 'placeholderTextColor'
  > {
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  onClear?: () => void;
  style?: StyleProp<TextStyle>;
  containerStyle?: ViewStyle;
  autoFocus?: boolean;
  rightIcon?: string | null;
  leftIcon?: string | null;
  onRightIconPress?: (() => void) | null;
  emptyRightIcon?: string | null;
  onEmptyRightIconPress?: (() => void) | null;
  keyboardType?:
    | 'default'
    | 'email-address'
    | 'numeric'
    | 'phone-pad'
    | 'number-pad'
    | 'decimal-pad';
  autoCorrect?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  isLoading?: boolean;
}

export default function BaseSearch({
  placeholder = 'Search...',
  value,
  onChangeText,
  onClear,
  style,
  containerStyle,
  autoFocus = false,
  rightIcon = null,
  leftIcon = null,
  onRightIconPress = null,
  emptyRightIcon = null,
  onEmptyRightIconPress = null,
  keyboardType = 'default',
  autoCorrect = true,
  autoCapitalize = 'sentences',
  isLoading = false,
  ...props
}: BaseSearchProps) {
  const colors = useThemeColors();

  const handleClear = () => {
    onChangeText('');
    if (onClear) onClear();
  };

  return (
    <View
      style={{
        borderBottomColor: colors.outline,
        borderTopWidth: 0.5,
        borderTopColor: colors.outline,
        ...containerStyle,
      }}
    >
      <TextInput
        label={placeholder}
        value={value}
        onChangeText={onChangeText}
        style={[{ backgroundColor: colors.surface }, style]}
        autoFocus={autoFocus}
        keyboardType={keyboardType}
        autoCorrect={autoCorrect}
        autoCapitalize={autoCapitalize}
        right={
          isLoading ? (
            <TextInput.Icon
              icon={() => <ActivityIndicator size={20} color={colors.primary} />}
            />
          ) : value && value.trim().length > 0 && rightIcon ? (
            <TextInput.Icon
              icon={rightIcon}
              onPress={onRightIconPress || handleClear}
              color={colors.onSurfaceVariant}
            />
          ) : emptyRightIcon ? (
            <TextInput.Icon
              icon={emptyRightIcon}
              onPress={onEmptyRightIconPress || undefined}
              color={colors.primary}
            />
          ) : null
        }
        left={
          leftIcon ? (
            <TextInput.Icon icon={leftIcon} color={colors.onSurfaceVariant} />
          ) : null
        }
        {...props}
      />
    </View>
  );
}
