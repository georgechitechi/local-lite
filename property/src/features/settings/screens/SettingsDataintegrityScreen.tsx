const setHouseViewModalVisible = (value: UIState['houseViewModalVisible']) =>
  setUIField('houseViewModalVisible', value);
const setHouseViewHouseId = (value: UIState['houseViewHouseId']) =>
  setUIField('houseViewHouseId', value);
const setPaymentMessagesListModalVisible = (
  value: UIState['paymentMessagesListModalVisible'],
) => setUIField('paymentMessagesListModalVisible', value);

import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, List, Surface, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import BookingDetailsModal from '@/features/payments/components/BookingDetailsModal';
import {
  ChangeReceiptDateModal,
  DeduplicateRecordsModal,
  IssueDetailsModal,
  MakeTenantFormerModal,
  PurgeRecordsModal,
  RenewContractModal,
  UpdateCommissioningDateModal,
  UpdateContractStartDateModal,
} from '@/features/settings/components/data-integrity';
import { useDataIntegrityActions } from '@/shared/hooks/useDataIntegrityActions';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import {
  useBookings,
  useContracts,
  useContractsById,
  useContractsByTenantId,
  useExpenses,
  useHouses,
  useMaintenanceRequests,
  usePaymentMessageReceipts,
  usePaymentMessages,
  usePromotions,
  useProperties,
  useReceipts,
  useReceiptsById,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import {
  type IntegrityIssue,
  type IntegrityScanData,
  performIntegrityScan,
} from '@/shared/utils/integrityUtils';
import { setUIField, type UIState } from '@/stores/uiStore';

export default function DataIntegrityScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const { isSyncActive: isCloudSyncEnabled } = useLocalSync();
  const { checkOnline } = useOfflineCheck();
  const { showSnackbar } = useSnackbar();

  // Scanner state
  const [loading, setLoading] = useState(false);
  const [hasRunAll, setHasRunAll] = useState(false);
  const [scanResults, setScanResults] = useState<IntegrityIssue[]>([]);
  const [currentModal, setCurrentModal] = useState<string | null>(null);

  // Resolution Dialog States
  const [renewDialogVisible, setRenewDialogVisible] = useState(false);
  const [renewTenant, setRenewTenant] = useState<any>(null);

  const [formerDialogVisible, setFormerDialogVisible] = useState(false);
  const [formerTenant, setFormerTenant] = useState<any>(null);

  const [commissioningDialogVisible, setCommissioningDialogVisible] = useState(false);
  const [commissioningHouse, setCommissioningHouse] = useState<any>(null);

  const [contractStartDateDialogVisible, setContractStartDateDialogVisible] =
    useState(false);
  const [contractStartDateHouse, setContractStartDateHouse] = useState<any>(null);
  const [availableEarlyContracts, setAvailableEarlyContracts] = useState<any[]>([]);

  const [changeReceiptDateDialogVisible, setChangeReceiptDateDialogVisible] =
    useState(false);
  const [receiptToChangeDate, setReceiptToChangeDate] = useState<any>(null);

  const [showPurgeModal, setShowPurgeModal] = useState(false);

  const [bookingDetailsVisible, setBookingDetailsVisible] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);

  // Data Store Queries
  const contractsById = useContractsById(selectedBusiness?.id);
  const receiptsById = useReceiptsById(selectedBusiness?.id);
  const contractsByTenant = useContractsByTenantId(selectedBusiness?.id);

  const allTenants = useTenants(selectedBusiness?.id);
  const allContracts = useContracts(selectedBusiness?.id);
  const allHouses = useHouses(selectedBusiness?.id);
  const allReceipts = useReceipts(selectedBusiness?.id);
  const allProperties = useProperties(selectedBusiness?.id);
  const allExpenses = useExpenses(selectedBusiness?.id);
  const allPaymentMessages = usePaymentMessages(selectedBusiness?.id);
  const allPaymentMessageReceipts = usePaymentMessageReceipts(selectedBusiness?.id);
  const allBookings = useBookings(selectedBusiness?.id);
  const allMaintenance = useMaintenanceRequests(selectedBusiness?.id);
  const allPromos = usePromotions(selectedBusiness?.id);

  const runFullScan = async () => {
    if (!selectedBusiness?.id) return [];
    setLoading(true);
    setHasRunAll(false);

    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      const scanData: IntegrityScanData = {
        allTenants,
        allContracts,
        allHouses,
        allReceipts,
        allProperties,
        allExpenses,
        allPaymentMessages,
        allPaymentMessageReceipts,
        allBookings,
        allMaintenance,
        allPromos,
      };
      const results = performIntegrityScan(scanData);
      setScanResults(results);
      setHasRunAll(true);
      const issuesFound = results.filter(r => (r?.items?.length || 0) > 0).length;
      showSnackbar(`Scan complete. ${issuesFound} check(s) need attention.`, 'success');
      return results;
    } catch (e: any) {
      showSnackbar(`Scan failed: ${e.message}`, 'error');
      return [];
    } finally {
      setLoading(false);
    }
  };

  // Integrity Actions Hook
  const actions = useDataIntegrityActions({
    allContracts,
    allProperties,
    allHouses,
    allPaymentMessages,
    allPaymentMessageReceipts,
    contractsById,
    contractsByTenant,
    showSnackbar,
    runFullScan,
    setCurrentModal,
  });

  // Modal Openers
  const handleOpenRenewDialog = (tenant: any) => {
    if (!tenant?.latest_contract) {
      showSnackbar('No previous contract found.', 'error');
      return;
    }
    setRenewTenant(tenant);
    setCurrentModal(null);
    setRenewDialogVisible(true);
  };

  const handleOpenFormerDialog = (tenant: any) => {
    setFormerTenant(tenant);
    setCurrentModal(null);
    setFormerDialogVisible(true);
  };

  const handleOpenCommissioningDialog = (item: any) => {
    const house = item.house || allHouses.find(h => h.id === item.id);
    if (!house) return;
    setCommissioningHouse(house);
    setCurrentModal(null);
    setCommissioningDialogVisible(true);
  };

  const handleOpenContractStartDateDialog = (item: any) => {
    const house = item.house || allHouses.find(h => h.id === item.id);
    const early =
      item.contracts?.length > 0
        ? item.contracts
        : allContracts.filter(c => c.house_id === item.id && c.start_date);

    if (early.length === 0) {
      showSnackbar('No early contracts found for this house.', 'error');
      return;
    }

    setContractStartDateHouse(house || { house_number: item.name || item.id });
    setAvailableEarlyContracts(early);
    setCurrentModal(null);
    setContractStartDateDialogVisible(true);
  };

  const handleOpenChangeReceiptDateDialog = (item: any) => {
    setReceiptToChangeDate(item);
    setCurrentModal(null);
    setChangeReceiptDateDialogVisible(true);
  };

  const handleViewDetails = (item: any, issueId: string) => {
    setCurrentModal(null);

    if (issueId === 'receiptDateMismatches') {
      router.push(`/receipts/view/${item.id}` as any);
      return;
    }

    if (issueId === 'unconvertedBookings' || issueId === 'orphanedBookings') {
      setSelectedBookingId(item.id);
      setBookingDetailsVisible(true);
      return;
    }

    if (issueId === 'unlinkedPaymentMessages') {
      setPaymentMessagesListModalVisible(true);
      return;
    }

    if (item.tenant_id) {
      router.push(`/tenants/view/${item.tenant_id}` as any);
    } else if (item.house_id) {
      setHouseViewHouseId(item.house_id);
      setHouseViewModalVisible(true);
    } else if (item.id) {
      if (issueId === 'orphanedHouses' || issueId === 'occupiedBeforeBuilt') {
        setHouseViewHouseId(item.id);
        setHouseViewModalVisible(true);
      } else if (issueId.includes('Tenant')) {
        router.push(`/tenants/view/${item.id}` as any);
      }
    }
  };

  const getSeverityColor = (severity: string) => {
    if (severity === 'critical') return colors.error;
    if (severity === 'warning') return (colors as any).warning;
    return colors.primary;
  };

  const actualIssueCount = scanResults.filter(r => (r?.items?.length || 0) > 0).length;
  const currentIssue = scanResults.find(r => r.id === currentModal) || null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Surface style={[styles.scanHeader, { backgroundColor: colors.surfaceVariant }]}>
          <MaterialCommunityIcons name="database-eye" size={40} color={colors.primary} />
          <Text
            variant="headlineSmall"
            style={[styles.scanTitle, { color: colors.onSurfaceVariant }]}
          >
            Deep Data Scan
          </Text>
          <Text
            variant="bodyMedium"
            style={[styles.scanSubtitle, { color: colors.onSurfaceVariant }]}
          >
            Analyze every record in your database for inconsistencies, orphaned links, and
            financial anomalies.
          </Text>
          <Button
            mode="contained"
            onPress={runFullScan}
            loading={loading}
            disabled={loading}
            icon="radar"
            style={styles.scanButton}
            contentStyle={{ height: 48 }}
          >
            {hasRunAll ? 'Perform Deep Re-Scan' : 'Run Full Integrity Scan'}
          </Button>
          {isCloudSyncEnabled && (
            <>
              <Button
                mode="outlined"
                onPress={() => setShowPurgeModal(true)}
                icon="delete-sweep"
                textColor={colors.error}
                style={[styles.scanButton, { marginTop: 12, borderColor: colors.error }]}
                contentStyle={{ height: 48 }}
              >
                Purge Soft-Deleted Records
              </Button>
              <Button
                mode="outlined"
                onPress={actions.handleDataCleanup}
                icon="broom"
                textColor={colors.primary}
                style={[
                  styles.scanButton,
                  { marginTop: 12, borderColor: colors.primary },
                ]}
                contentStyle={{ height: 48 }}
                loading={actions.processing}
                disabled={actions.processing}
              >
                Run Data Cleanup
              </Button>
            </>
          )}
        </Surface>

        {hasRunAll && (
          <View style={styles.resultsContainer}>
            <Surface
              style={[
                styles.summaryBanner,
                {
                  backgroundColor:
                    actualIssueCount === 0
                      ? (colors as any).successContainer
                      : colors.errorContainer,
                  borderColor:
                    actualIssueCount === 0 ? (colors as any).success : colors.error,
                  borderWidth: 1,
                  borderRadius: 12,
                  padding: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginBottom: 16,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={actualIssueCount === 0 ? 'check-decagram' : 'alert-decagram'}
                size={32}
                color={actualIssueCount === 0 ? (colors as any).success : colors.error}
              />
              <View style={{ marginLeft: 16, flex: 1 }}>
                <Text
                  variant="titleMedium"
                  style={{
                    fontWeight: 'bold',
                    color:
                      actualIssueCount === 0
                        ? (colors as any).onSuccessContainer
                        : colors.onSecondaryContainer,
                  }}
                >
                  {actualIssueCount === 0
                    ? 'Database Healthy'
                    : `${actualIssueCount} Areas Need Attention`}
                </Text>
                <Text
                  variant="bodySmall"
                  style={{
                    color:
                      actualIssueCount === 0
                        ? (colors as any).onSuccessContainer
                        : colors.onSecondaryContainer,
                    opacity: 0.8,
                  }}
                >
                  {actualIssueCount === 0
                    ? 'All internal links and statuses are synchronized.'
                    : 'We found some inconsistencies that may need your review.'}
                </Text>
              </View>
            </Surface>

            {['Relationship', 'Status', 'Financial', 'Logical', 'Quality'].map(cat => {
              const catIssues = scanResults.filter(
                r => r.category === cat && (r?.items?.length || 0) > 0,
              );
              if (catIssues.length === 0) return null;

              return (
                <List.Section key={cat}>
                  <List.Subheader style={{ color: colors.primary, fontWeight: 'bold' }}>
                    {cat.toUpperCase()}
                  </List.Subheader>
                  {catIssues.map(issue => {
                    const statusColor = getSeverityColor(issue.severity);
                    const iconName = 'alert-circle';

                    return (
                      <List.Item
                        key={issue.id}
                        title={issue.title}
                        description={issue.description}
                        right={_props => (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              marginRight: -4,
                            }}
                          >
                            <Pressable
                              onPress={() => {
                                setCurrentModal(issue.id);
                              }}
                              style={({ pressed }) => ({
                                opacity: pressed ? 0.6 : 1,
                                padding: 8,
                              })}
                            >
                              <MaterialCommunityIcons
                                name={iconName}
                                size={24}
                                color={statusColor}
                              />
                            </Pressable>
                          </View>
                        )}
                        style={[
                          styles.issueItem,
                          {
                            borderLeftColor: statusColor,
                            backgroundColor: colors.surface,
                          },
                        ]}
                        titleStyle={{ color: colors.onSurface }}
                        descriptionStyle={{ color: colors.onSurfaceVariant }}
                      />
                    );
                  })}
                </List.Section>
              );
            })}
          </View>
        )}

        {!hasRunAll && !loading && (
          <View style={{ padding: 60, alignItems: 'center' }}>
            <MaterialCommunityIcons
              name="shield-search"
              size={60}
              color={colors.onSurface}
              style={{ opacity: 0.2 }}
            />
            <Text
              variant="bodyMedium"
              style={{ marginTop: 20, opacity: 0.4, textAlign: 'center' }}
            >
              No scan data yet. Run the scanner to verify your business data integrity.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Main Issue Details Modal */}
      <IssueDetailsModal
        issue={currentIssue}
        visible={!!currentModal && currentModal !== 'duplicateDetection'}
        onDismiss={() => setCurrentModal(null)}
        processing={actions.processing}
        onOpenRenewDialog={handleOpenRenewDialog}
        onOpenFormerDialog={handleOpenFormerDialog}
        onResolveHouseStatus={actions.handleResolveHouseStatus}
        onOpenUpdateCommissioningDialog={handleOpenCommissioningDialog}
        onOpenUpdateContractStartDateDialog={handleOpenContractStartDateDialog}
        onAcceptReceiptAsIs={actions.handleAcceptReceiptAsIs}
        onAcceptOccupiedBeforeBuiltAsIs={actions.handleAcceptOccupiedBeforeBuiltAsIs}
        onOpenChangeReceiptDateDialog={handleOpenChangeReceiptDateDialog}
        onRelinkSingleReceipt={actions.handleRelinkSingleReceipt}
        onFixSingleItemAmount={actions.handleFixSingleItemAmount}
        onViewDetails={handleViewDetails}
        onFixFormerFutureDates={actions.handleFixFormerFutureDates}
        onFixOrphanedBookings={actions.handleFixOrphanedBookings}
        onFixReceiptDates={actions.handleFixReceiptDates}
        onAdjustContractsToCoverReceipts={actions.handleAdjustContractsToCoverReceipts}
        onAcceptAllReceiptDates={actions.handleAcceptAllReceiptDates}
        onAcceptAllOccupiedBeforeBuilt={actions.handleAcceptAllOccupiedBeforeBuilt}
        onFixUnformattedAmounts={actions.handleFixUnformattedAmounts}
        onMaskPhoneNumbers={actions.handleMaskPhoneNumbers}
        onUppercaseReferences={actions.handleUppercaseReferences}
        onSyncReceiptNotes={actions.handleSyncReceiptNotes}
      />

      {/* Deduplicate Records Modal */}
      <DeduplicateRecordsModal
        visible={currentModal === 'duplicateDetection'}
        onDismiss={() => setCurrentModal(null)}
        businessId={selectedBusiness?.id}
        allPaymentMessages={allPaymentMessages}
        allExpenses={allExpenses}
        allPaymentMessageReceipts={allPaymentMessageReceipts}
        receiptsById={receiptsById}
        checkOnline={checkOnline}
        showSnackbar={showSnackbar}
        onSuccess={runFullScan}
      />

      {/* Purge Soft-Deleted Records Modal */}
      <PurgeRecordsModal
        visible={showPurgeModal}
        onDismiss={() => setShowPurgeModal(false)}
        businessId={selectedBusiness?.id}
        checkOnline={checkOnline}
        showSnackbar={showSnackbar}
        onSuccess={runFullScan}
      />

      {/* Booking Details Modal */}
      <BookingDetailsModal
        visible={bookingDetailsVisible}
        onDismiss={() => setBookingDetailsVisible(false)}
        bookingId={selectedBookingId}
        businessId={selectedBusiness?.id}
      />

      {/* Renew Contract Dialog */}
      <RenewContractModal
        visible={renewDialogVisible}
        onDismiss={() => {
          setRenewDialogVisible(false);
          setRenewTenant(null);
          setCurrentModal('tenantsWithoutContracts');
        }}
        tenant={renewTenant}
        onRenew={async newEndDate => {
          await actions.handleRenewContract(renewTenant, newEndDate);
          setRenewDialogVisible(false);
          setRenewTenant(null);
          setCurrentModal('tenantsWithoutContracts');
        }}
        processing={actions.processing}
      />

      {/* Make Tenant Former Dialog */}
      <MakeTenantFormerModal
        visible={formerDialogVisible}
        onDismiss={() => {
          setFormerDialogVisible(false);
          setFormerTenant(null);
          setCurrentModal('tenantsWithoutContracts');
        }}
        tenant={formerTenant}
        onConfirm={async dateVacated => {
          await actions.handleMakeFormer(formerTenant, dateVacated);
          setFormerDialogVisible(false);
          setFormerTenant(null);
          setCurrentModal('tenantsWithoutContracts');
        }}
        processing={actions.processing}
      />

      {/* Update Commissioning Date Dialog */}
      <UpdateCommissioningDateModal
        visible={commissioningDialogVisible}
        onDismiss={() => {
          setCommissioningDialogVisible(false);
          setCommissioningHouse(null);
          setCurrentModal('occupiedBeforeBuilt');
        }}
        house={commissioningHouse}
        properties={allProperties}
        onConfirm={async (target, newDate) => {
          await actions.handleUpdateCommissioningDate(
            commissioningHouse,
            target,
            newDate,
          );
          setCommissioningDialogVisible(false);
          setCommissioningHouse(null);
          setCurrentModal('occupiedBeforeBuilt');
        }}
        processing={actions.processing}
      />

      {/* Update Contract Start Date Dialog */}
      <UpdateContractStartDateModal
        visible={contractStartDateDialogVisible}
        onDismiss={() => {
          setContractStartDateDialogVisible(false);
          setContractStartDateHouse(null);
          setAvailableEarlyContracts([]);
          setCurrentModal('occupiedBeforeBuilt');
        }}
        house={contractStartDateHouse}
        availableEarlyContracts={availableEarlyContracts}
        allTenants={allTenants}
        onConfirmSingle={async (contract, newDate) => {
          await actions.handleUpdateContractStartDate(contract, newDate);
          setContractStartDateDialogVisible(false);
          setContractStartDateHouse(null);
          setAvailableEarlyContracts([]);
          setCurrentModal('occupiedBeforeBuilt');
        }}
        onConfirmAll={async (contracts, newDate) => {
          await actions.handleUpdateAllEarlyContractsStartDate(contracts, newDate);
          setContractStartDateDialogVisible(false);
          setContractStartDateHouse(null);
          setAvailableEarlyContracts([]);
          setCurrentModal('occupiedBeforeBuilt');
        }}
        processing={actions.processing}
      />

      {/* Change Receipt Date Dialog */}
      <ChangeReceiptDateModal
        visible={changeReceiptDateDialogVisible}
        onDismiss={() => {
          setChangeReceiptDateDialogVisible(false);
          setReceiptToChangeDate(null);
          setCurrentModal('receiptDateMismatches');
        }}
        receipt={receiptToChangeDate}
        onConfirm={async (receipt, newDate) => {
          await actions.handleUpdateReceiptPaymentDate(receipt, newDate);
          setChangeReceiptDateDialogVisible(false);
          setReceiptToChangeDate(null);
          setCurrentModal('receiptDateMismatches');
        }}
        processing={actions.processing}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  scanHeader: {
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    elevation: 2,
    marginBottom: 16,
  },
  scanTitle: {
    fontWeight: 'bold',
    marginTop: 8,
  },
  scanSubtitle: {
    textAlign: 'center',
    marginTop: 4,
    opacity: 0.7,
    marginBottom: 16,
  },
  scanButton: {
    width: '100%',
    borderRadius: 12,
  },
  resultsContainer: {
    marginTop: 8,
  },
  summaryBanner: {
    borderLeftWidth: 6,
  },
  issueItem: {
    marginBottom: 8,
    borderRadius: 12,
    borderLeftWidth: 6,
    elevation: 1,
  },
});
