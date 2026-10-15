import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

export default function PrivacyPolicy() {
  const colors = useThemeColors();

  return (
    <KeyboardScroll
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <View>
        <Text
          variant="bodyMedium"
          style={[styles.lastUpdated, { color: colors.onSurfaceVariant }]}
        >
          Last Updated: {new Date().toLocaleDateString()}
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          1. Information We Collect
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          We collect information that you provide directly to us, including:
          {'\n\n'}• Account information (name, email, phone number){'\n'}• Property
          management data{'\n'}• Payment information{'\n'}• Communication records
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          2. How We Use Your Information
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          We use the information we collect to:{'\n\n'}• Provide and maintain our services
          {'\n'}• Process transactions{'\n'}• Send notifications and updates{'\n'}•
          Improve our services{'\n'}• Comply with legal obligations
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          3. Data Security
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          We implement appropriate security measures to protect your personal information.
          However, no method of transmission over the internet is 100% secure.
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          4. Data Sharing
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          We do not sell your personal information. We may share your information with:
          {'\n\n'}• Service providers (e.g., payment processors, email providers){'\n'}•
          Legal authorities when required
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          5. Your Rights
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          You have the right to:{'\n\n'}• Access your personal information{'\n'}• Correct
          inaccurate data{'\n'}• Request deletion of your data{'\n'}• Opt-out of
          communications
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          6. Contact Us
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          If you have any questions about this Privacy Policy, please contact us at:
          {'\n\n'}
          info@ogsadmin.com
        </Text>
      </View>
    </KeyboardScroll>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  lastUpdated: {
    marginBottom: 6,
  },
  sectionTitle: {
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  paragraph: {
    lineHeight: 20,
    marginBottom: 10,
  },
});
