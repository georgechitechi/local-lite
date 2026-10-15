import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { IconButton, ProgressBar, Surface, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import SectionGroup from '@/shared/components/SectionGroup';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { supabase } from '@/shared/services/supabase';
import { BUSINESS_COLLECTIONS } from '@/shared/services/sync/tables';

interface PurgeRecordsModalProps {
  visible: boolean;
  onDismiss: () => void;
  businessId?: string;
  checkOnline: (action: string) => boolean;
  showSnackbar: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  onSuccess?: () => void;
}

export default function PurgeRecordsModal({
  visible,
  onDismiss,
  businessId,
  checkOnline,
  showSnackbar,
  onSuccess,
}: PurgeRecordsModalProps) {
  const colors = useThemeColors();
  const [purgeProgress, setPurgeProgress] = useState(0);
  const [currentPurgeTable, setCurrentPurgeTable] = useState('');
  const [purgeStep, setPurgeStep] = useState<
    'idle' | 'scanning' | 'review' | 'purging' | 'complete'
  >('idle');
  const [deletedRecords, setDeletedRecords] = useState<Record<string, any[]>>({});
  const [expandedRecords, setExpandedRecords] = useState<Record<string, boolean>>({});

  const toggleRecord = (id: string) => {
    setExpandedRecords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handlePurgeDeleted = useCallback(async () => {
    if (!checkOnline('Database Scan')) return;
    setPurgeStep('scanning');
    setPurgeProgress(0);
    setDeletedRecords({});

    const found: Record<string, any[]> = {};
    const tables = BUSINESS_COLLECTIONS;
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      setCurrentPurgeTable(table);
      setPurgeProgress((i + 1) / tables.length);
      try {
        const { data } = await supabase
          .from(table as any)
          .select('*')
          .eq('business_id', businessId)
          .eq('deleted', true);
        if (data && data.length > 0) found[table] = data;
      } catch {}
    }
    setDeletedRecords(found);
    setPurgeStep('review');
  }, [businessId, checkOnline]);

  useEffect(() => {
    if (visible) {
      handlePurgeDeleted();
    } else {
      setPurgeStep('idle');
    }
  }, [visible, handlePurgeDeleted]);

  const confirmPurge = async () => {
    if (!checkOnline('Purge Records')) return;
    setPurgeStep('purging');
    setPurgeProgress(0);

    const order: readonly string[] = [...BUSINESS_COLLECTIONS].reverse();
    const tablesToPurge = Object.keys(deletedRecords).sort((a, b) => {
      return order.indexOf(a) - order.indexOf(b);
    });

    const failedTables: string[] = [];

    try {
      const cascadeRules = [
        { p: 'properties', c: 'houses', fk: 'property_id' },
        { p: 'houses', c: 'contracts', fk: 'house_id' },
        { p: 'houses', c: 'bookings', fk: 'house_id' },
        { p: 'houses', c: 'maintenance_requests', fk: 'house_id' },
        { p: 'houses', c: 'expenses', fk: 'house_id' },
        { p: 'tenants', c: 'reminder_logs', fk: 'tenant_id' },
        { p: 'tenants', c: 'receipts', fk: 'tenant_id' },
        { p: 'tenants', c: 'contracts', fk: 'tenant_id' },
        { p: 'tenants', c: 'bookings', fk: 'converted_tenant_id' },
        { p: 'tenants', c: 'maintenance_requests', fk: 'tenant_id' },
        { p: 'tenants', c: 'transactions', fk: 'tenant_id' },
        { p: 'tenants', c: 'promotions', fk: 'tenant_id' },
        { p: 'contracts', c: 'reminder_logs', fk: 'contract_id' },
        { p: 'contracts', c: 'receipts', fk: 'contract_id' },
        { p: 'contracts', c: 'payment_messages', fk: 'contract_id' },
        { p: 'receipts', c: 'receipt_refunds', fk: 'receipt_id' },
        { p: 'receipts', c: 'payment_message_receipts', fk: 'receipt_id' },
        { p: 'payment_messages', c: 'payment_message_receipts', fk: 'message_id' },
      ];

      for (const { p, c, fk } of cascadeRules) {
        if (deletedRecords[p] && deletedRecords[p].length > 0) {
          await supabase
            .from(c as any)
            .delete()
            .in(
              fk,
              deletedRecords[p].map((r: any) => r.id),
            );
        }
      }
    } catch (e) {
      console.log('Pre-purge cascade failed', e);
    }

    for (let i = 0; i < tablesToPurge.length; i++) {
      const table = tablesToPurge[i];
      setCurrentPurgeTable(table);
      setPurgeProgress((i + 1) / tablesToPurge.length);
      try {
        const { error } = await supabase
          .from(table as any)
          .delete()
          .eq('business_id', businessId)
          .eq('deleted', true);

        if (error) throw error;
      } catch (e: any) {
        let dependentTable = '';
        if (e?.code === '23503') {
          if (e.details?.includes('referenced from table')) {
            const match = e.details.match(/table "([^"]+)"/);
            if (match?.[1]) dependentTable = match[1];
          } else if (e.message?.includes('on table')) {
            const match = e.message.match(/on table "([^"]+)"/g);
            if (match && match.length > 0) {
              dependentTable = match[match.length - 1]
                .replace(/on table "/, '')
                .replace(/"/, '');
            }
          }
        }
        failedTables.push(
          dependentTable ? `${table} (used by ${dependentTable})` : table,
        );
      }
    }

    setPurgeStep('complete');

    if (failedTables.length > 0) {
      const failedStr =
        failedTables.slice(0, 3).join(', ') + (failedTables.length > 3 ? '...' : '');
      showSnackbar(`Failed to purge: ${failedStr}.`, 'warning');
    } else {
      showSnackbar('Purge completed successfully.', 'success');
      onSuccess?.();
    }
  };

  const confirmPurgeTable = async (table: string) => {
    if (!checkOnline('Purge Records')) return;
    try {
      const { error } = await supabase
        .from(table as any)
        .delete()
        .eq('business_id', businessId)
        .eq('deleted', true);

      if (error) throw error;

      setDeletedRecords(prev => {
        const next = { ...prev };
        delete next[table];
        return next;
      });

      if (Object.keys(deletedRecords).length <= 1) {
        setPurgeStep('complete');
      } else {
        showSnackbar(`Purged ${table.replace(/_/g, ' ')}`, 'success');
      }
    } catch (e: any) {
      if (e?.code === '23503') {
        let dependentTable = '';
        if (e.details?.includes('referenced from table')) {
          const match = e.details.match(/table "([^"]+)"/);
          if (match?.[1]) dependentTable = match[1];
        } else if (e.message?.includes('on table')) {
          const match = e.message.match(/on table "([^"]+)"/g);
          if (match && match.length > 0) {
            dependentTable = match[match.length - 1]
              .replace(/on table "/, '')
              .replace(/"/, '');
          }
        }

        const detailsStr = dependentTable
          ? ` Still referenced by '${dependentTable}'.`
          : '';

        const idMatch = e.details?.match(/Key \([^)]+\)=\(([^)]+)\)/);
        const blockedId = idMatch ? idMatch[1] : null;

        let itemDetail = '';
        if (blockedId && deletedRecords[table]) {
          const item = deletedRecords[table].find((r: any) => r.id === blockedId);
          if (item) {
            const name =
              item.name ||
              item.house_number ||
              item.message_content ||
              item.description ||
              item.category ||
              blockedId;
            itemDetail = `\n\nBlocked Item in ${table.replace(/_/g, ' ')}:\n${name}\n(ID: ${blockedId.substring(0, 8)})`;
          }
        }

        if (itemDetail) {
          Alert.alert(
            'Purge Blocked',
            `Cannot purge ${table.replace(/_/g, ' ')}.${detailsStr}${itemDetail}\n\nPlease delete or purge the dependent records first.`,
            [{ text: 'OK' }],
          );
        } else {
          showSnackbar(
            `Cannot purge ${table.replace(/_/g, ' ')}.${detailsStr} Please purge dependent records first.`,
            'error',
          );
        }
      } else {
        showSnackbar(
          `Failed to purge ${table}: ${e?.message || 'Unknown error'}`,
          'error',
        );
      }
    }
  };

  const renderContent = () => {
    if (purgeStep === 'scanning' || purgeStep === 'purging') {
      return (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <ProgressBar
            progress={purgeProgress}
            color={colors.primary}
            style={{ width: '100%', height: 10, borderRadius: 5 }}
          />
          <Text style={{ marginTop: 16 }}>
            {purgeStep === 'scanning' ? 'Scanning...' : 'Purging...'}{' '}
            {Math.round(purgeProgress * 100)}%
          </Text>
          <Text variant="bodySmall" style={{ opacity: 0.6 }}>
            {currentPurgeTable}
          </Text>
        </View>
      );
    }

    if (purgeStep === 'review') {
      return (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
          {Object.entries(deletedRecords).map(([table, items]) => (
            <View key={table} style={{ marginBottom: 0 }}>
              <SectionGroup
                title={table.replace(/_/g, ' ').toUpperCase()}
                subtitle={`${items.length} records found`}
                isExpanded={!!expandedRecords[table]}
                onToggle={() => toggleRecord(table)}
                rightContent={
                  <IconButton
                    icon="delete"
                    iconColor={colors.error}
                    style={{ margin: 0 }}
                    onPress={() => confirmPurgeTable(table)}
                  />
                }
                containerStyle={{ borderRadius: 0, marginBottom: 0 }}
              />
              {expandedRecords[table] && (
                <Surface
                  style={{
                    padding: 16,
                    borderRadius: 0,
                    backgroundColor: colors.surfaceVariant,
                    elevation: 0,
                  }}
                >
                  <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
                    <Text variant="bodySmall" style={{ fontFamily: 'monospace' }}>
                      {JSON.stringify(items, null, 2)}
                    </Text>
                  </ScrollView>
                </Surface>
              )}
            </View>
          ))}
          {Object.keys(deletedRecords).length === 0 && (
            <Text style={{ textAlign: 'center', padding: 20 }}>
              No deleted records found.
            </Text>
          )}
        </ScrollView>
      );
    }

    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <MaterialCommunityIcons name="check-circle" size={64} color={colors.primary} />
        <Text variant="titleMedium" style={{ marginTop: 16 }}>
          Cleanup Complete
        </Text>
      </View>
    );
  };

  const actions =
    purgeStep === 'review'
      ? [
          {
            label: 'Cancel',
            onPress: onDismiss,
            mode: 'outlined' as const,
          },
          {
            label: 'Purge Records',
            onPress: confirmPurge,
            mode: 'contained' as const,
            buttonColor: colors.error,
            disabled: Object.keys(deletedRecords).length === 0,
          },
        ]
      : purgeStep === 'complete'
        ? [
            {
              label: 'Close',
              onPress: onDismiss,
              mode: 'contained' as const,
            },
          ]
        : [];

  return (
    <BaseModal
      visible={visible}
      edgeToEdge
      onDismiss={() => {
        if (purgeStep !== 'purging') {
          onDismiss();
        } else {
          showSnackbar('Database cleanup in progress. Please wait...', 'info');
        }
      }}
      title="Database Cleanup"
      subtitle="Manage your properties"
      actions={actions}
    >
      {renderContent()}
    </BaseModal>
  );
}
