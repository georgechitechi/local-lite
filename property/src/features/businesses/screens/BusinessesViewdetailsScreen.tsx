import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Checkbox,
  Divider,
  HelperText,
  IconButton,
  List,
  Menu,
  Portal,
  ProgressBar,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness as useBusinessContext } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import ManageBusinessModal from '@/features/settings/components/ManageBusinessModal';
import { generateBusinessCard } from '@/features/settings/utils/businessCard';
import { initializeBusinessSettings } from '@/features/settings/utils/initializeSettings';
import { useAuth } from '@/providers/AuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import BaseModal from '@/shared/components/BaseModal';
import { useOfflineImageSync } from '@/shared/components/CachedImage';
import HistoryModal from '@/shared/components/HistoryModal';
import LoadingCard from '@/shared/components/LoadingCard';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import {
  useBusinesses,
  useBusinessShares,
  useCoreMutations,
  useProfiles,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import {
  sendAcceptanceEmail,
  sendBackupEmail,
  sendShareRemovalEmail,
  sendShareRequestEmail,
} from '@/shared/services/emailService';
import { uploadImage } from '@/shared/services/fileUpload';
import { supabase } from '@/shared/services/supabase';
import { getSyncClient } from '@/shared/services/sync/client';
import type { ConfirmDialog, Errors } from '@/shared/types/types';
import { generateUUID, getInitial } from '@/shared/utils/helper';
import { isActiveShareStatus } from '@/shared/utils/statusHelper';
import { validations } from '@/shared/utils/validations';

interface Share {
  id: string;
  business_id: string;
  shared_with: string;
  user_id: string;
  status: string;
  roles?: string[];
  shared_by_user?: {
    email: string;
  };
}

// Inner component to handle image hook logic
const OfflineLogo = ({ url }: { url: string }) => {
  const { localUri } = useOfflineImageSync(url);

  return (
    <Image source={{ uri: localUri || url }} style={styles.logo} resizeMode="contain" />
  );
};

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'active':
      return '#4CAF50';
    case 'pending':
      return '#FF9800';
    case 'inactive':
      return '#F44336';
    default:
      return '#9E9E9E';
  }
};

const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'active':
      return 'check-circle';
    case 'pending':
      return 'clock-outline';
    case 'inactive':
      return 'close-circle';
    default:
      return 'help-circle';
  }
};

