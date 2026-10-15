import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { usePathname, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Avatar, Button, Divider, List, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import { useOfflineImageSync } from '@/shared/components/CachedImage';
import EmptyState from '@/shared/components/EmptyState';
import {
  type Business,
  useBusinesses,
  useCachedBusinesses,
  useBusinessShares,
  useCoreMutations,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { OFFLINE_USER_ID } from '@/shared/services/auth';
import { sendAcceptanceEmail } from '@/shared/services/emailService';
import { isActiveBusinessShare, normalizeIdentity } from '@/shared/utils/businessAccess';
import ManageBusinessModal from './ManageBusinessModal';

interface BusinessSelectModalProps {
  visible: boolean;
  onDismiss: () => void;
}

const BusinessLogo = ({
  logoUrl,
  size = 40,
  colors,
  isSelected,
}: {
  logoUrl?: string | null;
  size?: number;
  colors: any;
  isSelected?: boolean;
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
      style={{
        backgroundColor: isSelected ? colors.primaryContainer : colors.surfaceVariant,
      }}
      color={isSelected ? colors.onPrimaryContainer : colors.onSurfaceVariant}
    />
  );
};

export default function BusinessSelectModal({
  visible,
  onDismiss,
}: BusinessSelectModalProps) {
  const colors = useThemeColors();
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { selectedBusiness, selectBusiness } = useBusiness();
  const { update } = useCoreMutations();
  const rawBusinesses = useCachedBusinesses();
  const accessibleBusinesses = useBusinesses();
  const rawShares = useBusinessShares();
  const [showAddModal, setShowAddModal] = useState(false);
  const [processingShareId, setProcessingShareId] = useState<string | null>(null);

  const pendingInvites = useMemo(() => {
    if (!user) return [];

    return rawShares
      .filter(s => !!user.email && normalizeIdentity(s.shared_with) === normalizeIdentity(user.email) && s.status === 'pending')
      .map(s => {
        const business = rawBusinesses.find(b => b.id === s.business_id);
        return {
          ...s,
          businessName: business?.name || 'Unknown Business',
          businessEmail: business?.email,
        };
      });
  }, [rawShares, rawBusinesses, user]);

  const businesses = useMemo(() => {
    if (!user) return [];

    const myShares = rawShares.filter(
      s => !!user.email && normalizeIdentity(s.shared_with) === normalizeIdentity(user.email) && isActiveBusinessShare(s),
    );

    return accessibleBusinesses
      .map(b => {
        const isOffline = user.id === OFFLINE_USER_ID;
        const isOwned =
          isOffline ||
          b.user_id === user.id ||
          b.user_id === OFFLINE_USER_ID;
        const myShare = myShares.find(s => s.business_id === b.id);
        const isSharedWithMe = !isOwned && !!myShare;

        const memberCount =
          rawShares.filter(s => s.business_id === b.id && isActiveBusinessShare(s)).length +
          1; // +1 for owner

        return {
          ...b,
          isSharedWithMe,
          memberCount,
        };
      })
      .filter(
        (b): b is Business & { isSharedWithMe: boolean; memberCount: number } =>
          b !== null,
      )
      .sort((a, b) => {
        // Selected business first
        if (a.id === selectedBusiness?.id) return -1;
        if (b.id === selectedBusiness?.id) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [accessibleBusinesses, rawShares, user, selectedBusiness]);

  const handleSelect = async (business: Business & { isSharedWithMe: boolean }) => {
    // We only pass the base Business object to selectBusiness
    const businessData = { ...business };
    delete (businessData as any).isSharedWithMe;

    if (user && user.id !== OFFLINE_USER_ID && businessData.user_id === OFFLINE_USER_ID) {
      await update('businesses', businessData.id, { user_id: user.id });
      businessData.user_id = user.id;
    }

    await selectBusiness(businessData as any);

    // If we are currently on a business view page, navigate to the new business view
    if (pathname.includes('/businesses/view/')) {
      router.replace(`/businesses/view/${business.id}`);
    }

    onDismiss();
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
      await update('business_shares', shareId, { status: 'inactive' });
    } catch (error) {
      console.error('Error declining share:', error);
    } finally {
      setProcessingShareId(null);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Select Business"
      subtitle="Manage your businesses"
      edgeToEdge
      scrollable
      actions={[
        {
          label: 'Create New Business',
          mode: 'outlined',
          icon: 'plus',
          onPress: () => {
            setShowAddModal(true);
          },
          textColor: colors.primary,
        },
      ]}
    >
      <View style={styles.container}>
        {pendingInvites.length > 0 && (
          <View style={styles.invitesSection}>
            <Text
              variant="labelLarge"
              style={[styles.sectionTitle, { color: colors.primary }]}
            >
              PENDING INVITATIONS
            </Text>
            {pendingInvites.map(invite => (
              <View
                key={invite.id}
                style={[
                  styles.inviteCard,
                  {
                    backgroundColor: colors.surfaceVariant,
                    borderColor: colors.outlineVariant,
                  },
                ]}
              >
                <View style={styles.inviteInfo}>
                  <View style={styles.inviteTextContent}>
                    <Text variant="titleMedium">{invite.businessName}</Text>
                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                      wants to share their business with you
                    </Text>
                  </View>
                </View>
                <View style={styles.inviteActions}>
                  <Button
                    mode="outlined"
                    onPress={() => handleDeclineShare(invite.id)}
                    textColor={colors.error}
                    disabled={!!processingShareId}
                    style={styles.inviteButton}
                  >
                    Decline
                  </Button>
                  <Button
                    mode="contained"
                    onPress={() => handleAcceptShare(invite.id)}
                    loading={processingShareId === invite.id}
                    disabled={!!processingShareId}
                    style={styles.inviteButton}
                  >
                    Accept
                  </Button>
                </View>
              </View>
            ))}
            <Divider style={styles.sectionDivider} />
          </View>
        )}

        {businesses.length === 0 && pendingInvites.length === 0 ? (
          <EmptyState icon="domain" title="No businesses found" />
        ) : (
          businesses.map((item, _index) => (
            <React.Fragment key={item.id}>
              <List.Item
                title={item.name}
                titleStyle={{ fontSize: 16 }}
                description={
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    {item.isSharedWithMe ? 'Member' : 'Owner'} &nbsp;·&nbsp;{' '}
                    <MaterialCommunityIcons
                      name="account-group"
                      size={16}
                      color={colors.onSurfaceVariant}
                    />{' '}
                    &nbsp; {item.memberCount} members
                  </Text>
                }
                left={props => (
                  <View {...props} style={[props.style, { marginLeft: 8 }]}>
                    <BusinessLogo
                      logoUrl={item.logo_url}
                      colors={colors}
                      isSelected={item.id === selectedBusiness?.id}
                      size={40}
                    />
                  </View>
                )}
                right={props =>
                  item.id === selectedBusiness?.id ? (
                    <View {...props} style={[props.style, { justifyContent: 'center' }]}>
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={24}
                        color={colors.primary}
                      />
                    </View>
                  ) : null
                }
                onPress={() =>
                  item.id !== selectedBusiness?.id ? handleSelect(item) : onDismiss()
                }
              />
              <Divider />
            </React.Fragment>
          ))
        )}
      </View>
      <ManageBusinessModal
        visible={showAddModal}
        onDismiss={() => setShowAddModal(false)}
      />
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 10,
  },
  invitesSection: {
    marginBottom: 8,
  },
  sectionTitle: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    letterSpacing: 1,
  },
  inviteCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  inviteInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  inviteTextContent: {
    flex: 1,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 12,
  },
  inviteButton: {
    flex: 1,
    borderRadius: 10,
  },
  sectionDivider: {
    marginVertical: 8,
    height: 8,
    opacity: 0.1,
  },
});
