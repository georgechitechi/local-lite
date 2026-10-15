import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type { BatchMutation } from 'local-lite';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Divider,
  IconButton,
  Menu,
  Portal,
  Text,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import {
  EXPENSE_CATEGORY,
  getCategoryDetails,
} from '@/features/expenses/utils/expenseUtils';
import UtilityImportModal from '@/features/utilities/components/UtilityImportModal';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import { useCurrency } from '@/shared/hooks/useCurrency';
import { useCoreMutations, useExpenses, useMaintenanceRequests, useStoreRefresh } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatWithCurrency } from '@/shared/utils/formatters';
import ExpenseDetailsModal from './ExpenseDetailsModal';
import ExpenseModal from './ExpenseModal';

interface Expense {
  id: string;
  category: string;
  amount: number;
  date: string;
  remarks?: string;
}

interface ExpensesListModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect?: (expense: Expense) => void;
  mode?: 'selection' | 'management';
  title?: string;
}

export default function ExpensesListModal({
  visible,
  onDismiss,
  onSelect,
  mode = 'management',
  title = 'Business Expenses',
}: ExpensesListModalProps) {
  const colors = useThemeColors();
  const { selectedBusiness } = useBusiness();
  const { loading: accessLoading } = useAccessControl();
  const rawExpenses = useExpenses(selectedBusiness?.id);
  const maintenanceRequests = useMaintenanceRequests(selectedBusiness?.id);
  const { batch: coreBatch, delete: deleteRecord } = useCoreMutations();
  const { refreshing, onRefresh } = useStoreRefresh();
  const { defaultCurrency } = useCurrency(selectedBusiness?.id);
  const { showSnackbar } = useSnackbar();

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [menuVisible, setMenuVisible] = useState<Record<string, boolean>>({});
  const [displayLimit, setDisplayLimit] = useState(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Action states
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    const visibleIds = filteredExpenses.map(e => e.id);
    const allVisibleSelected = visibleIds.every(id => selectedIds.has(id));

    const next = new Set(selectedIds);
    if (allVisibleSelected && visibleIds.length > 0) {
      for (const id of visibleIds) next.delete(id);
    } else {
      for (const id of visibleIds) next.add(id);
    }
    setSelectedIds(next);
  };

  const expenses = (rawExpenses || []).filter(Boolean) as Expense[];

  let filteredExpenses = expenses.filter(expense => {
    let matchesCategory = true;
    if (categoryFilter !== 'all') {
      matchesCategory = expense.category === categoryFilter;
    }

    const q = (searchQuery || '').toLowerCase();
    const matchesSearch =
      (expense.category || '').toLowerCase().includes(q) ||
      (expense.remarks || '').toLowerCase().includes(q) ||
      (expense.amount ?? '').toString().includes(q);

    return matchesCategory && matchesSearch;
  });

  filteredExpenses = filteredExpenses.sort(
    (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
  );

  const stats = {
    count: filteredExpenses.length,
    amount: filteredExpenses.reduce((sum, e) => sum + (Number(e?.amount) || 0), 0),
  };

  const handleDelete = async (id: string) => {
    setExpenseToDelete(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!selectedBusiness?.id) return;
    try {
      setDeleteLoading(true);
      const idsToDelete =
        selectedIds.size > 0
          ? Array.from(selectedIds)
          : expenseToDelete
            ? [expenseToDelete]
            : [];

      if (idsToDelete.length === 0) return;

      const maintenanceMutations: BatchMutation[] = [];
      for (const id of idsToDelete) {
        // Clear links in maintenance requests
        (maintenanceRequests || []).forEach((request: any) => {
          if (request.expense_id === id) {
            maintenanceMutations.push({
              tableName: 'maintenance_requests',
              operation: 'UPDATE',
              rowId: request.id,
              payload: { expense_id: null },
            });
          }
        });
      }
      if (maintenanceMutations.length > 0) {
        await coreBatch(maintenanceMutations);
      }

      if (idsToDelete.length > 1) {
        const mutations: BatchMutation[] = idsToDelete.map(id => ({
          tableName: 'expenses',
          operation: 'DELETE',
          rowId: id,
        }));
        await coreBatch(mutations);
      } else if (idsToDelete.length === 1) {
        await deleteRecord('expenses', idsToDelete[0]);
      }

      showSnackbar(
        idsToDelete.length > 1
          ? `Successfully deleted ${idsToDelete.length} expenses`
          : 'Expense deleted successfully',
        'success',
      );
      setSelectedIds(new Set());
      setExpenseToDelete(null);
    } catch (error) {
      console.error('Delete error:', error);
      showSnackbar('Failed to delete expense(s)', 'error');
    } finally {
      setDeleteLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  const renderExpenseItem = (expense: Expense) => {
    const categoryDetails = getCategoryDetails(expense.category);
    const categoryColor = (colors as any)[categoryDetails.color] || categoryDetails.color;

    return (
      <Card
        key={expense.id}
        style={[
          styles.expenseCard,
          { backgroundColor: colors.surface },
          mode === 'selection' && styles.selectionCard,
        ]}
        onPress={() => {
          if (mode === 'management') {
            handleToggleSelect(expense.id);
          } else {
            onSelect?.(expense);
          }
        }}
        mode="outlined"
      >
        <Card.Content style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <View style={styles.dateContainer}>
              <MaterialCommunityIcons
                name={categoryDetails.icon as any}
                size={16}
                color={categoryColor}
              />
              <Text
                variant="labelSmall"
                style={[styles.categoryText, { color: categoryColor }]}
              >
                {categoryDetails.label}
              </Text>
              <Text
                variant="labelSmall"
                style={{ color: colors.onSurfaceVariant, marginLeft: 8 }}
              >
                • {expense.date}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text
                variant="titleMedium"
                style={[styles.amount, { color: colors.primary }]}
              >
                {defaultCurrency
                  ? formatWithCurrency(expense.amount, defaultCurrency)
                  : expense.amount.toString()}
              </Text>

              {mode === 'management' && (
                <Menu
                  visible={!!menuVisible[expense.id]}
                  onDismiss={() =>
                    setMenuVisible(prev => ({ ...prev, [expense.id]: false }))
                  }
                  anchor={
                    <IconButton
                      icon="dots-vertical"
                      size={20}
                      onPress={() =>
                        setMenuVisible(prev => ({ ...prev, [expense.id]: true }))
                      }
                      style={{ margin: -10, marginLeft: 0 }}
                    />
                  }
                >
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(prev => ({ ...prev, [expense.id]: false }));
                      setSelectedExpenseId(expense.id);
                      setDetailsModalVisible(true);
                    }}
                    title="View Details"
                    leadingIcon="eye-outline"
                  />
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(prev => ({ ...prev, [expense.id]: false }));
                      setSelectedExpenseId(expense.id);
                      setEditModalVisible(true);
                    }}
                    title="Edit Expense"
                    leadingIcon="pencil-outline"
                  />
                  <Divider />
                  <Menu.Item
                    onPress={() => {
                      setMenuVisible(prev => ({ ...prev, [expense.id]: false }));
                      handleDelete(expense.id);
                    }}
                    title="Delete Expense"
                    leadingIcon="delete-outline"
                    titleStyle={{ color: colors.error }}
                  />
                </Menu>
              )}
            </View>
          </View>

          {expense.remarks && (
            <Text variant="bodyMedium" style={styles.remarksText} numberOfLines={2}>
              {expense.remarks}
            </Text>
          )}

          {selectedIds.has(expense.id) && (
            <View style={styles.selectionIndicator}>
              <MaterialCommunityIcons
                name="check-circle"
                size={18}
                color={colors.primary}
              />
            </View>
          )}
        </Card.Content>
      </Card>
    );
  };

  const filterOptions = useMemo(() => {
    return [
      { label: 'All', value: 'all', icon: 'layers-outline' },
      ...EXPENSE_CATEGORY.map(cat => ({
        label: cat.label,
        value: cat.key,
        icon: cat.icon,
      })),
    ];
  }, []);

  return (
    <Portal>
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title={title}
        subtitle="Manage your property expenses"
        edgeToEdge
        maxHeight="90%"
        scrollable={false}
        search={
          showSearch
            ? {
                placeholder: 'Search expenses...',
                value: searchQuery,
                onChangeText: setSearchQuery,
                onClear: () => setSearchQuery(''),
              }
            : null
        }
        headerRight={
          <IconButton
            icon={showSearch ? 'magnify-minus' : 'magnify'}
            onPress={() => {
              if (showSearch) setSearchQuery('');
              setShowSearch(!showSearch);
            }}
            size={22}
          />
        }
      >
        <View style={styles.container}>
          <View
            style={[styles.filterContainer, { borderBottomColor: colors.outlineVariant }]}
          >
            <FilterButtons
              options={filterOptions}
              selectedValue={categoryFilter}
              onValueChange={value => setCategoryFilter(value || 'all')}
            />
          </View>

          <View style={[styles.statsRow, { borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.statItem}>
              <Text variant="labelSmall" style={{ color: colors.primary }}>
                Total {stats.count} items
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text
                variant="labelSmall"
                style={{ color: colors.success, fontWeight: 'bold' }}
              >
                {defaultCurrency
                  ? formatWithCurrency(stats.amount, defaultCurrency)
                  : stats.amount}
              </Text>
            </View>
          </View>

          {mode === 'management' && (
            <View style={styles.headerRow}>
              <View style={styles.headerActions}>
                {selectedIds.size > 0 ? (
                  <>
                    <Text
                      variant="labelSmall"
                      style={{
                        fontWeight: 'bold',
                        color: colors.primary,
                        marginRight: 8,
                        marginLeft: 4,
                      }}
                    >
                      {selectedIds.size} SELECTED
                    </Text>
                    <Button
                      mode="text"
                      onPress={() => setShowDeleteConfirm(true)}
                      compact
                      icon="delete"
                      textColor={colors.error}
                      style={styles.bulkButton}
                      labelStyle={{ fontSize: 13 }}
                    >
                      Delete
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      onPress={() => setCreateModalVisible(true)}
                      icon="plus"
                      style={styles.bulkButton}
                      labelStyle={{ fontSize: 13 }}
                      compact={true}
                    >
                      Create Expense
                    </Button>
                    <Button
                      onPress={() => setImportModalVisible(true)}
                      icon="download"
                      style={styles.bulkButton}
                      labelStyle={{ fontSize: 13 }}
                      compact={true}
                    >
                      Import Expenses
                    </Button>
                  </>
                )}
              </View>

              {(() => {
                const visibleIds = filteredExpenses.map(e => e.id);
                const allVisibleSelected =
                  visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
                return (
                  <Button
                    mode="text"
                    onPress={handleSelectAll}
                    compact={true}
                    labelStyle={{ fontSize: 12 }}
                    icon={
                      allVisibleSelected
                        ? 'checkbox-multiple-marked'
                        : 'checkbox-multiple-blank-outline'
                    }
                  >
                    {allVisibleSelected ? 'Deselect All' : 'Select All'}
                  </Button>
                );
              })()}
            </View>
          )}

          <ScrollView
            style={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            showsVerticalScrollIndicator={false}
          >
            {accessLoading ? (
              <View style={{ padding: 20 }}>
                <Text style={{ textAlign: 'center' }}>Loading...</Text>
              </View>
            ) : filteredExpenses.slice(0, displayLimit).length > 0 ? (
              <>
                {filteredExpenses.slice(0, displayLimit).map(renderExpenseItem)}
                {filteredExpenses.length > displayLimit && (
                  <Button
                    mode="text"
                    onPress={() => setDisplayLimit(prev => prev + 10)}
                    style={styles.loadMoreButton}
                  >
                    Load More ({filteredExpenses.length - displayLimit} remaining)
                  </Button>
                )}
              </>
            ) : (
              <EmptyState icon="receipt" title="No expenses found" />
            )}
          </ScrollView>
        </View>
      </BaseModal>

      {/* Internal Modals */}
      <ExpenseModal
        visible={createModalVisible}
        onDismiss={() => setCreateModalVisible(false)}
      />

      <ExpenseModal
        visible={editModalVisible}
        onDismiss={() => {
          setEditModalVisible(false);
          setSelectedExpenseId(null);
        }}
        expenseId={selectedExpenseId}
      />

      <UtilityImportModal
        visible={importModalVisible}
        onDismiss={() => setImportModalVisible(false)}
      />

      <ExpenseDetailsModal
        visible={detailsModalVisible}
        onDismiss={() => {
          setDetailsModalVisible(false);
          setSelectedExpenseId(null);
        }}
        expenseId={selectedExpenseId}
        onEdit={_id => {
          setDetailsModalVisible(false);
          setEditModalVisible(true);
        }}
        onDelete={() => setDetailsModalVisible(false)}
      />

      <BaseModal
        mode="confirm"
        visible={showDeleteConfirm}
        onDismiss={() => {
          setShowDeleteConfirm(false);
          setExpenseToDelete(null);
        }}
        onConfirm={confirmDelete}
        title={selectedIds.size > 1 ? 'Bulk Delete' : 'Delete Expense'}
        message={
          selectedIds.size > 1
            ? `Are you sure you want to delete ${selectedIds.size} selected expenses?`
            : 'Are you sure you want to delete this expense?'
        }
        confirmText="Delete"
        cancelText="Cancel"
        loading={deleteLoading}
        destructive={true}
      />
    </Portal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterContainer: {
    paddingHorizontal: 2,
    borderBottomWidth: 0.5,
  },
  list: {
    flex: 1,
  },
  loadMoreButton: {
    marginVertical: 12,
  },
  expenseCard: {
    marginBottom: 12,
    marginHorizontal: 16,
    borderRadius: 12,
  },
  selectionCard: {
    borderWidth: 1.5,
  },
  cardContent: {
    padding: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  dateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryText: {
    marginLeft: 4,
    fontWeight: 'bold',
  },
  amount: {
    fontWeight: 'bold',
  },
  remarksText: {
    lineHeight: 20,
    marginTop: 4,
  },
  selectionIndicator: {
    position: 'absolute',
    bottom: 8,
    right: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    marginTop: 4,
    paddingHorizontal: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bulkButton: {
    margin: 0,
    padding: 0,
    minWidth: 0,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 4,
    borderBottomWidth: 0.5,
  },
  statItem: {
    alignItems: 'center',
  },
});
