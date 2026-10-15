import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { IconButton, Menu, Surface, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { EXPENSE_CATEGORY } from '@/features/expenses/utils/expenseUtils';
import BaseModal from '@/shared/components/BaseModal';
import HistoryModal from '@/shared/components/HistoryModal';
import LoadingCard from '@/shared/components/LoadingCard';
import { useAccessControl } from '@/shared/hooks/useAccessControl';
import {
  useCoreMutations,
  useExpensesById,
  useMaintenanceRequests,
  useSettings,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatDate, formatWithCurrency } from '@/shared/utils/formatters';

interface Expense {
  id: string;
  category: string;
  amount: number;
  date: string;
  remarks?: string;
  metadata?: Record<string, any>;
}

interface ExpenseDetailsModalProps {
  visible: boolean;
  onDismiss: () => void;
  expenseId: string | null;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export default function ExpenseDetailsModal({
  visible,
  onDismiss,
  expenseId,
  onEdit,
  onDelete,
}: ExpenseDetailsModalProps) {
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const { isOwner } = useAccessControl();
  const { selectedBusiness } = useBusiness();

  const allSettings = useSettings(selectedBusiness?.id);
  const expensesById = useExpensesById(selectedBusiness?.id);
  const { update, delete: deleteRecord } = useCoreMutations();
  const maintenanceRequests = useMaintenanceRequests(selectedBusiness?.id);

  const defaultCurrency = useMemo(() => {
    const currencySetting = allSettings.find(s => s.setting_key === 'currency_settings');
    if (currencySetting && Array.isArray(currencySetting.setting_value)) {
      const currencies = currencySetting.setting_value as any[];
      return currencies.find(c => c.default) || currencies[0];
    }
    return null;
  }, [allSettings]);

  const expense = useMemo(() => {
    if (!expenseId) return null;
    const e = expensesById.get(expenseId as string);
    if (!e) return null;
    return {
      ...e,
      amount: Number(e.amount),
    } as Expense;
  }, [expenseId, expensesById]);

  const [menuVisible, setMenuVisible] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handleDelete = () => {
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!expenseId) return;
    try {
      const linked = maintenanceRequests.filter((r: any) => r.expense_id === expenseId);
      for (const r of linked) {
        await update('maintenance_requests', r.id, { expense_id: null });
      }

      await deleteRecord('expenses', expenseId);
      showSnackbar('Expense deleted successfully', 'success');
      onDelete?.(expenseId);
      onDismiss();
    } catch (error) {
      console.error('Error deleting expense:', error);
      showSnackbar('Failed to delete expense', 'error');
    } finally {
      setShowDeleteModal(false);
    }
  };

  const handleShare = async () => {
    try {
      if (!expense || !selectedBusiness || !defaultCurrency) return;

      const categoryDetails =
        EXPENSE_CATEGORY.find(cat => cat.key === expense.category) || EXPENSE_CATEGORY[0];

      const htmlContent = `
                <!DOCTYPE html>
                <html>
                    <head>
                        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
                        <style>
                            @page {
                                margin: 1.5cm;
                            }
                            body {
                                font-family: Arial, sans-serif;
                                padding: 40px;
                                color: ${colors.onSurface};
                                line-height: 1.6;
                                margin: 0;
                            }
                            .header {
                                text-align: center;
                                margin-bottom: 40px;
                                padding-bottom: 20px;
                                border-bottom: 2px solid ${colors.outline};
                            }
                            .business-name {
                                font-size: 24px;
                                font-weight: 600;
                                color: ${colors.onSurface};
                                margin-bottom: 6px;
                                letter-spacing: 0.5px;
                            }
                            .business-details {
                                font-size: 13px;
                                color: ${colors.onSurfaceVariant};
                                line-height: 1.6;
                            }
                            .details-row {
                                display: table;
                                width: 100%;
                                margin: 20px 0;
                                border-collapse: collapse;
                            }
                            .detail-item {
                                display: table-cell;
                                padding: 8px;
                                vertical-align: middle;
                            }
                            .detail-label {
                                font-size: 13px;
                                color: ${colors.onSurfaceVariant};
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                                margin-bottom: 4px;
                            }
                            .detail-value {
                                font-size: 16px;
                                color: ${colors.onSurface};
                            }
                            .amount {
                                font-size: 20px;
                                font-weight: bold;
                                color: ${colors.primary};
                                text-align: center;
                            }
                            .remarks {
                                margin-top: 20px;
                                padding-top: 20px;
                                border-top: 1px solid ${colors.outline};
                            }
                            .remarks-label {
                                font-weight: bold;
                                margin-bottom: 10px;
                            }
                            .remarks-content {
                                white-space: pre-line;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <div class="business-name">${selectedBusiness.name || 'Business'}</div>
                            <div class="business-details">
                                ${selectedBusiness.address ? `${selectedBusiness.address}<br>` : ''}
                                ${selectedBusiness.phone ? `${selectedBusiness.phone}<br>` : ''}
                                ${selectedBusiness.email || ''}
                            </div>
                            <div><strong>Expense Details</strong></div>
                        </div>

                        <div class="details-row">
                            <div class="detail-item">
                                <div class="detail-label">Category</div>
                                <div class="detail-value">${categoryDetails.label}</div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Amount</div>
                                <div class="amount">${formatWithCurrency(expense.amount, defaultCurrency)}</div>
                            </div>
                            <div class="detail-item">
                                <div class="detail-label">Date</div>
                                <div class="detail-value">${formatDate(expense.date)}</div>
                            </div>
                        </div>

                        ${
                          expense.remarks
                            ? `
                        <div class="remarks">
                            <div class="remarks-label">Remarks:</div>
                            <div class="remarks-content">${expense.remarks}</div>
                        </div>
                        `
                            : ''
                        }
                    </body>
                </html>
            `;

      const { uri } = await Print.printToFileAsync({
        html: htmlContent,
        width: 612,
        height: 792,
        base64: false,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Share Expense Details',
          UTI: 'com.adobe.pdf',
        });
      } else {
        showSnackbar('Sharing is not available on this device', 'error');
      }
    } catch (error) {
      console.error('Error sharing expense:', error);
      showSnackbar('Failed to share expense details', 'error');
    }
  };

  if (visible && !expense) {
    return (
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title="Expense Details"
        subtitle="Manage your property expenses"
      >
        <LoadingCard iconName={'cash-minus' as any} text="Loading expense..." />
      </BaseModal>
    );
  }

  const categoryDetails = expense
    ? EXPENSE_CATEGORY.find(cat => cat.key === expense.category) || EXPENSE_CATEGORY[0]
    : EXPENSE_CATEGORY[0];
  const categoryColor = (colors as any)[categoryDetails.color] || categoryDetails.color;

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Expense Details"
      subtitle="Manage your property expenses"
      maxHeight="90%"
      headerRight={
        <Menu
          visible={menuVisible}
          onDismiss={() => setMenuVisible(false)}
          anchor={
            <IconButton
              icon="dots-vertical"
              size={24}
              onPress={() => setMenuVisible(true)}
            />
          }
        >
          <Menu.Item
            onPress={() => {
              setMenuVisible(false);
              if (expenseId) onEdit?.(expenseId);
            }}
            title="Edit"
            leadingIcon="pencil"
          />
          <Menu.Item
            onPress={() => {
              setMenuVisible(false);
              handleShare();
            }}
            title="Share"
            leadingIcon="share"
          />
          <Menu.Item
            onPress={() => {
              setMenuVisible(false);
              handleDelete();
            }}
            title="Delete"
            leadingIcon="delete"
            titleStyle={{ color: colors.error }}
          />
        </Menu>
      }
    >
      <ScrollView style={styles.container}>
        <Surface style={[styles.card, { backgroundColor: colors.surface }]} elevation={0}>
          <View style={styles.header}>
            <View style={styles.categoryContainer}>
              <MaterialCommunityIcons
                name={categoryDetails.icon as any}
                size={24}
                color={categoryColor}
              />
              <Text
                variant="titleLarge"
                style={[styles.categoryTitle, { color: categoryColor }]}
              >
                {categoryDetails.label}
              </Text>
            </View>
            <Text
              variant="headlineMedium"
              style={[styles.amount, { color: colors.primary }]}
            >
              {defaultCurrency && expense
                ? formatWithCurrency(expense.amount, defaultCurrency)
                : expense?.amount}
            </Text>
          </View>

          <View style={styles.detailsContainer}>
            <View style={styles.detailRow}>
              <MaterialCommunityIcons
                name="calendar"
                size={20}
                color={colors.onSurfaceVariant}
              />
              <Text variant="bodyLarge" style={styles.detailText}>
                {expense ? formatDate(expense.date) : ''}
              </Text>
            </View>

            {expense?.remarks && (
              <View style={styles.detailRow}>
                <MaterialCommunityIcons
                  name="text"
                  size={20}
                  color={colors.onSurfaceVariant}
                />
                <Text variant="bodyLarge" style={styles.detailText}>
                  {expense.remarks}
                </Text>
              </View>
            )}
          </View>
        </Surface>

        {isOwner && (
          <HistoryModal
            entityType="expenses"
            entityId={expense?.id}
            containerStyle={{ marginTop: 16 }}
          />
        )}
      </ScrollView>

      <BaseModal
        visible={showDeleteModal}
        onDismiss={() => setShowDeleteModal(false)}
        mode="confirm"
        title="Delete Expense"
        message="Are you sure you want to delete this expense?"
        confirmText="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  card: {
    padding: 16,
    borderRadius: 12,
  },
  header: {
    marginBottom: 24,
    alignItems: 'center',
  },
  categoryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  categoryTitle: {},
  amount: {
    fontWeight: 'bold',
  },
  detailsContainer: {
    gap: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailText: {
    flex: 1,
  },
});
