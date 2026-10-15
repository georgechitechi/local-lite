import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

export default function TermsOfUse() {
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
          1. Acceptance of Terms
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          By accessing and using this application, you accept and agree to be bound by the
          terms and provision of this agreement.
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          2. Use License
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          Permission is granted to temporarily use this application for personal,
          non-commercial transitory viewing only. This is the grant of a license, not a
          transfer of title.
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          3. User Responsibilities
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          You agree to:{'\n\n'}• Provide accurate information{'\n'}• Maintain the security
          of your account{'\n'}• Use the service in compliance with laws{'\n'}• Not misuse
          or abuse the service
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          4. Service Limitations
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          We reserve the right to:{'\n\n'}• Modify or discontinue the service
          {'\n'}• Restrict access to certain features{'\n'}• Terminate accounts for
          violations
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          5. Payment Terms
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          • All payments are processed securely{'\n'}• Subscription fees are
          non-refundable{'\n'}• We may change pricing with notice
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          6. Intellectual Property
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          The application and its original content, features, and functionality are owned
          by us and are protected by international copyright, trademark, and other
          intellectual property laws.
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          7. Limitation of Liability
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          We shall not be liable for any indirect, incidental, special, consequential, or
          punitive damages resulting from your use of or inability to use the service.
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          8. Changes to Terms
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          We reserve the right to modify these terms at any time. We will notify users of
          any material changes via email or through the application.
        </Text>

        <Text
          variant="titleMedium"
          style={[styles.sectionTitle, { color: colors.onBackground }]}
        >
          9. Contact Information
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.paragraph, { color: colors.onSurface }]}
        >
          Questions about the Terms of Use should be sent to us at:{'\n\n'}
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
    marginBottom: 10,
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
