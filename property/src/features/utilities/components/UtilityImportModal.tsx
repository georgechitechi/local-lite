import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Checkbox,
  Divider,
  Text,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import { useIdleLock } from '@/providers/LockScreenProvider';
import type { BatchMutation } from 'local-lite';
import BaseModal from '@/shared/components/BaseModal';
import LoadingOverlay from '@/shared/components/LoadingOverlay';
import {
  useCoreMutations,
  useExpenses,
  useSettings,
} from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { formatCompactDateTime, formatDateForDB } from '@/shared/utils/formatters';
import { generateUUID } from '@/shared/utils/helper';

interface TokenConcept {
  codConcept: string;
  amount: number;
}

interface TokenData {
  trnTimestamp: number;
  tokenNo: string;
  trnUnits: number;
  trnAmount: number;
  msno: string;
  tariff: string;
  concepts?: TokenConcept[];
  isDuplicate?: boolean;
  meterNo?: string;
}

interface UtilityImportModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess?: () => void;
}

const formatTokenNo = (tokenNo: string) => {
  return tokenNo.replace(/(.{4})/g, '$1-').replace(/-$/, '');
};

const isTokenDuplicate = (token: TokenData, existingExpensesTokens: string[]) => {
  const normToken = normalizeToken(token.tokenNo || '');
  return normToken ? existingExpensesTokens.some(r => r.includes(normToken)) : false;
};

const calculateTokenAmount = (token: TokenData) => {
  const tokenConcept = token.concepts?.find(c => c.codConcept === 'RESSTEP0');
  return tokenConcept ? tokenConcept.amount : 0;
};

const normalizeToken = (t: string) => t.replace(/[^0-9]/g, '');

