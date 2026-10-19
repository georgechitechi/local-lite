import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, Text, TextInput } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';

export interface BusinessLinks {
  whatsapp_group: string;
  website: string;
  facebook: string;
  instagram: string;
  twitter: string;
}

export interface BusinessLinksModalProps {
  visible: boolean;
  onDismiss: () => void;
  links: BusinessLinks;
  setLinks: React.Dispatch<React.SetStateAction<BusinessLinks>>;
  onSave: () => void;
  saving: boolean;
  colors: any;
  showSnackbar: (msg: string, type?: 'info' | 'error' | 'success' | 'warning') => void;
}

export default function BusinessLinksModal({
  visible,
  onDismiss,
  links,
  setLinks,
  onSave,
  saving,
  colors,
  showSnackbar,
}: BusinessLinksModalProps) {
  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Business Links"
      scrollable={true}
      subtitle="Add your business social media links and website."
      maxHeight="80%"
      actions={[
        {
          label: 'Cancel',
          mode: 'outlined',
          onPress: onDismiss,
          style: { flex: 1 },
        },
        {
          label: 'Save Links',
          mode: 'contained',
          onPress: onSave,
          loading: saving,
          disabled: saving,
          style: { flex: 1 },
        },
      ]}
    >
      <View style={styles.compactModalContent}>
        {/* Website */}
        <Card
          style={{ marginBottom: 12, backgroundColor: colors.surface }}
          elevation={1}
        >
          <Card.Content style={{ paddingVertical: 12 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <MaterialCommunityIcons
                name="web"
                size={20}
                color={colors.primary}
                style={{ marginRight: 8 }}
              />
              <Text variant="titleSmall" style={{ flex: 1, fontWeight: '600' }}>
                Website / Booking Portal
              </Text>
            </View>
            <TextInput
              mode="outlined"
              placeholder="https://yourwebsite.com"
              value={links.website}
              onChangeText={text => setLinks(prev => ({ ...prev, website: text }))}
              style={styles.input}
              outlineColor={links.website ? colors.success : undefined}
              activeOutlineColor={links.website ? colors.success : colors.primary}
              dense
              right={
                links.website ? (
                  <TextInput.Icon
                    icon="close-circle"
                    onPress={() => setLinks(prev => ({ ...prev, website: '' }))}
                  />
                ) : null
              }
            />
            <HelperText type="info" style={{ marginTop: 4, fontSize: 11 }}>
              📌 Used in tenant conversion emails for profile access
            </HelperText>
            {links.website && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Button
                  mode="outlined"
                  compact
                  icon="content-copy"
                  onPress={() => {
                    showSnackbar('Website link copied to clipboard', 'success');
                  }}
                  style={{ flex: 1 }}
                >
                  Copy
                </Button>
                <Button
                  mode="contained-tonal"
                  compact
                  icon="open-in-new"
                  onPress={() => Linking.openURL(links.website)}
                  style={{ flex: 1 }}
                >
                  Open
                </Button>
              </View>
            )}
          </Card.Content>
        </Card>

        {/* WhatsApp Group */}
        <Card
          style={{ marginBottom: 12, backgroundColor: colors.surface }}
          elevation={1}
        >
          <Card.Content style={{ paddingVertical: 12 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <MaterialCommunityIcons
                name="whatsapp"
                size={20}
                color="#25D366"
                style={{ marginRight: 8 }}
              />
              <Text variant="titleSmall" style={{ flex: 1, fontWeight: '600' }}>
                WhatsApp Group
              </Text>
            </View>
            <TextInput
              mode="outlined"
              placeholder="https://chat.whatsapp.com/..."
              value={links.whatsapp_group}
              onChangeText={text =>
                setLinks(prev => ({ ...prev, whatsapp_group: text }))
              }
              style={styles.input}
              outlineColor={links.whatsapp_group ? colors.success : undefined}
              activeOutlineColor={
                links.whatsapp_group ? colors.success : colors.primary
              }
              dense
              right={
                links.whatsapp_group ? (
                  <TextInput.Icon
                    icon="close-circle"
                    onPress={() => setLinks(prev => ({ ...prev, whatsapp_group: '' }))}
                  />
                ) : null
              }
            />
            <HelperText type="info" style={{ marginTop: 4, fontSize: 11 }}>
              📌 For tenant community group invitations
            </HelperText>
            {links.whatsapp_group && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Button
                  mode="outlined"
                  compact
                  icon="content-copy"
                  onPress={() => {
                    showSnackbar('WhatsApp link copied to clipboard', 'success');
                  }}
                  style={{ flex: 1 }}
                >
                  Copy
                </Button>
                <Button
                  mode="contained-tonal"
                  compact
                  icon="open-in-new"
                  onPress={() => Linking.openURL(links.whatsapp_group)}
                  style={{ flex: 1 }}
                >
                  Open
                </Button>
              </View>
            )}
          </Card.Content>
        </Card>

        {/* Social Media Section */}
        <Text
          variant="titleSmall"
          style={{ marginTop: 8, marginBottom: 12, fontWeight: '600' }}
        >
          Social Media Links
        </Text>

        {/* Facebook */}
        <View style={{ marginBottom: 12 }}>
          <TextInput
            mode="outlined"
            label="Facebook"
            placeholder="https://facebook.com/yourpage"
            value={links.facebook}
            onChangeText={text => setLinks(prev => ({ ...prev, facebook: text }))}
            style={styles.input}
            outlineColor={links.facebook ? colors.success : undefined}
            activeOutlineColor={links.facebook ? colors.success : colors.primary}
            dense
            left={<TextInput.Icon icon="facebook" color="#1877F2" />}
            right={
              links.facebook ? (
                <TextInput.Icon
                  icon="close-circle"
                  onPress={() => setLinks(prev => ({ ...prev, facebook: '' }))}
                />
              ) : null
            }
          />
        </View>

        {/* Instagram */}
        <View style={{ marginBottom: 12 }}>
          <TextInput
            mode="outlined"
            label="Instagram"
            placeholder="https://instagram.com/youraccount"
            value={links.instagram}
            onChangeText={text => setLinks(prev => ({ ...prev, instagram: text }))}
            style={styles.input}
            outlineColor={links.instagram ? colors.success : undefined}
            activeOutlineColor={links.instagram ? colors.success : colors.primary}
            dense
            left={<TextInput.Icon icon="instagram" color="#E4405F" />}
            right={
              links.instagram ? (
                <TextInput.Icon
                  icon="close-circle"
                  onPress={() => setLinks(prev => ({ ...prev, instagram: '' }))}
                />
              ) : null
            }
          />
        </View>

        {/* Twitter / X */}
        <View style={{ marginBottom: 12 }}>
          <TextInput
            mode="outlined"
            label="Twitter / X"
            placeholder="https://twitter.com/youraccount"
            value={links.twitter}
            onChangeText={text => setLinks(prev => ({ ...prev, twitter: text }))}
            style={styles.input}
            outlineColor={links.twitter ? colors.success : undefined}
            activeOutlineColor={links.twitter ? colors.success : colors.primary}
            dense
            left={<TextInput.Icon icon="twitter" color="#1DA1F2" />}
            right={
              links.twitter ? (
                <TextInput.Icon
                  icon="close-circle"
                  onPress={() => setLinks(prev => ({ ...prev, twitter: '' }))}
                />
              ) : null
            }
          />
        </View>
      </View>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  input: {
    marginBottom: 16,
  },
  compactModalContent: {
    paddingVertical: 8,
  },
});
