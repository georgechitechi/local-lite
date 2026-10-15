import type React from 'react';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Divider,
  HelperText,
  Icon,
  IconButton,
  Menu,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { SupabaseProject } from '@/shared/services/supabase';
import { addOpacity } from '@/shared/utils/helper';
import { generateSecureSecret, type SecretItem } from './types';

interface EdgeFunctionSecretsModalProps {
  visible: boolean;
  onDismiss: () => void;
  projectRef: string | null;
  fetchingSecrets: boolean;
  savingSecretName: string | null;
  secretsList: SecretItem[];
  onSecretsListChange: (list: SecretItem[]) => void;
  onSaveSecret: (name: string, value: string, isCustom?: boolean) => void;
  onDeleteSecret: (name: string, isCustom?: boolean) => void;
  testingNotification: boolean;
  onSendTestNotification: (channel: 'email' | 'sms') => void;
  pat?: string | null;
  patProjects?: SupabaseProject[];
  backupProjectRef?: string | null;
  configuringBackupRef?: string | null;
  onConfigureBackupProject?: (backupRef: string) => void;
  onDisconnectBackupProject?: () => void;
  onOpenPatManagement?: () => void;
}

export const EdgeFunctionSecretsModal: React.FC<EdgeFunctionSecretsModalProps> = ({
  visible,
  onDismiss,
  projectRef,
  fetchingSecrets,
  savingSecretName,
  secretsList,
  onSecretsListChange,
  onSaveSecret,
  onDeleteSecret,
  testingNotification,
  onSendTestNotification,
  pat,
  patProjects = [],
  backupProjectRef,
  configuringBackupRef,
  onConfigureBackupProject,
  onDisconnectBackupProject,
  onOpenPatManagement,
}) => {
  const colors = useThemeColors();
  const [openMenuSecretName, setOpenMenuSecretName] = useState<string | null>(null);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<{
    name: string;
    isCustom?: boolean;
  } | null>(null);
  const [showBackupPickerModal, setShowBackupPickerModal] = useState(false);

  const isBackupConfigured = Boolean(
    backupProjectRef ||
      secretsList.find(s => s.name === 'BACKUP_PROJECT_REF')?.isAlreadyConfigured,
  );
  const backupProject = (patProjects || []).find(p => p.ref === backupProjectRef);

  const groupedSecrets = Object.entries(
    secretsList
      .filter(
        s =>
          !(s.name.toUpperCase().startsWith('SUPABASE_') && !s.isCustom) &&
          s.name !== 'BACKUP_PROJECT_PAT' &&
          s.name !== 'BACKUP_PROJECT_REF',
      )
      .reduce(
        (acc, s, idx) => {
          const g = s.group || 'Custom Secrets';
          if (!acc[g]) acc[g] = { items: [], url: undefined };
          acc[g].items.push({ s, idx });
          if (s.url && !acc[g].url) {
            acc[g].url = s.url;
          }
          return acc;
        },
        {} as Record<string, { items: { s: SecretItem; idx: number }[]; url?: string }>,
      ),
  );

  return (
    <>
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title="Edge Function Secrets"
        subtitle={`Set environment variables: ${projectRef || ''}`}
        scrollable={true}
        maxHeight={'85%'}
        actions={[
          {
            label: 'Close',
            mode: 'outlined',
            onPress: onDismiss,
            style: { flex: 1 },
          },
        ]}
      >
        {fetchingSecrets ? (
          <ActivityIndicator style={{ marginVertical: 24 }} size="large" />
        ) : (
          <View>
            {/* Test Notifications Panel */}
            <View
              style={{
                backgroundColor: colors.surfaceVariant,
                padding: 12,
                borderRadius: 8,
                marginBottom: 16,
                gap: 6,
              }}
            >
              <Text variant="titleSmall">Test Cloud Notifications</Text>
              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                Send a test ping to verify SMTP Email and SMS credentials are configured
                in your Edge Functions.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <Button
                  mode="contained-tonal"
                  compact
                  icon="email-outline"
                  loading={testingNotification}
                  disabled={testingNotification}
                  onPress={() => onSendTestNotification('email')}
                  style={{ flex: 1 }}
                >
                  Test Email
                </Button>
                <Button
                  mode="contained-tonal"
                  compact
                  icon="message-text-outline"
                  loading={testingNotification}
                  disabled={testingNotification}
                  onPress={() => onSendTestNotification('sms')}
                  style={{ flex: 1 }}
                >
                  Test SMS
                </Button>
              </View>
            </View>

            {groupedSecrets.map(([groupName, groupData]) => (
              <View key={groupName} style={{ marginBottom: 20 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <Text
                    variant="labelLarge"
                    style={{ fontWeight: 'bold', color: colors.primary }}
                  >
                    {groupName}
                  </Text>
                  {groupData.url && (
                    <Button
                      mode="text"
                      compact
                      icon="open-in-new"
                      onPress={() => Linking.openURL(groupData.url as string)}
                      labelStyle={{ fontSize: 11 }}
                    >
                      Console
                    </Button>
                  )}
                </View>

                {groupName === 'Database Backup & Disaster Recovery' && (
                  <View
                    style={{
                      backgroundColor: colors.surfaceVariant,
                      padding: 14,
                      borderRadius: 10,
                      marginBottom: 14,
                      borderLeftWidth: 4,
                      borderLeftColor: isBackupConfigured
                        ? colors.success
                        : colors.primary,
                      gap: 8,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 10,
                          flex: 1,
                        }}
                      >
                        <Icon
                          source={isBackupConfigured ? 'database-check' : 'database-sync'}
                          size={24}
                          color={isBackupConfigured ? colors.success : colors.primary}
                        />
                        <View style={{ flex: 1 }}>
                          <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>
                            {isBackupConfigured
                              ? 'Backup Replica Connected'
                              : 'Disaster Recovery Replica'}
                          </Text>
                          <Text
                            variant="bodySmall"
                            style={{ color: colors.onSurfaceVariant }}
                          >
                            {isBackupConfigured
                              ? `Project: ${backupProject?.name || backupProjectRef || 'Configured via PAT'}`
                              : 'Auto-sync database changes to a secondary Supabase project.'}
                          </Text>
                        </View>
                      </View>
                      {isBackupConfigured && (
                        <View
                          style={{
                            backgroundColor: addOpacity(colors.success, 0.15),
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: 6,
                          }}
                        >
                          <Text
                            variant="labelSmall"
                            style={{
                              color: colors.success,
                              fontWeight: 'bold',
                              fontSize: 10,
                            }}
                          >
                            ACTIVE
                          </Text>
                        </View>
                      )}
                    </View>

                    {!pat ? (
                      <Button
                        mode="contained-tonal"
                        icon="key"
                        compact
                        onPress={onOpenPatManagement}
                        style={{ alignSelf: 'flex-start', marginTop: 4 }}
                      >
                        Configure Supabase PAT
                      </Button>
                    ) : isBackupConfigured ? (
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                        <Button
                          mode="outlined"
                          compact
                          icon="swap-horizontal"
                          loading={configuringBackupRef !== null}
                          disabled={configuringBackupRef !== null}
                          onPress={() => setShowBackupPickerModal(true)}
                          style={{ flex: 1 }}
                        >
                          Change Project
                        </Button>
                        <Button
                          mode="outlined"
                          compact
                          icon="link-off"
                          textColor={colors.error}
                          loading={configuringBackupRef !== null}
                          disabled={configuringBackupRef !== null}
                          onPress={onDisconnectBackupProject}
                          style={{ borderColor: colors.error, flex: 1 }}
                        >
                          Disconnect
                        </Button>
                      </View>
                    ) : (
                      <Button
                        mode="contained"
                        icon="database-sync"
                        loading={configuringBackupRef !== null}
                        disabled={configuringBackupRef !== null}
                        onPress={() => setShowBackupPickerModal(true)}
                        style={{ width: '100%', marginTop: 4 }}
                      >
                        Select Backup Project via PAT
                      </Button>
                    )}
                  </View>
                )}

                {groupData.items.map(({ s, idx }) => {
                  const secretKey = s.name || `custom_${idx}`;
                  return (
                    <View key={idx} style={{ marginBottom: 12 }}>
                      {!s.isCustom ? (
                        <View
                          style={{
                            backgroundColor: colors.surfaceVariant,
                            padding: 12,
                            borderRadius: 8,
                            gap: s.isEditing ? 8 : 0,
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
                                variant="bodyMedium"
                                style={{ fontWeight: 'bold' }}
                                numberOfLines={1}
                              >
                                {s.name}{' '}
                                {s.required && (
                                  <Text style={{ color: colors.error }}>*</Text>
                                )}
                              </Text>
                              {s.description && (
                                <Text
                                  variant="bodySmall"
                                  style={{
                                    color: colors.onSurfaceVariant,
                                    marginTop: 2,
                                  }}
                                >
                                  {s.description}
                                </Text>
                              )}
                            </View>

                            {/* Action buttons opposite secret name */}
                            {s.isEditing ? (
                              <View
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 2,
                                  marginRight: -6,
                                }}
                              >
                                {s.name === 'APP_SECRET_KEY' && (
                                  <IconButton
                                    icon="refresh"
                                    size={20}
                                    iconColor={colors.primary}
                                    style={{ margin: 0 }}
                                    onPress={() => {
                                      const result = generateSecureSecret();
                                      const newList = [...secretsList];
                                      newList[idx].value = result;
                                      onSecretsListChange(newList);
                                    }}
                                  />
                                )}
                                <IconButton
                                  icon="check"
                                  size={20}
                                  iconColor={colors.primary}
                                  style={{ margin: 0 }}
                                  loading={savingSecretName === s.name}
                                  disabled={
                                    !s.value.trim() || savingSecretName === s.name
                                  }
                                  onPress={() => onSaveSecret(s.name, s.value, false)}
                                />
                                <IconButton
                                  icon="close"
                                  size={20}
                                  style={{ margin: 0 }}
                                  disabled={savingSecretName === s.name}
                                  onPress={() => {
                                    const newList = [...secretsList];
                                    newList[idx].isEditing = false;
                                    newList[idx].value = '';
                                    onSecretsListChange(newList);
                                  }}
                                />
                              </View>
                            ) : (
                              <View
                                style={{
                                  alignItems: 'center',
                                  marginLeft: 'auto',
                                  marginRight: -2,
                                }}
                              >
                                <Menu
                                  visible={openMenuSecretName === secretKey}
                                  onDismiss={() => setOpenMenuSecretName(null)}
                                  anchor={
                                    <IconButton
                                      icon="dots-vertical"
                                      size={20}
                                      style={{ margin: 0 }}
                                      onPress={() =>
                                        setOpenMenuSecretName(
                                          openMenuSecretName === secretKey
                                            ? null
                                            : secretKey,
                                        )
                                      }
                                    />
                                  }
                                >
                                  <Menu.Item
                                    leadingIcon="pencil"
                                    onPress={() => {
                                      setOpenMenuSecretName(null);
                                      const newList = [...secretsList];
                                      newList[idx].isEditing = true;
                                      newList[idx].value = '';
                                      onSecretsListChange(newList);
                                    }}
                                    title="Edit"
                                  />
                                  <Divider />
                                  <Menu.Item
                                    leadingIcon="delete-outline"
                                    onPress={() => {
                                      setOpenMenuSecretName(null);
                                      setConfirmDeleteTarget({
                                        name: s.name,
                                        isCustom: false,
                                      });
                                    }}
                                    title="Delete"
                                    titleStyle={{ color: colors.error }}
                                  />
                                </Menu>
                                {s.isAlreadyConfigured && (
                                  <View style={{ marginTop: -2 }}>
                                    <Icon
                                      source="check-circle"
                                      size={15}
                                      color={colors.success}
                                    />
                                  </View>
                                )}
                              </View>
                            )}
                          </View>

                          {/* Full-width Value Input when editing */}
                          {s.isEditing && (
                            <TextInput
                              mode="outlined"
                              label="New Value"
                              value={s.value}
                              secureTextEntry={
                                !s.isPasswordVisible &&
                                (s.name.includes('KEY') ||
                                  s.name.includes('SECRET') ||
                                  s.name.includes('PASSWORD') ||
                                  s.name.includes('TOKEN'))
                              }
                              right={
                                <TextInput.Icon
                                  icon={s.isPasswordVisible ? 'eye-off' : 'eye'}
                                  onPress={() => {
                                    const newList = [...secretsList];
                                    newList[idx].isPasswordVisible =
                                      !newList[idx].isPasswordVisible;
                                    onSecretsListChange(newList);
                                  }}
                                />
                              }
                              onChangeText={v => {
                                const newList = [...secretsList];
                                newList[idx].value = v;
                                onSecretsListChange(newList);
                              }}
                              autoCapitalize="none"
                              autoCorrect={false}
                              dense
                            />
                          )}
                        </View>
                      ) : s.isEditing ? (
                        <View
                          style={{
                            backgroundColor: colors.surfaceVariant,
                            padding: 12,
                            borderRadius: 8,
                            gap: 8,
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
                              {s.isAlreadyConfigured ? (
                                <>
                                  <Text
                                    variant="bodyMedium"
                                    style={{ fontWeight: 'bold' }}
                                    numberOfLines={1}
                                  >
                                    {s.name}
                                  </Text>
                                  <Text
                                    variant="bodySmall"
                                    style={{
                                      color: colors.onSurfaceVariant,
                                      marginTop: 2,
                                    }}
                                  >
                                    Custom Environment Variable
                                  </Text>
                                </>
                              ) : (
                                <TextInput
                                  mode="outlined"
                                  label="Custom Key Name"
                                  value={s.name}
                                  error={s.name
                                    .trim()
                                    .toUpperCase()
                                    .startsWith('SUPABASE_')}
                                  onChangeText={v => {
                                    const newList = [...secretsList];
                                    newList[idx].name = v;
                                    onSecretsListChange(newList);
                                  }}
                                  autoCapitalize="none"
                                  autoCorrect={false}
                                  dense
                                />
                              )}
                            </View>
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 2,
                                marginRight: -6,
                              }}
                            >
                              <IconButton
                                icon="check"
                                size={20}
                                iconColor={colors.primary}
                                style={{ margin: 0 }}
                                loading={savingSecretName === s.name}
                                disabled={
                                  !s.name.trim() ||
                                  !s.value.trim() ||
                                  s.name.trim().toUpperCase().startsWith('SUPABASE_') ||
                                  savingSecretName === s.name
                                }
                                onPress={() => onSaveSecret(s.name, s.value, true)}
                              />
                              {s.isAlreadyConfigured ? (
                                <IconButton
                                  icon="close"
                                  size={20}
                                  style={{ margin: 0 }}
                                  disabled={savingSecretName === s.name}
                                  onPress={() => {
                                    const newList = [...secretsList];
                                    newList[idx].isEditing = false;
                                    newList[idx].value = '';
                                    onSecretsListChange(newList);
                                  }}
                                />
                              ) : (
                                <IconButton
                                  icon="delete"
                                  size={20}
                                  iconColor={colors.error}
                                  style={{ margin: 0 }}
                                  disabled={savingSecretName === s.name}
                                  onPress={() => {
                                    if (s.name.trim() && s.isAlreadyConfigured) {
                                      setConfirmDeleteTarget({
                                        name: s.name,
                                        isCustom: true,
                                      });
                                    } else {
                                      onDeleteSecret(s.name, true);
                                    }
                                  }}
                                />
                              )}
                            </View>
                          </View>
                          {!s.isAlreadyConfigured &&
                            s.name.trim().toUpperCase().startsWith('SUPABASE_') && (
                              <HelperText type="error" visible style={{ marginTop: -4 }}>
                                Secrets named SUPABASE_* are system reserved and cannot be
                                edited.
                              </HelperText>
                            )}
                          <TextInput
                            mode="outlined"
                            label={s.isAlreadyConfigured ? 'New Value' : 'Value'}
                            value={s.value}
                            secureTextEntry={
                              !s.isPasswordVisible &&
                              (s.name.includes('KEY') ||
                                s.name.includes('SECRET') ||
                                s.name.includes('PASSWORD') ||
                                s.name.includes('TOKEN'))
                            }
                            right={
                              <TextInput.Icon
                                icon={s.isPasswordVisible ? 'eye-off' : 'eye'}
                                onPress={() => {
                                  const newList = [...secretsList];
                                  newList[idx].isPasswordVisible =
                                    !newList[idx].isPasswordVisible;
                                  onSecretsListChange(newList);
                                }}
                              />
                            }
                            onChangeText={v => {
                              const newList = [...secretsList];
                              newList[idx].value = v;
                              onSecretsListChange(newList);
                            }}
                            autoCapitalize="none"
                            autoCorrect={false}
                            dense
                          />
                        </View>
                      ) : (
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            backgroundColor: colors.surfaceVariant,
                            padding: 12,
                            borderRadius: 8,
                          }}
                        >
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 6,
                                flexWrap: 'wrap',
                              }}
                            >
                              <Text
                                variant="bodyMedium"
                                style={{ fontWeight: 'bold' }}
                                numberOfLines={1}
                              >
                                {s.name || 'Untitled Secret'}
                              </Text>
                            </View>
                            <Text
                              variant="bodySmall"
                              style={{
                                color: colors.onSurfaceVariant,
                                marginTop: 2,
                              }}
                            >
                              Custom Environment Variable
                            </Text>
                          </View>

                          <View
                            style={{
                              alignItems: 'center',
                              marginLeft: 'auto',
                              marginRight: -6,
                            }}
                          >
                            <Menu
                              visible={openMenuSecretName === secretKey}
                              onDismiss={() => setOpenMenuSecretName(null)}
                              anchor={
                                <IconButton
                                  icon="dots-vertical"
                                  size={20}
                                  style={{ margin: 0 }}
                                  onPress={() =>
                                    setOpenMenuSecretName(
                                      openMenuSecretName === secretKey ? null : secretKey,
                                    )
                                  }
                                />
                              }
                            >
                              <Menu.Item
                                leadingIcon="pencil"
                                onPress={() => {
                                  setOpenMenuSecretName(null);
                                  const newList = [...secretsList];
                                  newList[idx].isEditing = true;
                                  newList[idx].value = '';
                                  onSecretsListChange(newList);
                                }}
                                title="Edit"
                              />
                              <Divider />
                              <Menu.Item
                                leadingIcon="delete-outline"
                                onPress={() => {
                                  setOpenMenuSecretName(null);
                                  setConfirmDeleteTarget({
                                    name: s.name,
                                    isCustom: true,
                                  });
                                }}
                                title="Delete"
                                titleStyle={{ color: colors.error }}
                              />
                            </Menu>
                            {s.isAlreadyConfigured && (
                              <View style={{ marginTop: -2 }}>
                                <Icon
                                  source="check-circle"
                                  size={15}
                                  color={colors.success}
                                />
                              </View>
                            )}
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
            <Button
              mode="text"
              icon="plus"
              onPress={() =>
                onSecretsListChange([
                  ...secretsList,
                  { name: '', value: '', isCustom: true, isEditing: true },
                ])
              }
              style={{ alignSelf: 'flex-start', marginTop: 8 }}
            >
              Add Custom Secret
            </Button>
          </View>
        )}
      </BaseModal>

      {/* Confirm Delete Secret Modal */}
      <BaseModal
        visible={!!confirmDeleteTarget}
        onDismiss={() => setConfirmDeleteTarget(null)}
        mode="confirm"
        destructive={true}
        icon="delete-alert"
        title="Delete Secret?"
        message={`Are you sure you want to delete "${confirmDeleteTarget?.name}" from your Edge Function secrets? This will remove it from your cloud environment.`}
        confirmText="Delete"
        cancelText="Cancel"
        loading={savingSecretName === confirmDeleteTarget?.name}
        onConfirm={() => {
          if (confirmDeleteTarget) {
            onDeleteSecret(confirmDeleteTarget.name, confirmDeleteTarget.isCustom);
            setConfirmDeleteTarget(null);
          }
        }}
        onCancel={() => setConfirmDeleteTarget(null)}
      />

      {/* Backup Project Picker Modal */}
      <BaseModal
        visible={showBackupPickerModal}
        onDismiss={() => setShowBackupPickerModal(false)}
        title="Select Backup Project"
        subtitle="Choose a secondary project from your Supabase account"
        scrollable={true}
        actions={[
          {
            label: 'Cancel',
            mode: 'outlined',
            onPress: () => setShowBackupPickerModal(false),
            style: { flex: 1 },
          },
        ]}
      >
        <View style={{ gap: 8, paddingVertical: 8 }}>
          {patProjects.filter(p => p.ref !== projectRef).length === 0 ? (
            <View style={{ padding: 16, alignItems: 'center', gap: 8 }}>
              <Icon source="database-remove" size={36} color={colors.onSurfaceVariant} />
              <Text
                variant="bodyMedium"
                style={{
                  textAlign: 'center',
                  color: colors.onSurfaceVariant,
                }}
              >
                No other projects found under this Supabase account. Create a secondary
                project on Supabase to use as a disaster recovery replica.
              </Text>
            </View>
          ) : (
            patProjects
              .filter(p => p.ref !== projectRef)
              .map(project => {
                const isSelected = project.ref === backupProjectRef;
                const isConfiguring = configuringBackupRef === project.ref;
                return (
                  <Pressable
                    key={project.ref}
                    disabled={configuringBackupRef !== null}
                    onPress={() => {
                      setShowBackupPickerModal(false);
                      onConfigureBackupProject?.(project.ref);
                    }}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Surface
                      elevation={isSelected ? 2 : 1}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        backgroundColor: isSelected
                          ? colors.primaryContainer
                          : colors.surfaceVariant,
                        borderWidth: isSelected ? 1.5 : 0,
                        borderColor: colors.primary,
                      }}
                    >
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <View
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                        >
                          <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                            {project.name}
                          </Text>
                          {isSelected && (
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 3,
                                backgroundColor: colors.primary,
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: 10,
                              }}
                            >
                              <Icon
                                source="check-circle"
                                size={12}
                                color={colors.onPrimary}
                              />
                              <Text
                                variant="labelSmall"
                                style={{
                                  color: colors.onPrimary,
                                  fontWeight: 'bold',
                                  fontSize: 10,
                                }}
                              >
                                Active
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text
                          variant="bodySmall"
                          style={{ color: colors.onSurfaceVariant, marginTop: 2 }}
                        >
                          {project.ref} • {project.region || 'global'}
                        </Text>
                      </View>
                      {isConfiguring ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Icon
                          source={isSelected ? 'check-circle' : 'chevron-right'}
                          size={20}
                          color={isSelected ? colors.primary : colors.onSurfaceVariant}
                        />
                      )}
                    </Surface>
                  </Pressable>
                );
              })
          )}
        </View>
      </BaseModal>
    </>
  );
};
