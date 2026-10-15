import type { TextStyle } from 'react-native';
import { Text } from 'react-native-paper';

interface FormattedTextProps {
  text: string;
  style?: TextStyle;
  variant?:
    | 'displayLarge'
    | 'displayMedium'
    | 'displaySmall'
    | 'headlineLarge'
    | 'headlineMedium'
    | 'headlineSmall'
    | 'titleLarge'
    | 'titleMedium'
    | 'titleSmall'
    | 'labelLarge'
    | 'labelMedium'
    | 'labelSmall'
    | 'bodyLarge'
    | 'bodyMedium'
    | 'bodySmall';
  numberOfLines?: number;
}

/**
 * A component that renders text with WhatsApp-style formatting (*bold*, _italic_)
 */
export default function FormattedText({
  text,
  style,
  variant = 'bodyMedium',
  numberOfLines,
}: FormattedTextProps) {
  if (!text) return null;

  // Regex to split by *bold* and _italic_
  // We keep the delimiters to identify which parts need formatting
  const parts = text.split(/(\*[^*]+\*|_[^_]+_)/g);

  return (
    <Text variant={variant} style={style} numberOfLines={numberOfLines}>
      {parts.map((part, index) => {
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return (
            <Text key={index} style={[style, { fontWeight: 'bold' }]}>
              {part.slice(1, -1)}
            </Text>
          );
        }
        if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
          return (
            <Text key={index} style={[style, { fontStyle: 'italic' }]}>
              {part.slice(1, -1)}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
}
