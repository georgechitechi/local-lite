import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { DataTable, Divider, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import { useContracts, useReceipts } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatMonthYear } from '@/shared/utils/formatters';
import { calculateEffectiveRent, parseMetadata } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';

interface PendingRentDetailsModalProps {
  visible: boolean;
  onDismiss: () => void;
  tenantId: string | null;
  tenantName: string | null;
}

export default function PendingRentDetailsModal({
  visible,
  onDismiss,
  tenantId,
  tenantName,
}: PendingRentDetailsModalProps) {
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const rawContracts = useContracts(selectedBusiness?.id);
  const receipts = useReceipts(selectedBusiness?.id);

  const details = useMemo(() => {
    if (!tenantId || !rawContracts || !receipts) return [];

    const tenantContracts = rawContracts.filter(
      c => c.tenant_id === tenantId && !c.deleted && isActiveContractStatus(c.status),
    );
    if (tenantContracts.length === 0) return [];

    const tenantReceipts = receipts.filter(r => r.tenant_id === tenantId && !r.deleted);

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const firstStartDate = tenantContracts.reduce(
      (earliest, c) => {
        if (!c.start_date) return earliest;
        if (!earliest || c.start_date < earliest) return c.start_date;
        return earliest;
      },
      null as string | null,
    );

    if (!firstStartDate) return [];

    const start = new Date(firstStartDate);
    const breakdown = [];

    const iterDate = new Date(start.getFullYear(), start.getMonth(), 1);
    const endDateLimit = new Date(currentYear, currentMonth, 1);

    while (iterDate <= endDateLimit) {
      const month = iterDate.getMonth();
      const year = iterDate.getFullYear();

      // Find applicable contract for this month
      const contract = tenantContracts.find(c => {
        if (!c.start_date) return false;
        const [sY, sM] = c.start_date.split('-').map(Number);
        const cStartMonth = new Date(sY, sM - 1, 1);

        if (cStartMonth > iterDate) return false;

        if (c.end_date) {
          const [eY, eM] = c.end_date.split('-').map(Number);
          const cEndMonth = new Date(eY, eM - 1, 1);
          if (cEndMonth < iterDate) return false;
        }
        return true;
      });

      if (contract) {
        const metadata = parseMetadata(contract.metadata);

        const { effectiveRent: due } = calculateEffectiveRent(
          contract.rent_amount || 0,
          month + 1,
          year,
          metadata.breaks || [],
        );

        const paid = tenantReceipts
          .filter(r => {
            let period = r.payment_period as any;
            if (typeof period === 'string') {
              try {
                period = JSON.parse(period);
              } catch (_e) {
                return false;
              }
            }
            return period?.month === month + 1 && period?.year === year;
          })
          .reduce((sum, r) => sum + (parseFloat(String(r.amount)) || 0), 0);

        const balance = due - paid;
        if (balance > 0) {
          breakdown.push({
            period: formatMonthYear(iterDate),
            due,
            paid,
            balance,
          });
        }
      }

      iterDate.setMonth(iterDate.getMonth() + 1);
    }

    return breakdown.reverse(); // Newest first
  }, [tenantId, rawContracts, receipts]);

  const totalPending = details.reduce((sum, d) => sum + d.balance, 0);

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Pending Rent Details"
      subtitle={tenantName || ''}
      edgeToEdge
      maxHeight="80%"
    >
      <ScrollView style={styles.container}>
        {details.length === 0 ? (
          <EmptyState
            icon="cash-remove"
            title="No pending rent"
            description="No pending rent found for this tenant."
          />
        ) : (
          <>
            <DataTable>
              <DataTable.Header>
                <DataTable.Title>Period</DataTable.Title>
                <DataTable.Title numeric>Due</DataTable.Title>
                <DataTable.Title numeric>Paid</DataTable.Title>
                <DataTable.Title numeric>Balance</DataTable.Title>
              </DataTable.Header>

              {details.map((row, index) => (
                <DataTable.Row key={index}>
                  <DataTable.Cell>{row.period}</DataTable.Cell>
                  <DataTable.Cell numeric>{row.due.toLocaleString()}</DataTable.Cell>
                  <DataTable.Cell numeric>{row.paid.toLocaleString()}</DataTable.Cell>
                  <DataTable.Cell numeric style={styles.balanceCell}>
                    <Text style={{ color: colors.error, fontWeight: 'bold' }}>
                      {row.balance.toLocaleString()}
                    </Text>
                  </DataTable.Cell>
                </DataTable.Row>
              ))}
            </DataTable>

            <Divider style={styles.divider} />

            <View style={styles.totalRow}>
              <Text variant="titleMedium">Total Pending</Text>
              <Text
                variant="titleLarge"
                style={{ color: colors.error, fontWeight: '900' }}
              >
                KES {totalPending.toLocaleString()}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
    paddingHorizontal: 16,
  },
  balanceCell: {
    justifyContent: 'flex-end',
  },
  divider: {
    marginVertical: 16,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
});
