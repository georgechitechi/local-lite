import type React from 'react';
import { Linking, View } from 'react-native';
import { ActivityIndicator, Button, HelperText, Icon, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { WorkflowPollResult } from '@/shared/services/githubActions';
import type { SupabaseProject } from '@/shared/services/supabase';

interface ProjectDetailsModalProps {
  visible: boolean;
  onDismiss: () => void;
  selectedProject: SupabaseProject | null;
  currentProjectRef: string | null;
  deployLoading: boolean;
  workflowResult: WorkflowPollResult | null;
  schemaDone: boolean;
  schemaError: string;
  selectedRef: string;
  onSwitchProject: (ref: string) => void;
  onRequestDeploy: (ref: string) => void;
  backupProjectRef?: string | null;
  configuringBackupRef?: string | null;
  onSetAsBackupReplica?: (ref: string) => void;
}

export const ProjectDetailsModal: React.FC<ProjectDetailsModalProps> = ({
  visible,
  onDismiss,
  selectedProject,
  currentProjectRef,
  deployLoading,
  workflowResult,
  schemaDone,
  schemaError,
  selectedRef,
  onSwitchProject,
  onRequestDeploy,
  backupProjectRef,
  configuringBackupRef,
  onSetAsBackupReplica,
}) => {
  const colors = useThemeColors();

  const isPaused =
    selectedProject?.status?.toLowerCase().includes('inactive') ||
    selectedProject?.status?.toLowerCase().includes('pause');

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title={selectedProject?.name || 'Project Details'}
      subtitle={selectedProject?.ref || ''}
      scrollable={true}
      actions={[
        {
          label: 'Close',
          mode: 'outlined',
          onPress: onDismiss,
          style: { flex: 1 },
        },
      ]}
    >
      <View style={{ marginTop: 8 }}>
        {isPaused && (
          <View
            style={{
              backgroundColor: colors.errorContainer,
              padding: 12,
              borderRadius: 8,
              marginBottom: 12,
              gap: 6,
            }}
          >
            <Text
              variant="labelMedium"
              style={{ color: colors.onErrorContainer, fontWeight: 'bold' }}
            >
              ⚠️ Database Project is Paused
            </Text>
            <Text variant="bodySmall" style={{ color: colors.onErrorContainer }}>
              Supabase pauses inactive free-tier projects. Restore it from your Supabase
              dashboard before deploying or connecting.
            </Text>
            <Button
              mode="contained"
              compact
              buttonColor={colors.error}
              textColor={colors.onError}
              onPress={() =>
                Linking.openURL(
                  `https://supabase.com/dashboard/project/${selectedProject?.ref}`,
                )
              }
              style={{ alignSelf: 'flex-start', marginTop: 4 }}
            >
              Open Dashboard to Resume
            </Button>
          </View>
        )}

        <View style={{ gap: 12 }}>
          <Button
            mode="contained"
            icon="swap-horizontal"
            disabled={deployLoading || selectedProject?.ref === currentProjectRef}
            onPress={() => {
              if (selectedProject?.ref) {
                onSwitchProject(selectedProject.ref);
              }
            }}
          >
            Switch to this Project
          </Button>

          <Button
            mode="outlined"
            icon="cloud-upload"
            disabled={deployLoading}
            onPress={() => {
              if (selectedProject?.ref) {
                onRequestDeploy(selectedProject.ref);
              }
            }}
          >
            Reset DB & Deploy Schema
          </Button>

          {selectedProject?.ref !== currentProjectRef && onSetAsBackupReplica && (
            <Button
              mode={
                backupProjectRef === selectedProject?.ref ? 'outlined' : 'contained-tonal'
              }
              icon="database-sync"
              loading={configuringBackupRef === selectedProject?.ref}
              disabled={
                deployLoading ||
                configuringBackupRef !== null ||
                backupProjectRef === selectedProject?.ref
              }
              onPress={() => {
                if (selectedProject?.ref) {
                  onSetAsBackupReplica(selectedProject.ref);
                }
              }}
            >
              {backupProjectRef === selectedProject?.ref
                ? 'Configured as Backup Replica'
                : 'Set as Backup Replica Project'}
            </Button>
          )}
        </View>

        {schemaError ? (
          <HelperText type="error" visible style={{ marginTop: 16 }}>
            {schemaError}
          </HelperText>
        ) : null}

        {workflowResult && selectedRef === selectedProject?.ref ? (
          <View
            style={{
              marginTop: 16,
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
                style={{ color: colors.success, marginTop: 8, fontWeight: 'bold' }}
              >
                Deployment Complete!
              </Text>
            )}
          </View>
        ) : null}
      </View>
    </BaseModal>
  );
};
