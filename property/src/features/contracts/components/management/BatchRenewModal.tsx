import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type React from 'react';
import { View } from 'react-native';
import { Button, Checkbox, Chip, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import DatePicker from '@/shared/components/DatePicker';
import EmptyState from '@/shared/components/EmptyState';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import SPressable from '@/shared/components/SlightPressable';
import { formatDate } from '@/shared/utils/formatters';

export interface BatchRenewModalProps {
  visible: boolean;
  onDismiss: () => void;
  batchNewEndDate: string;
  setBatchNewEndDate: (d: string) => void;
  filterExpiringSoon: boolean;
  setFilterExpiringSoon: (val: boolean) => void;
  filteredContractsForBatch: any[];
  selectedBatchIds: Set<string>;
  setSelectedBatchIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onExecuteBatchRenewal: () => void;
  actionLoading: boolean;
  colors: any;
}

export default function BatchRenewModal({
  visible,
  onDismiss,
  batchNewEndDate,
  setBatchNewEndDate,
  filterExpiringSoon,
  setFilterExpiringSoon,
  filteredContractsForBatch,
  selectedBatchIds,
  setSelectedBatchIds,
  onExecuteBatchRenewal,
  actionLoading,
  colors,
}: BatchRenewModalProps) {
  const toggleBatchSelection = (id: string) => {
    setSelectedBatchIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Align Expiry Dates"
      subtitle="Manage property contracts"
      maxHeight="90%"
      actions={[
        {
          label: 'Cancel',
          onPress: onDismiss,
          mode: 'outlined',
        },
        {
          label: 'Update Selected',
          onPress: onExecuteBatchRenewal,
          loading: actionLoading,
          disabled: actionLoading,
          mode: 'contained',
        },
      ]}
    >
      <View style={{ marginBottom: 16 }}>
        <DatePicker
          label="New End Date"
          value={batchNewEndDate}
          onChange={(d: string | null) => d && setBatchNewEndDate(d)}
          maximumDate={null}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Chip
            selected={!filterExpiringSoon}
            onPress={() => setFilterExpiringSoon(false)}
            showSelectedCheck={false}
            compact
            style={{ width: '100%' }}
            textStyle={{ textAlign: 'center', width: '100%' }}
          >
            All Active
          </Chip>
        </View>
        <View style={{ flex: 1 }}>
          <Chip
            selected={filterExpiringSoon}
            onPress={() => setFilterExpiringSoon(true)}
            showSelectedCheck={false}
            compact
            style={{ width: '100%' }}
            textStyle={{ textAlign: 'center', width: '100%' }}
          >
            Expiring Soon
          </Chip>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginVertical: 2,
        }}
      >
        <Text variant="bodySmall">
          Selected {selectedBatchIds.size} of {filteredContractsForBatch.length} contracts
        </Text>
        <Button
          compact
          mode="text"
          onPress={() => {
            const visibleIds = filteredContractsForBatch.map(c => c.id);
            const allVisibleSelected =
              visibleIds.length > 0 && visibleIds.every(id => selectedBatchIds.has(id));

            if (allVisibleSelected) {
              setSelectedBatchIds(prev => {
                const next = new Set(prev);
                for (const id of visibleIds) next.delete(id);
                return next;
              });
            } else {
              setSelectedBatchIds(prev => {
                const next = new Set(prev);
                for (const id of visibleIds) next.add(id);
                return next;
              });
            }
          }}
        >
          {filteredContractsForBatch.length > 0 &&
          filteredContractsForBatch.every(c => selectedBatchIds.has(c.id))
            ? 'Deselect All'
            : 'Select All'}
        </Button>
      </View>
      <KeyboardScroll style={{ flex: 1 }} useSafeArea={false}>
        {filteredContractsForBatch.length === 0 ? (
          <EmptyState icon="file-document-outline" title="No contracts found" />
        ) : (
          filteredContractsForBatch.map(c => (
            <SPressable
              key={c.id}
              onPress={() => toggleBatchSelection(c.id)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 8,
                paddingHorizontal: 4,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodyLarge" style={{ fontWeight: '600' }}>
                  {c.tenantName}
                </Text>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}
                >
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', width: '45%' }}
                  >
                    <MaterialCommunityIcons
                      name="office-building"
                      size={14}
                      color={colors.onSurfaceVariant}
                      style={{ marginRight: 4 }}
                    />
                    <Text
                      variant="bodySmall"
                      numberOfLines={1}
                      style={{ color: colors.onSurfaceVariant }}
                    >
                      Unit {c.houseNumber}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <MaterialCommunityIcons
                      name="calendar-clock"
                      size={14}
                      color={colors.onSurfaceVariant}
                      style={{ marginRight: 4 }}
                    />
                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                      {formatDate(c.end_date)}
                    </Text>
                  </View>
                </View>
              </View>
              <View pointerEvents="none">
                <Checkbox.Android
                  status={selectedBatchIds.has(c.id) ? 'checked' : 'unchecked'}
                />
              </View>
            </SPressable>
          ))
        )}
      </KeyboardScroll>
    </BaseModal>
  );
}
