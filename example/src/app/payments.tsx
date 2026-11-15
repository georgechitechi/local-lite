import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  createDarajaAdapter,
  createManualPaymentAdapter,
  createPaymentRegistry,
  createPaystackAdapter,
  createStripeCheckoutAdapter,
  formatKenyanPhone,
  type PaymentInitiateResult,
  type PaymentMethodOption,
  type PaymentProviderAdapter,
  type PaymentProviderId,
  type PaymentWebhookResult,
} from 'local-lite/payments';

const CURRENCIES = ['KES', 'USD', 'NGN', 'GHS', 'EUR'] as const;
const COUNTRIES = ['KE', 'US', 'NG', 'GH', 'GB'] as const;
const ALL_PROVIDER_IDS = ['manual', 'daraja', 'stripe', 'paystack', 'bank_transfer'] as const;

interface PaymentLogEntry {
  id: string;
  amount: number;
  currency: string;
  result: PaymentInitiateResult;
  webhook?: PaymentWebhookResult;
  timestamp: string;
}

function makeActionId() {
  return `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Creates a mock fetch implementation for testing Daraja, Stripe, and Paystack
 * flows end-to-end without requiring live API credentials.
 */
function createMockPaymentFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/oauth/v1/generate')) {
      return Response.json({ access_token: 'mock_daraja_token_123' });
    }

    if (url.includes('/mpesa/stkpush/v1/processrequest')) {
      const ref = `ws_CO_${Date.now()}`;
      return Response.json({
        ResponseCode: '0',
        CheckoutRequestID: ref,
        MerchantRequestID: `mr_${Date.now()}`,
        CustomerMessage: 'Success. Request accepted for processing (Simulated)',
      });
    }

    if (url.includes('api.stripe.com/v1/checkout/sessions')) {
      const id = `cs_test_${Date.now().toString(36)}`;
      return Response.json({
        id,
        url: `https://checkout.stripe.com/c/pay/${id}`,
      });
    }

    if (url.includes('api.paystack.co/transaction/initialize')) {
      let ref = `ps_${Date.now().toString(36)}`;
      if (typeof init?.body === 'string') {
        try {
          const parsed = JSON.parse(init.body);
          if (parsed?.reference) ref = parsed.reference;
        } catch {
          // ignore parse errors
        }
      }
      return Response.json({
        status: true,
        message: 'Authorization URL created (Simulated)',
        data: {
          reference: ref,
          authorization_url: `https://checkout.paystack.com/${ref}`,
        },
      });
    }

    return Response.json({ error: `Unhandled mock URL: ${url}` }, { status: 404 });
  }) as typeof fetch;
}

