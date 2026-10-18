import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, TouchableOpacity, View } from 'react-native';
import { Avatar, Button, Surface, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import ManageBusinessModal from '@/features/settings/components/ManageBusinessModal';
import { useAuth } from '@/providers/AuthProvider';
import { useOfflineImageSync } from '@/shared/components/CachedImage';
import EmptyState from '@/shared/components/EmptyState';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import {
  type Business,
  useBusinesses,
  useBusinessShares,
  useCachedBusinesses,
  useCoreMutations,
  useStoreRefresh,
} from '@/shared/hooks/useStore';
import { useTheme, useThemeColors } from '@/shared/hooks/useThemeProvider';
import { OFFLINE_USER_ID } from '@/shared/services/auth';
import { sendAcceptanceEmail } from '@/shared/services/emailService';
import {
  isActiveBusinessShare,
  normalizeIdentity,
  parseShareRoles,
} from '@/shared/utils/businessScope';

const BusinessLogo = ({
  logoUrl,
  size = 48,
  colors,
}: {
  logoUrl?: string | null;
  size?: number;
  colors: any;
}) => {
  const { localUri } = useOfflineImageSync(logoUrl || undefined);

  if (localUri) {
    return (
      <Avatar.Image
        size={size}
        source={{ uri: localUri }}
        style={{ backgroundColor: 'transparent' }}
      />
    );
  }

  return (
    <Avatar.Icon
      size={size}
      icon="briefcase"
      style={{ backgroundColor: colors.primaryContainer }}
      color={colors.onPrimaryContainer}
    />
  );
};

export const WelcomeDashboard = () => {
  const colors = useThemeColors();
  const { isDarkMode } = useTheme();
  const isDark = isDarkMode || false;
  const router = useRouter();
  const { user } = useAuth();
  const { selectBusiness } = useBusiness();
  const { update } = useCoreMutations();
  const accessibleBusinesses = useBusinesses();
  const rawBusinesses = useCachedBusinesses();
  const rawShares = useBusinessShares();
  const { isSyncActive } = useLocalSync();
  const { refreshing, onRefresh } = useStoreRefresh();
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);

  const handlePullRefresh = async () => {
    setIsPullRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsPullRefreshing(false);
    }
  };

  const isLoading = refreshing || isPullRefreshing;

  const [showAddModal, setShowAddModal] = useState(false);
  const [processingShareId, setProcessingShareId] = useState<string | null>(null);

  const pendingInvites = useMemo(() => {
    if (!user) return [];

    return rawShares
      .filter(
        s =>
          !!user.email &&
          normalizeIdentity(s.shared_with) === normalizeIdentity(user.email) &&
          s.status === 'pending',
      )
      .map(s => {
        const business = rawBusinesses.find(b => b.id === s.business_id);
        return {
          ...s,
          businessName: business?.name || 'Unknown Business',
          businessEmail: business?.email,
        };
      });
  }, [rawShares, rawBusinesses, user]);

  const myShares = useMemo(() => {
    if (!user?.email) return [];
    return rawShares.filter(
      s =>
        normalizeIdentity(s.shared_with) === normalizeIdentity(user.email) &&
        isActiveBusinessShare(s),
    );
  }, [rawShares, user]);

  const handleSelect = async (business: Business) => {
    if (user && user.id !== OFFLINE_USER_ID && business.user_id === OFFLINE_USER_ID) {
      await update('businesses', business.id, { user_id: user.id });
      business.user_id = user.id;
    }
    selectBusiness(business);
  };

  const handleAcceptShare = async (shareId: string) => {
    try {
      setProcessingShareId(shareId);
      await update('business_shares', shareId, { status: 'active' });

      const share = rawShares.find(s => s.id === shareId);
      const business = rawBusinesses.find(b => b.id === share?.business_id);

      if (business && user?.email) {
        sendAcceptanceEmail(business as any, {
          email: user.email,
        }).catch(err => console.warn('Acceptance email failed:', err));
      }
    } catch (error) {
      console.error('Error accepting share:', error);
    } finally {
      setProcessingShareId(null);
    }
  };

  const handleDeclineShare = async (shareId: string) => {
    try {
      setProcessingShareId(shareId);
      await update('business_shares', shareId, { status: 'rejected' });
    } catch (error) {
      console.error('Error declining share:', error);
    } finally {
      setProcessingShareId(null);
    }
  };

  const getRoleLabel = (b: Business): string => {
    const bizUserId = normalizeIdentity(b.user_id);
    const userId = normalizeIdentity(user?.id);
    const offlineId = normalizeIdentity(OFFLINE_USER_ID);
    const userEmail = normalizeIdentity(user?.email);
    const bizEmail = normalizeIdentity(b.email);

    if (
      user &&
      (userId === offlineId ||
        bizUserId === userId ||
        bizUserId === offlineId ||
        Boolean(userEmail && bizEmail && bizEmail === userEmail))
    ) {
      return 'Owner';
    }
    const share = myShares.find(s => s.business_id === b.id);
    if (share) {
      const roles = parseShareRoles(share.roles);
      return roles.length > 0 ? roles.join(', ') : 'Shared';
    }
    return 'Tenant';
  };

  if (!user) {
    return null;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={isPullRefreshing}
          onRefresh={handlePullRefresh}
          colors={[colors.primary]}
          tintColor={colors.primary}
          progressBackgroundColor={colors.surface}
        />
      }
    >
      {/* Header section */}
      <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4,
          }}
        >
          <Text
            variant="headlineMedium"
            style={{ fontWeight: '700', color: colors.onBackground }}
          >
            Your Businesses
          </Text>
          <Button
            mode="text"
            compact
            icon="refresh"
            onPress={onRefresh}
            loading={isLoading}
            disabled={isLoading}
            textColor={colors.primary}
          >
            Refresh
          </Button>
        </View>
        <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
          Choose a business to open and manage, or create a new one.
        </Text>
      </View>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <Text
            variant="titleSmall"
            style={{
              color: colors.primary,
              fontWeight: '700',
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Pending Invitations ({pendingInvites.length})
          </Text>
          {pendingInvites.map(invite => (
            <Surface
              key={invite.id}
              elevation={2}
              style={{
                borderRadius: 14,
                padding: 14,
                marginBottom: 8,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.primary,
              }}
            >
              <View
                style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}
              >
                <Avatar.Icon
                  size={36}
                  icon="email-outline"
                  style={{ backgroundColor: colors.primaryContainer, marginRight: 12 }}
                  color={colors.primary}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    variant="titleMedium"
                    style={{ fontWeight: 'bold', color: colors.onSurface }}
                  >
                    {invite.businessName}
                  </Text>
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    Invited as: {parseShareRoles(invite.roles).join(', ') || 'Member'}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
                <Button
                  mode="outlined"
                  onPress={() => handleDeclineShare(invite.id)}
                  disabled={processingShareId === invite.id || isLoading}
                  compact
                  textColor={colors.error}
                  style={{ borderColor: colors.error }}
                >
                  Decline
                </Button>
                <Button
                  mode="contained"
                  onPress={() => handleAcceptShare(invite.id)}
                  loading={processingShareId === invite.id}
                  disabled={processingShareId === invite.id || isLoading}
                  compact
                  buttonColor={colors.primary}
                >
                  Accept
                </Button>
              </View>
            </Surface>
          ))}
        </View>
      )}

      {/* Accessible Businesses List */}
      <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
        {accessibleBusinesses.length === 0 ? (
          <EmptyState
            icon="domain-off"
            title="No businesses found"
            description="You don't have access to any businesses yet. Create your first business or ask an administrator to invite you."
            style={{ padding: 24 }}
          >
            <Button
              mode="contained"
              onPress={() => setShowAddModal(true)}
              disabled={isLoading}
              style={{ width: '100%', marginTop: 8 }}
              icon="plus"
            >
              Create Business
            </Button>
          </EmptyState>
        ) : (
          <View style={{ gap: 10 }}>
            {accessibleBusinesses.map(b => {
              const role = getRoleLabel(b);
              const isOwner = role === 'Owner';
              return (
                <TouchableOpacity
                  key={b.id}
                  activeOpacity={0.7}
                  onPress={() => handleSelect(b)}
                  disabled={isLoading}
                >
                  <Surface
                    elevation={1}
                    style={{
                      borderRadius: 16,
                      padding: 14,
                      backgroundColor: colors.surface,
                      borderWidth: isDark ? 1 : 0,
                      borderColor: colors.outlineVariant,
                      flexDirection: 'row',
                      alignItems: 'center',
                      opacity: isLoading ? 0.6 : 1,
                    }}
                  >
                    <BusinessLogo logoUrl={b.logo_url} size={48} colors={colors} />
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <Text
                        variant="titleMedium"
                        style={{
                          fontWeight: '700',
                          color: colors.onSurface,
                        }}
                        numberOfLines={1}
                      >
                        {b.name}
                      </Text>
                      <Text
                        variant="bodySmall"
                        style={{ color: colors.onSurfaceVariant, marginTop: 2 }}
                        numberOfLines={1}
                      >
                        {b.address || b.email || b.phone || 'Tap to open workspace'}
                      </Text>
                    </View>
                    <View
                      style={{
                        alignItems: 'flex-end',
                        justifyContent: 'space-between',
                        alignSelf: 'stretch',
                        marginLeft: 10,
                        paddingVertical: 2,
                      }}
                    >
                      <View
                        style={{
                          backgroundColor: isOwner
                            ? colors.primaryContainer
                            : colors.secondaryContainer,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 12,
                        }}
                      >
                        <Text
                          variant="labelSmall"
                          style={{
                            color: isOwner
                              ? colors.onPrimaryContainer
                              : colors.onSecondaryContainer,
                            fontWeight: '600',
                          }}
                        >
                          {role}
                        </Text>
                      </View>
                      <MaterialCommunityIcons
                        name="chevron-right"
                        size={20}
                        color={colors.onSurfaceVariant}
                      />
                    </View>
                  </Surface>
                </TouchableOpacity>
              );
            })}

            <Button
              mode="outlined"
              onPress={() => setShowAddModal(true)}
              disabled={isLoading}
              icon="plus"
              style={{
                marginTop: 6,
                borderRadius: 12,
                borderColor: colors.outline,
                borderStyle: 'dashed',
              }}
            >
              Add Another Business
            </Button>
          </View>
        )}
      </View>

      {/* Cloud Sync promotion when offline */}
      {!isSyncActive && (
        <Surface
          elevation={1}
          style={{
            marginHorizontal: 16,
            marginBottom: 16,
            borderRadius: 16,
            padding: 16,
            backgroundColor: colors.surface,
            ...(isDark && { borderColor: colors.outlineVariant, borderWidth: 1 }),
          }}
        >
          <Text
            variant="titleMedium"
            style={{
              color: colors.onSurface,
              fontWeight: 'bold',
              marginBottom: 16,
              textAlign: 'center',
            }}
          >
            Unlock the full potential 🚀
          </Text>

          <View style={{ gap: 14, marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  backgroundColor: colors.primaryContainer,
                  padding: 8,
                  borderRadius: 20,
                }}
              >
                <MaterialCommunityIcons
                  name="shield-check"
                  size={20}
                  color={colors.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  variant="bodyMedium"
                  style={{ color: colors.onSurface, fontWeight: 'bold' }}
                >
                  Secure Auto-Backups
                </Text>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  Your data is safe in the cloud across all your devices
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  backgroundColor: colors.secondaryContainer,
                  padding: 8,
                  borderRadius: 20,
                }}
              >
                <MaterialCommunityIcons
                  name="devices"
                  size={20}
                  color={colors.secondary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  variant="bodyMedium"
                  style={{ color: colors.onSurface, fontWeight: 'bold' }}
                >
                  Multi-Device Access
                </Text>
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  Sync seamlessly across all your devices instantly
                </Text>
              </View>
            </View>
          </View>

          <Button
            mode="contained"
            onPress={() => router.push('/settings/cloud-sync')}
            disabled={isLoading}
            style={{ borderRadius: 8 }}
            buttonColor={colors.primary}
            icon={'cloud-sync'}
          >
            Go to Cloud Sync
          </Button>
        </Surface>
      )}

      <ManageBusinessModal
        visible={showAddModal}
        onDismiss={() => setShowAddModal(false)}
      />
    </ScrollView>
  );
};
