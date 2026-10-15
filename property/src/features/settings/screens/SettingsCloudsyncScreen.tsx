import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Switch, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import {
  ActiveSyncCard,
  AppKeyModal,
  COMMON_KEYS,
  ConfirmDeployModal,
  type DiagnosticsResult,
  decodeConnectionKey,
  EdgeFunctionSecretsModal,
  EditUserProfileModal,
  encodeConnectionKey,
  extractProjectRef,
  OfflineSetupCards,
  OnboardingModal,
  PatManagementModal,
  ProjectDetailsModal,
  type ProjectUser,
  ProjectUsersModal,
  type SecretItem,
  StepOneModal,
} from '@/features/settings/components/cloudsync';
import { BACKUP_PROJECT_STORAGE_KEY } from '@/features/settings/components/cloudsync/types';
import { useAuth } from '@/providers/AuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import LoadingCard from '@/shared/components/LoadingCard';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { WorkflowPollResult } from '@/shared/services/githubActions';
import { pollDeployStatus, triggerDeploy } from '@/shared/services/githubActions';
import { secureStorage } from '@/shared/services/secureStorage';
import {
  type ConnectionTestResult,
  configureBackupReplicaSecrets,
  deleteEdgeFunctionSecrets,
  enableJitAccess,
  getApiKeys,
  getEdgeFunctionSecrets,
  getOrganizationMembers,
  listProjects,
  removeBackupReplicaSecrets,
  type SupabaseProject,
  setEdgeFunctionSecrets,
  supabase,
  testSupabaseConnection,
} from '@/shared/services/supabase';
import { safeReloadApp } from '@/shared/utils/safeReload';
import SqliteInspectorModal from '@/features/settings/components/SqliteInspectorModal';
import { clearAllPersistence } from '@/stores/syncHelper';

const SUPABASE_PAT_KEY = 'supabase_mgmt_pat';

