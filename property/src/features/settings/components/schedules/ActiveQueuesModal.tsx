import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Fragment, useState } from 'react';
import { ScrollView, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  Menu,
  Text,
  useTheme,
} from 'react-native-paper';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import { useLocalSync } from '@/shared/hooks/useLocalSync';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { supabase } from '@/shared/services/supabase';
import { htmlToPlain } from '@/shared/services/templateService';
import { formatDateTime } from '@/shared/utils/formatters';

interface ActiveQueuesModalProps {
  visible: boolean;
  onDismiss: () => void;
  activeQueuesData: any[];
  setActiveQueuesData: (data: any[]) => void;
  loadingQueues: boolean;
  setLoadingQueues: (loading: boolean) => void;
}

export default function ActiveQueuesModal({
  visible,
  onDismiss,
  activeQueuesData,
  setActiveQueuesData,
  loadingQueues,
  setLoadingQueues,
}: ActiveQueuesModalProps) {
  const theme = useTheme();
  const colors = useThemeColors();
  const { showSnackbar } = useSnackbar();
  const { session } = useAuth();
  const { checkOnline } = useOfflineCheck();
  const { requireCloudSync } = useLocalSync();

  const [openQueueMenuId, setOpenQueueMenuId] = useState<number | null>(null);
  const [previewPayload, setPreviewPayload] = useState<any>(null);

  const fetchActiveQueues = async () => {
    if (!checkOnline('View Active Queues') || !requireCloudSync('View Active Queues'))
      return;
    try {
      setLoadingQueues(true);
      const { data: messagesData, error: messagesError } = await supabase.rpc(
        'get_pending_queue_jobs',
        {
          queue_name: 'bulk_messages',
        },
      );
      if (messagesError) throw messagesError;

      const combined = (messagesData || [])
        .map((msg: any) => ({
          ...msg,
          type: msg.message?.channel === 'sms' ? 'SMS' : 'Email',
        }))
        .sort(
          (a: any, b: any) =>
            new Date(b.enqueued_at).getTime() - new Date(a.enqueued_at).getTime(),
        );

      setActiveQueuesData(combined);
    } catch (error: any) {
      console.error('Error fetching active queues:', error);
      showSnackbar('Failed to fetch active queues', 'error');
    } finally {
      setLoadingQueues(false);
    }
  };

  const handleManageQueueJob = async (
    msgId: number,
    actionType: 'archive' | 'process_now',
  ) => {
    try {
      setLoadingQueues(true);
      const { error } = await supabase.rpc('manage_queue_job', {
        queue_name: 'bulk_messages',
        message_id: msgId,
        action_type: actionType,
      });
      if (error) throw error;

      if (actionType === 'process_now') {
        const token = session?.access_token;
        await supabase.functions.invoke('process-messages', {
          body: { action: 'process_queue' },
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        showSnackbar('Message processed successfully', 'success');
      } else {
        showSnackbar('Message archived successfully', 'success');
      }
      await fetchActiveQueues();
    } catch (e: any) {
      console.error('Failed to manage queue job:', e);
      showSnackbar(e?.message ?? `Failed to ${actionType} message`, 'error');
      setLoadingQueues(false);
    }
  };

  const handleDownloadAttachment = async (attachment: any) => {
    try {
      let content = attachment.content;
      if (!content) {
        showSnackbar('Attachment has no content', 'error');
        return;
      }
      if (content.includes('base64,')) {
        content = content.split('base64,')[1];
      }

      const file = new File(Paths.document, attachment.filename || 'attachment.pdf');
      file.write(content, { encoding: 'base64' });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri);
      } else {
        showSnackbar(`Saved to ${file.uri}`, 'success');
      }
    } catch (e: any) {
      console.error(e);
      showSnackbar('Failed to download attachment', 'error');
    }
  };

  return (
    <>
      <BaseModal
        visible={visible}
        onDismiss={onDismiss}
        title="Active Queues"
        subtitle="Pending messages in queues"
        scrollable
        maxHeight="85%"
        actions={[
          {
            label: 'Refresh',
            onPress: fetchActiveQueues,
            mode: 'outlined',
            icon: 'refresh',
            loading: loadingQueues,
            disabled: loadingQueues,
          },
          {
            label: 'Close',
            onPress: onDismiss,
            mode: 'contained',
          },
        ]}
      >
        {loadingQueues && activeQueuesData.length === 0 ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <ActivityIndicator size="large" />
          </View>
        ) : activeQueuesData.length === 0 ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <Text variant="bodyMedium">No pending messages in queues.</Text>
          </View>
        ) : (
          <List.Section>
            {activeQueuesData.map((msg, idx) => (
              <Fragment key={`${msg.type}-${msg.msg_id}-${idx}`}>
                <List.Item
                  style={{ paddingVertical: 0 }}
                  title={`${msg.type} to ${msg.message?.to || msg.message?.phone || 'Unknown'}`}
                  description={`Created: ${formatDateTime(msg.enqueued_at)}${
                    msg.vt &&
                    new Date(msg.vt).getTime() >
                      new Date(msg.enqueued_at).getTime() + 5000
                      ? `\nDispatch: ${formatDateTime(msg.vt)}`
                      : ''
                  }`}
                  descriptionNumberOfLines={2}
                  left={props => (
                    <List.Icon
                      {...props}
                      icon={msg.type === 'Email' ? 'email' : 'message-text'}
                      color={theme.colors.primary}
                    />
                  )}
                  right={props => (
                    <Menu
                      visible={openQueueMenuId === msg.msg_id}
                      onDismiss={() => setOpenQueueMenuId(null)}
                      anchor={
                        <IconButton
                          {...props}
                          icon="dots-vertical"
                          onPress={() => setOpenQueueMenuId(msg.msg_id)}
                        />
                      }
                    >
                      <Menu.Item
                        leadingIcon="eye"
                        title="View Payload"
                        onPress={() => {
                          setOpenQueueMenuId(null);
                          setPreviewPayload(msg.message);
                        }}
                      />
                      <Menu.Item
                        leadingIcon="send-clock"
                        title="Send Now"
                        onPress={() => {
                          setOpenQueueMenuId(null);
                          handleManageQueueJob(msg.msg_id, 'process_now');
                        }}
                      />
                      <Menu.Item
                        leadingIcon="archive"
                        title="Archive"
                        titleStyle={{ color: theme.colors.error }}
                        onPress={() => {
                          setOpenQueueMenuId(null);
                          handleManageQueueJob(msg.msg_id, 'archive');
                        }}
                      />
                    </Menu>
                  )}
                />
                {idx < activeQueuesData.length - 1 && <Divider />}
              </Fragment>
            ))}
          </List.Section>
        )}
      </BaseModal>

      {/* Payload Preview Modal */}
      <BaseModal
        visible={!!previewPayload}
        onDismiss={() => setPreviewPayload(null)}
        title="Message Preview"
        scrollable
        actions={[
          { label: 'Close', onPress: () => setPreviewPayload(null), mode: 'contained' },
        ]}
      >
        <ScrollView style={{ padding: 16, paddingBottom: 40 }}>
          {(() => {
            if (!previewPayload) return null;

            const attachmentsToDownload = Array.isArray(previewPayload.attachments)
              ? previewPayload.attachments
              : [];
            const payloadCopy = { ...previewPayload };
            if (payloadCopy.attachments && Array.isArray(payloadCopy.attachments)) {
              payloadCopy.attachments = `[${payloadCopy.attachments.length} attachment(s) removed for preview]`;
            }

            return (
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Chip icon={payloadCopy.channel === 'email' ? 'email' : 'message-text'}>
                    {payloadCopy.channel?.toUpperCase()}
                  </Chip>
                  {payloadCopy.provider && (
                    <Chip icon="server-network">{payloadCopy.provider}</Chip>
                  )}
                </View>
                <Text variant="labelLarge" style={{ marginTop: 8 }}>
                  To:
                </Text>
                <Text variant="bodyLarge">{payloadCopy.to}</Text>
                {payloadCopy.channel === 'email' && (
                  <>
                    <Text variant="labelLarge" style={{ marginTop: 8 }}>
                      Subject:
                    </Text>
                    <Text variant="bodyLarge" style={{ fontWeight: 'bold' }}>
                      {payloadCopy.subject}
                    </Text>
                    <Text variant="labelLarge" style={{ marginTop: 8 }}>
                      Message Body (Stripped HTML):
                    </Text>
                    <View
                      style={{
                        backgroundColor: colors.surfaceVariant,
                        padding: 12,
                        borderRadius: 8,
                      }}
                    >
                      <Text variant="bodyMedium">{htmlToPlain(payloadCopy.html)}</Text>
                    </View>
                  </>
                )}
                {payloadCopy.channel === 'sms' && (
                  <>
                    <Text variant="labelLarge" style={{ marginTop: 8 }}>
                      Message:
                    </Text>
                    <View
                      style={{
                        backgroundColor: colors.surfaceVariant,
                        padding: 12,
                        borderRadius: 8,
                      }}
                    >
                      <Text variant="bodyLarge">{payloadCopy.message}</Text>
                    </View>
                  </>
                )}
                {attachmentsToDownload.length > 0 && (
                  <>
                    <Divider style={{ marginVertical: 16 }} />
                    <Text
                      variant="labelMedium"
                      style={{ color: colors.outline, marginBottom: 8 }}
                    >
                      Attachments
                    </Text>
                    {attachmentsToDownload.map((att: any, idx: number) => (
                      <Button
                        key={idx}
                        mode="outlined"
                        icon="download"
                        onPress={() => handleDownloadAttachment(att)}
                        style={{ marginBottom: 8, alignSelf: 'flex-start' }}
                      >
                        Download {att.filename || `Attachment ${idx + 1}`}
                      </Button>
                    ))}
                  </>
                )}
              </View>
            );
          })()}
        </ScrollView>
      </BaseModal>
    </>
  );
}
