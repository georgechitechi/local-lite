import * as Clipboard from 'expo-clipboard';
import type React from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  Divider,
  HelperText,
  IconButton,
  Menu,
  Text,
  TextInput,
} from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import FilterButtons from '@/shared/components/FilterButtons';
import LoadingCard from '@/shared/components/LoadingCard';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { ProjectUser } from './types';

const ROLE_FILTER_OPTIONS = [
  { label: 'All', value: 'all', icon: 'account-multiple-outline' },
  { label: 'Active', value: 'active', icon: 'account-check-outline' },
  { label: 'Banned', value: 'banned', icon: 'account-cancel-outline' },
  { label: 'Owner', value: 'owner', icon: 'crown-outline' },
];

interface ProjectUsersModalProps {
  visible: boolean;
  onDismiss: () => void;
  projectUsers: ProjectUser[];
  usersLoaded: boolean;
  usersLoading: boolean;
  currentUserId?: string;
  onFetchUsers: () => void;
  onEditUser: (user: ProjectUser) => void;
  onBanToggle: (user: ProjectUser) => void;
  banningUserId: string | null;
  confirmBanUser: ProjectUser | null;
  onSetConfirmBanUser: (user: ProjectUser | null) => void;
}

export const ProjectUsersModal: React.FC<ProjectUsersModalProps> = ({
  visible,
  onDismiss,
  projectUsers,
  usersLoaded,
  usersLoading,
  currentUserId,
  onFetchUsers,
  onEditUser,
  onBanToggle,
  banningUserId,
  confirmBanUser,
  onSetConfirmBanUser,
}) => {
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'active' | 'banned' | 'owner'>(
    'all',
  );

  const filteredUsers = projectUsers.filter(u => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.display_name || '').toLowerCase().includes(q) ||
      ((u as any).phone || '').toLowerCase().includes(q);

    if (!matchesSearch) return false;

    if (roleFilter === 'active') return !u.is_banned && u.mgmt_role !== 'Owner';
    if (roleFilter === 'banned') return u.is_banned;
    if (roleFilter === 'owner') return u.mgmt_role === 'Owner';
    return true;
  });

  return (
    <>
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title="Project Users"
        subtitle="Manage who can access this Supabase project"
        scrollable={true}
      >
        <View>
          <View style={[styles.usersSectionHeader, { marginBottom: 0 }]}>
            <View style={{ flex: 1 }}>
              <Text variant="titleSmall">Project Users List</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {usersLoaded && usersLoading && (
                <ActivityIndicator
                  size={24}
                  color={colors.primary}
                  style={{ marginRight: 8 }}
                />
              )}
              <IconButton
                icon={usersLoaded ? 'refresh' : 'account-group'}
                size={20}
                onPress={onFetchUsers}
                disabled={usersLoading}
              />
            </View>
          </View>

          {!usersLoaded && !usersLoading && (
            <Button
              mode="outlined"
              compact
              icon="account-group"
              onPress={onFetchUsers}
              style={{ marginTop: 4 }}
            >
              Load Project Users
            </Button>
          )}

          {!usersLoaded && usersLoading && (
            <View style={{ height: '100%' }}>
              <LoadingCard iconName="loading" text="Loading users..." />
            </View>
          )}

          {usersLoaded && (
            <View style={{ marginVertical: 8, gap: 8 }}>
              {/* Instant Search Bar */}
              <TextInput
                placeholder="Search by name, email, or phone..."
                value={searchQuery}
                onChangeText={setSearchQuery}
                mode="outlined"
                dense
                style={{ height: 42 }}
                left={<TextInput.Icon icon="magnify" />}
                right={
                  searchQuery ? (
                    <TextInput.Icon icon="close" onPress={() => setSearchQuery('')} />
                  ) : null
                }
              />

              {/* Role Filter Buttons */}
              <FilterButtons
                options={ROLE_FILTER_OPTIONS}
                selectedValue={roleFilter}
                onValueChange={val => setRoleFilter((val as any) || 'all')}
                containerStyle={{
                  backgroundColor: 'transparent',
                  borderBottomWidth: 0,
                  marginTop: 2,
                }}
              />

              {/* User Stats Summary */}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: colors.surfaceVariant,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 6,
                }}
              >
                <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                  Total: {projectUsers.length} • Active:{' '}
                  {projectUsers.filter(u => !u.is_banned).length} • Banned:{' '}
                  {projectUsers.filter(u => u.is_banned).length}
                </Text>
              </View>
            </View>
          )}

          {usersLoaded && projectUsers.length === 0 && (
            <Text
              variant="bodySmall"
              style={{ color: colors.onSurfaceVariant, marginTop: 8 }}
            >
              No other users found on this project.
            </Text>
          )}

          {usersLoaded && projectUsers.length > 0 && filteredUsers.length === 0 && (
            <Text
              variant="bodySmall"
              style={{
                color: colors.onSurfaceVariant,
                marginVertical: 16,
                textAlign: 'center',
              }}
            >
              No users match the search filter.
            </Text>
          )}

          {usersLoaded &&
            filteredUsers.map((u, index) => (
              <View key={u.id}>
                {index > 0 && <Divider style={{ marginVertical: 4 }} />}
                <View style={styles.userRow}>
                  <View style={{ flex: 1 }}>
                    <Text
                      variant="bodyMedium"
                      style={{ fontWeight: '600' }}
                      numberOfLines={1}
                    >
                      {u.display_name || u.email}
                    </Text>
                    {u.display_name && (
                      <Text
                        variant="bodySmall"
                        style={{ color: colors.onSurfaceVariant }}
                      >
                        {u.email}
                      </Text>
                    )}
                    {u.created_at ? (
                      <Text
                        variant="bodySmall"
                        style={{ color: colors.onSurfaceVariant }}
                      >
                        Joined{' '}
                        {new Date(u.created_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.userRowRight}>
                    {u.mgmt_role === 'Owner' ? (
                      // Project owner row: crown badge, no menu
                      <Chip
                        compact
                        icon="crown"
                        style={{ backgroundColor: colors.tertiaryContainer }}
                        textStyle={{
                          color: colors.onTertiaryContainer,
                          fontSize: 11,
                        }}
                      >
                        {u.mgmt_role}
                      </Chip>
                    ) : (
                      <>
                        <Chip
                          compact
                          style={{
                            backgroundColor: u.is_banned
                              ? colors.errorContainer
                              : colors.primaryContainer,
                          }}
                          textStyle={{
                            color: u.is_banned
                              ? colors.onErrorContainer
                              : colors.onPrimaryContainer,
                            fontSize: 11,
                          }}
                        >
                          {u.is_banned ? 'Banned' : 'Active'}
                        </Chip>
                        <Menu
                          visible={openMenuId === u.id}
                          onDismiss={() => setOpenMenuId(null)}
                          anchor={
                            <IconButton
                              icon="dots-vertical"
                              size={20}
                              onPress={() =>
                                setOpenMenuId(openMenuId === u.id ? null : u.id)
                              }
                            />
                          }
                        >
                          <Menu.Item
                            leadingIcon="content-copy"
                            onPress={async () => {
                              setOpenMenuId(null);
                              await Clipboard.setStringAsync(u.id);
                              showSnackbar('User ID copied to clipboard', 'success');
                            }}
                            title="Copy User ID"
                          />
                          <Menu.Item
                            leadingIcon="email-outline"
                            onPress={async () => {
                              setOpenMenuId(null);
                              await Clipboard.setStringAsync(u.email);
                              showSnackbar('User email copied', 'success');
                            }}
                            title="Copy Email"
                          />
                          <Divider />
                          <Menu.Item
                            leadingIcon="account-edit"
                            onPress={() => {
                              setOpenMenuId(null);
                              onEditUser(u);
                            }}
                            title="Edit Profile"
                          />
                          {u.id !== currentUserId && (
                            <>
                              <Divider />
                              <Menu.Item
                                leadingIcon={
                                  u.is_banned ? 'account-check' : 'account-cancel'
                                }
                                onPress={() => {
                                  setOpenMenuId(null);
                                  onSetConfirmBanUser(u);
                                }}
                                title={u.is_banned ? 'Unban User' : 'Ban User'}
                                titleStyle={{
                                  color: u.is_banned ? undefined : colors.error,
                                }}
                              />
                            </>
                          )}
                        </Menu>
                      </>
                    )}
                  </View>
                </View>
              </View>
            ))}
        </View>
      </BaseModal>

      {/* ── Ban / Unban Confirmation Dialog ── */}
      <BaseModal
        visible={!!confirmBanUser}
        onDismiss={() => onSetConfirmBanUser(null)}
        mode="confirm"
        destructive={!confirmBanUser?.is_banned}
        icon={confirmBanUser?.is_banned ? 'account-check' : 'account-cancel'}
        loading={banningUserId === confirmBanUser?.id}
        title={confirmBanUser?.is_banned ? 'Unban User?' : 'Ban User?'}
        message={
          confirmBanUser?.is_banned
            ? `This will restore access for ${confirmBanUser?.email}. They will be able to sign in again.`
            : `This will immediately revoke all access for ${confirmBanUser?.email}. Their active session will be invalidated and they will not be able to sign in again.`
        }
        confirmText={confirmBanUser?.is_banned ? 'Unban' : 'Ban'}
        onConfirm={() => confirmBanUser && onBanToggle(confirmBanUser)}
        onCancel={() => onSetConfirmBanUser(null)}
      >
        {!confirmBanUser?.is_banned && (
          <HelperText type="error" visible style={{ textAlign: 'center' }}>
            ⚠️ This action takes effect immediately and blocks the user project-wide.
          </HelperText>
        )}
      </BaseModal>
    </>
  );
};

const styles = StyleSheet.create({
  usersSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  userRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