export default function CloudSyncSettings() {
  const router = useRouter();
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const { checkOnline } = useOfflineCheck();
  const { user, session, signOut } = useAuth();
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();

  const [sqliteInspectorVisible, setSqliteInspectorVisible] = useState(false);

  const { isCloudSyncEnabled, enableSync, disableSync } = useLocalSync();
  const { isOwner } = useAccessControl();
  const { selectedBusiness } = useBusiness();

  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [connectionKey, setConnectionKey] = useState('');
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [appKeyDialogVisible, setAppKeyDialogVisible] = useState(false);
  const [appKeyString, setAppKeyString] = useState('');

  // Connection Pre-flight & Live Health Check state
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagResult, setDiagResult] = useState<DiagnosticsResult | null>(null);

  // Test Notification state
  const [testingNotification, setTestingNotification] = useState(false);

  // Project Users state
  const [projectUsers, setProjectUsers] = useState<ProjectUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [banningUserId, setBanningUserId] = useState<string | null>(null);
  const [confirmBanUser, setConfirmBanUser] = useState<ProjectUser | null>(null);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersModalVisible, setUsersModalVisible] = useState(false);

  // User Profile Editing state
  const [editProfileUser, setEditProfileUser] = useState<ProjectUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [updatingProfile, setUpdatingProfile] = useState(false);

  // Project Details Modal State
  const [projectDetailsModalVisible, setProjectDetailsModalVisible] = useState(false);
  const [selectedProject, setSelectedProject] = useState<SupabaseProject | null>(null);

  // Onboarding (BYOD) state
  const [stepOneModalVisible, setStepOneModalVisible] = useState(false);
  const [onboardingModalVisible, setOnboardingModalVisible] = useState(false);
  const [connectionMethod, setConnectionMethod] = useState<'pat' | 'manual' | null>(null);
  const [cachedProjectName, setCachedProjectName] = useState<string | null>(null);
  const [patProjects, setPatProjects] = useState<SupabaseProject[]>([]);
  const [isFetchingProjects, setIsFetchingProjects] = useState(false);
  const [onboardingPatInput, setOnboardingPatInput] = useState('');

  // PAT (Personal Access Token) state
  const [pat, setPat] = useState<string | null>(null);
  const [patInput, setPatInput] = useState('');
  const [patModalVisible, setPatModalVisible] = useState(false);
  const [savingPat, setSavingPat] = useState(false);

  // Edge Function Secrets State
  const [secretsModalVisible, setSecretsModalVisible] = useState(false);
  const [secretsList, setSecretsList] = useState<SecretItem[]>([]);
  const [savingSecretName, setSavingSecretName] = useState<string | null>(null);
  const [fetchingSecrets, setFetchingSecrets] = useState(false);
  const [backupProjectRef, setBackupProjectRef] = useState<string | null>(null);
  const [configuringBackupRef, setConfiguringBackupRef] = useState<string | null>(null);

  // JIT & Deploy State
  const [selectedRef, setSelectedRef] = useState('');
  const [deployLoading, setDeployLoading] = useState(false);
  const [workflowResult, setWorkflowResult] = useState<WorkflowPollResult | null>(null);
  const [triggeredAt, setTriggeredAt] = useState<Date | null>(null);
  const [schemaError, setSchemaError] = useState('');
  const [schemaDone, setSchemaDone] = useState(false);
  const [confirmDeployModalVisible, setConfirmDeployModalVisible] = useState(false);

  // Loading Card State
  const [showLoadingCard, setShowLoadingCard] = useState(false);

  // Load PAT and Backup Project from SecureStore on mount
  useEffect(() => {
    secureStorage.getItem('supabase_active_project_name').then(stored => {
      if (typeof stored === 'string' && stored.trim()) {
        setCachedProjectName(stored.trim());
      }
    });
    secureStorage.getItem(SUPABASE_PAT_KEY).then(async stored => {
      if (typeof stored === 'string' && stored.trim()) {
        const token = stored.trim();
        setPat(token);
        setOnboardingPatInput(token);
        try {
          const projects = await listProjects(token);
          setPatProjects(projects);
          const activeUrl = (supabase as any)?.supabaseUrl;
          const ref = activeUrl ? extractProjectRef(activeUrl) : null;
          if (ref) {
            const match = projects.find(p => p.ref === ref);
            if (match?.name) {
              setCachedProjectName(match.name);
              await secureStorage.setItem('supabase_active_project_name', match.name);
            }
          }
        } catch {
          // Silent fallback on initial mount background fetch
        }
      }
    });
    secureStorage.getItem(BACKUP_PROJECT_STORAGE_KEY).then(stored => {
      if (typeof stored === 'string' && stored.trim()) {
        setBackupProjectRef(stored.trim());
      }
    });
  }, []);

  const handleOpenSecretsModal = async () => {
    if (!checkOnline('Fetching secrets')) return;
    setSecretsModalVisible(true);
    if (!pat) return;
    if (patProjects.length === 0) {
      fetchPatProjects(pat);
    }
    const supabaseUrl = (supabase as any)?.supabaseUrl as string;
    const ref = extractProjectRef(supabaseUrl);
    if (!ref) return;

    try {
      setFetchingSecrets(true);
      const existing = await getEdgeFunctionSecrets(pat, ref);
      const filtered: SecretItem[] = [];

      for (const k of COMMON_KEYS) {
        const existingSecret = existing.find(s => s.name === k.name);
        filtered.push({
          name: k.name,
          value: '',
          isCustom: false,
          description: k.desc,
          required: k.req,
          url: (k as any).url,
          group: (k as any).group,
          isAlreadyConfigured: !!existingSecret,
          isPasswordVisible: false,
        });
      }

      // Preserve any custom secrets created earlier, excluding reserved SUPABASE_* system secrets
      for (const s of existing) {
        if (
          !COMMON_KEYS.some(k => k.name === s.name) &&
          !s.name.toUpperCase().startsWith('SUPABASE_')
        ) {
          filtered.push({
            name: s.name,
            value: '',
            isCustom: true,
            group: 'Custom Secrets',
            isAlreadyConfigured: true,
            isPasswordVisible: false,
          });
        }
      }

      setSecretsList(filtered);
    } catch (e) {
      showSnackbar(
        (e instanceof Error ? e.message : 'Unknown error') ?? 'Failed to fetch secrets',
        'error',
      );
    } finally {
      setFetchingSecrets(false);
    }
  };

  const handleDeleteSecret = async (secretName: string, isCustom?: boolean) => {
    const trimmedName = secretName.trim();
    if (!trimmedName) return;

    if (trimmedName.toUpperCase().startsWith('SUPABASE_')) {
      showSnackbar('System secrets (SUPABASE_*) cannot be deleted.', 'error');
      return;
    }

    const targetItem = secretsList.find(s => s.name === trimmedName);
    const isConfiguredOnCloud = targetItem?.isAlreadyConfigured;

    // If not configured on Supabase (e.g. unsaved draft) or no PAT, just update local state
    if (!isConfiguredOnCloud || !pat) {
      if (isCustom) {
        setSecretsList(prev => prev.filter(s => s.name !== trimmedName));
      } else {
        setSecretsList(prev =>
          prev.map(s =>
            s.name === trimmedName
              ? { ...s, value: '', isEditing: false, isAlreadyConfigured: false }
              : s,
          ),
        );
      }
      return;
    }

    if (!checkOnline('Deleting secret')) return;

    const supabaseUrl = (supabase as any)?.supabaseUrl as string;
    const ref = extractProjectRef(supabaseUrl);
    if (!ref) {
      showSnackbar('Could not determine Project Ref from URL.', 'error');
      return;
    }

    try {
      setSavingSecretName(trimmedName);
      await deleteEdgeFunctionSecrets(pat, ref, [trimmedName]);
      if (isCustom) {
        setSecretsList(prev => prev.filter(s => s.name !== trimmedName));
      } else {
        setSecretsList(prev =>
          prev.map(s =>
            s.name === trimmedName
              ? { ...s, value: '', isEditing: false, isAlreadyConfigured: false }
              : s,
          ),
        );
      }
      showSnackbar(`Secret "${trimmedName}" deleted from edge functions.`, 'success');
    } catch (err: any) {
      showSnackbar(`Failed to delete secret: ${err?.message || 'Error'}`, 'error');
    } finally {
      setSavingSecretName(null);
    }
  };

  const handleSendTestNotification = async (channel: 'email' | 'sms') => {
    if (!checkOnline('Testing notification')) return;
    if (!supabase) return;
    setTestingNotification(true);
    try {
      const token = session?.access_token;
      const target =
        channel === 'email'
          ? user?.email
          : (user as any)?.phone || user?.user_metadata?.phone;
      if (!target) {
        showSnackbar(
          `No ${channel === 'email' ? 'email address' : 'phone number'} found on your user profile.`,
          'warning',
        );
        return;
      }

      const { error } = await supabase.functions.invoke('send-message', {
        body: {
          channel,
          to: target,
          subject: 'Property Admin - Cloud Test Message',
          html: '<p>Your edge function notification secrets are configured and working properly!</p>',
          message: 'Property Admin: Cloud notification test successful!',
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (error) throw error;
      showSnackbar(`Test ${channel.toUpperCase()} sent to ${target}!`, 'success');
    } catch (err: any) {
      showSnackbar(
        `Notification test failed: ${err?.message || 'Error invoking send-message'}`,
        'error',
      );
    } finally {
      setTestingNotification(false);
    }
  };

  const handleSaveSecret = async (name: string, value: string, isCustom?: boolean) => {
    const trimmedName = name.trim();
    const trimmedValue = value.trim();

    if (!trimmedName) {
      showSnackbar('Secret key name is required', 'error');
      return;
    }
    if (trimmedName.toUpperCase().startsWith('SUPABASE_')) {
      showSnackbar('Secrets starting with SUPABASE_ are reserved by Supabase.', 'error');
      return;
    }
    if (!trimmedValue) {
      showSnackbar('Secret value cannot be empty', 'error');
      return;
    }
    if (!checkOnline('Saving secret')) return;
    if (!pat) {
      showSnackbar('Please configure Management API PAT first', 'error');
      return;
    }
    const supabaseUrl = (supabase as any)?.supabaseUrl as string;
    const ref = extractProjectRef(supabaseUrl);
    if (!ref) {
      showSnackbar('Could not determine Project Ref from URL.', 'error');
      return;
    }

    try {
      setSavingSecretName(trimmedName);
      await setEdgeFunctionSecrets(pat, ref, [
        { name: trimmedName, value: trimmedValue },
      ]);
      showSnackbar(`Secret ${trimmedName} saved!`, 'success');
      setSecretsList(prev =>
        prev.map(s =>
          (isCustom ? s.name === name : s.name === trimmedName)
            ? {
                ...s,
                name: trimmedName,
                value: '',
                isEditing: false,
                isAlreadyConfigured: true,
              }
            : s,
        ),
      );
    } catch (e) {
      showSnackbar(
        (e instanceof Error ? e.message : 'Unknown error') ?? 'Failed to update secret',
        'error',
      );
    } finally {
      setSavingSecretName(null);
    }
  };

  const handleConfigureBackupProject = async (targetBackupRef: string) => {
    if (!checkOnline('Configuring backup replica')) return;
    if (!pat) {
      showSnackbar('Please configure Management API PAT first', 'error');
      return;
    }
    const supabaseUrl = (supabase as any)?.supabaseUrl as string;
    const activeRef = extractProjectRef(supabaseUrl);
    if (!activeRef) {
      showSnackbar('Could not determine active Project Ref.', 'error');
      return;
    }

    if (activeRef === targetBackupRef) {
      showSnackbar('Backup replica cannot be the same as your active project.', 'error');
      return;
    }

    try {
      setConfiguringBackupRef(targetBackupRef);
      await configureBackupReplicaSecrets(
        pat,
        activeRef,
        targetBackupRef,
        user?.email ?? undefined,
      );

      await secureStorage.setItem(BACKUP_PROJECT_STORAGE_KEY, targetBackupRef);
      setBackupProjectRef(targetBackupRef);

      // Refresh secrets list to mark BACKUP_* keys as configured
      setSecretsList(prev =>
        prev.map(s => {
          if (
            s.name === 'BACKUP_PROJECT_PAT' ||
            s.name === 'BACKUP_PROJECT_REF' ||
            s.name === 'BACKUP_TARGET_EMAIL'
          ) {
            return {
              ...s,
              value: '',
              isEditing: false,
              isAlreadyConfigured: true,
            };
          }
          return s;
        }),
      );

      const targetProj = patProjects.find(p => p.ref === targetBackupRef);
      showSnackbar(
        `Backup replica configured with "${targetProj?.name || targetBackupRef}"!`,
        'success',
      );
    } catch (err: any) {
      showSnackbar(
        `Failed to configure backup replica: ${err?.message || 'Error'}`,
        'error',
      );
    } finally {
      setConfiguringBackupRef(null);
    }
  };

  const handleDisconnectBackupProject = async () => {
    if (!checkOnline('Disconnecting backup replica')) return;
    if (!pat) return;
    const supabaseUrl = (supabase as any)?.supabaseUrl as string;
    const activeRef = extractProjectRef(supabaseUrl);
    if (!activeRef) return;

    try {
      setConfiguringBackupRef('disconnecting');
      await removeBackupReplicaSecrets(pat, activeRef);
      await secureStorage.removeItem(BACKUP_PROJECT_STORAGE_KEY);
      setBackupProjectRef(null);

      // Update secrets list
      setSecretsList(prev =>
        prev.map(s => {
          if (
            s.name === 'BACKUP_PROJECT_PAT' ||
            s.name === 'BACKUP_PROJECT_REF' ||
            s.name === 'BACKUP_TARGET_EMAIL'
          ) {
            return {
              ...s,
              value: '',
              isEditing: false,
              isAlreadyConfigured: false,
            };
          }
          return s;
        }),
      );

      showSnackbar('Backup replica disconnected from Edge Functions.', 'success');
    } catch (err: any) {
      showSnackbar(
        `Failed to disconnect backup replica: ${err?.message || 'Error'}`,
        'error',
      );
    } finally {
      setConfiguringBackupRef(null);
    }
  };

  const handleRemovePat = async () => {
    await secureStorage.removeItem(SUPABASE_PAT_KEY);
    setPat(null);
    setPatInput('');
    setOnboardingPatInput('');
    setPatProjects([]);
    showSnackbar('Management API token removed.', 'success');
  };

  const handleStartPatOnboarding = () => {
    setConnectionMethod('pat');
    setOnboardingModalVisible(true);
    if (pat) {
      fetchPatProjects(pat);
    }
  };

  const fetchPatProjects = async (tokenOverride?: string) => {
    if (!checkOnline('Fetching projects')) return;
    const token = tokenOverride || onboardingPatInput || pat;
    if (!token?.trim()) {
      showSnackbar('Please enter a Personal Access Token.', 'error');
      return;
    }
    setIsFetchingProjects(true);
    try {
      const projects = await listProjects(token.trim());
      setPatProjects(projects);
      const activeUrl = (supabase as any)?.supabaseUrl;
      const ref = activeUrl ? extractProjectRef(activeUrl) : null;
      if (ref) {
        const match = projects.find(p => p.ref === ref);
        if (match?.name) {
          setCachedProjectName(match.name);
          secureStorage.setItem('supabase_active_project_name', match.name);
        }
      }
      if (projects.length === 0) {
        showSnackbar('No projects found under this account.', 'info');
      }
    } catch (e) {
      showSnackbar(
        (e instanceof Error ? e.message : 'Unknown error') || 'Failed to fetch projects.',
        'error',
      );
    } finally {
      setIsFetchingProjects(false);
    }
  };

  const handleSavePat = async () => {
    if (!patInput.trim()) {
      showSnackbar('Please enter a token.', 'error');
      return;
    }
    setSavingPat(true);
    try {
      const projects = await listProjects(patInput.trim());
      await secureStorage.setItem(SUPABASE_PAT_KEY, patInput.trim());
      setPat(patInput.trim());
      setOnboardingPatInput(patInput.trim());
      setPatProjects(projects);
      showSnackbar('Management token saved!', 'success');
    } catch (e) {
      showSnackbar(
        (e instanceof Error ? e.message : 'Unknown error') || 'Invalid token.',
        'error',
      );
    } finally {
      setSavingPat(false);
    }
  };

  const handleProjectSelect = (projectRef: string) => {
    setSelectedRef(projectRef);
    setWorkflowResult(null);
    setSchemaDone(false);
    setTriggeredAt(null);
    setSchemaError('');
  };

  const handleSwitchProject = async (targetRef: string) => {
    if (!pat) return;
    pauseAutoLock();
    try {
      setDeployLoading(true);
      setShowLoadingCard(true);
      // Allow LoadingCard to render before async work begins
      await new Promise(resolve => setTimeout(resolve, 80));
      const keys = await getApiKeys(pat, targetRef);
      const targetUrl = `https://${targetRef}.supabase.co`;
      await enableSync(targetUrl, keys.publishableKey);
      await clearAllPersistence();
      await signOut({ clearLocalData: false });
      showSnackbar(`Switched to project ${targetRef}!`, 'success');
      await router.replace('/(auth)/login' as any);
    } catch (e) {
      showSnackbar(
        (e instanceof Error ? e.message : 'Unknown error') || 'Failed to switch project.',
        'error',
      );
      setShowLoadingCard(false);
    } finally {
      setDeployLoading(false);
      setShowLoadingCard(false);
      resumeAutoLock();
    }
  };

  const handleConnectOnly = async () => {
    if (!checkOnline('Connecting to database')) return;
    const token = onboardingPatInput || pat;
    if (!token || !selectedRef) return;
    pauseAutoLock();
    try {
      setDeployLoading(true);
      const keys = await getApiKeys(token.trim(), selectedRef);
      const targetUrl = `https://${selectedRef}.supabase.co`;
      await secureStorage.setItem(SUPABASE_PAT_KEY, token.trim());
      setPat(token.trim());
      await enableSync(targetUrl, keys.publishableKey);
      await clearAllPersistence();
      await signOut({ clearLocalData: false });
      showSnackbar('Connected to Supabase! Restarting...', 'success');
      setOnboardingModalVisible(false);
      router.replace('/(auth)/login' as any);
    } catch (err: any) {
      setSchemaError(err?.message ?? 'Failed to fetch API keys or connect.');
    } finally {
      setDeployLoading(false);
      resumeAutoLock();
    }
  };

  const handleConnectOnlyRef = useRef(handleConnectOnly);
  handleConnectOnlyRef.current = handleConnectOnly;

  // Deployment polling effect
  useEffect(() => {
    if (!deployLoading || !triggeredAt) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const result = await pollDeployStatus(triggeredAt);
        if (cancelled) return;
        setWorkflowResult(result);

        if (result.runStatus === 'completed') {
          if (result.runConclusion === 'success') {
            setSchemaDone(true);
            setDeployLoading(false);
            showSnackbar('Database schema deployed successfully!', 'success');
            await handleConnectOnlyRef.current();
          } else {
            setSchemaError('Deployment workflow failed. Check GitHub Actions logs.');
            setDeployLoading(false);
          }
          return;
        }

        timer = setTimeout(poll, 4000);
      } catch (err: any) {
        if (cancelled) return;
        setSchemaError(err?.message ?? 'Polling error');
        setDeployLoading(false);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [deployLoading, triggeredAt, showSnackbar]);

  const handleDeploy = async () => {
    if (!checkOnline('Deploying schema')) return;
    const token = onboardingPatInput || pat;
    if (!token) {
      showSnackbar('Management API token required.', 'error');
      return;
    }
    if (!selectedRef) {
      showSnackbar('No project selected.', 'error');
      return;
    }

    setDeployLoading(true);
    setSchemaError('');
    setSchemaDone(false);
    setWorkflowResult(null);

    try {
      await enableJitAccess(token.trim(), selectedRef);

      await triggerDeploy(token.trim(), selectedRef, token.trim());

      setTriggeredAt(new Date());
    } catch (err: any) {
      setSchemaError(err?.message ?? 'Failed to trigger deployment.');
      setDeployLoading(false);
    }
  };

  const fetchProjectUsers = async () => {
    if (!supabase) return;
    setUsersLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-user-access', {
        body: { action: 'list' },
      });
      if (error) throw error;

      let users: ProjectUser[] = (data?.users || []).map((u: any) => ({
        id: u.id,
        email: u.email,
        display_name: u.display_name,
        phone: u.phone,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        is_banned: u.is_banned,
      }));

      // Enrich with Management API org roles if PAT is available
      if (pat) {
        const supabaseUrl = (supabase as any)?.supabaseUrl as string;
        const ref = extractProjectRef(supabaseUrl);
        if (ref) {
          try {
            const members = await getOrganizationMembers(pat, ref);
            users = users.map(u => {
              const match = members.find(
                m =>
                  m.gotrue_id === u.id ||
                  m.user_id === u.id ||
                  m.primary_email === u.email ||
                  m.email === u.email,
              );
              return match ? { ...u, mgmt_role: match.role_name } : u;
            });
          } catch {}
        }
      }

      // Sort: project owners first, then active users, then banned users
      users.sort((a, b) => {
        if (a.mgmt_role === 'Owner') return -1;
        if (b.mgmt_role === 'Owner') return 1;
        if (a.is_banned === b.is_banned) return 0;
        return a.is_banned ? 1 : -1;
      });

      setProjectUsers(users);
      setUsersLoaded(true);
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to fetch users.', 'error');
    } finally {
      setUsersLoading(false);
    }
  };

  const handleBanToggle = async (targetUser: ProjectUser) => {
    if (!supabase) return;
    const action = targetUser.is_banned ? 'unban' : 'ban';
    setBanningUserId(targetUser.id);
    try {
      const { error } = await supabase.functions.invoke('manage-user-access', {
        body: { action, target_user_id: targetUser.id },
      });
      if (error) throw error;
      showSnackbar(
        `User ${targetUser.email} has been ${action === 'ban' ? 'banned' : 'unbanned'}.`,
        'success',
      );
      setProjectUsers(prev =>
        prev.map(u =>
          u.id === targetUser.id ? { ...u, is_banned: action === 'ban' } : u,
        ),
      );
    } catch (err: any) {
      showSnackbar(err?.message || `Failed to ${action} user.`, 'error');
    } finally {
      setBanningUserId(null);
      setConfirmBanUser(null);
    }
  };

  const openEditProfile = (targetUser: ProjectUser) => {
    setEditProfileUser(targetUser);
    setEditDisplayName(targetUser.display_name || '');
    setEditEmail(targetUser.email || '');
    setEditPhone(targetUser.phone || '');
  };

  const handleUpdateProfile = async () => {
    if (!supabase || !editProfileUser) return;
    setUpdatingProfile(true);
    try {
      const { error } = await supabase.functions.invoke('manage-user-access', {
        body: {
          action: 'update',
          target_user_id: editProfileUser.id,
          display_name: editDisplayName.trim() || undefined,
          email: editEmail.trim() || undefined,
          phone: editPhone.trim() || undefined,
        },
      });
      if (error) throw error;
      showSnackbar('User profile updated!', 'success');
      setProjectUsers(prev =>
        prev.map(u =>
          u.id === editProfileUser.id
            ? {
                ...u,
                display_name: editDisplayName.trim() || u.display_name,
                email: editEmail.trim() || u.email,
                phone: editPhone.trim() || u.phone,
              }
            : u,
        ),
      );
      setEditProfileUser(null);
    } catch (err: any) {
      showSnackbar(err?.message || 'Failed to update profile.', 'error');
    } finally {
      setUpdatingProfile(false);
    }
  };

  const handleToggleSync = async (value: boolean) => {
    if (!value) {
      pauseAutoLock();
      try {
        setLoading(true);
        await disableSync();
        await signOut();
        showSnackbar('Cloud sync disabled. Operating in offline mode.', 'success');
      } catch (_e) {
        showSnackbar('Failed to disable cloud sync', 'error');
      } finally {
        setLoading(false);
        resumeAutoLock();
      }
    }
  };

  const handleTestConnection = async () => {
    let targetUrl = url.trim();
    let targetKey = key.trim();

    if (!isAdvancedMode && connectionKey) {
      const decoded = decodeConnectionKey(connectionKey.trim());
      if (decoded.u && decoded.k) {
        targetUrl = decoded.u;
        targetKey = decoded.k;
      } else {
        showSnackbar('Invalid Connection Key format', 'error');
        return;
      }
    }

    if (!targetUrl || !targetKey) {
      showSnackbar('Please provide connection details to test', 'warning');
      return;
    }

    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await testSupabaseConnection(targetUrl, targetKey);
      setTestResult(res);
      if (res.ok) {
        showSnackbar(`Connection verified! Latency: ${res.latencyMs}ms`, 'success');
      } else if (res.isPaused) {
        showSnackbar('Project is paused on Supabase.', 'error');
      } else {
        showSnackbar(res.error || 'Connection test failed', 'error');
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        error: err?.message || 'Failed to ping host',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleRunDiagnostics = async () => {
    if (!checkOnline('Running diagnostics')) return;
    if (!supabase) return;
    setDiagLoading(true);
    try {
      const supabaseUrl = (supabase as any)?.supabaseUrl as string;
      const supabaseKey = (supabase as any)?.supabaseKey as string;
      const res = await testSupabaseConnection(supabaseUrl, supabaseKey);

      let authHealthy = false;
      try {
        const { data } = await supabase.auth.getSession();
        authHealthy = !!data?.session;
      } catch {}

      // Test Postgres query directly through the initialized Supabase client
      let dbHealthy = res.ok;
      let dbIssue = res.error || '';

      try {
        const { error: pgError } = await supabase.from('settings').select('id').limit(1);

        if (!pgError) {
          dbHealthy = true;
          dbIssue = '';
        } else if (
          pgError.code === 'PGRST116' ||
          pgError.code === 'PGRST301' ||
          pgError.code === '42501' ||
          pgError.message?.includes('permission') ||
          pgError.message?.includes('JWT')
        ) {
          // PostgREST/Postgres responded with an RLS or schema response, meaning the database is online
          dbHealthy = true;
          dbIssue = '';
        } else if (
          pgError.message?.includes('FetchError') ||
          pgError.message?.includes('Network') ||
          pgError.message?.includes('Failed to fetch')
        ) {
          dbHealthy = false;
          dbIssue = pgError.message;
        }
      } catch (e: any) {
        if (!dbHealthy) {
          dbIssue = e?.message || dbIssue;
        }
      }

      const issues: string[] = [];
      if (!dbHealthy) {
        issues.push(`Database: ${dbIssue || 'Postgres unreachable or paused'}`);
      }
      if (!authHealthy) {
        issues.push('Auth: No active session (please sign in).');
      }
      if (res.latencyMs > 2000) {
        issues.push(`Network: High latency (${res.latencyMs}ms).`);
      }

      setDiagResult({
        restLatency: res.latencyMs,
        authHealthy,
        dbHealthy,
        checkedAt: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        issues: issues.length > 0 ? issues : undefined,
      });

      if (issues.length === 0) {
        showSnackbar(`Diagnostics passed: ${res.latencyMs}ms latency`, 'success');
      } else {
        showSnackbar('Diagnostics detected issues.', 'warning');
      }
    } catch (err: any) {
      showSnackbar(`Diagnostics error: ${err?.message || 'Failed to ping'}`, 'error');
    } finally {
      setDiagLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!checkOnline('Connecting to cloud')) return;
    let targetUrl = url.trim();
    let targetKey = key.trim();

    if (!isAdvancedMode && connectionKey) {
      const decoded = decodeConnectionKey(connectionKey.trim());
      if (decoded.u && decoded.k) {
        targetUrl = decoded.u;
        targetKey = decoded.k;
      } else {
        showSnackbar('Invalid Connection Key format', 'error');
        return;
      }
    }

    if (!targetUrl || !targetKey) {
      showSnackbar('Please provide connection details', 'error');
      return;
    }

    pauseAutoLock();
    try {
      setLoading(true);
      const client = await enableSync(targetUrl, targetKey);
      if (client) {
        showSnackbar('Cloud sync configured! Restarting app...', 'success');
        await clearAllPersistence();
        await signOut({ clearLocalData: false });
        setUrl('');
        setKey('');
        return true;
      } else {
        showSnackbar('Failed to initialize client with provided details', 'error');
      }
    } catch (_error) {
      showSnackbar('Connection error. Check your URL and Key.', 'error');
    } finally {
      setLoading(false);
      resumeAutoLock();
    }
    return false;
  };

  return (
    <>
      <KeyboardScroll
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        extraHeight={16}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text variant="titleMedium">Enable Cloud Sync</Text>
            <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
              {isCloudSyncEnabled
                ? 'Your data is syncing with a custom Supabase project.'
                : 'Your data is completely local to this device.'}
            </Text>
          </View>
          <Switch
            value={isCloudSyncEnabled}
            onValueChange={handleToggleSync}
            disabled={loading}
          />
        </View>

        {isCloudSyncEnabled &&
        user &&
        session &&
        user.app_metadata?.provider !== 'offline' ? (
          <ActiveSyncCard
            user={user}
            supabaseUrl={(supabase as any)?.supabaseUrl}
            projectName={
              patProjects.find(
                p => p.ref === extractProjectRef((supabase as any)?.supabaseUrl || ''),
              )?.name || cachedProjectName
            }
            isOwner={isOwner || !selectedBusiness || !!pat}
            hasPat={!!pat}
            diagLoading={diagLoading}
            diagResult={diagResult}
            onShowAppKey={() => {
              if (supabase) {
                const encoded = encodeConnectionKey(
                  (supabase as any).supabaseUrl,
                  (supabase as any).supabaseKey,
                );
                setAppKeyString(encoded);
                setAppKeyDialogVisible(true);
              }
            }}
            onOpenPatModal={() => {
              setPatInput('');
              setPatModalVisible(true);
              if (pat) {
                fetchPatProjects(pat);
              }
            }}
            onRunDiagnostics={handleRunDiagnostics}
            onOpenUsersModal={() => {
              setUsersModalVisible(true);
              if (!usersLoaded && !usersLoading) {
                fetchProjectUsers();
              }
            }}
            onInspectSqlite={() => setSqliteInspectorVisible(true)}
            onResetProject={async () => {
              try {
                await clearAllPersistence();
                await safeReloadApp();
              } catch (e) {
                showSnackbar(
                  (e instanceof Error ? e.message : 'Unknown error') ||
                    'Failed to clear local storage.',
                  'error',
                );
              }
            }}
          />
        ) : isCloudSyncEnabled &&
          (!user || !session || user.app_metadata?.provider === 'offline') ? (
          <View
            style={[styles.activeContainer, { backgroundColor: colors.primaryContainer }]}
          >
            <Text variant="bodyMedium" style={{ marginBottom: 12 }}>
              Cloud sync is configured. Please sign in to sync your data.
            </Text>
            <Button mode="contained" onPress={() => router.push('/(auth)/login' as any)}>
              Sign In to Sync
            </Button>
          </View>
        ) : (
          <OfflineSetupCards
            pat={pat}
            onStartPatOnboarding={handleStartPatOnboarding}
            onStartManualConnection={() => {
              setConnectionMethod('manual');
              setOnboardingModalVisible(true);
            }}
            onOpenStepOneModal={() => setStepOneModalVisible(true)}
          />
        )}
      </KeyboardScroll>

      {showLoadingCard && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.background,
            zIndex: 100,
          }}
        >
          <LoadingCard
            iconName="swap-horizontal"
            text="Switching project..."
            textColor={colors.primary}
            iconColor={colors.primary}
          />
        </View>
      )}

      {/* Step 1 Create Project Modal */}
      <StepOneModal
        visible={stepOneModalVisible}
        onDismiss={() => setStepOneModalVisible(false)}
        onProceed={handleStartPatOnboarding}
      />

      {/* Onboarding Modal */}
      <OnboardingModal
        visible={onboardingModalVisible}
        onDismiss={() => setOnboardingModalVisible(false)}
        connectionMethod={connectionMethod}
        onboardingPatInput={onboardingPatInput}
        onOnboardingPatInputChange={setOnboardingPatInput}
        onOpenStepOneModal={() => setStepOneModalVisible(true)}
        isFetchingProjects={isFetchingProjects}
        onFetchPatProjects={() => fetchPatProjects()}
        hasPat={!!pat}
        onRemovePat={handleRemovePat}
        patProjects={patProjects}
        selectedRef={selectedRef}
        onSelectProjectRef={handleProjectSelect}
        schemaError={schemaError}
        workflowResult={workflowResult}
        schemaDone={schemaDone}
        deployLoading={deployLoading}
        onConnectOnly={handleConnectOnly}
        onRequestDeployConfirm={() => setConfirmDeployModalVisible(true)}
        isAdvancedMode={isAdvancedMode}
        onToggleAdvancedMode={() => setIsAdvancedMode(!isAdvancedMode)}
        connectionKey={connectionKey}
        onConnectionKeyChange={setConnectionKey}
        url={url}
        onUrlChange={setUrl}
        key={key}
        onKeyChange={setKey}
        loading={loading}
        testResult={testResult}
        testingConnection={testingConnection}
        onTestConnection={handleTestConnection}
        onConnect={async () => {
          if (await handleConnect()) setOnboardingModalVisible(false);
        }}
      />

      {/* App Key Modal */}
      <AppKeyModal
        visible={appKeyDialogVisible}
        onDismiss={() => setAppKeyDialogVisible(false)}
        appKeyString={appKeyString}
        supabaseUrl={(supabase as any)?.supabaseUrl}
      />

      {/* Project Users Modal */}
      <ProjectUsersModal
        visible={usersModalVisible}
        onDismiss={() => setUsersModalVisible(false)}
        projectUsers={projectUsers}
        usersLoaded={usersLoaded}
        usersLoading={usersLoading}
        currentUserId={user?.id}
        onFetchUsers={fetchProjectUsers}
        onEditUser={openEditProfile}
        onBanToggle={handleBanToggle}
        banningUserId={banningUserId}
        confirmBanUser={confirmBanUser}
        onSetConfirmBanUser={setConfirmBanUser}
      />

      {/* Edit Profile Modal */}
      <EditUserProfileModal
        user={editProfileUser}
        visible={!!editProfileUser}
        displayName={editDisplayName}
        email={editEmail}
        phone={editPhone}
        loading={updatingProfile}
        onDisplayNameChange={setEditDisplayName}
        onEmailChange={setEditEmail}
        onPhoneChange={setEditPhone}
        onSave={handleUpdateProfile}
        onDismiss={() => setEditProfileUser(null)}
      />

      {/* Management API — PAT Modal */}
      <PatManagementModal
        visible={patModalVisible}
        onDismiss={() => setPatModalVisible(false)}
        pat={pat}
        patInput={patInput}
        onPatInputChange={setPatInput}
        savingPat={savingPat}
        onSavePat={handleSavePat}
        onRemovePat={handleRemovePat}
        isFetchingProjects={isFetchingProjects}
        patProjects={patProjects}
        onRefreshProjects={() => pat && fetchPatProjects(pat)}
        onOpenSecretsModal={handleOpenSecretsModal}
        onSelectProject={p => {
          setSelectedProject(p);
          setSelectedRef(p.ref);
          setProjectDetailsModalVisible(true);
        }}
        currentSupabaseUrl={(supabase as any)?.supabaseUrl}
        deployLoading={deployLoading}
      />

      {/* Project Details Modal */}
      <ProjectDetailsModal
        visible={projectDetailsModalVisible}
        onDismiss={() => setProjectDetailsModalVisible(false)}
        selectedProject={selectedProject}
        currentProjectRef={extractProjectRef((supabase as any)?.supabaseUrl || '')}
        deployLoading={deployLoading}
        workflowResult={workflowResult}
        schemaDone={schemaDone}
        schemaError={schemaError}
        selectedRef={selectedRef}
        onSwitchProject={ref => {
          setProjectDetailsModalVisible(false);
          setPatModalVisible(false);
          handleSwitchProject(ref);
        }}
        onRequestDeploy={ref => {
          setSelectedRef(ref);
          setWorkflowResult(null);
          setSchemaDone(false);
          setTriggeredAt(null);
          setSchemaError('');
          setConfirmDeployModalVisible(true);
        }}
        backupProjectRef={backupProjectRef}
        configuringBackupRef={configuringBackupRef}
        onSetAsBackupReplica={handleConfigureBackupProject}
      />

      {/* Confirm Deploy Dialog */}
      <ConfirmDeployModal
        visible={confirmDeployModalVisible}
        onDismiss={() => setConfirmDeployModalVisible(false)}
        onConfirm={() => {
          setConfirmDeployModalVisible(false);
          handleDeploy();
        }}
      />

      {/* Edge Function Secrets Modal */}
      <EdgeFunctionSecretsModal
        visible={secretsModalVisible}
        onDismiss={() => setSecretsModalVisible(false)}
        projectRef={extractProjectRef((supabase as any)?.supabaseUrl || '')}
        fetchingSecrets={fetchingSecrets}
        savingSecretName={savingSecretName}
        secretsList={secretsList}
        onSecretsListChange={setSecretsList}
        onSaveSecret={handleSaveSecret}
        onDeleteSecret={handleDeleteSecret}
        testingNotification={testingNotification}
        onSendTestNotification={handleSendTestNotification}
        pat={pat}
        patProjects={patProjects}
        backupProjectRef={backupProjectRef}
        configuringBackupRef={configuringBackupRef}
        onConfigureBackupProject={handleConfigureBackupProject}
        onDisconnectBackupProject={handleDisconnectBackupProject}
        onOpenPatManagement={() => setPatModalVisible(true)}
      />

      <SqliteInspectorModal
        visible={sqliteInspectorVisible}
        onDismiss={() => setSqliteInspectorVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerText: {
    flex: 1,
    paddingRight: 16,
  },
  activeContainer: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
  },
});
