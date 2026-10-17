import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useMemo, useState } from 'react';
import { Dimensions, Linking, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, IconButton, Surface, Text } from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import BaseModal from '@/shared/components/BaseModal';
import CachedImage from '@/shared/components/CachedImage';
import HistoryModal from '@/shared/components/HistoryModal';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useBookings, useCoreMutations, useTenantsById } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { properCase } from '@/shared/utils/helper';

interface Document {
  id?: string;
  url: string;
  name?: string;
  type?: string;
  size?: number;
  uploadedAt?: string;
}

interface BookingDetailsModalProps {
  visible: boolean;
  onDismiss: () => void;
  bookingId: string | null;
  businessId?: string;
}

const getStatusColor = (status: string, colors: any): string => {
  switch (status) {
    case 'pending':
      return colors.warning;
    case 'approved':
      return colors.success;
    case 'rejected':
      return colors.error;
    case 'converted':
      return colors.primary;
    case 'reserved':
      return colors.tertiary;
    default:
      return colors.onSurfaceVariant;
  }
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  reserved: 'Reserved',
  converted: 'Converted',
};

export default function BookingDetailsModal({
  visible,
  onDismiss,
  bookingId,
  businessId,
}: BookingDetailsModalProps) {
  const colors = useThemeColors();
  const { isOwner, can } = useAccessControl();
  const { showSnackbar } = useSnackbar();
  const screenWidth = Dimensions.get('window').width;

  const [documentPreviewVisible, setDocumentPreviewVisible] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const allBookings = useBookings(businessId);
  const { delete: deleteRecord } = useCoreMutations();
  const tenantsById = useTenantsById(businessId);

  const request = useMemo(() => {
    if (!bookingId) return null;
    const b = allBookings.find(item => item.id === bookingId);
    if (!b) return null;

    const convertedTenant = b.converted_tenant_id
      ? tenantsById.get(b.converted_tenant_id as string)
      : undefined;

    let next_of_kin = b.next_of_kin;
    if (typeof next_of_kin === 'string') {
      try {
        next_of_kin = JSON.parse(next_of_kin);
      } catch {}
    }

    let documents = b.documents;
    if (typeof documents === 'string') {
      try {
        documents = JSON.parse(documents);
      } catch {}
    }

    return {
      ...b,
      next_of_kin,
      documents,
      converted_tenant: convertedTenant
        ? { id: convertedTenant.id, name: convertedTenant.name }
        : undefined,
    };
  }, [bookingId, allBookings, tenantsById]);

  const handleDelete = async () => {
    if (!bookingId) return;
    try {
      setDeleting(true);
      await deleteRecord('bookings', bookingId);
      showSnackbar('Booking deleted successfully', 'success');
      setDeleteConfirmVisible(false);
      onDismiss();
    } catch (error: any) {
      showSnackbar(`Failed to delete booking: ${error.message}`, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleDocumentPreview = (doc: Document) => {
    setPreviewDocument(doc);
    setDocumentPreviewVisible(true);
  };

  const renderInfoItem = (
    icon: string,
    label: string,
    value: string | null | undefined,
  ) => (
    <View style={styles.infoItem}>
      <View style={styles.infoIcon}>
        <MaterialCommunityIcons
          name={icon as any}
          size={20}
          color={colors.onSurfaceVariant}
        />
      </View>
      <View style={styles.infoContent}>
        <Text variant="labelSmall" style={styles.infoLabel}>
          {label}
        </Text>
        <Text variant="bodyMedium" style={styles.infoValue}>
          {value || 'Not provided'}
        </Text>
      </View>
    </View>
  );

  if (!request && visible) {
    return (
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title="Request Details"
        subtitle="Manage your properties"
      >
        <View style={styles.center}>
          <Text>Request not found</Text>
        </View>
      </BaseModal>
    );
  }

  return (
    <>
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title="Booking Details"
        subtitle="Manage your properties"
        maxHeight="90%"
        scrollable={true}
        actions={[
          ...(can('delete', 'booking')
            ? [
                {
                  label: 'Delete Booking',
                  onPress: () => setDeleteConfirmVisible(true),
                  mode: 'outlined' as const,
                  buttonColor: colors.error,
                  icon: 'delete-outline',
                },
              ]
            : []),
          {
            label: 'Close',
            onPress: onDismiss,
            mode: 'contained',
          },
        ]}
      >
        <View style={styles.container}>
          <Surface
            style={[styles.header, { backgroundColor: colors.surfaceVariant }]}
            elevation={0}
          >
            <View style={styles.headerContent}>
              <View style={{ flex: 1 }}>
                <Text variant="headlineSmall" style={{ fontWeight: 'bold' }}>
                  {request?.name}
                </Text>
                <Text variant="bodyMedium" style={{ opacity: 0.8 }}>
                  {request?.phone}
                </Text>
              </View>
              <Chip
                mode="outlined"
                style={{
                  borderColor: getStatusColor(request?.status || '', colors),
                  borderRadius: 12,
                }}
                textStyle={{
                  color: getStatusColor(request?.status || '', colors),
                  fontWeight: 'bold',
                }}
              >
                {STATUS_LABELS[request?.status || ''] || request?.status}
              </Chip>
            </View>
          </Surface>

          <Card style={styles.sectionCard} mode="contained">
            <Card.Content>
              {renderInfoItem('account', 'Full Name', request?.name)}
              {renderInfoItem('phone', 'Phone Number', request?.phone)}
              {renderInfoItem('email', 'Email Address', request?.email)}
              {renderInfoItem('home', 'Address', request?.address)}
              {renderInfoItem(
                'gender-male-female',
                'Gender',
                properCase(request?.gender),
              )}
              {renderInfoItem(
                'ring',
                'Marital Status',
                properCase(request?.marital_status),
              )}
              {renderInfoItem('earth', 'Nationality', request?.nationality)}
            </Card.Content>
          </Card>

          {request?.next_of_kin &&
            Array.isArray(request.next_of_kin) &&
            request.next_of_kin.length > 0 && (
              <Card style={styles.sectionCard} mode="contained">
                <Card.Title title="Next of Kin" titleStyle={{ fontWeight: 'bold' }} />
                <Card.Content>
                  {request.next_of_kin.map((kin: any, index: number) => (
                    <View
                      key={index}
                      style={[styles.kinItem, { backgroundColor: colors.surfaceVariant }]}
                    >
                      <View style={styles.row}>
                        <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                          {kin.name}
                        </Text>
                        {(kin.isPrimary || kin.is_primary) && (
                          <MaterialCommunityIcons
                            name="star"
                            size={16}
                            color={colors.tertiary}
                            style={{ marginLeft: 8 }}
                          />
                        )}
                      </View>
                      <Text variant="bodySmall">Relationship: {kin.relationship}</Text>
                      <Text variant="bodySmall">Phone: {kin.phone}</Text>
                    </View>
                  ))}
                </Card.Content>
              </Card>
            )}

          {request?.documents &&
            Array.isArray(request.documents) &&
            request.documents.length > 0 && (
              <Card style={styles.sectionCard} mode="contained">
                <Card.Title title="Documents" titleStyle={{ fontWeight: 'bold' }} />
                <Card.Content>
                  {request.documents.map((doc: any, index: number) => (
                    <View
                      key={index}
                      style={[
                        styles.documentItem,
                        { backgroundColor: colors.surfaceVariant },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="file-document-outline"
                        size={24}
                        color={colors.primary}
                      />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text variant="bodyMedium" numberOfLines={1}>
                          {doc.name || `File ${index + 1}`}
                        </Text>
                        <Text variant="labelSmall">
                          {doc.size ? `${Math.round(doc.size / 1024)} KB` : ''}
                        </Text>
                      </View>
                      <IconButton
                        icon="eye-outline"
                        onPress={() => handleDocumentPreview(doc)}
                      />
                    </View>
                  ))}
                </Card.Content>
              </Card>
            )}

          <Card style={styles.sectionCard} mode="contained">
            <Card.Title title="Timeline" titleStyle={{ fontWeight: 'bold' }} />
            <Card.Content>
              <View style={styles.timelineItem}>
                <MaterialCommunityIcons
                  name="clock-outline"
                  size={20}
                  color={colors.onSurfaceVariant}
                />
                <View style={{ marginLeft: 12 }}>
                  <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                    Submitted
                  </Text>
                  <Text variant="bodySmall">
                    {new Date(request?.created_at || 0).toLocaleString()}
                  </Text>
                </View>
              </View>
              {request?.metadata?.reviews?.map((review: any, idx: number) => (
                <View key={idx} style={styles.timelineItem}>
                  <MaterialCommunityIcons
                    name="check-circle-outline"
                    size={20}
                    color={colors.primary}
                  />
                  <View style={{ marginLeft: 12 }}>
                    <Text variant="bodyMedium" style={{ fontWeight: 'bold' }}>
                      {STATUS_LABELS[review.status] || review.status}
                    </Text>
                    <Text variant="bodySmall">
                      {new Date(review.reviewed_at || 0).toLocaleString()} by{' '}
                      {review.reviewed_by}
                    </Text>
                    {review.review_notes && (
                      <Text variant="bodySmall" style={{ fontStyle: 'italic' }}>
                        Notes: {review.review_notes}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </Card.Content>
          </Card>

          {isOwner && (
            <HistoryModal
              entityType="bookings"
              entityId={request?.id}
              containerStyle={{ marginHorizontal: 16, marginBottom: 32 }}
            />
          )}
        </View>
      </BaseModal>

      {/* Delete Confirmation */}
      <BaseModal
        visible={deleteConfirmVisible}
        onDismiss={() => setDeleteConfirmVisible(false)}
        title="Delete Booking"
        mode="confirm"
        onConfirm={handleDelete}
        loading={deleting}
        destructive={true}
        confirmText="Delete"
      >
        <Text variant="bodyMedium">
          Are you sure you want to permanently delete the booking for{' '}
          <Text style={{ fontWeight: 'bold' }}>{request?.name}</Text>? This action cannot
          be undone.
        </Text>
      </BaseModal>

      <BaseModal
        visible={documentPreviewVisible}
        onDismiss={() => setDocumentPreviewVisible(false)}
        title={previewDocument?.name || 'Preview'}
        subtitle="Manage your properties"
        edgeToEdge
        maxHeight="100%"
        scrollable={true}
        rounded={false}
      >
        {previewDocument && (
          <View style={{ flex: 1, alignItems: 'center' }}>
            {previewDocument.url?.match(/\.(jpg|jpeg|png|webp)$/i) ? (
              <CachedImage
                uri={previewDocument.url}
                style={{ width: screenWidth, height: screenWidth * 1.5 }}
                resizeMode="contain"
              />
            ) : (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <MaterialCommunityIcons
                  name="file-document-outline"
                  size={80}
                  color={colors.outline}
                />
                <Text style={{ marginVertical: 20 }}>
                  Preview not available for this file type
                </Text>
                <Button
                  mode="contained"
                  onPress={() => Linking.openURL(previewDocument.url)}
                >
                  Open Externally
                </Button>
              </View>
            )}
          </View>
        )}
      </BaseModal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    padding: 40,
    alignItems: 'center',
  },
  header: {
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionCard: {
    marginBottom: 16,
    borderRadius: 16,
  },
  infoItem: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  infoIcon: {
    width: 32,
    alignItems: 'center',
  },
  infoContent: {
    flex: 1,
    marginLeft: 8,
  },
  infoLabel: {
    opacity: 0.7,
  },
  infoValue: {
    fontWeight: '500',
  },
  kinItem: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 12,
    marginBottom: 8,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 16,
  },
});
