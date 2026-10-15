import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Card, Divider, List, Text } from 'react-native-paper';
import BaseSearch from '@/shared/components/BaseSearch';
import EmptyState from '@/shared/components/EmptyState';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

export default function DocumentationPage() {
  const colors = useThemeColors();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSection, setExpandedSection] = useState<string | null>('byod-setup');

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const sections = [
    {
      id: 'byod-setup',
      title: 'Bring Your Own Database',
      icon: 'database-sync',
      content: [
        {
          subtitle: 'Setup Instructions',
          text: 'Property Admin allows you to connect your own Supabase instance to retain complete ownership of your data.\n\n1. Navigate to Settings > Cloud Sync.\n2. Enable Cloud Sync and enter your Supabase Project URL and Anon Key.\n3. Alternatively, you can paste a "Connection Key" if provided by an administrator.\n4. Tap connect, and the application will synchronize all your local offline data with your cloud database.',
        },
      ],
    },
    {
      id: 'getting-started',
      title: 'Getting Started',
      icon: 'rocket-launch',
      content: [
        {
          subtitle: 'Welcome to Property Admin',
          text: 'This app is designed to help property managers and landlords manage their portfolio efficiently. Start by setting up your Business Profile in Settings.',
        },
        {
          subtitle: 'Initial Setup Steps',
          text: '1. Configure your Business Profile in Settings.\n2. Add your first Property with its address.\n3. Create Units (Apartments, Rooms, etc.) for that property.\n4. Onboard your first Tenant and set up their lease.',
        },
      ],
    },
    {
      id: 'properties',
      title: 'Properties & Units',
      icon: 'home-city',
      content: [
        {
          subtitle: 'Adding Properties',
          text: 'Navigate to the Properties tab and tap the "+" button. Fill in the property details including name, address, and upload images. You can manage multiple properties from this view.',
        },
        {
          subtitle: 'Managing Units',
          text: 'Select a property to view its units. You can add units individually, specifying unit numbers, types (e.g., 1BHK, Studio), and rental prices. Units track their own occupancy status automatically.',
        },
        {
          subtitle: 'Pro Tip',
          text: 'Use high-quality photos for your properties and units. Clear visuals help you identify properties quickly and look professional when sharing details with potential tenants.',
        },
      ],
    },
    {
      id: 'tenants',
      title: 'Tenant & Lease Management',
      icon: 'account-group',
      content: [
        {
          subtitle: 'Onboarding Tenants',
          text: 'Add new tenants directly or convert booking requests. Capture essential details like phone number and email for automated communications and digital receipts.',
        },
        {
          subtitle: 'Lease Agreements',
          text: 'Create and manage lease agreements. The app tracks lease start/end dates, security deposits, and automatically flags expiring contracts in the dashboard.',
        },
        {
          subtitle: 'Pro Tip',
          text: 'Always record the security deposit at the start of the lease. This ensures your tenant ledger is accurate and helps avoid disputes during move-out.',
        },
      ],
    },
    {
      id: 'financials',
      title: 'Financials & Payments',
      icon: 'cash-multiple',
      content: [
        {
          subtitle: 'Recording Payments',
          text: 'Log rent payments, security deposits, and other fees. You can attach proof of payment images (receipts) to each transaction for record-keeping.',
        },
        {
          subtitle: 'Digital Receipts',
          text: 'Generate professional receipts automatically. These can be shared instantly with tenants via WhatsApp, Email, or SMS directly from the app.',
        },
        {
          subtitle: 'Pro Tip',
          text: 'Encourage tenants to provide a reference number with their payments. You can record this in the payment notes to make reconciliation easier during audits.',
        },
      ],
    },
    {
      id: 'maintenance',
      title: 'Maintenance & Repairs',
      icon: 'wrench',
      content: [
        {
          subtitle: 'Tracking Issues',
          text: 'Log maintenance requests and track their progress from "Reported" to "Resolved". Attach photos of the issue for better documentation.',
        },
        {
          subtitle: 'Cost Association',
          text: 'Link maintenance tasks to expenses to keep your financial reports accurate and understand the total cost of ownership for each property.',
        },
      ],
    },
    {
      id: 'reports',
      title: 'Reports & Insights',
      icon: 'chart-bar',
      content: [
        {
          subtitle: 'Performance Dashboard',
          text: 'The dashboard provides a high-level overview of occupancy rates, pending rent, and monthly financial performance at a glance.',
        },
        {
          subtitle: 'Generating Reports',
          text: 'Export detailed PDF reports for properties, financial summaries, or tax purposes. Filter by date range, property, or tenant.',
        },
      ],
    },
    {
      id: 'bookings',
      title: 'Bookings & Requests',
      icon: 'calendar-check',
      content: [
        {
          subtitle: 'Booking Process',
          text: 'Prospective tenants can submit booking requests for vacant units. You will receive notifications for new requests which can be approved or rejected.',
        },
        {
          subtitle: 'Converting to Tenant',
          text: 'Approved bookings can be converted to active tenants with a single click. This automatically creates their profile and links them to the selected unit.',
        },
      ],
    },
    {
      id: 'communications',
      title: 'Communications & Reminders',
      icon: 'bell-ring',
      content: [
        {
          subtitle: 'Rent Reminders',
          text: 'Automated rent reminders are sent to tenants via Email or SMS days before their rent is due to ensure timely payments.',
        },
        {
          subtitle: 'System Notifications',
          text: 'The app notifies you about important events like expiring contracts, low occupancy, or completed data backups.',
        },
      ],
    },
    {
      id: 'offline',
      title: 'Offline Mode & Sync',
      icon: 'sync',
      content: [
        {
          subtitle: 'Working Offline',
          text: 'Property Admin works seamlessly without an internet connection. Most actions like adding payments or updating tenant info are stored locally on your device.',
        },
        {
          subtitle: 'Automatic Syncing',
          text: 'Once you are back online, the app automatically synchronizes your changes with the cloud database to ensure your data is always safe and accessible across devices.',
        },
      ],
    },
    {
      id: 'security',
      title: 'Security & Privacy',
      icon: 'shield-check',
      content: [
        {
          subtitle: 'Data Backups',
          text: 'Your data is backed up regularly to the cloud. You can also manually trigger a backup from the Settings menu to ensure you never lose important information.',
        },
        {
          subtitle: 'App Lock & Biometrics',
          text: 'Enable Biometric Authentication (Fingerprint or Face ID) in Settings to protect your sensitive property data from unauthorized access.',
        },
      ],
    },
    {
      id: 'support',
      title: 'Support & Feedback',
      icon: 'help-circle',
      content: [
        {
          subtitle: 'Need Help?',
          text: 'If you encounter any issues or have suggestions for new features, please reach out via the "Report a Bug" option in Settings or contact our support team.',
        },
      ],
    },
  ];

  const filteredSections = sections.filter(section => {
    const searchLower = searchQuery.toLowerCase();
    return (
      section.title.toLowerCase().includes(searchLower) ||
      section.content.some(
        item =>
          item.subtitle.toLowerCase().includes(searchLower) ||
          item.text.toLowerCase().includes(searchLower),
      )
    );
  });

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Documentation',
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.onSurface,
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[{ backgroundColor: colors.surface }]}>
          <BaseSearch
            placeholder="Search documentation..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            onClear={() => setSearchQuery('')}
            leftIcon="magnify"
            rightIcon="close-circle"
            containerStyle={{ marginVertical: 0 }}
          />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Text
            variant="bodyMedium"
            style={{
              marginBottom: 16,
              color: colors.onSurfaceVariant,
              paddingHorizontal: 4,
            }}
          >
            Comprehensive guide to using Property Admin features effectively.
          </Text>

          {filteredSections.map(section => (
            <Card
              key={section.id}
              style={[styles.card, { backgroundColor: colors.surface }]}
              mode="elevated"
            >
              <List.Accordion
                title={section.title}
                left={props => (
                  <List.Icon {...props} icon={section.icon} color={colors.primary} />
                )}
                expanded={expandedSection === section.id || searchQuery.length > 0}
                onPress={() => toggleSection(section.id)}
                titleStyle={{ fontWeight: '600', color: colors.onSurface }}
                style={{ backgroundColor: colors.surface }}
              >
                <View
                  style={[
                    styles.sectionContent,
                    { backgroundColor: colors.surfaceVariant },
                  ]}
                >
                  {section.content.map((item, index) => (
                    <View key={index} style={styles.itemContainer}>
                      <Text
                        variant="titleSmall"
                        style={{ color: colors.primary, marginBottom: 4 }}
                      >
                        {item.subtitle}
                      </Text>
                      <Text
                        variant="bodyMedium"
                        style={{
                          color: colors.onSurfaceVariant,
                          lineHeight: 20,
                        }}
                      >
                        {item.text}
                      </Text>
                      {index < section.content.length - 1 && (
                        <Divider style={{ marginVertical: 12 }} />
                      )}
                    </View>
                  ))}
                </View>
              </List.Accordion>
            </Card>
          ))}

          {filteredSections.length === 0 && (
            <EmptyState
              icon="text-box-search-outline"
              title={`No topics found matching "${searchQuery}"`}
            />
          )}

          <View style={{ height: 20 }} />
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  card: {
    marginBottom: 12,
    borderRadius: 8,
    overflow: 'hidden',
  },
  sectionContent: {
    padding: 16,
  },
  itemContainer: {
    marginBottom: 4,
  },
});
