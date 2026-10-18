import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { IconButton, Menu, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import ContractEditModal from '@/features/contracts/components/ContractEditModal';
import PendingRentDetailsModal from '@/features/dashboard/components/PendingRentDetailsModal';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import HolidayBreakActionModal from '@/shared/components/HolidayBreakActionModal';
import {
  useContracts,
  useHouses,
  useProperties,
  useReceipts,
  useTenants,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDate, formatDateForDB, formatPeriod } from '@/shared/utils/formatters';
import {
  calculateEffectiveRent,
  parseMetadata,
  safeParseJSON,
} from '@/shared/utils/helper';
import {
  isActiveContractStatus,
  isActiveTenantStatus,
  isContractPaused,
} from '@/shared/utils/statusHelper';

interface PendingRentHousekeepingModalProps {
  visible: boolean;
  onDismiss: () => void;
}

export default function PendingRentHousekeepingModal({
  visible,
  onDismiss,
}: PendingRentHousekeepingModalProps) {
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const rawContracts = useContracts(selectedBusiness?.id);
  const tenants = useTenants(selectedBusiness?.id);
  const receipts = useReceipts(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const properties = useProperties(selectedBusiness?.id);

  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [holidayModalVisible, setHolidayModalVisible] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<{
    id: string;
    name: string;
    contractId?: string;
  } | null>(null);

  const tenantsWithPendingRent = useMemo(() => {
    if (!rawContracts || !tenants || !receipts) return [];

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const result: {
      tenantId: string;
      tenantName: string;
      propertyName: string;
      houseNumber: string;
      totalPending: number;
      firstStartDate: string | null;
      firstContractId: string | null;
      firstReceiptPeriod: string;
    }[] = [];

    tenants
      .filter(t => isActiveTenantStatus(t.status))
      .forEach(tenant => {
        const tenantContracts = rawContracts.filter(
          c =>
            c.tenant_id === tenant.id &&
            isActiveContractStatus(c.status) &&
            !isContractPaused(c),
        );
        if (tenantContracts.length === 0) return;

        const firstStartDate = tenantContracts.reduce(
          (earliest, c) => {
            if (!c.start_date) return earliest;
            if (!earliest || c.start_date < earliest) return c.start_date;
            return earliest;
          },
          null as string | null,
        );

        if (!firstStartDate) return;

        const firstContractId =
          tenantContracts.sort((a, b) => {
            if (!a.start_date) return 1;
            if (!b.start_date) return -1;
            return a.start_date.localeCompare(b.start_date);
          })[0]?.id || null;

        let totalPendingForTenant = 0;
        const earliestDate = new Date(firstStartDate);
        const cur = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1);

        while (
          cur.getFullYear() < currentYear ||
          (cur.getFullYear() === currentYear && cur.getMonth() + 1 <= currentMonth)
        ) {
          const periodMonth = cur.getMonth() + 1;
          const periodYear = cur.getFullYear();
          const periodMonthStart = formatDateForDB(
            new Date(periodYear, periodMonth - 1, 1),
          );
          const periodMonthEnd = formatDateForDB(new Date(periodYear, periodMonth, 0));

          // Find applicable contract for this period
          const applicableContracts = tenantContracts.filter(c => {
            const cStart = String(c.start_date || '');
            const cEnd = c.end_date ? String(c.end_date) : null;
            return cStart <= periodMonthEnd && (!cEnd || cEnd >= periodMonthStart);
          });

          if (applicableContracts.length > 0) {
            // Usually one contract per period, but if multiple, take latest one
            const contract = applicableContracts.sort(
              (a, b) =>
                new Date(b.start_date || 0).getTime() -
                new Date(a.start_date || 0).getTime(),
            )[0];

            const rentAmount = Number.parseFloat(String(contract.rent_amount || 0));
            const { breaks } = parseMetadata(contract.metadata);
            const { effectiveRent } = calculateEffectiveRent(
              rentAmount,
              periodMonth,
              periodYear,
              breaks,
            );

            const periodReceipts = receipts.filter(r => {
              if (r.contract_id !== contract.id || !r.payment_period) return false;
              const period = safeParseJSON(r.payment_period, null) as any;
              return period?.month === periodMonth && period?.year === periodYear;
            });

            const paidAmount = periodReceipts.reduce(
              (sum, r) =>
                sum +
                (Number.parseFloat(String(r.amount || 0)) -
                  Number.parseFloat(String(r.refunded_amount || 0))),
              0,
            );

            const pendingForPeriod = effectiveRent - paidAmount;
            totalPendingForTenant += pendingForPeriod;
          }

          cur.setMonth(cur.getMonth() + 1);
        }

        if (totalPendingForTenant > 0.99) {
          const activeContract =
            tenantContracts.find(c => isActiveContractStatus(c.status)) ||
            tenantContracts[0];
          const house = houses?.find(h => h.id === activeContract?.house_id);
          const property = properties?.find(p => p.id === house?.property_id);

          const tenantContractIds = tenantContracts.map(c => c.id);
          const tenantReceipts = receipts.filter(
            r => r.contract_id && tenantContractIds.includes(r.contract_id),
          );

          const firstReceipt = tenantReceipts
            .filter(r => r.payment_period)
            .sort((a, b) => {
              const pA = a.payment_period as any;
              const pB = b.payment_period as any;
              if (pA.year !== pB.year) return pA.year - pB.year;
              return pA.month - pB.month;
            })[0];

          const firstReceiptPeriod = firstReceipt?.payment_period
            ? formatPeriod(firstReceipt.payment_period as any)
            : 'N/A';

          result.push({
            tenantId: tenant.id,
            tenantName: tenant.name || 'Unknown',
            propertyName: property?.name || 'N/A',
            houseNumber: house?.house_number || 'N/A',
            totalPending: totalPendingForTenant,
            firstStartDate,
            firstContractId,
            firstReceiptPeriod,
          });
        }
      });

    return result.sort((a, b) => {
      if (!a.firstStartDate) return 1;
      if (!b.firstStartDate) return -1;
      return a.firstStartDate.localeCompare(b.firstStartDate);
    });
  }, [rawContracts, tenants, receipts, houses, properties]);

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Pending Rent Housekeeping"
      subtitle={`${tenantsWithPendingRent.length} tenants with unpaid receipts`}
      maxHeight="90%"
      scrollable
    >
      <View style={{ paddingBottom: 24 }}>
        {tenantsWithPendingRent.length === 0 ? (
          <EmptyState icon="cash-check" title="No tenants with pending rent" />
        ) : (
          tenantsWithPendingRent.map(item => (
            <View
              key={item.tenantId}
              style={[styles.contractCard, { borderBottomColor: colors.outlineVariant }]}
            >
              <View style={styles.contractHeader}>
                <View style={styles.tenantInfo}>
                  <Text variant="titleSmall" style={styles.tenantName}>
                    {item.tenantName}
                  </Text>
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    {item.propertyName} • Unit {item.houseNumber}
                  </Text>
                </View>
                <View style={styles.headerRight}>
                  <Menu
                    visible={menuVisible === item.tenantId}
                    onDismiss={() => setMenuVisible(null)}
                    anchor={
                      <IconButton
                        icon="dots-vertical"
                        onPress={() => setMenuVisible(item.tenantId)}
                        style={{ margin: -8 }}
                      />
                    }
                  >
                    <Menu.Item
                      onPress={() => {
                        setSelectedContractId(item.firstContractId);
                        setEditModalVisible(true);
                        setMenuVisible(null);
                      }}
                      title="Edit First Contract"
                      leadingIcon="pencil"
                    />
                    <Menu.Item
                      onPress={() => {
                        setMenuVisible(null);
                        setSelectedTenant({
                          id: item.tenantId,
                          name: item.tenantName,
                          contractId: item.firstContractId || undefined,
                        });
                        setDetailsModalVisible(true);
                      }}
                      title="View Pending Details"
                      leadingIcon="book-open-variant"
                    />
                    <Menu.Item
                      onPress={() => {
                        setMenuVisible(null);
                        setSelectedTenant({
                          id: item.tenantId,
                          name: item.tenantName,
                          contractId: item.firstContractId || undefined,
                        });
                        setHolidayModalVisible(true);
                      }}
                      title="Create Holiday Break"
                      leadingIcon="calendar-clock"
                    />
                  </Menu>
                </View>
              </View>

              <View style={styles.detailsRow}>
                <View style={styles.detailsContainer}>
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    First Contract: {formatDate(item.firstStartDate) || 'N/A'}
                  </Text>
                  <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                    First Receipt: {item.firstReceiptPeriod}
                  </Text>
                </View>

                <Text
                  variant="titleMedium"
                  style={{ color: colors.error, fontWeight: 'bold' }}
                >
                  {item.totalPending.toLocaleString()}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
      <ContractEditModal
        visible={editModalVisible}
        onDismiss={() => setEditModalVisible(false)}
        contractId={selectedContractId}
      />

      <PendingRentDetailsModal
        visible={detailsModalVisible}
        onDismiss={() => setDetailsModalVisible(false)}
        tenantId={selectedTenant?.id || null}
        tenantName={selectedTenant?.name || null}
      />

      <HolidayBreakActionModal
        visible={holidayModalVisible}
        onDismiss={() => setHolidayModalVisible(false)}
        targetContractIds={selectedTenant?.contractId ? [selectedTenant.contractId] : []}
        tenantName={selectedTenant?.name || null}
      />
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  contractCard: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    paddingHorizontal: 4,
  },
  contractHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  tenantInfo: {
    flex: 1,
  },
  tenantName: {
    fontWeight: 'bold',
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 4,
  },
  detailsContainer: {
    flex: 1,
    gap: 2,
  },
});