export default function BusinessView() {
  const { user } = useAuth();

  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const isOwner = useAccessControl().isOwner;
  const { isOnline, checkOnline } = useOfflineCheck();
  const { isDemoMode } = useLocalSync();

  const { pauseAutoLock, resumeAutoLock } = useIdleLock();

  const { insert, update, delete: deleteRecord } = useCoreMutations();
  const allBusinesses = useBusinesses();
  const allShares = useBusinessShares();
  const allProfiles = useProfiles();
  const { selectedBusiness: contextSelectedBusiness, clearSelectedBusiness } =
    useBusinessContext();

  const [directBusiness, setDirectBusiness] = useState<any>(null);
  const [directLoading, setDirectLoading] = useState(true);

  const business = useMemo(() => {
    if (!id) return null;
    return (
      allBusinesses.find(b => String(b.id) === String(id)) ||
      (contextSelectedBusiness && String(contextSelectedBusiness.id) === String(id)
        ? contextSelectedBusiness
        : null) ||
      directBusiness
    );
  }, [id, allBusinesses, contextSelectedBusiness, directBusiness]);

  useEffect(() => {
    let active = true;
    if (!id) {
      setDirectLoading(false);
      return;
    }

    const alreadyFound =
      allBusinesses.some(b => String(b.id) === String(id)) ||
      (contextSelectedBusiness && String(contextSelectedBusiness.id) === String(id));

    if (alreadyFound) {
      setDirectLoading(false);
      return;
    }

    const fetchDirect = async () => {
      try {
        const client = await getSyncClient().catch(() => null);
        if (client) {
          const found = await client.findById('businesses', id).catch(() => null);
          if (active && found && !found.deleted) {
            setDirectBusiness(found);
            setDirectLoading(false);
            return;
          }
        }

        if (supabase) {
          const { data } = await supabase
            .from('businesses')
            .select('*')
            .eq('id', id)
            .maybeSingle();

          if (active && data && !data.deleted) {
            setDirectBusiness(data);
            if (client) {
              await client.db
                .execute(
                  `INSERT OR REPLACE INTO "businesses" ("id", "name", "phone", "email", "address", "latitude", "longitude", "user_id", "is_system", "logo_url", "deleted", "created_at", "updated_at")
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    data.id,
                    data.name || '',
                    data.phone || null,
                    data.email || null,
                    data.address || null,
                    data.latitude ?? null,
                    data.longitude ?? null,
                    data.user_id || '',
                    data.is_system ? 1 : 0,
                    data.logo_url || null,
                    data.deleted ? 1 : 0,
                    data.created_at || new Date().toISOString(),
                    data.updated_at || new Date().toISOString(),
                  ],
                )
                .catch(() => {});
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load business directly:', err);
      } finally {
        if (active) {
          setDirectLoading(false);
        }
      }
    };

    fetchDirect();

    return () => {
      active = false;
    };
  }, [id, allBusinesses, contextSelectedBusiness]);

  const shares = useMemo(() => {
    return allShares
      .filter(
        (s: any) =>
          String(s.business_id) === String(id) &&
          ['active', 'pending', 'inactive'].includes(s.status || ''),
      )
      .map((s: any) => {
        const profile = allProfiles.find((p: any) => p?.user_id === s.user_id) as any;
        return {
          ...s,
          shared_by_user: { email: profile?.email || 'Unknown' },
        };
      }) as Share[];
  }, [id, allShares, allProfiles]);

  const loading = !business && directLoading;
  const router = useRouter();
  const [showLogoDialog, setShowLogoDialog] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>(['tenant']);
  const [sendingEmail, setSendingEmail] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>({
    visible: false,
    title: '',
    message: '',
    onConfirm: null,
    confirmText: 'OK',
    showCancel: false,
    destructive: false,
  });

  const [deletingBusiness, setDeletingBusiness] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState('');

  const [showManageAccessModal, setShowManageAccessModal] = useState(false);
  const [isUpdatingAccess, setIsUpdatingAccess] = useState(false);
  const [currentShare, setCurrentShare] = useState<Share | null>(null);
  const [tempRoles, setTempRoles] = useState<string[]>([]);
  const [tempStatus, setTempStatus] = useState<string>('');

  const [syncingSettings, setSyncingSettings] = useState(false);

  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [copyName, setCopyName] = useState('');
  const [copyingBusiness, setCopyingBusiness] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const [selectedShareId, setSelectedShareId] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  const handleUpdateShareStatus = async (
    shareId: string,
    updates: { status: string },
  ) => {
    try {
      const share = allShares.find((s: any) => s.id === shareId) as any;
      if (!share) throw new Error('Share not found');

      // Send notifications based on status change BEFORE updating the state
      if (isActiveShareStatus(updates) && share.status !== 'active') {
        sendAcceptanceEmail(business as any, { email: share.shared_with }).catch(err =>
          console.warn('Acceptance email failed:', err),
        );
      } else if (updates.status === 'inactive' && share.status !== 'inactive') {
        sendShareRemovalEmail(
          share.shared_with,
          business as any,
          user?.email || '',
        ).catch(err => console.warn('Removal email failed:', err));
      }

      await update('business_shares', shareId, updates);

      showSnackbar(
        updates.status === 'inactive' ? 'Access removed' : 'Share status updated',
        'success',
      );
    } catch (error) {
      console.error('Error updating share:', error);
      showSnackbar('Failed to update share status', 'error');
    }
  };

  const handleUpdateRoles = async (shareId: string, roles: string[], status?: string) => {
    if (!shareId) return;
    if (!checkOnline('Updating Access')) return;

    try {
      setIsUpdatingAccess(true);
      const share = allShares.find((s: any) => s.id === shareId) as any;
      if (!share) throw new Error('Share not found');

      const updates: any = { roles };
      if (status) updates.status = status;

      // Send notifications based on status change
      if (status === 'active' && share.status !== 'active') {
        sendAcceptanceEmail(business as any, { email: share.shared_with }).catch(err =>
          console.warn('Acceptance email failed:', err),
        );
      } else if (status === 'inactive' && share.status !== 'inactive') {
        sendShareRemovalEmail(
          share.shared_with,
          business as any,
          user?.email || '',
        ).catch(err => console.warn('Removal email failed:', err));
      }

      await update('business_shares', shareId, updates);
      showSnackbar('Access updated successfully', 'success');
    } catch (error) {
      console.error('Error updating access:', error);
      showSnackbar('Failed to update access', 'error');
    } finally {
      setIsUpdatingAccess(false);
      setShowManageAccessModal(false);
      setSelectedShareId(null);
      setCurrentShare(null);
    }
  };

  const handleManageAccess = (share: Share) => {
    setCurrentShare(share);
    setSelectedShareId(null);
    setTempRoles(share.roles || ['tenant']);
    setTempStatus(share.status);
    setIsUpdatingAccess(false);
    setShowManageAccessModal(true);
  };

  const handleSyncSettings = async () => {
    if (!business) return;
    setConfirmDialog({
      visible: true,
      title: 'Sync Settings',
      message: `This will initialize default settings for "${business.name}". This is safe to run multiple times and will only add missing settings. Continue?`,
      onConfirm: async () => {
        try {
          if (!checkOnline('Sync Settings')) return;
          setSyncingSettings(true);
          const result = await initializeBusinessSettings(business.id);
          if (result.success) {
            showSnackbar('Settings synchronized successfully!', 'success');
          } else {
            showSnackbar(result.message || 'Failed to sync settings', 'error');
          }
        } catch (error) {
          console.error('Error syncing settings:', error);
          showSnackbar('Failed to sync settings. Please try again.', 'error');
        } finally {
          setSyncingSettings(false);
          setConfirmDialog(prev => ({ ...prev, visible: false }));
        }
      },
      confirmText: 'Sync',
      showCancel: true,
      destructive: false,
    });
  };

  const handleSharePress = () => {
    setEmailError('');
    setIsUpdatingAccess(false);
    setShowShareDialog(true);
  };

  const handleShareBusiness = async () => {
    if (!shareEmail || !business) return;
    if (!checkOnline('Sharing Business')) return;

    const emailErrorMsg = validations.email(shareEmail);
    if (emailErrorMsg) {
      setEmailError(emailErrorMsg);
      return;
    }
    try {
      setSendingEmail(true);
      const existingShare = allShares.find(
        (s: any) => s.business_id === business.id && s.shared_with === shareEmail,
      ) as any;
      if (existingShare) {
        if (existingShare.status === 'inactive') {
          await update('business_shares', existingShare.id, {
            status: 'pending',
            roles: selectedRoles,
          });
          setConfirmDialog({
            visible: true,
            title: 'Success',
            message: 'Share request reactivated successfully',
            onConfirm: () => setConfirmDialog(prev => ({ ...prev, visible: false })),
            confirmText: 'OK',
            showCancel: false,
            destructive: false,
          });
        } else {
          await handleUpdateRoles(existingShare.id, selectedRoles);
        }
      } else {
        const newShareId = generateUUID();
        await insert('business_shares', {
          id: newShareId,
          business_id: business.id,
          user_id: user?.id || '',
          shared_with: shareEmail,
          status: 'pending',
          roles: selectedRoles,
        } as any);

        sendShareRequestEmail(shareEmail, business as any, user?.email || '').catch(err =>
          console.warn('Email sending failed (might be offline):', err),
        );

        showSnackbar('Business share request sent successfully', 'success');
      }
      setShowShareDialog(false);
      setShareEmail('');
      setEmailError('');
      setSelectedRoles(['tenant']);
      setIsUpdatingAccess(false);
    } catch (error) {
      console.error('Error sharing business:', error);
      showSnackbar('Failed to share business', 'error');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleRemoveSharedBusiness = async () => {
    if (!business) return;
    setConfirmDialog({
      visible: true,
      title: 'Leave Business',
      message:
        'Are you sure you want to leave this shared business? You will lose access to all its data.',
      onConfirm: async () => {
        try {
          const share = allShares.find(
            (s: any) => s.business_id === business.id && s.shared_with === user?.email,
          ) as any;
          if (share) {
            await update('business_shares', share.id, { status: 'inactive' });
          }

          if (contextSelectedBusiness && contextSelectedBusiness.id === business.id) {
            await clearSelectedBusiness();
          }

          showSnackbar('You have left the business.', 'success');
          setConfirmDialog(prev => ({ ...prev, visible: false }));
          router.replace('/(tabs)');
        } catch (error) {
          console.error('Error removing business access:', error);
          showSnackbar(
            'Failed to leave business. Please try again or contact the business owner.',
            'error',
          );
          setConfirmDialog(prev => ({ ...prev, visible: false }));
        }
      },
      confirmText: 'Leave',
      showCancel: true,
      destructive: true,
    });
  };

  const handleDeleteBusiness = async () => {
    if (!business) return;
    setConfirmDialog({
      visible: true,
      title: 'Delete Business',
      message: `Are you sure you want to delete "${business.name.trim()}"? This action cannot be undone. A backup of all data will be sent to ${business.email} before deletion.`,
      onConfirm: async () => {
        try {
          setDeletingBusiness(true);

          try {
            setDeleteProgress('Creating backup...');

            const client = await getSyncClient().catch(() => null);
            const fetchTableData = async (table: string) => {
              if (client) {
                try {
                  const rows = await client.findMany(table, {
                    where: (r: Record<string, any>) =>
                      !r.deleted && (!r.business_id || r.business_id === business.id),
                  });
                  if (rows && rows.length > 0) return rows;
                } catch {
                  // fallback
                }
              }
              return [];
            };

            const properties = await fetchTableData('properties');
            const houses = await fetchTableData('houses');
            const tenants = await fetchTableData('tenants');
            const contracts = await fetchTableData('contracts');
            const receipts = await fetchTableData('receipts');
            const expenses = await fetchTableData('expenses');
            const bookings = await fetchTableData('bookings');
            const promotions = await fetchTableData('promotions');
            const maintenance_requests = await fetchTableData('maintenance_requests');

            const backupData = {
              version: Constants.expoConfig?.version || '1.0.0',
              timestamp: new Date().toISOString(),
              data: {
                business: {
                  id: business.id,
                  name: business.name,
                  address: business.address,
                  phone: business.phone,
                  email: business.email,
                  created_at: (business as any).created_at,
                  updated_at: (business as any).updated_at,
                  user_id: (business as any).user_id,
                },
                properties,
                houses,
                tenants,
                contracts,
                receipts,
                expenses,
                bookings,
                promotions,
                maintenance_requests,
              },
            };

            const backupJson = JSON.stringify(backupData);
            const blob = new Blob([backupJson], { type: 'application/json' });
            const reader = new FileReader();
            reader.readAsDataURL(blob);

            await new Promise(resolve => {
              reader.onloadend = resolve;
            });
            const backupBase64 = (reader.result as string).split(',')[1];

            setDeleteProgress('Sending backup email...');
            await sendBackupEmail(business as any, backupData as any, backupBase64);
          } catch (backupError) {
            console.warn('Backup failed, proceeding with deletion:', backupError);
          }

          setDeleteProgress('Deleting business data...');

          if (!isDemoMode && checkOnline('Delete Business')) {
            const { error: rpcError } = await supabase.rpc('delete_business_data', {
              p_business_id: business.id,
            });
            if (rpcError) {
              console.error('Failed to securely delete business data:', rpcError);
              throw new Error(
                rpcError.message ||
                  'Failed to securely delete business data from server.',
              );
            }
          }

          await deleteRecord('businesses', business.id);

          if (contextSelectedBusiness && contextSelectedBusiness.id === business.id) {
            await clearSelectedBusiness();
          }

          setDeleteProgress('');
          showSnackbar('Business deleted successfully. Refreshing app...', 'success');

          setTimeout(() => {
            try {
              setDeletingBusiness(false);
              router.replace('/(tabs)');
            } catch (navError) {
              console.error('Failed to navigate:', navError);
              router.replace('/(tabs)');
            }
          }, 1500);
        } catch (error) {
          console.error('Error deleting business:', error);
          showSnackbar('Failed to delete business.', 'error');
          setDeleteProgress('');
          setDeletingBusiness(false);
        } finally {
          setConfirmDialog(prev => ({ ...prev, visible: false }));
        }
      },
      confirmText: 'Delete',
      showCancel: true,
      destructive: true,
    });
  };

  const handleCopyBusiness = () => {
    if (!business) return;
    setCopyName(`${business.name} Copy`);
    setShowCopyDialog(true);
  };

  const handleConfirmCopyBusiness = async () => {
    if (!business || !copyName.trim() || !user?.id) return;
    if (!checkOnline('Copying Business')) return;

    setCopyingBusiness(true);
    try {
      const duplicate = allBusinesses.some(
        (b: any) => b.name.toLowerCase() === copyName.trim().toLowerCase(),
      );
      if (duplicate) {
        setErrors(prev => ({
          ...prev,
          name: 'Business name already exists',
        }));
        setCopyingBusiness(false);
        return;
      }

      if (copyName.trim().length > 25) {
        setErrors(prev => ({
          ...prev,
          name: 'Business name cannot exceed 25 characters',
        }));
        setCopyingBusiness(false);
        return;
      }

      const newId = generateUUID();

      const newBusinessData = {
        id: newId,
        name: copyName.trim(),
        phone: business.phone,
        email: business.email,
        address: business.address,
        latitude: (business as any).latitude || null,
        longitude: (business as any).longitude || null,
        user_id: user.id,
        is_system: false,
        logo_url: null,
      };

      await insert('businesses', newBusinessData as any);

      setShowCopyDialog(false);
      setCopyName('');
      setErrors({});

      showSnackbar('Business copied successfully', 'success');
    } catch (error) {
      console.error('Error copying business:', error);
      showSnackbar('Failed to copy business', 'error');
    } finally {
      setCopyingBusiness(false);
    }
  };

  const pickImage = async () => {
    pauseAutoLock();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        await uploadLogo(result.assets[0]);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      showSnackbar('Failed to pick image', 'error');
    } finally {
      resumeAutoLock();
    }
  };

  const uploadLogo = async (imageAsset: ImagePicker.ImagePickerAsset) => {
    if (!business) return;
    if (!checkOnline('Uploading Logo')) return;

    setUploading(true);
    try {
      const { publicUrl } = await uploadImage(
        imageAsset,
        'public-assets',
        'business-logos',
        business.id,
        { offlineSupport: true },
      );

      // Update business logo via local-lite
      await update('businesses', business.id, { logo_url: publicUrl });

      setShowLogoDialog(false);
    } catch {
      console.error('Error uploading logo:');
      showSnackbar('Failed to upload logo', 'error');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <LoadingCard iconName="office-building" text="Loading business..." />;
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      {deletingBusiness && <ProgressBar indeterminate visible color={colors.primary} />}
      {business ? (
        <React.Fragment key={business.id}>
          <Card style={styles.card}>
            <Card.Content style={{ position: 'relative' }}>
              <View style={styles.header}>
                {business.logo_url ? (
                  <OfflineLogo url={business.logo_url} />
                ) : (
                  <View
                    style={[
                      styles.logo,
                      styles.placeholderLogo,
                      { backgroundColor: colors.surfaceVariant },
                    ]}
                  >
                    <Text style={[styles.placeholderText, { color: colors.onSurface }]}>
                      {getInitial(business.name.charAt(0))}
                    </Text>
                  </View>
                )}
                <View style={[styles.businessInfo, { flex: 1 }]}>
                  <Text
                    variant="titleMedium"
                    style={[
                      styles.businessName,
                      { color: colors.onSurface, flexShrink: 1 },
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    allowFontScaling={false}
                  >
                    {business.name}
                  </Text>
                  <Text style={[styles.contactInfo, { color: colors.onSurfaceVariant }]}>
                    {business.phone && `Phone: ${business.phone}`}
                    {'\n'}
                    {business.email && `Email: ${business.email}`}
                    {'\n'}
                    {business.address && `${business.address}`}
                  </Text>
                </View>
                <View style={{ position: 'absolute', top: -8, right: -8 }}>
                  <Menu
                    visible={menuVisible}
                    onDismiss={() => setMenuVisible(false)}
                    anchor={
                      <IconButton
                        icon="dots-vertical"
                        size={24}
                        onPress={() => setMenuVisible(true)}
                        disabled={deletingBusiness}
                        style={{ margin: 0 }}
                      />
                    }
                  >
                    {isOwner ? (
                      <>
                        <Menu.Item
                          leadingIcon="pencil"
                          onPress={() => {
                            setMenuVisible(false);
                            setShowEditModal(true);
                          }}
                          title="Edit Business"
                          disabled={deletingBusiness || !isOnline}
                        />
                        <Menu.Item
                          leadingIcon="share-variant"
                          onPress={() => {
                            setMenuVisible(false);
                            handleSharePress();
                          }}
                          title="Share Business"
                          disabled={deletingBusiness || !isOnline}
                        />
                        <Menu.Item
                          leadingIcon={syncingSettings ? 'loading' : 'cog-sync'}
                          onPress={() => {
                            setMenuVisible(false);
                            handleSyncSettings();
                          }}
                          title={syncingSettings ? 'Syncing...' : 'Sync Settings'}
                          disabled={deletingBusiness || syncingSettings || !isOnline}
                        />
                        <Menu.Item
                          leadingIcon="file-document-outline"
                          onPress={() => {
                            setMenuVisible(false);
                            handleCopyBusiness();
                          }}
                          title="Copy Business"
                          disabled={deletingBusiness}
                        />
                        <Menu.Item
                          leadingIcon={deletingBusiness ? 'loading' : 'delete'}
                          onPress={() => {
                            setMenuVisible(false);
                            handleDeleteBusiness();
                          }}
                          title={deletingBusiness ? 'Deleting...' : 'Delete Business'}
                          titleStyle={{
                            color:
                              deletingBusiness || !isOnline
                                ? colors.onSurface
                                : colors.error,
                          }}
                          disabled={deletingBusiness || !isOnline}
                        />
                      </>
                    ) : (
                      <Menu.Item
                        leadingIcon="exit-run"
                        onPress={() => {
                          setMenuVisible(false);
                          handleRemoveSharedBusiness();
                        }}
                        title="Leave Business"
                        titleStyle={{
                          color: !isOnline ? colors.onSurface : colors.error,
                        }}
                        disabled={!isOnline}
                      />
                    )}
                  </Menu>
                </View>
              </View>
            </Card.Content>
            {isOwner && (
              <Card.Actions style={{ justifyContent: 'flex-end' }}>
                <Button
                  mode="outlined"
                  onPress={() => setShowLogoDialog(true)}
                  icon="image-edit"
                >
                  {business.logo_url ? 'Change Logo' : 'Add Logo'}
                </Button>
                <Button
                  mode="contained"
                  onPress={async () => {
                    try {
                      await generateBusinessCard(business as any);
                    } catch {
                      showSnackbar('Failed to generate business card', 'error');
                    }
                  }}
                  icon="id-card"
                >
                  Generate Card
                </Button>
              </Card.Actions>
            )}
          </Card>

          {isOwner && (
            <Card style={styles.card}>
              <Card.Content>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}
                >
                  <Text
                    variant="titleMedium"
                    style={[
                      styles.sectionTitle,
                      { color: colors.onSurface, flex: 1, marginBottom: 0 },
                    ]}
                  >
                    Shared With
                  </Text>
                  <View
                    style={{
                      backgroundColor: (colors as any).primary,
                      borderRadius: 12,
                      minWidth: 24,
                      height: 24,
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingHorizontal: 8,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.onPrimary,
                        fontSize: 12,
                        fontWeight: 'bold',
                      }}
                    >
                      {shares.length} members
                    </Text>
                  </View>
                </View>
                {shares.length === 0 ? (
                  <Text style={[styles.emptyText, { color: colors.onSurfaceVariant }]}>
                    No shares found
                  </Text>
                ) : (
                  shares.map(share => (
                    <React.Fragment key={share.id}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 8,
                          paddingLeft: 8,
                        }}
                      >
                        <List.Icon
                          icon={getStatusIcon(share.status)}
                          color={getStatusColor(share.status)}
                        />
                        <View style={{ flex: 1, marginLeft: 8 }}>
                          <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
                            {share.shared_with}
                          </Text>
                          <Text
                            variant="bodySmall"
                            style={{ color: colors.onSurfaceVariant }}
                          >
                            Shared by: {share.shared_by_user?.email || 'Unknown'}
                          </Text>
                          <Text
                            variant="bodySmall"
                            style={{ color: colors.onSurfaceVariant }}
                          >
                            Roles: {share.roles?.join(', ') || 'staff'}
                          </Text>
                        </View>
                        <Menu
                          visible={selectedShareId === share.id}
                          onDismiss={() => setSelectedShareId(null)}
                          anchor={
                            <IconButton
                              icon="dots-vertical"
                              size={20}
                              style={{ margin: 0 }}
                              onPress={() => setSelectedShareId(share.id)}
                            />
                          }
                        >
                          <Menu.Item
                            title="Manage Access"
                            leadingIcon="account-cog"
                            onPress={() => handleManageAccess(share as any)}
                          />
                        </Menu>
                      </View>
                      <Divider />
                    </React.Fragment>
                  ))
                )}
              </Card.Content>
            </Card>
          )}

          {isOwner && (
            <HistoryModal
              entityType="businesses"
              entityId={business.id}
              containerStyle={{ marginHorizontal: 16, marginBottom: 16 }}
            />
          )}

          <Portal>
            <ManageBusinessModal
              visible={showEditModal}
              onDismiss={() => setShowEditModal(false)}
              businessId={id}
            />

            <BaseModal
              visible={showLogoDialog}
              onDismiss={() => setShowLogoDialog(false)}
              title="Change Business Logo"
              message={`Choose a new logo for your business.\nThe image will be cropped to a square.`}
              confirmText="Choose Image"
              mode="confirm"
              showCancel={true}
              destructive={false}
              loading={uploading}
              loadingText="Uploading..."
              onConfirm={pickImage}
            />
          </Portal>
        </React.Fragment>
      ) : (
        <Card style={styles.card}>
          <Card.Content style={{ alignItems: 'center', paddingVertical: 32 }}>
            <IconButton icon="office-building-marker-outline" size={48} iconColor={colors.onSurfaceVariant} />
            <Text variant="titleMedium" style={{ color: colors.onSurface, marginTop: 8, fontWeight: 'bold' }}>
              Business Not Found
            </Text>
            <Text
              variant="bodyMedium"
              style={{
                color: colors.onSurfaceVariant,
                textAlign: 'center',
                marginTop: 4,
                marginBottom: 20,
              }}
            >
              The business you are looking for may have been removed or you do not have permission to view it.
            </Text>
            <Button mode="contained" onPress={() => router.back()} icon="arrow-left">
              Go Back
            </Button>
          </Card.Content>
        </Card>
      )}

      <Portal>
        <BaseModal
          mode="confirm"
          visible={confirmDialog.visible}
          title={confirmDialog.title}
          message={confirmDialog.message}
          onDismiss={() => setConfirmDialog(prev => ({ ...prev, visible: false }))}
          onConfirm={
            confirmDialog.onConfirm ||
            (() => setConfirmDialog(prev => ({ ...prev, visible: false })))
          }
          confirmText={confirmDialog.confirmText}
          showCancel={confirmDialog.showCancel}
          destructive={confirmDialog.destructive}
          loading={deletingBusiness || syncingSettings || copyingBusiness}
          loadingText={
            deletingBusiness
              ? deleteProgress
              : copyingBusiness
                ? 'Copying...'
                : syncingSettings
                  ? 'Syncing settings...'
                  : ''
          }
          zIndex={3000}
        />
      </Portal>

      {/* Share Business Dialog */}
      <BaseModal
        visible={showShareDialog}
        onDismiss={() => {
          setShowShareDialog(false);
          setShareEmail('');
          setEmailError('');
          setSelectedRoles(['tenant']);
        }}
        title="Share Business"
        subtitle="Manage your businesses"
        scrollable={true}
        actions={[
          {
            label: 'Cancel',
            mode: 'outlined' as const,
            onPress: () => {
              setShowShareDialog(false);
              setShareEmail('');
              setEmailError('');
              setSelectedRoles(['tenant']);
            },
            disabled: sendingEmail,
            style: { flex: 1 },
          },
          {
            label: sendingEmail ? 'Sharing...' : 'Share',
            mode: 'contained' as const,
            onPress: handleShareBusiness,
            loading: sendingEmail,
            disabled: sendingEmail || selectedRoles.length === 0 || !shareEmail,
            style: { flex: 1 },
          },
        ]}
      >
        <TextInput
          label="Email Address"
          value={shareEmail}
          onChangeText={(text: string) => {
            setShareEmail(text);
            setEmailError('');
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          error={!!emailError}
          disabled={sendingEmail}
          style={{ marginBottom: 4 }}
        />
        {emailError ? (
          <Text style={{ color: colors.error, fontSize: 12, marginBottom: 8 }}>
            {emailError}
          </Text>
        ) : null}

        <Text
          variant="bodyMedium"
          style={{ marginTop: 16, marginBottom: 8, color: colors.onSurface }}
        >
          Select Roles:
        </Text>

        <View style={{ gap: 8 }}>
          <View>
            <Button
              mode={selectedRoles.includes('admin') ? 'contained' : 'outlined'}
              onPress={() => {
                if (selectedRoles.includes('admin')) {
                  setSelectedRoles(selectedRoles.filter((r: string) => r !== 'admin'));
                } else {
                  setSelectedRoles([...selectedRoles, 'admin']);
                }
              }}
              disabled={sendingEmail}
              icon="account-cog"
              style={{ borderRadius: 50 }}
            >
              Admin
            </Button>
            <Text
              variant="bodySmall"
              style={{ color: colors.onSurfaceVariant, marginTop: 4 }}
            >
              Full access to all data and settings
            </Text>
          </View>

          <View>
            <Button
              mode={selectedRoles.includes('staff') ? 'contained' : 'outlined'}
              onPress={() => {
                if (selectedRoles.includes('staff')) {
                  setSelectedRoles(selectedRoles.filter((r: string) => r !== 'staff'));
                } else {
                  setSelectedRoles([...selectedRoles, 'staff']);
                }
              }}
              disabled={sendingEmail}
              icon="account-group"
              style={{ borderRadius: 50 }}
            >
              Staff
            </Button>
            <Text
              variant="bodySmall"
              style={{ color: colors.onSurfaceVariant, marginTop: 4 }}
            >
              Can manage properties, houses, and tenants
            </Text>
          </View>

          <View>
            <Button
              mode={selectedRoles.includes('tenant') ? 'contained' : 'outlined'}
              onPress={() => {
                if (selectedRoles.includes('tenant')) {
                  setSelectedRoles(selectedRoles.filter((r: string) => r !== 'tenant'));
                } else {
                  setSelectedRoles([...selectedRoles, 'tenant']);
                }
              }}
              disabled={sendingEmail}
              icon="account"
              style={{ borderRadius: 50 }}
            >
              Tenant
            </Button>
            <Text
              variant="bodySmall"
              style={{ color: colors.onSurfaceVariant, marginTop: 4 }}
            >
              Can view receipts and contracts
            </Text>
          </View>
        </View>

        <HelperText type="info" style={{ marginTop: 8 }}>
          Select one or more roles for this user. The user will have access based on the
          highest role assigned.
        </HelperText>
      </BaseModal>

      {/* Copy Business Dialog */}
      <BaseModal
        visible={showCopyDialog}
        onDismiss={() => {
          setShowCopyDialog(false);
          setCopyName('');
          setErrors({});
        }}
        title="Copy Business"
        subtitle="Manage your businesses"
        scrollable={true}
      >
        <Text variant="bodyMedium" style={{ marginBottom: 16 }}>
          Enter a name for the copied business.
        </Text>
        <TextInput
          label="Business Name *"
          value={copyName}
          onChangeText={text => {
            setCopyName(text);
            if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
          }}
          mode="outlined"
          error={!!errors.name}
          maxLength={50}
        />
        <Text
          variant="bodySmall"
          style={{ textAlign: 'right', color: colors.onSurfaceVariant, marginTop: 4 }}
        >
          {copyName.length}/50
        </Text>
        {errors.name && <HelperText type="error">{errors.name}</HelperText>}
        <Button
          mode="contained"
          onPress={handleConfirmCopyBusiness}
          loading={copyingBusiness}
          disabled={copyingBusiness || !copyName.trim()}
          style={{ marginTop: 24 }}
        >
          {copyingBusiness ? 'Copying...' : 'Copy Business'}
        </Button>
      </BaseModal>

      {/* Manage Access Dialog */}
      <BaseModal
        visible={showManageAccessModal}
        onDismiss={() => {
          setShowManageAccessModal(false);
          setSelectedShareId(null);
          setCurrentShare(null);
        }}
        title="Manage Access"
        subtitle="Manage your properties"
        scrollable={true}
        zIndex={2000}
        actions={[
          {
            label: 'Cancel',
            mode: 'outlined' as const,
            onPress: () => {
              setShowManageAccessModal(false);
              setSelectedShareId(null);
              setCurrentShare(null);
            },
            style: { flex: 1 },
            disabled: isUpdatingAccess,
          },
          {
            label: 'Update',
            mode: 'contained' as const,
            onPress: () =>
              currentShare && handleUpdateRoles(currentShare.id, tempRoles, tempStatus),
            loading: isUpdatingAccess,
            disabled: isUpdatingAccess || tempRoles.length === 0 || !currentShare?.id,
            style: { flex: 1 },
          },
        ]}
      >
        <View style={{ gap: 16 }}>
          <View>
            <Text
              variant="titleSmall"
              style={{ color: colors.onSurface, marginBottom: 8 }}
            >
              Status
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                mode={tempStatus === 'active' ? 'contained' : 'outlined'}
                onPress={() => setTempStatus('active')}
                icon="check-circle"
                style={{ flex: 1 }}
                compact
              >
                Active
              </Button>
              <Button
                mode={tempStatus === 'pending' ? 'contained' : 'outlined'}
                onPress={() => setTempStatus('pending')}
                icon="clock-outline"
                style={{ flex: 1 }}
                compact
              >
                Pending
              </Button>
            </View>
          </View>

          <Divider />

          <View>
            <Text
              variant="titleSmall"
              style={{ color: colors.onSurface, marginBottom: 8 }}
            >
              Roles
            </Text>
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Checkbox
                  status={tempRoles.includes('admin') ? 'checked' : 'unchecked'}
                  onPress={() => {
                    if (tempRoles.includes('admin')) {
                      setTempRoles(tempRoles.filter(r => r !== 'admin'));
                    } else {
                      setTempRoles([...tempRoles, 'admin']);
                    }
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
                    Admin
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: colors.onSurfaceVariant, marginTop: 2 }}
                  >
                    Full access to all data
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Checkbox
                  status={tempRoles.includes('staff') ? 'checked' : 'unchecked'}
                  onPress={() => {
                    if (tempRoles.includes('staff')) {
                      setTempRoles(tempRoles.filter(r => r !== 'staff'));
                    } else {
                      setTempRoles([...tempRoles, 'staff']);
                    }
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
                    Staff
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: colors.onSurfaceVariant, marginTop: 2 }}
                  >
                    Access to receipts and contracts only
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Checkbox
                  status={tempRoles.includes('tenant') ? 'checked' : 'unchecked'}
                  onPress={() => {
                    if (tempRoles.includes('tenant')) {
                      setTempRoles(tempRoles.filter(r => r !== 'tenant'));
                    } else {
                      setTempRoles([...tempRoles, 'tenant']);
                    }
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
                    Tenant
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: colors.onSurfaceVariant, marginTop: 2 }}
                  >
                    Access to receipts only
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <Divider />

          <Button
            mode="contained-tonal"
            textColor={colors.error}
            icon="delete"
            onPress={() => {
              if (!currentShare) return;
              setConfirmDialog({
                visible: true,
                title: 'Remove Access',
                message: `Are you sure you want to remove access for ${currentShare.shared_with}?`,
                onConfirm: () => {
                  handleUpdateShareStatus(currentShare.id, {
                    status: 'inactive',
                  });
                  setConfirmDialog(prev => ({ ...prev, visible: false }));
                  setShowManageAccessModal(false);
                },
                confirmText: 'Remove',
                showCancel: true,
                destructive: true,
              });
            }}
            style={{ marginTop: 8 }}
          >
            Remove Access
          </Button>
        </View>
      </BaseModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  card: {
    margin: 16,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 10,
  },
  placeholderLogo: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 32,
  },
  businessName: {
    marginBottom: 2,
    fontSize: 16,
    fontWeight: 'bold',
  },
  sectionTitle: {
    marginBottom: 6,
  },
  emptyText: {
    textAlign: 'center',
    marginVertical: 16,
  },
  businessInfo: {
    flex: 1,
    marginRight: 32, // Leave space for absolute menu button
  },
  contactInfo: {
    fontSize: 12,
  },
});