export default function UtilityImportModal({
  visible,
  onDismiss,
  onSuccess,
}: UtilityImportModalProps) {
  const { user } = useAuth();

  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const router = useRouter();
  const { selectedBusiness } = useBusiness();
  const settings = useSettings(selectedBusiness?.id);
  const { batch } = useCoreMutations();
  const expenses = useExpenses(selectedBusiness?.id);
  const { pauseAutoLock, resumeAutoLock } = useIdleLock();

  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [totalFound, setTotalFound] = useState(0);
  const [selectedTokenNos, setSelectedTokenNos] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [currentMeter, setCurrentMeter] = useState<string>('');

  const activeMeterNumber = React.useMemo(() => {
    const utilityMeters = (settings || []).find(
      (s: any) => s.setting_key === 'utility_meters' && !s.deleted,
    );
    let val: any = utilityMeters?.setting_value;
    if (typeof val === 'string') {
      try { val = JSON.parse(val); } catch {}
    }
    const meters: any[] = Array.isArray(val) ? val : [];
    const activeMeter: any = meters.find(
      (m: any) => m?.type === 'electricity' && m?.active !== false,
    );
    return (activeMeter?.meterNumber as string) || '';
  }, [settings]);

  const fetchTokens = React.useCallback(
    async (forcePoll: boolean = false) => {
      setLoading(true);
      if (forcePoll) {
        pauseAutoLock();
      }
      try {
        const meter = activeMeterNumber;
        if (!meter) {
          setLoading(false);
          return;
        }
        setCurrentMeter(meter);

        const existingExpensesTokens = expenses.map(e => normalizeToken(e.remarks || ''));
        let nonDuplicateTokens: TokenData[] = [];
        let totalFoundItems = 0;

        const startTime = Date.now();
        const minDuration = forcePoll ? 10000 : 0;

        while (true) {
          const apiBaseUrl = 'https://property-admin-vjk4.onrender.com';
          const url = forcePoll
            ? `${apiBaseUrl}/api/tokens/${meter}?_t=${Date.now()}`
            : `${apiBaseUrl}/api/tokens/${meter}`;

          const headers: any = { Accept: 'application/json' };
          if (forcePoll) {
            headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            headers.Pragma = 'no-cache';
          }

          const response = await fetch(url, { headers });
          const text = await response.text();
          let json: any = {};
          try {
            json = JSON.parse(text);
          } catch (_e) {
            throw new Error('Invalid API response: not JSON');
          }

          if (json.success && json.data?.data?.[0]?.colPrepayment) {
            const rawTokens = json.data.data[0].colPrepayment as TokenData[];
            totalFoundItems = rawTokens.length;

            const fetchedTokens = rawTokens.map(token => {
              return {
                ...token,
                meterNo: meter, // Inject the meter number we searched for
                isDuplicate: isTokenDuplicate(token, existingExpensesTokens),
              };
            });

            const uniqueTokensMap = new Map<string, TokenData>();
            fetchedTokens.forEach(token => {
              const norm = normalizeToken(token.tokenNo || '');
              if (norm && !uniqueTokensMap.has(norm)) {
                uniqueTokensMap.set(norm, token);
              }
            });

            nonDuplicateTokens = Array.from(uniqueTokensMap.values()).filter(
              t => !t.isDuplicate,
            );
          }

          const elapsed = Date.now() - startTime;
          if (!forcePoll || elapsed >= minDuration) {
            break;
          } else {
            // Wait 3 seconds before polling again
            await new Promise(resolve =>
              setTimeout(resolve, Math.min(3000, minDuration - elapsed)),
            );
          }
        }

        setTotalFound(totalFoundItems);
        setTokens(nonDuplicateTokens);
        setSelectedTokenNos(new Set(nonDuplicateTokens.map(t => t.tokenNo)));

        if (totalFoundItems === 0) {
          showSnackbar('No tokens found or failed to fetch.', 'error');
        }
      } catch (error) {
        setTotalFound(0);
        console.warn('Fetch error:', error);
        showSnackbar('Failed to fetch utility tokens.', 'error');
      } finally {
        setLoading(false);
        if (forcePoll) {
          resumeAutoLock();
        }
      }
    },
    [expenses, showSnackbar, pauseAutoLock, resumeAutoLock, selectedBusiness?.id],
  );

  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const handleDismiss = () => {
    setTokens([]);
    setTotalFound(0);
    setSelectedTokenNos(new Set());
    setInitializedKey(null);
    onDismiss();
  };

  useEffect(() => {
    if (!visible) return;
    if (initializedKey === 'open') return;

    fetchTokens(false);
    setInitializedKey('open');
  }, [visible, fetchTokens, initializedKey]);

  const toggleSelection = (tokenNo: string) => {
    const next = new Set(selectedTokenNos);
    if (next.has(tokenNo)) {
      next.delete(tokenNo);
    } else {
      next.add(tokenNo);
    }
    setSelectedTokenNos(next);
  };

  const handleImport = async () => {
    if (selectedTokenNos.size === 0 || !selectedBusiness?.id) return;

    setImporting(true);
    try {
      if (!user) throw new Error('User not found');

      const selectedTokens = tokens.filter(t => selectedTokenNos.has(t.tokenNo));
      const existingExpensesTokens = expenses.map(e => normalizeToken(e.remarks || ''));

      let importedCount = 0;
      let skippedCount = 0;
      const mutations: BatchMutation[] = [];
      for (const token of selectedTokens) {
        if (isTokenDuplicate(token, existingExpensesTokens)) {
          skippedCount++;
          continue;
        }

        const id = generateUUID();
        const date = formatDateForDB(new Date(token.trnTimestamp));

        const tknAmt = calculateTokenAmount(token);
        const otherCharges = token.trnAmount - tknAmt;
        const formattedToken = formatTokenNo(token.tokenNo);
        const formattedDate = formatCompactDateTime(token.trnTimestamp);

        const remark = `Mtr:${token.meterNo || token.msno}
Token:${formattedToken}
Date:${formattedDate}
Units:${token.trnUnits}
Amt:${token.trnAmount.toFixed(2)}
TknAmt:${tknAmt.toFixed(2)}
OtherCharges:${otherCharges.toFixed(2)}
For Details dial *977#`;

        const expenseData = {
          id,
          business_id: selectedBusiness.id,
          user_id: user.id,
          category: 'Utilities',
          amount: token.trnAmount,
          date,
          remarks: remark,
          metadata: {},
        };

        mutations.push({
          tableName: 'expenses',
          operation: 'INSERT',
          payload: expenseData,
        });
        importedCount++;
      }

      if (mutations.length > 0 && batch) {
        await batch(mutations);
      }

      let message = `Successfully imported ${importedCount} utility expenses!`;
      if (skippedCount > 0) {
        message += ` (${skippedCount} duplicates skipped)`;
      }
      showSnackbar(message, importedCount > 0 ? 'success' : 'info');
      onSuccess?.();
      handleDismiss();
    } catch (error) {
      console.error('Import error:', error);
      showSnackbar('Failed to import utility expenses.', 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <BaseModal
      visible={visible}
      onDismiss={handleDismiss}
      title="Import Utility Expenses"
      subtitle={
        currentMeter
          ? `KPLC Tokens for Meter ${currentMeter}`
          : 'No active electricity meter set'
      }
      edgeToEdge
      actions={[
        {
          label: 'Cancel',
          onPress: handleDismiss,
          mode: 'outlined',
          disabled: importing,
        },
        {
          label: `Import (${selectedTokenNos.size})`,
          onPress: handleImport,
          mode: 'contained',
          loading: importing,
          disabled: importing || selectedTokenNos.size === 0 || !currentMeter,
          icon: 'download',
        },
      ]}
      scrollable={false}
    >
      <View style={styles.container}>
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ marginTop: 16 }}>Fetching tokens...</Text>
          </View>
        ) : !currentMeter ? (
          <View style={styles.centerContainer}>
            <MaterialCommunityIcons name="flash-off" size={48} color={colors.error} />
            <Text style={{ marginTop: 16, textAlign: 'center', fontWeight: 'bold' }}>
              No electricity meter configured
            </Text>
            <Text
              style={{
                marginTop: 8,
                textAlign: 'center',
                color: colors.onSurfaceVariant,
              }}
            >
              Go to Settings → Utility Meters and add an active Electricity meter.
            </Text>
            <Button
              mode="contained"
              icon="meter-electric-outline"
              onPress={() => {
                onDismiss();
                router.push('/settings');
              }}
              style={{ marginTop: 16 }}
            >
              Open Utility Meters
            </Button>
          </View>
        ) : tokens.length === 0 ? (
          <View style={styles.centerContainer}>
            <MaterialCommunityIcons
              name={totalFound > 0 ? 'check-circle' : 'flash-off'}
              size={48}
              color={totalFound > 0 ? colors.primary : colors.outline}
            />
            <Text style={{ marginTop: 8, textAlign: 'center' }}>
              {totalFound > 0
                ? `Found ${totalFound} tokens which are all imported`
                : 'No tokens found'}
            </Text>
            <Button onPress={() => fetchTokens(true)} style={{ marginTop: 16 }}>
              {totalFound > 0 ? 'Refresh' : 'Retry'}
            </Button>
          </View>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text variant="titleSmall" style={{ fontWeight: 'bold' }}>
                Found {tokens.length} tokens to import
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Button
                  mode="text"
                  compact
                  onPress={() => {
                    if (selectedTokenNos.size === tokens.length) {
                      setSelectedTokenNos(new Set());
                    } else {
                      setSelectedTokenNos(new Set(tokens.map(t => t.tokenNo)));
                    }
                  }}
                >
                  {selectedTokenNos.size === tokens.length
                    ? 'Deselect All'
                    : 'Select All'}
                </Button>
              </View>
            </View>
            <Divider />
            <ScrollView contentContainerStyle={styles.scrollContent}>
              {tokens.map(token => {
                const isSelected = selectedTokenNos.has(token.tokenNo);
                const date = new Date(token.trnTimestamp).toLocaleDateString();

                return (
                  <Card
                    key={token.tokenNo}
                    style={[
                      styles.tokenCard,
                      { backgroundColor: colors.surface },
                      isSelected && { borderColor: colors.primary, borderWidth: 1 },
                    ]}
                    onPress={() => toggleSelection(token.tokenNo)}
                    mode="outlined"
                  >
                    <Card.Content style={styles.cardContent}>
                      <View style={styles.cardRow}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                              KES {token.trnAmount.toLocaleString()}
                            </Text>
                          </View>
                          <Text
                            variant="labelSmall"
                            style={{ color: colors.onSurfaceVariant }}
                          >
                            Date: {date} • Units: {token.trnUnits}
                          </Text>
                          <Text variant="bodySmall" style={{ marginTop: 4 }}>
                            Token: {token.tokenNo}
                          </Text>
                        </View>
                        <Checkbox
                          status={isSelected ? 'checked' : 'unchecked'}
                          onPress={() => toggleSelection(token.tokenNo)}
                          color={colors.primary}
                        />
                      </View>
                    </Card.Content>
                  </Card>
                );
              })}
            </ScrollView>
          </>
        )}
      </View>
      <LoadingOverlay visible={importing} message="Importing tokens..." />
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 300,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  scrollContent: {
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tokenCard: {
    marginBottom: 12,
  },
  cardContent: {
    padding: 12,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