export default function PaymentsScreen() {
  // Simulation vs Live mode
  const [simulated, setSimulated] = useState(true);

  // Context filters
  const [currency, setCurrency] = useState<string>('KES');
  const [country, setCountry] = useState<string>('KE');
  const [isOnline, setIsOnline] = useState(true);
  const [enabledFilter, setEnabledFilter] = useState<string[] | null>(null);

  // Live API credentials (used only when simulated === false)
  const [darajaKey, setDarajaKey] = useState('');
  const [darajaSecret, setDarajaSecret] = useState('');
  const [darajaShortcode, setDarajaShortcode] = useState('174379');
  const [darajaPasskey, setDarajaPasskey] = useState('');
  const [stripeSecretKey, setStripeSecretKey] = useState('');
  const [paystackSecretKey, setPaystackSecretKey] = useState('');

  // Form inputs
  const [selectedProvider, setSelectedProvider] = useState<PaymentProviderId>('daraja');
  const [actionId, setActionId] = useState(makeActionId);
  const [amount, setAmount] = useState('1500');
  const [phone, setPhone] = useState('0712345678');
  const [email, setEmail] = useState('demo@example.com');
  const [description, setDescription] = useState('Local-lite test order');
  const [callbackUrl, setCallbackUrl] = useState('https://api.example.com/payments/callback');
  const [returnUrl, setReturnUrl] = useState('https://app.example.com/payments/return');

  // Execution & logs
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [history, setHistory] = useState<PaymentLogEntry[]>([]);

  const mockFetch = useMemo(() => createMockPaymentFetch(), []);

  // Build PaymentRegistry with built-in + custom adapters
  const registry = useMemo(() => {
    const fetchImpl = simulated ? mockFetch : globalThis.fetch;

    const customBankAdapter: PaymentProviderAdapter = {
      id: 'bank_transfer',
      label: 'Custom Bank Transfer (EFT / RTGS)',
      description: 'Custom adapter registered via registry.register().',
      supportedCurrencies: ['KES', 'USD', 'EUR'],
      supportedCountries: '*',
      requiresOnline: false,
      async initiate(input) {
        return {
          success: true,
          status: 'pending',
          provider: 'bank_transfer',
          actionId: input.actionId,
          providerRef: `EFT-${input.actionId.slice(-6).toUpperCase()}`,
          customerMessage: `Transfer ${input.currency} ${input.amount} to Account #0012345678.`,
        };
      },
    };

    const reg = createPaymentRegistry({
      defaultCurrency: 'KES',
      enabledProviders: enabledFilter ?? undefined,
      providers: [
        createManualPaymentAdapter(),
        createDarajaAdapter({
          consumerKey: simulated ? 'mock_ck' : darajaKey || 'missing_ck',
          consumerSecret: simulated ? 'mock_cs' : darajaSecret || 'missing_cs',
          shortcode: darajaShortcode || '174379',
          passkey: simulated ? 'mock_pk' : darajaPasskey || 'missing_pk',
          callbackUrl,
          env: 'sandbox',
          fetch: fetchImpl,
        }),
        createStripeCheckoutAdapter({
          secretKey: simulated ? 'sk_test_mock' : stripeSecretKey || 'sk_test_missing',
          fetch: fetchImpl,
        }),
        createPaystackAdapter({
          secretKey: simulated ? 'sk_test_paystack_mock' : paystackSecretKey || 'sk_test_missing',
          fetch: fetchImpl,
        }),
      ],
    });

    reg.register(customBankAdapter);
    return reg;
  }, [
    simulated,
    mockFetch,
    enabledFilter,
    darajaKey,
    darajaSecret,
    darajaShortcode,
    darajaPasskey,
    callbackUrl,
    stripeSecretKey,
    paystackSecretKey,
  ]);

  const availableOptions: PaymentMethodOption[] = useMemo(() => {
    return registry.getAvailableOptions({
      currency,
      country,
      isOnline,
      enabledProviders: enabledFilter ?? undefined,
    });
  }, [registry, currency, country, isOnline, enabledFilter]);

  // Keep selectedProvider aligned with available options when filters change
  const activeOption =
    availableOptions.find((o) => o.id === selectedProvider) ?? availableOptions[0] ?? null;
  const activeProviderId = activeOption?.id ?? selectedProvider;

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    if (Platform.OS !== 'web') {
      Alert.alert(type === 'success' ? 'Success' : 'Error', text);
    }
  };

  const toggleProviderFilter = (id: string) => {
    setEnabledFilter((prev) => {
      if (!prev) {
        return ALL_PROVIDER_IDS.filter((p) => p !== id);
      }
      if (prev.includes(id)) {
        const next = prev.filter((p) => p !== id);
        return next.length === 0 ? [] : next;
      }
      const next = [...prev, id];
      return next.length === ALL_PROVIDER_IDS.length ? null : next;
    });
  };

  const handleInitiate = async () => {
    if (!activeOption) {
      showToast('No payment provider is available for the current context.', 'error');
      return;
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      showToast('Enter a valid amount greater than 0.', 'error');
      return;
    }

    setMessage(null);
    setSubmitting(true);
    try {
      const result = await registry.initiate({
        actionId,
        provider: activeOption.id,
        amount: numericAmount,
        currency,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        description: description.trim() || undefined,
        callbackUrl: callbackUrl.trim() || undefined,
        returnUrl: returnUrl.trim() || undefined,
      });

      const entry: PaymentLogEntry = {
        id: actionId,
        amount: numericAmount,
        currency,
        result,
        timestamp: new Date().toLocaleTimeString(),
      };
      setHistory((prev) => [entry, ...prev]);
      setActionId(makeActionId());
      showToast(
        `${activeOption.label}: ${result.status.toUpperCase()}${result.providerRef ? ` (${result.providerRef})` : ''}`,
      );
    } catch (err: any) {
      showToast(err?.message || String(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSimulateDarajaWebhook = async (entry: PaymentLogEntry) => {
    const daraja = registry.getProvider('daraja');
    if (!daraja?.verifyWebhook) return;

    try {
      const checkoutId = entry.result.providerRef || `ws_CO_${Date.now()}`;
      const merchantReqId = entry.result.merchantRequestId || `mr_${Date.now()}`;
      const normalizedPhone = formatKenyanPhone(phone || '0712345678');

      const webhookReq = new Request(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Body: {
            stkCallback: {
              MerchantRequestID: merchantReqId,
              CheckoutRequestID: checkoutId,
              ResultCode: 0,
              ResultDesc: 'The service request is processed successfully.',
              CallbackMetadata: {
                Item: [
                  { Name: 'Amount', Value: Math.round(entry.amount) },
                  {
                    Name: 'MpesaReceiptNumber',
                    Value: `MPR${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
                  },
                  { Name: 'PhoneNumber', Value: Number(normalizedPhone) },
                ],
              },
            },
          },
        }),
      });

      const verified = await daraja.verifyWebhook(webhookReq);
      setHistory((prev) =>
        prev.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                result: {
                  ...item.result,
                  status: verified.status,
                },
                webhook: verified,
              }
            : item,
        ),
      );
      showToast(
        `Webhook verified! Receipt: ${verified.receiptNumber ?? 'N/A'} (${verified.status})`,
      );
    } catch (err: any) {
      showToast(err?.message || String(err), 'error');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>💳 local-lite Payments</Text>
        <Text style={styles.subtitle}>
          Test PaymentRegistry context filtering, offline manual payments, M-Pesa Daraja, Stripe,
          Paystack & custom adapters
        </Text>
        <View style={styles.badgeRow}>
          <TouchableOpacity
            style={[styles.badge, simulated ? styles.badgeInfo : styles.badgeWarn]}
            onPress={() => setSimulated((s) => !s)}
          >
            <Text style={styles.badgeText}>
              {simulated ? 'Mode: Simulated (Mock API)' : 'Mode: Live API'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.badge, isOnline ? styles.badgeSuccess : styles.badgeMuted]}
            onPress={() => setIsOnline((o) => !o)}
          >
            <Text style={styles.badgeText}>{isOnline ? 'Online' : 'Offline'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Toast Alert */}
      {message && (
        <View
          style={[
            styles.alert,
            message.type === 'error' ? styles.alertError : styles.alertSuccess,
          ]}
        >
          <Text style={styles.alertText}>{message.text}</Text>
        </View>
      )}

      {/* Context Filter Card */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>1. Registry Context</Text>

        <Text style={styles.label}>Currency</Text>
        <View style={styles.chipRow}>
          {CURRENCIES.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.chip, currency === c && styles.chipActive]}
              onPress={() => setCurrency(c)}
            >
              <Text style={[styles.chipText, currency === c && styles.chipTextActive]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Country</Text>
        <View style={styles.chipRow}>
          {COUNTRIES.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.chip, country === c && styles.chipActive]}
              onPress={() => setCountry(c)}
            >
              <Text style={[styles.chipText, country === c && styles.chipTextActive]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>
          Enabled Providers ({enabledFilter ? `${enabledFilter.length} selected` : 'All'})
        </Text>
        <View style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chip, !enabledFilter && styles.chipActive]}
            onPress={() => setEnabledFilter(null)}
          >
            <Text style={[styles.chipText, !enabledFilter && styles.chipTextActive]}>All</Text>
          </TouchableOpacity>
          {ALL_PROVIDER_IDS.map((id) => {
            const active = !enabledFilter || enabledFilter.includes(id);
            return (
              <TouchableOpacity
                key={id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => toggleProviderFilter(id)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{id}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Available Methods Card */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          2. Available Methods ({availableOptions.length})
        </Text>
        {availableOptions.length === 0 ? (
          <Text style={styles.emptyText}>
            No payment providers match {currency} / {country} ({isOnline ? 'online' : 'offline'}).
          </Text>
        ) : (
          availableOptions.map((option) => {
            const isSelected = activeProviderId === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.methodCard, isSelected && styles.methodCardActive]}
                onPress={() => setSelectedProvider(option.id)}
              >
                <View style={styles.methodHeader}>
                  <Text style={styles.methodTitle}>
                    {isSelected ? '● ' : '○ '}
                    {option.label}
                  </Text>
                  <View style={styles.methodBadge}>
                    <Text style={styles.methodBadgeText}>
                      {option.requiresOnline ? 'Online' : 'Offline-ready'}
                    </Text>
                  </View>
                </View>
                {option.description ? (
                  <Text style={styles.methodDesc}>{option.description}</Text>
                ) : null}
                <Text style={styles.methodMeta}>
                  ID: {option.id} • Currencies:{' '}
                  {option.supportedCurrencies === '*'
                    ? 'All (*)'
                    : option.supportedCurrencies.join(', ')}
                </Text>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {/* Payment Initiation Form */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>3. Initiate Payment</Text>

        <View style={styles.rowBetween}>
          <Text style={styles.label}>Action ID (Idempotency Key)</Text>
          <TouchableOpacity onPress={() => setActionId(makeActionId())}>
            <Text style={styles.linkText}>Generate New</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          value={actionId}
          onChangeText={setActionId}
          autoCapitalize="none"
        />

        <Text style={styles.label}>Amount ({currency})</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="1500"
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder="Order payment"
        />

        {activeProviderId === 'daraja' && (
          <>
            <Text style={styles.label}>
              Kenyan Phone (formatted: {formatKenyanPhone(phone) || 'invalid'})
            </Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="0712345678"
            />
            <Text style={styles.label}>HTTPS Callback URL</Text>
            <TextInput
              style={styles.input}
              value={callbackUrl}
              onChangeText={setCallbackUrl}
              autoCapitalize="none"
            />
          </>
        )}

        {(activeProviderId === 'stripe' || activeProviderId === 'paystack') && (
          <>
            <Text style={styles.label}>Customer Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </>
        )}

        {activeProviderId === 'stripe' && (
          <>
            <Text style={styles.label}>Return URL</Text>
            <TextInput
              style={styles.input}
              value={returnUrl}
              onChangeText={setReturnUrl}
              autoCapitalize="none"
            />
          </>
        )}

        {activeProviderId === 'paystack' && (
          <>
            <Text style={styles.label}>Callback URL</Text>
            <TextInput
              style={styles.input}
              value={callbackUrl}
              onChangeText={setCallbackUrl}
              autoCapitalize="none"
            />
          </>
        )}

        {!simulated && activeProviderId === 'daraja' && (
          <View style={styles.liveBox}>
            <Text style={styles.liveBoxTitle}>Live Daraja Sandbox Credentials</Text>
            <TextInput
              style={styles.input}
              placeholder="Consumer Key"
              value={darajaKey}
              onChangeText={setDarajaKey}
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder="Consumer Secret"
              value={darajaSecret}
              onChangeText={setDarajaSecret}
              autoCapitalize="none"
              secureTextEntry
            />
            <TextInput
              style={styles.input}
              placeholder="Shortcode (e.g. 174379)"
              value={darajaShortcode}
              onChangeText={setDarajaShortcode}
            />
            <TextInput
              style={styles.input}
              placeholder="Passkey"
              value={darajaPasskey}
              onChangeText={setDarajaPasskey}
              autoCapitalize="none"
              secureTextEntry
            />
          </View>
        )}

        {!simulated && activeProviderId === 'stripe' && (
          <View style={styles.liveBox}>
            <Text style={styles.liveBoxTitle}>Live Stripe Secret Key</Text>
            <TextInput
              style={styles.input}
              placeholder="sk_test_..."
              value={stripeSecretKey}
              onChangeText={setStripeSecretKey}
              autoCapitalize="none"
              secureTextEntry
            />
          </View>
        )}

        {!simulated && activeProviderId === 'paystack' && (
          <View style={styles.liveBox}>
            <Text style={styles.liveBoxTitle}>Live Paystack Secret Key</Text>
            <TextInput
              style={styles.input}
              placeholder="sk_test_..."
              value={paystackSecretKey}
              onChangeText={setPaystackSecretKey}
              autoCapitalize="none"
              secureTextEntry
            />
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryButton, (!activeOption || submitting) && styles.buttonDisabled]}
          onPress={handleInitiate}
          disabled={!activeOption || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>
              Initiate {activeOption ? activeOption.label : 'Payment'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Payment History & Webhook Tester */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>4. Payment Results ({history.length})</Text>
          {history.length > 0 && (
            <TouchableOpacity onPress={() => setHistory([])}>
              <Text style={styles.linkText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {history.length === 0 ? (
          <Text style={styles.emptyText}>
            No payments initiated yet. Pick a provider above and tap Initiate.
          </Text>
        ) : (
          history.map((entry) => (
            <View key={entry.id} style={styles.historyItem}>
              <View style={styles.rowBetween}>
                <Text style={styles.historyTitle}>
                  {entry.result.provider.toUpperCase()} • {entry.currency} {entry.amount}
                </Text>
                <View
                  style={[
                    styles.statusPill,
                    entry.result.status === 'completed'
                      ? styles.statusCompleted
                      : entry.result.status === 'failed'
                        ? styles.statusFailed
                        : styles.statusPending,
                  ]}
                >
                  <Text style={styles.statusPillText}>{entry.result.status}</Text>
                </View>
              </View>

              <Text style={styles.historyMeta}>
                Action: {entry.result.actionId} • {entry.timestamp}
              </Text>
              {entry.result.providerRef ? (
                <Text style={styles.historyMeta}>Ref: {entry.result.providerRef}</Text>
              ) : null}
              {entry.result.customerMessage ? (
                <Text style={styles.historyMsg}>{entry.result.customerMessage}</Text>
              ) : null}

              {entry.result.checkoutUrl ? (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => Linking.openURL(entry.result.checkoutUrl!)}
                >
                  <Text style={styles.secondaryButtonText}>
                    Open Checkout URL ({entry.result.checkoutUrl})
                  </Text>
                </TouchableOpacity>
              ) : null}

              {entry.result.provider === 'daraja' && !entry.webhook && (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => handleSimulateDarajaWebhook(entry)}
                >
                  <Text style={styles.secondaryButtonText}>
                    Simulate Daraja Callback Webhook
                  </Text>
                </TouchableOpacity>
              )}

              {entry.webhook && (
                <View style={styles.webhookBox}>
                  <Text style={styles.webhookTitle}>
                    Webhook Verified: {entry.webhook.verified ? 'Yes' : 'No'} • Receipt:{' '}
                    {entry.webhook.receiptNumber ?? 'N/A'}
                  </Text>
                </View>
              )}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
    backgroundColor: '#f8fafc',
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 13,
    color: '#475569',
    marginTop: 4,
    lineHeight: 18,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeInfo: {
    backgroundColor: '#e0f2fe',
  },
  badgeWarn: {
    backgroundColor: '#fef3c7',
  },
  badgeSuccess: {
    backgroundColor: '#dcfce7',
  },
  badgeMuted: {
    backgroundColor: '#e2e8f0',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  alert: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 14,
  },
  alertSuccess: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  alertError: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  alertText: {
    fontSize: 13,
    color: '#0f172a',
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
    marginTop: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  chipActive: {
    backgroundColor: '#0284c7',
    borderColor: '#0284c7',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  methodCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    marginBottom: 10,
  },
  methodCardActive: {
    borderColor: '#0284c7',
    backgroundColor: '#f0f9ff',
  },
  methodHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  methodTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  methodBadge: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  methodBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  methodDesc: {
    fontSize: 12,
    color: '#475569',
    marginTop: 4,
  },
  methodMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0284c7',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
    marginBottom: 4,
  },
  liveBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  liveBoxTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
    marginBottom: 6,
  },
  primaryButton: {
    backgroundColor: '#0284c7',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryButtonText: {
    color: '#0369a1',
    fontSize: 12,
    fontWeight: '600',
  },
  historyItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  historyMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  historyMsg: {
    fontSize: 13,
    color: '#334155',
    marginTop: 4,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusCompleted: {
    backgroundColor: '#dcfce7',
  },
  statusPending: {
    backgroundColor: '#fef3c7',
  },
  statusFailed: {
    backgroundColor: '#fee2e2',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0f172a',
    textTransform: 'uppercase',
  },
  webhookBox: {
    marginTop: 8,
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#dcfce7',
  },
  webhookTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#166534',
  },
  emptyText: {
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 16,
    fontSize: 13,
  },
});
