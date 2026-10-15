import { useState } from 'react';

export function useContractManagement() {
  // Modal Visibility States
  const [isBatchSelectionMode, setIsBatchSelectionMode] = useState(false);
  const [contractListModal, setContractListModal] = useState<{
    title: string;
    subtitle?: string;
  } | null>(null);

  // Contract Data & Selection States
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [modalSearchQuery, setModalSearchQuery] = useState('');

  // Handlers
  const toggleBatchSelection = (id: string) => {
    setSelectedBatchIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Move the rest of your state (filters, pagination, supabase fetch calls) here...

  return {
    isBatchSelectionMode,
    setIsBatchSelectionMode,
    contractListModal,
    setContractListModal,
    selectedBatchIds,
    setSelectedBatchIds,
    toggleBatchSelection,
    modalSearchQuery,
    setModalSearchQuery,
  };
}
