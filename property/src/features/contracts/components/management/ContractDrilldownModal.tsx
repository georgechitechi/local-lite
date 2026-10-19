import type React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import { formatDateForDB } from '@/shared/utils/formatters';
import ContractCard from './ContractCard';

export interface ContractDrilldownModalProps {
  contractListModal: { title: string; subtitle?: string; data: any[] } | null;
  onDismiss: () => void;
  modalSearchQuery: string;
  setModalSearchQuery: (q: string) => void;
  selectedListProperty: string;
  setSelectedListProperty: (p: string) => void;
  selectedListType: string;
  setSelectedListType: (t: string) => void;
  propertyOptions: any[];
  typeOptions: any[];
  selectedListIds: Set<string>;
  setSelectedListIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  menuVisible: string | null;
  setMenuVisible: (id: string | null) => void;
  onOpenActionDialog: (batchActionType: any, actionDate: string) => void;
  onViewContract: (contract: any) => void;
  onRenewContract: (contract: any) => void;
  onPauseContract: (contract: any) => void;
  onResumeContract: (contract: any) => void;
  onSendReminder: (contract: any) => void;
  onTerminateContract: (contract: any) => void;
  colors: any;
}

export default function ContractDrilldownModal({
  contractListModal,
  onDismiss,
  modalSearchQuery,
  setModalSearchQuery,
  selectedListProperty,
  setSelectedListProperty,
  selectedListType,
  setSelectedListType,
  propertyOptions,
  typeOptions,
  selectedListIds,
  setSelectedListIds,
  menuVisible,
  setMenuVisible,
  onOpenActionDialog,
  onViewContract,
  onRenewContract,
  onPauseContract,
  onResumeContract,
  onSendReminder,
  onTerminateContract,
  colors,
}: ContractDrilldownModalProps) {
  const handleClose = () => {
    onDismiss();
    setSelectedListIds(new Set());
    setModalSearchQuery('');
    setSelectedListProperty('all');
    setSelectedListType('all');
  };

  const listData = contractListModal?.data ?? [];
  const filteredData = listData.filter((c: any) => {
    if (selectedListProperty !== 'all' && c.propertyId !== selectedListProperty)
      return false;
    if (selectedListType !== 'all' && c.houseType !== selectedListType) return false;
    if (!modalSearchQuery) return true;
    const q = modalSearchQuery.toLowerCase();
    return (
      c.tenantName?.toLowerCase().includes(q) ||
      c.tenantEmail?.toLowerCase().includes(q) ||
      c.houseNumber?.toString().toLowerCase().includes(q) ||
      c.status?.toLowerCase().includes(q)
    );
  });

  const selectedContractsData = Array.from(selectedListIds).map(id =>
    contractListModal?.data.find(c => c.id === id),
  );
  const isAllPaused =
    selectedContractsData.length > 0 && selectedContractsData.every(c => c?.isPaused);
  const batchActionType = isAllPaused ? 'batch_resume' : 'batch_pause';
  const batchActionLabel = isAllPaused ? 'Resume' : 'Pause';

  return (
    <BaseModal
      visible={!!contractListModal}
      onDismiss={handleClose}
      title={contractListModal?.title ?? ''}
      subtitle={contractListModal?.subtitle}
      maxHeight="90%"
      scrollable
      search={{
        value: modalSearchQuery,
        onChangeText: setModalSearchQuery,
        placeholder: 'Search by tenant, unit...',
        onClear: () => setModalSearchQuery(''),
      }}
    >
      <View>
        <View
          style={{
            marginHorizontal: -8,
            flexDirection: 'row',
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.outlineVariant,
          }}
        >
          <FilterButtons
            options={propertyOptions}
            selectedValue={selectedListProperty}
            onValueChange={val => {
              setSelectedListProperty(val || 'all');
              setSelectedListType('all');
            }}
            containerStyle={{
              flex: selectedListProperty !== 'all' ? 0.5 : 1,
              borderBottomWidth: 0,
            }}
          />
          {selectedListProperty !== 'all' && (
            <FilterButtons
              options={typeOptions}
              selectedValue={selectedListType}
              onValueChange={val => setSelectedListType(val || 'all')}
              containerStyle={{ flex: 0.5, borderBottomWidth: 0 }}
            />
          )}
        </View>

        {selectedListIds.size > 0 && (
          <Surface
            style={{
              paddingHorizontal: 12,
              paddingVertical: 0,
              elevation: 2,
              backgroundColor: colors.surface,
              borderBottomWidth: 1,
              borderBottomColor: colors.outlineVariant,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 0,
            }}
          >
            <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>
              {selectedListIds.size} Selected
            </Text>
            <View style={{ flexDirection: 'row', gap: 0 }}>
              <Button
                mode="text"
                compact
                contentStyle={{ paddingVertical: 0, marginVertical: 0 }}
                labelStyle={{ marginVertical: 4 }}
                onPress={() => setSelectedListIds(new Set())}
              >
                Cancel
              </Button>
              <Button
                mode="text"
                compact
                contentStyle={{ paddingVertical: 0, marginVertical: 0 }}
                labelStyle={{ marginVertical: 4 }}
                onPress={() => {
                  onOpenActionDialog(batchActionType, formatDateForDB(new Date()));
                }}
              >
                {batchActionLabel}
              </Button>
            </View>
          </Surface>
        )}

        {filteredData.length === 0 ? (
          <EmptyState icon="file-document-outline" title="No contracts found" />
        ) : (
          filteredData.map((contract: any) => (
            <ContractCard
              key={contract.id}
              contract={contract}
              colors={colors}
              isSelected={selectedListIds.has(contract.id)}
              isSelectionMode={selectedListIds.size > 0}
              menuVisible={menuVisible === contract.id}
              onLongPress={() => {
                if (selectedListIds.size === 0) {
                  setSelectedListIds(new Set([contract.id]));
                }
              }}
              onPress={() => {
                if (selectedListIds.size > 0) {
                  setSelectedListIds(prev => {
                    const next = new Set(prev);
                    if (next.has(contract.id)) next.delete(contract.id);
                    else next.add(contract.id);
                    return next;
                  });
                }
              }}
              onMenuVisible={() => setMenuVisible(contract.id)}
              onMenuDismiss={() => setMenuVisible(null)}
              onViewContract={() => {
                onDismiss();
                onViewContract(contract);
              }}
              onRenewContract={() => {
                onDismiss();
                onRenewContract(contract);
              }}
              onPauseContract={() => {
                onDismiss();
                onPauseContract(contract);
              }}
              onResumeContract={() => {
                onDismiss();
                onResumeContract(contract);
              }}
              onSendReminder={() => {
                onDismiss();
                onSendReminder(contract);
              }}
              onTerminateContract={() => {
                onDismiss();
                onTerminateContract(contract);
              }}
            />
          ))
        )}
      </View>
    </BaseModal>
  );
}
