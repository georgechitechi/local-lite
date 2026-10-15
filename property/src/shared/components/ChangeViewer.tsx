import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

interface ChangeViewerProps {
  data: any;
}

export default function ChangeViewer({ data }: ChangeViewerProps) {
  const colors = useThemeColors();

  if (!data) return null;

  const simplifiedData = data;

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceVariant }]}>
      <ScrollView nestedScrollEnabled>
        <ScrollView
          horizontal
          contentContainerStyle={styles.scrollContent}
          nestedScrollEnabled
        >
          <Text
            style={[styles.code, { color: colors.onSurface }]}
            variant="bodySmall"
            selectable={true}
          >
            {JSON.stringify(simplifiedData, null, 2)}
          </Text>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    marginVertical: 4,
    maxHeight: 250,
    overflow: 'hidden',
    width: '100%',
  },
  scrollContent: {
    padding: 12,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
});
