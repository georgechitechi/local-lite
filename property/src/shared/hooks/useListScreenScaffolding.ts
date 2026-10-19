import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useDeferredValue, useEffect, useState } from 'react';

export interface UseListScreenScaffoldingOptions<_T = any> {
  initialStatuses?: string[];
}

export function useListScreenScaffolding<T = any>(
  options: UseListScreenScaffoldingOptions<T> = {},
) {
  const router = useRouter();
  const params = useLocalSearchParams<{ search?: string }>();

  // 1. Search with deferred query and parameter consumption
  const [searchQuery, setSearchQuery] = useState(params.search || '');
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    if (params.search && params.search !== searchQuery) {
      setSearchQuery(params.search as string);
      router.setParams({ search: undefined } as any);
    }
  }, [params.search, searchQuery, router]);

  // 2. Expand / Collapse status sections
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(
    () => new Set(options.initialStatuses || []),
  );

  const toggleSection = useCallback((status: string) => {
    setExpandedStatuses(prev => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback((statuses: string[]) => {
    setExpandedStatuses(new Set(statuses));
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedStatuses(new Set());
  }, []);

  // 3. Delete Confirmation Modal
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<T | null>(null);

  const openDeleteDialog = useCallback((item: T) => {
    setItemToDelete(item);
    setDeleteDialogVisible(true);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setItemToDelete(null);
    setDeleteDialogVisible(false);
  }, []);

  // 4. Bulk Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkMode, setIsBulkMode] = useState(false);

  const toggleSelectItem = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllItems = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsBulkMode(false);
  }, []);

  return {
    // Search
    searchQuery,
    setSearchQuery,
    deferredSearchQuery,

    // Expand/Collapse Sections
    expandedStatuses,
    setExpandedStatuses,
    toggleSection,
    expandAll,
    collapseAll,

    // Delete dialog
    deleteDialogVisible,
    setDeleteDialogVisible,
    itemToDelete,
    setItemToDelete,
    openDeleteDialog,
    closeDeleteDialog,

    // Bulk selection
    selectedIds,
    setSelectedIds,
    isBulkMode,
    setIsBulkMode,
    toggleSelectItem,
    selectAllItems,
    clearSelection,
  };
}
