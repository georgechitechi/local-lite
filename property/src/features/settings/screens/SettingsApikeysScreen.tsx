import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useState } from 'react';
import { Clipboard, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  DataTable,
  HelperText,
  IconButton,
  List,
  Portal,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useApiKeys, useCoreMutations } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { supabase } from '@/shared/services/supabase';
import { formatDateTime } from '@/shared/utils/formatters';

const AVAILABLE_SCOPES = [
  { id: 'read', label: 'General Read' },
  { id: 'write', label: 'General Write' },
];

interface GenerateApiKeyResponse {
  api_key: string;
}

export default function ApiKeysManager() {
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const { checkOnline } = useOfflineCheck();
  const { requireCloudSync } = useLocalSync();
  const { showSnackbar } = useSnackbar();

  const apiKeys = useApiKeys(selectedBusiness?.id);
  const { delete: deleteRecord } = useCoreMutations();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);

  const handleRevealKey = async (id: string) => {
    if (!checkOnline('Reveal API Key') || !requireCloudSync('Reveal API Key')) return;
    try {
      setRevealing(true);
      setRevealedKey(null);
      const { data, error } = await supabase.rpc('reveal_api_key', {
        p_key_id: id,
      });

      if (error) throw error;
      setRevealedKey(data as string);
    } catch (error: any) {
      console.error('Error revealing API key:', error);
      showSnackbar('Failed to reveal API key', 'error');
    } finally {
      setRevealing(false);
    }
  };
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['read']);
  const [generating, setGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  const selectedKey = selectedKeyId && apiKeys.find(k => k.id === selectedKeyId);

  const toggleScope = (scopeId: string) => {
    setSelectedScopes(prev =>
      prev.includes(scopeId) ? prev.filter(id => id !== scopeId) : [...prev, scopeId],
    );
  };

  const handleCreateKey = async () => {
    if (!checkOnline('Generate API Key') || !requireCloudSync('Generate API Key')) return;
    if (!newKeyName.trim()) {
      showSnackbar('Please enter a name for the API key', 'error');
      return;
    }

    if (selectedScopes.length === 0) {
      showSnackbar('Please select at least one scope', 'error');
      return;
    }

    if (!selectedBusiness?.id) {
      showSnackbar('No business selected', 'error');
      return;
    }

    try {
      setGenerating(true);
      const { data, error } = await supabase.rpc('generate_api_key', {
        p_business_id: selectedBusiness.id,
        p_name: newKeyName.trim(),
        p_scopes: selectedScopes,
      });

      if (error) throw error;

      const responseData = data as unknown as GenerateApiKeyResponse;

      if (responseData?.api_key) {
        setGeneratedKey(responseData.api_key);
      }
    } catch (error: any) {
      console.error('Error generating API key:', error);
      showSnackbar('Failed to generate API key', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevokeKey = (id: string) => {
    setRevokeKeyParams(id);
    setShowRevokeConfirm(true);
  };

  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [revokeKeyParams, setRevokeKeyParams] = useState<string | null>(null);

  const copyToClipboard = (text: string) => {
    Clipboard.setString(text);
    showSnackbar('Copied to clipboard', 'success');
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <List.Section>
        <List.Subheader>Your API Keys</List.Subheader>
        <Card style={styles.card}>
          <Card.Content>
            <Text variant="bodyMedium" style={{ marginBottom: 16 }}>
              Use API keys to authenticate external applications and integrations with
              your business data.
            </Text>
            <Button
              mode="contained"
              onPress={() => {
                setNewKeyName('');
                setSelectedScopes(['read']);
                setGeneratedKey(null);
                setShowCreateModal(true);
              }}
              icon="plus"
            >
              Generate New Key
            </Button>
          </Card.Content>
        </Card>

        {apiKeys.length === 0 ? (
          <EmptyState icon="key-variant" title="No active API keys found" />
        ) : (
          <DataTable>
            <DataTable.Header>
              <DataTable.Title>Name</DataTable.Title>
              <DataTable.Title>Key Prefix</DataTable.Title>
              <DataTable.Title numeric>Actions</DataTable.Title>
            </DataTable.Header>

            {apiKeys.map(key => (
              <DataTable.Row key={key.id}>
                <DataTable.Cell>{key.name}</DataTable.Cell>
                <DataTable.Cell>{key.key_prefix}</DataTable.Cell>
                <DataTable.Cell numeric>
                  <IconButton
                    icon="eye-outline"
                    size={20}
                    onPress={() => {
                      setSelectedKeyId(key.id);
                      setShowDetailsModal(true);
                    }}
                  />
                </DataTable.Cell>
              </DataTable.Row>
            ))}
          </DataTable>
        )}
      </List.Section>

      <Portal>
        {/* Create Modal */}
        <BaseModal
          visible={showCreateModal}
          onDismiss={() => setShowCreateModal(false)}
          title="Generate API Key"
          subtitle="Manage your properties"
          scrollable
          actions={
            generatedKey
              ? [
                  {
                    label: 'Done',
                    mode: 'contained',
                    onPress: () => setShowCreateModal(false),
                  },
                ]
              : [
                  {
                    label: 'Cancel',
                    mode: 'outlined',
                    onPress: () => setShowCreateModal(false),
                  },
                  {
                    label: 'Generate',
                    mode: 'contained',
                    onPress: handleCreateKey,
                    loading: generating,
                    disabled:
                      generating || !newKeyName.trim() || selectedScopes.length === 0,
                  },
                ]
          }
        >
          {generatedKey ? (
            <View>
              <View style={[styles.warningBox, { borderColor: colors.warning }]}>
                <MaterialCommunityIcons name="alert" size={24} color={colors.warning} />
                <Text variant="bodySmall" style={{ marginLeft: 8, flex: 1 }}>
                  Please copy and store this key securely. For your security, we
                  won&apos;t show it to you again.
                </Text>
              </View>

              <View
                style={[
                  styles.keyDisplay,
                  {
                    backgroundColor: colors.surfaceVariant,
                    borderColor: colors.outlineVariant,
                  },
                ]}
              >
                <Text variant="titleMedium" style={{ fontFamily: 'monospace' }}>
                  {generatedKey}
                </Text>
                <IconButton
                  icon="content-copy"
                  onPress={() => copyToClipboard(generatedKey)}
                />
              </View>
            </View>
          ) : (
            <View>
              <TextInput
                mode="outlined"
                label="Key Name"
                placeholder="e.g. My Integration"
                value={newKeyName}
                onChangeText={setNewKeyName}
                autoFocus
                style={{ marginBottom: 16 }}
              />

              <Text variant="labelLarge" style={{ marginBottom: 8 }}>
                Scopes
              </Text>
              <View style={styles.chipContainer}>
                {AVAILABLE_SCOPES.map(scope => (
                  <Chip
                    key={scope.id}
                    selected={selectedScopes.includes(scope.id)}
                    onPress={() => toggleScope(scope.id)}
                    style={styles.chip}
                    showSelectedOverlay
                  >
                    {scope.label}
                  </Chip>
                ))}
              </View>
              <HelperText type="info">
                Select the permissions this API key should have.
              </HelperText>
            </View>
          )}
        </BaseModal>

        {/* Details Modal */}
        <BaseModal
          visible={showDetailsModal}
          onDismiss={() => {
            setShowDetailsModal(false);
            setRevealedKey(null);
          }}
          title="API Key Details"
          subtitle="Manage your properties"
          scrollable
          maxHeight="60%"
          actions={[
            {
              label: 'Close',
              mode: 'outlined',
              onPress: () => {
                setShowDetailsModal(false);
                setRevealedKey(null);
              },
            },
            {
              label: 'Revoke',
              mode: 'contained',
              buttonColor: colors.error,
              onPress: () => selectedKey && handleRevokeKey(selectedKey.id),
            },
          ]}
        >
          {selectedKey && (
            <View>
              <View
                style={[styles.compactRow, { borderBottomColor: colors.outlineVariant }]}
              >
                <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
                  Name
                </Text>
                <Text variant="bodyLarge">{selectedKey.name}</Text>
              </View>

              <View
                style={[styles.compactRow, { borderBottomColor: colors.outlineVariant }]}
              >
                <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
                  API Key
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    flex: 1,
                    justifyContent: 'flex-end',
                    marginLeft: 12,
                  }}
                >
                  <Text
                    variant="bodyMedium"
                    style={{
                      fontFamily: 'monospace',
                      flexShrink: 1,
                      marginRight: 4,
                      maxWidth: 160,
                    }}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                  >
                    {revealedKey ? revealedKey : '••••••••••••'}
                  </Text>
                  {revealing ? (
                    <ActivityIndicator size={20} style={{ marginHorizontal: 10 }} />
                  ) : (
                    <IconButton
                      icon={revealedKey ? 'content-copy' : 'eye-outline'}
                      size={20}
                      style={{ margin: 0 }}
                      onPress={() =>
                        revealedKey
                          ? copyToClipboard(revealedKey)
                          : handleRevealKey(selectedKey.id)
                      }
                    />
                  )}
                </View>
              </View>

              <View
                style={[styles.compactRow, { borderBottomColor: colors.outlineVariant }]}
              >
                <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
                  Key Prefix
                </Text>
                <Text variant="bodyMedium" style={{ fontFamily: 'monospace' }}>
                  {selectedKey.key_prefix}
                </Text>
              </View>

              <View
                style={[styles.compactRow, { borderBottomColor: colors.outlineVariant }]}
              >
                <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
                  Scopes
                </Text>
                <Text variant="bodyMedium">
                  {Array.isArray(selectedKey.scopes)
                    ? selectedKey.scopes.join(', ')
                    : 'None'}
                </Text>
              </View>

              <View
                style={[styles.compactRow, { borderBottomColor: colors.outlineVariant }]}
              >
                <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
                  Created At
                </Text>
                <Text variant="bodyMedium">
                  {selectedKey.created_at
                    ? formatDateTime(selectedKey.created_at)
                    : 'N/A'}
                </Text>
              </View>

              <View
                style={[styles.compactRow, { borderBottomColor: colors.outlineVariant }]}
              >
                <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
                  Last Used
                </Text>
                <Text variant="bodyMedium">
                  {selectedKey.last_used_at
                    ? formatDateTime(selectedKey.last_used_at)
                    : 'Never'}
                </Text>
              </View>

              {selectedKey.expires_at && (
                <View
                  style={[
                    styles.compactRow,
                    { borderBottomColor: colors.outlineVariant },
                  ]}
                >
                  <Text variant="labelMedium" style={{ color: colors.onSurfaceVariant }}>
                    Expires At
                  </Text>
                  <Text variant="bodyMedium">
                    {formatDateTime(selectedKey.expires_at)}
                  </Text>
                </View>
              )}
            </View>
          )}
        </BaseModal>

        <BaseModal
          mode="confirm"
          visible={showRevokeConfirm}
          onDismiss={() => {
            setShowRevokeConfirm(false);
            setRevokeKeyParams(null);
          }}
          onConfirm={async () => {
            if (!revokeKeyParams) return;
            try {
              if (deleteRecord) {
                await deleteRecord('api_keys', revokeKeyParams);
                showSnackbar('API Key revoked successfully', 'success');
                setShowDetailsModal(false);
              }
            } catch (error: any) {
              console.error('Error revoking API key:', error);
              showSnackbar('Failed to revoke API key', 'error');
            } finally {
              setShowRevokeConfirm(false);
              setRevokeKeyParams(null);
            }
          }}
          title="Revoke API Key"
          message="Are you sure you want to revoke this API key? Any applications using it will lose access immediately."
          confirmText="Revoke"
          destructive={true}
        />
      </Portal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  card: {
    margin: 16,
    marginTop: 0,
  },
  warningBox: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
  },
  keyDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  compactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  chip: {
    width: '48.5%',
    marginBottom: 8,
  },
});
