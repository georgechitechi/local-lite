import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { IconButton, List, Switch } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';

interface DashboardCustomizationModalProps {
  visible: boolean;
  onDismiss: () => void;
  settings: any;
  saveSettings: (key: string, value: any) => void;
}

export default function DashboardCustomizationModal({
  visible,
  onDismiss,
  settings,
  saveSettings,
}: DashboardCustomizationModalProps) {
  const router = useRouter();

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Business Customization"
      edgeToEdge
      scrollable={true}
      subtitle="Manage visibility of dashboard cards and email receipts"
      maxHeight="80%"
    >
      <View style={styles.compactModalContent}>
        <List.Section>
          <List.Item
            title="Business Gallery"
            description="Upload and manage business images"
            left={props => <List.Icon {...props} icon="image-multiple" />}
            onPress={() => {
              onDismiss();
              router.push('/settings/business-gallery');
            }}
            right={props => <IconButton {...props} icon="chevron-right" />}
          />
          <List.Item
            title="Property Layout Builder"
            description="Visually map and manage property units"
            left={props => <List.Icon {...props} icon="floor-plan" />}
            onPress={() => {
              onDismiss();
              router.push('/settings/layout-builder' as any);
            }}
            right={props => <IconButton {...props} icon="chevron-right" />}
          />
          <List.Item
            title="Message Templates"
            description="Customize Message templates"
            left={props => <List.Icon {...props} icon="message-draw" />}
            onPress={() => {
              onDismiss();
              router.push('/settings/templates');
            }}
            right={props => <IconButton {...props} icon="chevron-right" />}
          />
          <List.Item
            title="Insights"
            description="Show insights card on dashboard"
            left={props => <List.Icon {...props} icon="lightbulb-outline" />}
            right={() => (
              <Switch
                value={settings.dashboard_preferences?.show_insights ?? true}
                onValueChange={value => {
                  const newSettings = {
                    ...(settings.dashboard_preferences || {}),
                    show_insights: value,
                  };
                  saveSettings('dashboard_preferences', newSettings);
                }}
              />
            )}
          />
          <List.Item
            title="Pending Rent"
            description="Show pending rent card on dashboard"
            left={props => <List.Icon {...props} icon="cash-clock" />}
            right={() => (
              <Switch
                value={settings.dashboard_preferences?.show_pending_rent ?? true}
                onValueChange={value => {
                  const newSettings = {
                    ...(settings.dashboard_preferences || {}),
                    show_pending_rent: value,
                  };
                  saveSettings('dashboard_preferences', newSettings);
                }}
              />
            )}
          />
          <List.Item
            title="Recent Activity"
            description="Show recent activity card on dashboard"
            left={props => <List.Icon {...props} icon="history" />}
            right={() => (
              <Switch
                value={settings.dashboard_preferences?.show_recent_activity ?? true}
                onValueChange={value => {
                  const newSettings = {
                    ...(settings.dashboard_preferences || {}),
                    show_recent_activity: value,
                  };
                  saveSettings('dashboard_preferences', newSettings);
                }}
              />
            )}
          />
          <List.Item
            title="Holiday Waivers"
            description="Show holiday waivers card on dashboard"
            left={props => <List.Icon {...props} icon="calendar-clock" />}
            right={() => (
              <Switch
                value={settings.dashboard_preferences?.show_waivers ?? true}
                onValueChange={value => {
                  const newSettings = {
                    ...(settings.dashboard_preferences || {}),
                    show_waivers: value,
                  };
                  saveSettings('dashboard_preferences', newSettings);
                }}
              />
            )}
          />
          <List.Item
            title="Expiring Contracts"
            description="Show expiring contracts card on dashboard"
            left={props => <List.Icon {...props} icon="timer-sand" />}
            right={() => (
              <Switch
                value={settings.dashboard_preferences?.show_expiring_contracts ?? true}
                onValueChange={value => {
                  const newSettings = {
                    ...(settings.dashboard_preferences || {}),
                    show_expiring_contracts: value,
                  };
                  saveSettings('dashboard_preferences', newSettings);
                }}
              />
            )}
          />
          <List.Item
            title="Daily Finance"
            description="Show daily finance card on dashboard"
            left={props => <List.Icon {...props} icon="finance" />}
            right={() => (
              <Switch
                value={settings.dashboard_preferences?.show_daily_finance ?? true}
                onValueChange={value => {
                  const newSettings = {
                    ...(settings.dashboard_preferences || {}),
                    show_daily_finance: value,
                  };
                  saveSettings('dashboard_preferences', newSettings);
                }}
              />
            )}
          />
          <List.Item
            title="Maintenance Overview"
            description="Show maintenance overview card on dashboard"
            left={props => <List.Icon {...props} icon="wrench-clock" />}
            right={() => (
              <Switch
                value={settings.dashboard_preferences?.show_maintenance ?? true}
                onValueChange={value => {
                  const newSettings = {
                    ...(settings.dashboard_preferences || {}),
                    show_maintenance: value,
                  };
                  saveSettings('dashboard_preferences', newSettings);
                }}
              />
            )}
          />
          <List.Item
            title="Expenses Analysis"
            description="Show expenses & utilities card on dashboard"
            left={props => <List.Icon {...props} icon="calculator-variant" />}
            right={() => (
              <Switch
                value={settings.dashboard_preferences?.show_expenses_analysis ?? true}
                onValueChange={value => {
                  const newSettings = {
                    ...(settings.dashboard_preferences || {}),
                    show_expenses_analysis: value,
                  };
                  saveSettings('dashboard_preferences', newSettings);
                }}
              />
            )}
          />
        </List.Section>
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  compactModalContent: {
    paddingVertical: 8,
  },
});
