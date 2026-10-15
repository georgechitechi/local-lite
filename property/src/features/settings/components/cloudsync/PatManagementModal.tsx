import type React from 'react';
import { Linking, View } from 'react-native';
import { Button, HelperText, List, Text, TextInput } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import LoadingCard from '@/shared/components/LoadingCard';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { SupabaseProject } from '@/shared/services/supabase';
import { extractProjectRef } from './types';

interface PatManagementModalProps {
  visible: boolean;
  onDismiss: () => void;
  pat: string | null;
  patInput: string;
  onPatInputChange: (v: string) => void;
  savingPat: boolean;
  onSavePat: () => void;
  onRemovePat: () => void;
  isFetchingProjects: boolean;
  patProjects: SupabaseProject[];
  onRefreshProjects: () => void;
  onOpenSecretsModal: () => void;
  onSelectProject: (project: SupabaseProject) => void;
  currentSupabaseUrl?: string;
  deployLoading: boolean;
}

export const PatManagementModal: React.FC<PatManagementModalProps> = ({
  visible,
  onDismiss,
  pat,
  patInput,
  onPatInputChange,
  savingPat,
  onSavePat,
  onRemovePat,
  isFetchingProjects,
  patProjects,
  onRefreshProjects,
  onOpenSecretsModal,
  onSelectProject,
  currentSupabaseUrl,
  deployLoading,
}) => {
  const colors = useThemeColors();
  const currentRef = currentSupabaseUrl ? extractProjectRef(currentSupabaseUrl) : null;

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Management API Token"
      subtitle="Supabase Personal Access Token"
      scrollable={true}
      actions={
        pat
          ? [
              {
                label: 'Remove Token',
                mode: 'outlined',
                onPress: () => {
                  onRemovePat();
                  onDismiss();
                },
                style: { flex: 1 },
              },
              {
                label: 'Refresh',
                mode: 'contained',
                icon: 'refresh',
                loading: isFetchingProjects,
                disabled: isFetchingProjects,
                onPress: onRefreshProjects,
                style: { flex: 1 },
              },
            ]
          : [
              {
                label: 'Cancel',
                mode: 'outlined',
                onPress: onDismiss,
                style: { flex: 1 },
              },
              {
                label: 'Save Token',
                mode: 'contained',
                loading: savingPat,
                onPress: onSavePat,
                style: { flex: 1 },
              },
            ]
      }
    >
      {pat ? (
        <View>
          <View
            style={{
              backgroundColor: colors.primaryContainer,
              borderWidth: 1,
              borderColor: colors.primary,
              padding: 12,
              borderRadius: 8,
              marginTop: 16,
              marginBottom: 16,
            }}
          >
            <Text
              variant="labelMedium"
              style={{ color: colors.primary, marginBottom: 2 }}
            >
              Management API: Connected
            </Text>
            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
              Token is stored securely on this device. Project owner and member roles will
              appear in the users list.
            </Text>
          </View>

          <Button
            mode="outlined"
            icon="key-chain"
            onPress={() => {
              onDismiss();
              onOpenSecretsModal();
            }}
            style={{ marginBottom: 16 }}
          >
            Manage Edge Function Secrets
          </Button>

          {isFetchingProjects && (
            <View style={{ paddingVertical: 24 }}>
              <LoadingCard
                iconName="database-search"
                text="Fetching your projects..."
                backgroundColor="transparent"
              />
            </View>
          )}

          {patProjects.length > 0 && !isFetchingProjects && (
            <View>
              <Text variant="titleSmall" style={{ marginBottom: 8 }}>
                Switch Project
              </Text>
              {patProjects.map((p: SupabaseProject) => {
                const isCurrent = p.ref === currentRef;
                return (
                  <List.Item
                    key={p.id}
                    title={p.name}
                    description={`${p.ref}${p.region ? ` • ${p.region}` : ''}`}
                    onPress={() => onSelectProject(p)}
                    left={props => <List.Icon {...props} icon="database" />}
                    right={props => (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        {isCurrent && (
                          <List.Icon
                            {...props}
                            icon="check-decagram"
                            color={colors.primary}
                          />
                        )}
                      </View>
                    )}
                    style={{
                      backgroundColor: isCurrent
                        ? colors.primaryContainer
                        : colors.surfaceVariant,
                      marginBottom: 8,
                      borderRadius: 8,
                      opacity: deployLoading && !isCurrent ? 0.5 : 1,
                    }}
                    disabled={deployLoading}
                  />
                );
              })}
            </View>
          )}
        </View>
      ) : (
        <>
          <TextInput
            label="Personal Access Token"
            value={patInput}
            onChangeText={onPatInputChange}
            mode="outlined"
            style={{ marginBottom: 8 }}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="sbp_••••••••••••••••"
          />
          <HelperText type="info">
            Generate a token at{' '}
            <Text
              style={{ color: colors.primary, textDecorationLine: 'underline' }}
              onPress={() =>
                Linking.openURL('https://supabase.com/dashboard/account/tokens')
              }
            >
              supabase.com/dashboard/account/tokens
            </Text>
          </HelperText>
        </>
      )}
    </BaseModal>
  );
};
