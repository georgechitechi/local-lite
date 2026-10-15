import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function DemoModeBanner() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.container, { backgroundColor: theme.colors.errorContainer }]}
    >
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => router.push('/(tabs)/settings/cloud-sync')}
      >
        <View style={styles.content}>
          <MaterialCommunityIcons
            name="alert"
            size={18}
            color={theme.colors.onErrorContainer}
            style={styles.icon}
          />
          <Text
            variant="labelSmall"
            style={[styles.text, { color: theme.colors.onErrorContainer }]}
          >
            Demo Mode — Connect Cloud Sync to save real data.{'\n'}All data here will be
            wiped on connect.
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={theme.colors.onErrorContainer}
          />
        </View>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    zIndex: 999,
    elevation: 4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 40,
  },
  icon: {
    marginRight: 6,
  },
  text: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '600',
    marginRight: 6,
  },
});
