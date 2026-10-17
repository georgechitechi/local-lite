import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import {
  Avatar,
  Button,
  Divider,
  HelperText,
  IconButton,
  List,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import { useOfflineImageSync } from '@/shared/components/CachedImage';
import ContactPicker from '@/shared/components/ContactPicker';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import LoadingCard from '@/shared/components/LoadingCard';
import { useNetworkStatus } from '@/shared/hooks/useNetworkStatus';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useCoreMutations, useProfile } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { ensureUserProfile } from '@/shared/services/auth';
import { deleteImage, uploadImage } from '@/shared/services/fileUpload';
import { supabase } from '@/shared/services/supabase';
import { normalizePhoneNumber } from '@/shared/utils/helper';
import { validateFields, validations } from '@/shared/utils/validations';

interface ProfileData {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatar_url: string;
  user_id?: string;
}

interface ProfileErrors {
  name?: string;
  phone?: string;
}

export default function Profile() {
  const { user } = useAuth();

  const colors = useThemeColors();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileData>({
    id: '',
    name: '',
    email: '',
    phone: '',
    avatar_url: '',
  });
  const [errors, setErrors] = useState<ProfileErrors>({});

  // Current user ID
  const [userId, setUserId] = useState<string | null>(null);
  const { showSnackbar } = useSnackbar();
  const isOnline = useNetworkStatus();
  const { checkOnline } = useOfflineCheck();
  const { update } = useCoreMutations();
  const currentProfile = useProfile(userId);
  const storeProfile = currentProfile;

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const u = user;
        if (u) {
          setUserId(u.id);
          // Ensure profile exists (local-first: checks store first, then database)
          // This will create profile in local store if it doesn't exist
          const profileData = await ensureUserProfile(u);

          // Set initial email from user
          setProfile(prev => {
            const data = profileData?.profile;
            return {
              ...prev,
              email: u.email || '',
              // If profile was just created, use its data
              ...(data
                ? {
                    id: data.user_id || u.id,
                    name: data.name || '',
                    phone: data.phone || '',
                    avatar_url: data.avatar_url || '',
                  }
                : {}),
            };
          });
        }
      } catch (error) {
        console.error('Error loading profile:', error);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [user]);

  // Offline image sync for avatar
  const { localUri: avatarUri } = useOfflineImageSync(
    storeProfile?.avatar_url || profile.avatar_url || undefined,
  );

  // Sync local state when store profile changes (from sync or updates)
  useEffect(() => {
    if (storeProfile && userId) {
      const avatarUrl = storeProfile.avatar_url;

      setProfile(prev => ({
        ...prev,
        id: storeProfile.user_id || userId,
        name: storeProfile.name || prev.email?.split('@')[0] || 'User',
        email: storeProfile.email || prev.email || '',
        phone: storeProfile.phone || '',
        // Handle null/undefined avatar_url properly - preserve existing if new one is null
        avatar_url: avatarUrl || prev.avatar_url || '',
      }));
    }
  }, [storeProfile, userId]);

  const validateForm = (): boolean => {
    const result = validateFields(profile, {
      name: validations.required,
      phone: validations.combine(validations.required, validations.phone),
    });
    setErrors(result.errors);
    return result.isValid;
  };

  const handleUpdateProfile = async () => {
    if (!validateForm() || !userId) return;

    if (!checkOnline('Updating your profile')) return;

    setSaving(true);
    try {
      // Profile should already exist in store (ensured on load)
      // But handle edge case where it might not exist
      const existingProfile = currentProfile;

      if (!existingProfile) {
        if (user) {
          await ensureUserProfile(user);
        }
      }

      const normalizedPhone = normalizePhoneNumber(profile.phone);

      const { error: authError } = await supabase.auth.updateUser({
        email: profile.email,
        data: {
          name: profile.name,
          phone: normalizedPhone,
        },
      });

      if (authError) throw authError;

      if (currentProfile?.id) {
        await update('profiles', currentProfile.id, {
          name: profile.name,
          phone: normalizedPhone,
          email: profile.email,
        });
      }

      showSnackbar('Profile updated successfully', 'success');
    } catch (error) {
      console.error('Error updating profile:', error);
      showSnackbar((error as Error).message || 'Failed to update profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  const { pauseAutoLock, resumeAutoLock } = useIdleLock();

  const handleImagePick = async () => {
    if (!checkOnline('Updating your profile picture')) return;

    pauseAutoLock();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await uploadAvatar(result.assets[0]);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      showSnackbar('Failed to pick image', 'error');
    } finally {
      resumeAutoLock();
    }
  };

  const uploadAvatar = async (imageAsset: ImagePicker.ImagePickerAsset) => {
    try {
      setSaving(true);
      if (!userId) throw new Error('No user found');

      // Ensure profile exists before updating avatar
      const existingProfile = currentProfile;
      if (!existingProfile) {
        if (user) {
          await ensureUserProfile(user);
        }
      }

      // Delete old avatar if exists (only when online)
      // When offline, the old avatar will remain until the new one is uploaded
      if (profile.avatar_url && isOnline) {
        try {
          const oldPath = profile.avatar_url.split('/').pop();
          if (oldPath && !oldPath.startsWith('file://')) {
            // Only delete if it's a remote URL, not a local file
            await deleteImage('public-assets', `avatars/${userId}/${oldPath}`);
          }
        } catch (deleteError) {
          // Continue even if deletion fails (might not exist or network error)
          console.warn('Error deleting old avatar:', deleteError);
        }
      }

      // Upload new avatar with offline support
      const { publicUrl } = await uploadImage(
        imageAsset,
        'public-assets',
        'avatars',
        userId,
        { offlineSupport: true }, // Enable offline upload queue
      );

      // Update auth user metadata
      await supabase.auth.updateUser({
        data: { avatar_url: publicUrl },
      });

      // Update profile with new avatar URL in local store (will sync automatically)
      if (currentProfile?.id) {
        await update('profiles', currentProfile.id, {
          avatar_url: publicUrl,
        });
      }

      // Also update local state immediately for instant UI update
      setProfile(prev => ({
        ...prev,
        avatar_url: publicUrl,
      }));

      showSnackbar('Profile picture updated successfully', 'success');
    } catch (error) {
      console.error('Error uploading avatar:', error);
      showSnackbar('Failed to upload profile picture', 'error');
    } finally {
      setSaving(false);
    }
  };

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      if (user) {
        await ensureUserProfile(user);
      }
    } catch (error) {
      console.error('Error refreshing profile:', error);
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  if (loading) {
    return <LoadingCard iconName="account" text="Loading profile..." />;
  }

  return (
    <KeyboardScroll
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View>
        {/* Header Section */}
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            <Avatar.Image
              size={100}
              source={
                (storeProfile?.avatar_url || profile.avatar_url) &&
                (storeProfile?.avatar_url || profile.avatar_url).trim() !== ''
                  ? { uri: avatarUri || storeProfile?.avatar_url || profile.avatar_url }
                  : require('../../../../assets/default-avatar.png')
              }
            />
            <IconButton
              icon="camera"
              mode="contained-tonal"
              size={24}
              onPress={handleImagePick}
              style={[styles.avatarEditBtn, { backgroundColor: colors.surface }]}
              loading={saving}
            />
          </View>
          <Text variant="headlineSmall" style={styles.userName}>
            {profile.name}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            {profile.email}
          </Text>
        </View>

        {/* Form Section */}
        <Surface style={styles.section} elevation={1}>
          <Text
            variant="titleSmall"
            style={[styles.sectionTitle, { color: colors.primary, marginTop: 12 }]}
          >
            Personal Information
          </Text>

          <TextInput
            label="Full Name"
            value={profile.name}
            onChangeText={text => setProfile(prev => ({ ...prev, name: text }))}
            style={[styles.input, { backgroundColor: 'transparent' }]}
            error={!!errors.name}
            mode="flat"
            dense
          />
          {errors.name && <HelperText type="error">{errors.name}</HelperText>}

          <View style={{ height: 16 }} />

          <ContactPicker
            value={profile.phone}
            onChangeText={(text: string) =>
              setProfile(prev => ({ ...prev, phone: text }))
            }
            onNameChange={(nameData: { firstName: string; lastName: string }) => {
              setProfile(prev => ({
                ...prev,
                name: `${nameData.firstName} ${nameData.lastName}` || prev.name,
              }));
            }}
            onEmailChange={(email: string) => {
              setProfile(prev => ({
                ...prev,
                email: email,
              }));
            }}
            error={!!errors.phone}
            errorText={errors.phone}
            style={styles.input}
          />
          {errors.phone && <HelperText type="error">{errors.phone}</HelperText>}

          <Button
            mode="contained"
            onPress={handleUpdateProfile}
            loading={saving}
            style={styles.button}
            contentStyle={{ height: 48 }}
          >
            Save Changes
          </Button>
        </Surface>

        <Divider style={{ marginVertical: 12 }} />

        {/* Account Settings Section */}
        <Surface style={styles.section} elevation={1}>
          <Text
            variant="titleSmall"
            style={[styles.sectionTitle, { color: colors.primary, marginTop: 12 }]}
          >
            Account Settings
          </Text>

          <List.Item
            title="Change Password"
            description="Update your security credentials"
            left={props => <List.Icon {...props} icon="lock-outline" />}
            onPress={() => router.push('/settings/change-password')}
            style={styles.listItem}
          />
          <Divider />
          <List.Item
            title="Delete Account"
            description="Request account deletion"
            left={props => (
              <List.Icon {...props} icon="delete-outline" color={colors.error} />
            )}
            onPress={() => router.push('/settings/delete-account' as any)}
            style={styles.listItem}
            titleStyle={{ color: colors.error }}
          />
        </Surface>
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
  },
  header: {
    alignItems: 'center',
    paddingBottom: 16,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  avatarEditBtn: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    elevation: 4,
  },
  userName: {
    fontWeight: 'bold',
    marginBottom: 2,
  },
  section: {
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    fontWeight: '700',
  },
  input: {
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  button: {
    marginTop: 8,
    borderRadius: 8,
  },
  listItem: {
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
});
