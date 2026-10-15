import { View } from 'react-native';
import { Divider, List } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';

interface ThemeModalProps {
  visible: boolean;
  onDismiss: () => void;
  themeMode: 'auto' | 'light' | 'dark';
  setThemeMode: (mode: 'auto' | 'light' | 'dark') => void;
  colors: any;
}

export default function ThemeModal({
  visible,
  onDismiss,
  themeMode,
  setThemeMode,
  colors,
}: ThemeModalProps) {
  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Choose Theme"
      subtitle="Select your preferred theme mode"
      edgeToEdge
    >
      <View>
        <List.Item
          title="System Mode"
          description="Match your phone's theme"
          left={props => (
            <List.Icon
              {...props}
              icon={themeMode === 'auto' ? 'radiobox-marked' : 'radiobox-blank'}
              color={themeMode === 'auto' ? colors.primary : colors.onSurfaceVariant}
            />
          )}
          onPress={() => {
            setThemeMode('auto');
            onDismiss();
          }}
          style={{
            backgroundColor:
              themeMode === 'auto' ? colors.primaryContainer : 'transparent',
            borderRadius: 8,
            marginBottom: 8,
          }}
        />
        <Divider />

        <List.Item
          title="Light Mode"
          description="Always use light theme"
          left={props => (
            <List.Icon
              {...props}
              icon={themeMode === 'light' ? 'radiobox-marked' : 'radiobox-blank'}
              color={themeMode === 'light' ? colors.primary : colors.onSurfaceVariant}
            />
          )}
          onPress={() => {
            setThemeMode('light');
            onDismiss();
          }}
          style={{
            backgroundColor:
              themeMode === 'light' ? colors.primaryContainer : 'transparent',
            borderRadius: 8,
            marginBottom: 8,
          }}
        />
        <Divider />

        <List.Item
          title="Dark Mode"
          description="Always use dark theme"
          left={props => (
            <List.Icon
              {...props}
              icon={themeMode === 'dark' ? 'radiobox-marked' : 'radiobox-blank'}
              color={themeMode === 'dark' ? colors.primary : colors.onSurfaceVariant}
            />
          )}
          onPress={() => {
            setThemeMode('dark');
            onDismiss();
          }}
          style={{
            backgroundColor:
              themeMode === 'dark' ? colors.primaryContainer : 'transparent',
            borderRadius: 8,
          }}
        />
      </View>
    </BaseModal>
  );
}
