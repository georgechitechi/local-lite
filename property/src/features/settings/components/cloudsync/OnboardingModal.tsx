import React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  HelperText,
  Icon,
  List,
  Text,
  TextInput,
} from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import LoadingCard from '@/shared/components/LoadingCard';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { WorkflowPollResult } from '@/shared/services/githubActions';
import type { ConnectionTestResult, SupabaseProject } from '@/shared/services/supabase';
import { addOpacity } from '@/shared/utils/helper';
import { decodeConnectionKey } from './types';

interface OnboardingModalProps {
  visible: boolean;
  onDismiss: () => void;
  connectionMethod: 'pat' | 'manual' | null;
  onboardingPatInput: string;
  onOnboardingPatInputChange: (v: string) => void;
  onOpenStepOneModal: () => void;
  isFetchingProjects: boolean;
  onFetchPatProjects: () => void;
  hasPat: boolean;
  onRemovePat: () => void;
  patProjects: SupabaseProject[];
  selectedRef: string;
  onSelectProjectRef: (ref: string) => void;
  schemaError: string;
  workflowResult: WorkflowPollResult | null;
  schemaDone: boolean;
  deployLoading: boolean;
  onConnectOnly: () => void;
  onRequestDeployConfirm: () => void;
  isAdvancedMode: boolean;
  onToggleAdvancedMode: () => void;
  connectionKey: string;
  onConnectionKeyChange: (k: string) => void;
  url: string;
  onUrlChange: (u: string) => void;
  key: string;
  onKeyChange: (k: string) => void;
  loading: boolean;
  testResult: ConnectionTestResult | null;
  testingConnection: boolean;
  onTestConnection: () => void;
  onConnect: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  visible,
  onDismiss,
  connectionMethod,
  onboardingPatInput,
  onOnboardingPatInputChange,
  onOpenStepOneModal,
  isFetchingProjects,
  onFetchPatProjects,
  hasPat,
  onRemovePat,
  patProjects,
  selectedRef,
  onSelectProjectRef,
  schemaError,
  workflowResult,
  schemaDone,
  deployLoading,
  onConnectOnly,
  onRequestDeployConfirm,
  isAdvancedMode,
  onToggleAdvancedMode,
  connectionKey,
  onConnectionKeyChange,
  url,
  onUrlChange,
  key,
  onKeyChange,
  loading,
  testResult,
  testingConnection,
  onTestConnection,
  onConnect,
}) => {
  const colors = useThemeColors();

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Connect Database"
      subtitle={
        connectionMethod === 'pat'
          ? 'Enter your Personal Access Token'
          : 'Enter connection details'
      }
      scrollable={true}
    >
      <View>
        {connectionMethod === 'pat' ? (
          <View>
            <TextInput
              label="Supabase Personal Access Token"
              value={onboardingPatInput}
              onChangeText={onOnboardingPatInputChange}
              mode="outlined"
              secureTextEntry
              style={{ marginBottom: 8 }}
            />
            <Button
              mode="text"
              compact
              icon="help-circle-outline"
              onPress={() => {
                onDismiss();
                onOpenStepOneModal();
              }}
              style={{ alignSelf: 'flex-start', marginBottom: 10 }}
              labelStyle={{ fontSize: 13 }}
            >
              Need to create a project or PAT first? Click here.
            </Button>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              <Button
                mode="contained-tonal"
                loading={isFetchingProjects}
                onPress={onFetchPatProjects}
                style={{ flex: 1 }}
              >
                Fetch Projects
              </Button>
              {hasPat && (
                <Button mode="outlined" onPress={onRemovePat} style={{ flex: 1 }}>
                  Revoke PAT
                </Button>
              )}
            </View>

            {isFetchingProjects && (
              <View style={{ paddingVertical: 24 }}>
                <LoadingCard
                  iconName="database-search"
                  text="Fetching your projects..."
                  backgroundColor="transparent"
                />
              </View>
            )}

            {patProjects.length > 0 && !isFetchingProjects && !selectedRef && (
              <View>
                <Text variant="titleSmall" style={{ marginBottom: 8 }}>
                  Available Projects
                </Text>
                {patProjects.map((p: SupabaseProject) => (
                  <List.Item
                    key={p.id}
                    title={p.name}
                    description={p.ref}
                    onPress={() => onSelectProjectRef(p.ref)}
                    left={props => <List.Icon {...props} icon="database" />}
                    style={{
                      backgroundColor: colors.surfaceVariant,
                      marginBottom: 8,
                      borderRadius: 8,
                    }}
                  />
                ))}
              </View>
            )}

            {selectedRef && (
              <View style={{ marginTop: 12 }}>
                {/* Target Project Summary Card */}
                <View
                  style={{
                    backgroundColor: addOpacity(colors.primary, 0.08),
                    borderColor: addOpacity(colors.primary, 0.25),
                    borderWidth: 1,
                    borderRadius: 10,
                    padding: 12,
                    marginBottom: 16,
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text
                        variant="labelSmall"
                        style={{
                          color: colors.primary,
                          fontWeight: '700',
                          letterSpacing: 0.5,
                        }}
                      >
                        TARGET PROJECT
                      </Text>
                      <Text
                        variant="titleMedium"
                        style={{ fontWeight: '700', marginTop: 2 }}
                        numberOfLines={1}
                      >
                        {patProjects.find(p => p.ref === selectedRef)?.name ||
                          selectedRef}
                      </Text>
                      <Text
                        variant="bodySmall"
                        style={{ color: colors.onSurfaceVariant, marginTop: 2 }}
                      >
                        Ref: {selectedRef}
                      </Text>
                    </View>
                    <Button
                      mode="text"
                      onPress={() => onSelectProjectRef('')}
                      disabled={deployLoading || schemaDone}
                      labelStyle={{ fontSize: 12 }}
                    >
                      Change
                    </Button>
                  </View>
                </View>

                {schemaError ? (
                  <HelperText type="error" visible>
                    {schemaError}
                  </HelperText>
                ) : null}

                {workflowResult ? (
                  <View
                    style={{
                      marginBottom: 16,
                      backgroundColor: colors.surfaceVariant,
                      padding: 12,
                      borderRadius: 8,
                    }}
                  >
                    <Text variant="titleSmall" style={{ marginBottom: 4 }}>
                      Deployment Progress
                    </Text>
                    {workflowResult.steps.map(s => (
                      <View
                        key={s.number}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          marginVertical: 2,
                        }}
                      >
                        {s.conclusion === 'success' ? (
                          <Icon source="check-circle" size={16} color={colors.success} />
                        ) : s.conclusion === 'failure' ? (
                          <Icon source="alert-circle" size={16} color={colors.error} />
                        ) : s.status === 'in_progress' ? (
                          <ActivityIndicator size={16} />
                        ) : (
                          <Icon
                            source="circle-outline"
                            size={16}
                            color={colors.onSurfaceVariant}
                          />
                        )}
                        <Text variant="bodySmall" style={{ marginLeft: 8 }}>
                          {s.name}
                        </Text>
                      </View>
                    ))}
                    {schemaDone && (
                      <Text
                        variant="bodyMedium"
                        style={{
                          color: colors.success,
                          marginTop: 8,
                          fontWeight: 'bold',
                        }}
                      >
                        Deployment Complete! Initializing sync...
                      </Text>
                    )}
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                  <Button
                    mode="contained"
                    buttonColor={colors.error}
                    textColor={colors.onError}
                    loading={deployLoading || schemaDone}
                    disabled={deployLoading || schemaDone}
                    onPress={onRequestDeployConfirm}
                    style={{ flex: 1 }}
                  >
                    Reset Database
                  </Button>
                  <Button
                    mode="contained"
                    loading={deployLoading || schemaDone}
                    disabled={deployLoading || schemaDone}
                    onPress={onConnectOnly}
                    style={{ flex: 1 }}
                  >
                    Connect Directly
                  </Button>
                </View>
              </View>
            )}
          </View>
        ) : connectionMethod === 'manual' ? (
          <View>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <Text variant="titleSmall">Manual Connection</Text>
              <Button mode="text" compact onPress={onToggleAdvancedMode}>
                {isAdvancedMode ? 'Use App Key' : 'Advanced'}
              </Button>
            </View>

            {!isAdvancedMode ? (
              <React.Fragment>
                <TextInput
                  label="Connection Key"
                  value={connectionKey}
                  onChangeText={onConnectionKeyChange}
                  mode="outlined"
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Paste your base64 app key here"
                />
                {connectionKey.trim() && decodeConnectionKey(connectionKey.trim()).u ? (
                  <HelperText type="info" visible={true}>
                    Project URL: {decodeConnectionKey(connectionKey.trim()).u}
                  </HelperText>
                ) : null}
              </React.Fragment>
            ) : (
              <React.Fragment>
                <TextInput
                  label="Supabase URL"
                  value={url}
                  onChangeText={onUrlChange}
                  mode="outlined"
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="https://project-ref.supabase.co"
                />
                <TextInput
                  label="Supabase Anon Key"
                  value={key}
                  onChangeText={onKeyChange}
                  mode="outlined"
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />
              </React.Fragment>
            )}

            <HelperText type="info">
              Your credentials will be stored securely on this device.
            </HelperText>

            {testResult && (
              <View
                style={{
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: testResult.ok
                    ? colors.primaryContainer
                    : colors.errorContainer,
                  marginTop: 8,
                  marginBottom: 8,
                }}
              >
                <Text
                  variant="labelMedium"
                  style={{
                    color: testResult.ok ? colors.primary : colors.error,
                    fontWeight: 'bold',
                  }}
                >
                  {testResult.ok
                    ? `✓ Verified! Host reachable (${testResult.latencyMs}ms)`
                    : testResult.isPaused
                      ? '⚠️ Project Paused on Supabase'
                      : '✕ Connection Failed'}
                </Text>
                {testResult.error ? (
                  <Text
                    variant="bodySmall"
                    style={{ color: colors.onErrorContainer, marginTop: 2 }}
                  >
                    {testResult.error}
                  </Text>
                ) : null}
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Button
                mode="outlined"
                icon="network-strength-4"
                onPress={onTestConnection}
                loading={testingConnection}
                disabled={
                  testingConnection ||
                  loading ||
                  (!isAdvancedMode && !connectionKey) ||
                  (isAdvancedMode && (!url || !key))
                }
                style={{ flex: 1 }}
              >
                Test Ping
              </Button>
              <Button
                mode="contained"
                onPress={onConnect}
                loading={loading}
                disabled={
                  loading ||
                  testingConnection ||
                  (!isAdvancedMode && !connectionKey) ||
                  (isAdvancedMode && (!url || !key))
                }
                style={{ flex: 1 }}
              >
                Connect
              </Button>
            </View>
          </View>
        ) : null}
      </View>
    </BaseModal>
  );
};

const styles = StyleSheet.create({
  input: {
    marginBottom: 8,
  },
});
