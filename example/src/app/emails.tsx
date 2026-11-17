import { createElement, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { LocalFirstClient } from 'local-lite/config';
import type { ActionRecord } from 'local-lite';
import { DevMailbox, type DevSentEmail } from 'local-lite/email';
import { KeyboardScrollView } from 'react-native-keyboard-scroll';
import { BottomSheetModal } from '../components/BottomSheetModal';
import { getClient } from '../lib/sync';

const PRESETS = [
  {
    label: 'Welcome',
    to: 'demo@example.com',
    subject: 'Welcome to local-lite!',
    text: 'Your offline-first account is ready. Everything works locally and syncs when online.',
    html: '<h1>Welcome to local-lite!</h1><p>Your offline-first account is ready.</p>',
  },
  {
    label: 'Password Reset',
    to: 'demo@example.com',
    subject: 'Reset your password',
    text: 'Use code 482910 to reset your password. This code expires in 15 minutes.',
    html: '<p>Use code <strong>482910</strong> to reset your password.</p>',
  },
  {
    label: 'Receipt',
    to: 'billing@example.com',
    subject: 'Payment Receipt #INV-1042',
    text: 'Thank you for your payment of KES 1,500. Status: Paid.',
    html: '<p>Thank you for your payment of <strong>KES 1,500</strong>.</p>',
  },
] as const;

export default function EmailsScreen() {
  const [client, setClient] = useState<LocalFirstClient | null>(null);
  const [initLoading, setInitLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [to, setTo] = useState('demo@example.com');
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('Welcome to local-lite!');
  const [text, setText] = useState(
    'Your offline-first account is ready. Everything works locally and syncs when online.',
  );
  const [html, setHtml] = useState(
    '<h1>Welcome to local-lite!</h1><p>Your offline-first account is ready.</p>',
  );

  const [inbox, setInbox] = useState<DevSentEmail[]>([]);
  const [outbox, setOutbox] = useState<ActionRecord[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<DevSentEmail | null>(null);
  const [previewMode, setPreviewMode] = useState<'rendered' | 'text' | 'raw'>(
    'rendered',
  );
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setStatusMessage({ text: msg, type });
    if (Platform.OS !== 'web') {
      Alert.alert(type === 'success' ? 'Success' : 'Error', msg);
    }
  };

  const refreshState = useCallback(async (c: LocalFirstClient | null) => {
    setInbox(DevMailbox.getInbox().slice().reverse());
    if (c) {
      const records = await c.actions.list({ action: 'send_email' });
      setOutbox(records.slice().reverse());
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    getClient()
      .then(async (c) => {
        if (!mounted) return;
        setClient(c);
        await refreshState(c);
        setInitLoading(false);
      })
      .catch((err) => {
        if (!mounted) return;
        setInitLoading(false);
        showToast('Failed to initialize client: ' + err.message, 'error');
      });

    return () => {
      mounted = false;
    };
  }, [refreshState]);

  const handleSend = async (flushImmediately: boolean) => {
    if (!client) return;
    if (!to.trim() || !subject.trim()) {
      showToast('Recipient (To) and Subject are required.', 'error');
      return;
    }

    setSending(true);
    try {
      const record = await client.actions.sendEmail({
        to: to.trim(),
        ...(from.trim() ? { from: from.trim() } : {}),
        subject: subject.trim(),
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(html.trim() ? { html: html.trim() } : {}),
      });

      if (flushImmediately) {
        await client.actions.flush();
        showToast(`Dispatched email (${record.id}) to DevMailbox`);
      } else {
        showToast(`Enqueued email (${record.id}) in action outbox`);
      }

      await refreshState(client);
    } catch (err: any) {
      showToast(err?.message || 'Failed to send email', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleFlush = async () => {
    if (!client) return;
    setSending(true);
    try {
      const result = await client.actions.flush();
      await refreshState(client);
      showToast(
        `Flushed outbox: ${result.completed} sent, ${result.failed} failed`,
      );
    } catch (err: any) {
      showToast(err?.message || 'Flush failed', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleClearMailbox = async () => {
    DevMailbox.clear();
    if (client) {
      await client.actions.prune({
        completedOlderThanMs: 0,
        failedOlderThanMs: 0,
      });
    }
    await refreshState(client);
    showToast('Cleared DevMailbox and pruned completed outbox records');
  };

  if (initLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0284c7" />
        <Text style={styles.loadingText}>Initializing email outbox...</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <KeyboardScrollView
        style={[
          styles.container,
          selectedEmail !== null && styles.blurredContent,
        ]}
        contentContainerStyle={styles.content}
      >
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Provider: preview (DevMailbox)</Text>
          </View>
          <View style={styles.badgeSecondary}>
            <Text style={styles.badgeSecondaryText}>
              Inbox: {inbox.length} | Outbox: {outbox.length}
            </Text>
          </View>
        </View>

        {statusMessage && (
          <View
            style={[
              styles.toast,
              statusMessage.type === 'error'
                ? styles.toastError
                : styles.toastSuccess,
            ]}
          >
            <Text
              style={[
                styles.toastText,
                statusMessage.type === 'error'
                  ? styles.toastTextError
                  : styles.toastTextSuccess,
              ]}
            >
              {statusMessage.text}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Compose Test Email</Text>
          <Text style={styles.cardSubtitle}>
            Dispatches through client.actions.sendEmail() using the local
            preview provider.
          </Text>

          <View style={styles.presetRow}>
            {PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset.label}
                style={styles.presetChip}
                onPress={() => {
                  setTo(preset.to);
                  setSubject(preset.subject);
                  setText(preset.text);
                  setHtml(preset.html);
                }}
              >
                <Text style={styles.presetChipText}>{preset.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>To *</Text>
          <TextInput
            style={styles.input}
            value={to}
            onChangeText={setTo}
            placeholder="recipient@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>From (optional, uses defaultFrom)</Text>
          <TextInput
            style={styles.input}
            value={from}
            onChangeText={setFrom}
            placeholder="Local Lite Demo <no-reply@local-lite.dev>"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Subject *</Text>
          <TextInput
            style={styles.input}
            value={subject}
            onChangeText={setSubject}
            placeholder="Email subject"
          />

          <Text style={styles.label}>Text Body</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={text}
            onChangeText={setText}
            placeholder="Plain text body..."
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>HTML Body</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={html}
            onChangeText={setHtml}
            placeholder="<p>HTML body...</p>"
            multiline
            numberOfLines={3}
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.primaryButton, sending && styles.buttonDisabled]}
              onPress={() => handleSend(true)}
              disabled={sending}
            >
              <Text style={styles.primaryButtonText}>
                {sending ? 'Sending...' : 'Send & Flush'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, sending && styles.buttonDisabled]}
              onPress={() => handleSend(false)}
              disabled={sending}
            >
              <Text style={styles.secondaryButtonText}>Enqueue Only</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.outlineButton}
              onPress={handleFlush}
              disabled={sending}
            >
              <Text style={styles.outlineButtonText}>Flush Outbox</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dangerOutlineButton}
              onPress={handleClearMailbox}
              disabled={sending}
            >
              <Text style={styles.dangerOutlineButtonText}>Clear Inbox</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            DevMailbox Inbox ({inbox.length})
          </Text>
          <Text style={styles.cardSubtitle}>
            Captured in-memory without sending real network requests.
          </Text>

          {inbox.length === 0 ? (
            <Text style={styles.emptyText}>
              No emails dispatched yet. Tap "Send & Flush" above to test.
            </Text>
          ) : (
            inbox.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.emailItem}
                activeOpacity={0.75}
                onPress={() => {
                  setSelectedEmail(item);
                  setPreviewMode(item.mailOptions.html ? 'rendered' : 'text');
                }}
              >
                <View style={styles.emailHeader}>
                  <Text style={styles.emailSubject}>
                    {item.mailOptions.subject}
                  </Text>
                  <Text style={styles.emailTime}>
                    {new Date(item.sentAt).toLocaleTimeString()}
                  </Text>
                </View>
                <Text style={styles.emailMeta}>
                  From: {String(item.mailOptions.from || 'default')}
                </Text>
                <Text style={styles.emailMeta}>
                  To:{' '}
                  {Array.isArray(item.mailOptions.to)
                    ? item.mailOptions.to.join(', ')
                    : String(item.mailOptions.to)}
                </Text>
                {item.mailOptions.text ? (
                  <Text style={styles.emailBody} numberOfLines={2}>
                    {item.mailOptions.text}
                  </Text>
                ) : null}
                <View style={styles.emailFooter}>
                  <Text style={styles.emailId}>ID: {item.id}</Text>
                  <Text style={styles.previewLink}>Preview →</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Action Outbox ({outbox.length})</Text>
          {outbox.length === 0 ? (
            <Text style={styles.emptyText}>
              No send_email records in outbox.
            </Text>
          ) : (
            outbox.map((rec) => (
              <View key={rec.id} style={styles.outboxItem}>
                <View style={styles.emailHeader}>
                  <Text style={styles.outboxSubject}>
                    {rec.payload?.subject || '(no subject)'}
                  </Text>
                  <Text style={styles.outboxStatus}>
                    {rec.status.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.emailMeta}>
                  To: {String(rec.payload?.to || '')} | Retries:{' '}
                  {rec.retryCount}
                </Text>
              </View>
            ))
          )}
        </View>
      </KeyboardScrollView>

      <BottomSheetModal
        visible={selectedEmail !== null}
        onClose={() => setSelectedEmail(null)}
        title={selectedEmail?.mailOptions.subject || 'Email Preview'}
      >
        {selectedEmail && (
          <>
            <View style={styles.modalMetaBox}>
              <Text style={styles.emailMeta}>
                <Text style={styles.metaBold}>From: </Text>
                {String(selectedEmail.mailOptions.from || 'default')}
              </Text>
              <Text style={styles.emailMeta}>
                <Text style={styles.metaBold}>To: </Text>
                {Array.isArray(selectedEmail.mailOptions.to)
                  ? selectedEmail.mailOptions.to.join(', ')
                  : String(selectedEmail.mailOptions.to)}
              </Text>
              <Text style={styles.emailMeta}>
                <Text style={styles.metaBold}>Sent: </Text>
                {new Date(selectedEmail.sentAt).toLocaleString()}
              </Text>
            </View>

            <View style={styles.modeTabs}>
              {(['rendered', 'text', 'raw'] as const).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.modeTab,
                    previewMode === mode && styles.modeTabActive,
                  ]}
                  onPress={() => setPreviewMode(mode)}
                >
                  <Text
                    style={[
                      styles.modeTabText,
                      previewMode === mode && styles.modeTabTextActive,
                    ]}
                  >
                    {mode === 'rendered'
                      ? 'Preview'
                      : mode === 'text'
                        ? 'Plain Text'
                        : 'Raw HTML'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView style={styles.previewBody}>
              {previewMode === 'rendered' ? (
                selectedEmail.mailOptions.html ? (
                  Platform.OS === 'web' ? (
                    createElement('iframe', {
                      srcDoc: selectedEmail.mailOptions.html,
                      style: {
                        width: '100%',
                        minHeight: 260,
                        border: 'none',
                        backgroundColor: '#ffffff',
                      },
                      sandbox: '',
                    })
                  ) : (
                    <Text style={styles.previewText}>
                      {selectedEmail.mailOptions.html
                        .replace(/<style[\s\S]*?<\/style>/gi, '')
                        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n\n')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .replace(/<[^>]+>/g, '')
                        .replace(/\n{3,}/g, '\n\n')
                        .trim()}
                    </Text>
                  )
                ) : (
                  <Text style={styles.previewText}>
                    {selectedEmail.mailOptions.text || '(empty body)'}
                  </Text>
                )
              ) : previewMode === 'text' ? (
                <Text style={styles.previewText}>
                  {selectedEmail.mailOptions.text || '(no plain text body)'}
                </Text>
              ) : (
                <Text style={styles.previewCode}>
                  {selectedEmail.mailOptions.html || '(no HTML body)'}
                </Text>
              )}
            </ScrollView>
          </>
        )}
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  blurredContent: {
    filter: [{ blur: 2 }] as any,
  },
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 16,
    paddingBottom: 36,
    gap: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    gap: 12,
  },
  loadingText: {
    color: '#64748b',
    fontSize: 14,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeText: {
    color: '#0369a1',
    fontSize: 12,
    fontWeight: '600',
  },
  badgeSecondary: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeSecondaryText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
  },
  toast: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  toastSuccess: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  toastError: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  toastText: {
    fontSize: 13,
    fontWeight: '500',
  },
  toastTextSuccess: {
    color: '#166534',
  },
  toastTextError: {
    color: '#991b1b',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 4,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  presetChip: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#ffffff',
  },
  multiline: {
    minHeight: 68,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#0284c7',
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  outlineButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  outlineButtonText: {
    color: '#334155',
    fontWeight: '600',
    fontSize: 13,
  },
  dangerOutlineButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#fca5a5',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  dangerOutlineButtonText: {
    color: '#dc2626',
    fontWeight: '600',
    fontSize: 13,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 13,
    fontStyle: 'italic',
  },
  emailItem: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 4,
  },
  emailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  emailSubject: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  emailTime: {
    fontSize: 11,
    color: '#64748b',
  },
  emailMeta: {
    fontSize: 12,
    color: '#475569',
  },
  emailBody: {
    fontSize: 13,
    color: '#1e293b',
    marginTop: 4,
  },
  emailId: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  outboxItem: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 2,
  },
  outboxSubject: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1,
  },
  outboxStatus: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284c7',
  },
  emailFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  previewLink: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0284c7',
  },
  modalMetaBox: {
    backgroundColor: '#f8fafc',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 2,
  },
  metaBold: {
    fontWeight: '700',
    color: '#334155',
  },
  modeTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingHorizontal: 12,
    gap: 6,
    paddingTop: 8,
  },
  modeTab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  modeTabActive: {
    borderBottomColor: '#0284c7',
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  modeTabTextActive: {
    color: '#0284c7',
  },
  previewBody: {
    padding: 16,
    minHeight: 220,
  },
  previewText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#0f172a',
  },
  previewCode: {
    fontSize: 12,
    lineHeight: 18,
    color: '#334155',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
