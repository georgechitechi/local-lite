import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, IconButton, Portal, Surface, Text } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import BaseSearch from '@/shared/components/BaseSearch';
import EmptyState from '@/shared/components/EmptyState';
import SPressable from '@/shared/components/SlightPressable';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import type { PaymentMessage } from '@/shared/types/types';
import { formatDate } from '@/shared/utils/formatters';
import { addOpacity } from '@/shared/utils/helper';

interface LinkedMessagesProps {
  messages: PaymentMessage[];
  selectedMessageIds: string[];
  linkedMessages: PaymentMessage[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onMessageToggle: (message: PaymentMessage) => void;
  onCreateNew: () => void;
  onClearSelection: () => void;
  visible?: boolean;
  onDismiss?: () => void;
  onShow?: () => void;
  activeMessageId?: string;
}

export default function LinkedMessages({
  messages,
  selectedMessageIds,
  searchQuery,
  onSearchChange,
  onMessageToggle,
  onCreateNew,
  onClearSelection,
  visible,
  onDismiss,
  onShow,
  activeMessageId,
}: LinkedMessagesProps) {
  const colors = useThemeColors();

  const displayedMessages = useMemo(() => {
    let filtered = messages;
    if (searchQuery.trim()) {
      const search = searchQuery.toLowerCase();
      filtered = messages.filter(m => m.message_content.toLowerCase().includes(search));
    }

    const selectedIdsSet = new Set(selectedMessageIds.map(id => String(id)));

    const sorted = [...filtered].sort((a, b) => {
      const aId = String(a.id);
      const bId = String(b.id);

      // Active (newly imported) message always comes first
      if (activeMessageId) {
        if (aId === activeMessageId) return -1;
        if (bId === activeMessageId) return 1;
      }

      const aSelected = selectedIdsSet.has(aId);
      const bSelected = selectedIdsSet.has(bId);

      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;

      // Newest transaction first
      const dateA = a.transaction_date || '';
      const dateB = b.transaction_date || '';
      if (dateA > dateB) return -1;
      if (dateA < dateB) return 1;

      return 0;
    });

    // Limit to 5 messages if not searching
    if (!searchQuery.trim()) {
      return sorted.slice(0, 5);
    }

    return sorted;
  }, [messages, selectedMessageIds, searchQuery, activeMessageId]);

  const isMessageSelected = (id: string | number) =>
    selectedMessageIds.includes(String(id));

  // Filter messages that are currently selected to show in the inline section
  const selectedMessages = useMemo(() => {
    const selectedIdsSet = new Set(selectedMessageIds.map(id => String(id)));
    return messages.filter(m => selectedIdsSet.has(String(m.id)));
  }, [messages, selectedMessageIds]);

  return (
    <>
      {/* Inline Section View */}
      <SPressable
        onPress={() => onShow?.()}
        style={[
          styles.linkButton,
          { borderColor: colors.outline, backgroundColor: colors.surface },
        ]}
      >
        <View style={styles.linkButtonContent}>
          <View style={styles.linkButtonLeft}>
            <IconButton
              icon="link-variant"
              size={20}
              iconColor={colors.primary}
              style={styles.linkIcon}
            />
            <View>
              <Text
                variant="labelLarge"
                style={{ color: colors.primary, fontWeight: 'bold' }}
              >
                Link Payment Messages
              </Text>
              <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                {selectedMessageIds.length > 0
                  ? `${selectedMessageIds.length} message(s) linked`
                  : 'Link bank messages to this receipt'}
              </Text>
            </View>
          </View>
          <IconButton icon="plus-circle-outline" size={20} iconColor={colors.primary} />
        </View>
      </SPressable>

      {/* List of selected messages shown inline */}
      {selectedMessages.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          {selectedMessages.map(msg => (
            <Surface
              key={`selected-${msg.id}`}
              style={{
                padding: 10,
                borderRadius: 8,
                marginBottom: 8,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: addOpacity(colors.surfaceVariant, 0.25),
                borderWidth: 1,
                borderColor: colors.outlineVariant,
              }}
              elevation={0}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" numberOfLines={1} style={{ fontWeight: '600' }}>
                  {msg.message_content}
                </Text>
                <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                  {formatDate(msg.transaction_date || '')}
                </Text>
              </View>
              <IconButton
                icon="close-circle-outline"
                size={18}
                onPress={() => onMessageToggle(msg)}
                iconColor={colors.error}
              />
            </Surface>
          ))}
        </View>
      )}

      <Portal>
        <BaseModal
          visible={!!visible}
          onDismiss={onDismiss || (() => {})}
          title={`Link Messages (${selectedMessageIds.length})`}
          subtitle="Select payment messages to link with this receipt"
          maxHeight="85%"
          scrollable={false}
          edgeToEdge={true}
          actions={[
            {
              label: 'Done',
              onPress: onDismiss || (() => {}),
              mode: 'contained',
            },
          ]}
        >
          <View style={styles.modalContent}>
            <View style={[styles.modalActionsRow, { paddingHorizontal: 16 }]}>
              <View style={styles.modalActionsLeft}>
                <Text variant="bodyMedium" style={{ color: colors.onSurface }}>
                  {messages.length} {messages.length === 1 ? 'message' : 'messages'}
                </Text>
                {selectedMessageIds.length > 0 && (
                  <Text variant="bodySmall" style={{ color: colors.primary }}>
                    {selectedMessageIds.length} selected
                  </Text>
                )}
              </View>
              <View style={styles.modalActions}>
                {selectedMessageIds.length > 0 && (
                  <Button
                    mode="text"
                    onPress={onClearSelection}
                    textColor={colors.error}
                    compact
                    labelStyle={{ fontSize: 13, fontWeight: '700' }}
                  >
                    Clear
                  </Button>
                )}
                <Button
                  mode="text"
                  icon="plus"
                  onPress={onCreateNew}
                  compact
                  labelStyle={{ fontSize: 13, fontWeight: '700' }}
                >
                  Add
                </Button>
              </View>
            </View>

            <BaseSearch
              placeholder="Search messages..."
              value={searchQuery}
              onChangeText={onSearchChange}
              containerStyle={styles.searchInput}
              onClear={() => onSearchChange('')}
              rightIcon={searchQuery ? 'close' : 'magnify'}
            />

            <ScrollView style={styles.messagesScrollView}>
              {displayedMessages.length > 0 ? (
                <View style={[styles.messagesContainer, { paddingHorizontal: 16 }]}>
                  {displayedMessages.map(message => {
                    const isSelected = isMessageSelected(message.id);
                    const isActive = isSelected;
                    const isNewlyImported =
                      activeMessageId && message.id === activeMessageId;
                    const linkedElsewhere =
                      (message as any).linked_receipt_count > 0 && !isSelected;

                    return (
                      <SPressable
                        key={message.id}
                        onPress={() => onMessageToggle(message)}
                        activeOpacity={0.7}
                      >
                        <View
                          style={[
                            styles.messageCard,
                            { borderColor: colors.outline },
                            isActive && [
                              styles.selectedMessageCard,
                              {
                                borderColor: (colors as any).success || colors.primary,
                                backgroundColor: addOpacity(
                                  (colors as any).successContainer ||
                                    colors.primaryContainer,
                                  0.15,
                                ),
                              },
                            ],
                            isNewlyImported && {
                              borderColor: colors.primary,
                              borderWidth: 2,
                              backgroundColor: addOpacity(colors.primaryContainer, 0.1),
                            },
                            linkedElsewhere &&
                              !isActive && [
                                styles.linkedElsewhereCard,
                                { borderColor: colors.tertiary },
                              ],
                          ]}
                        >
                          {isNewlyImported && (
                            <View
                              style={[
                                styles.newBadge,
                                { backgroundColor: colors.primary },
                              ]}
                            >
                              <Text
                                variant="labelSmall"
                                style={{ color: colors.onPrimary, fontWeight: 'bold' }}
                              >
                                NEWLY IMPORTED
                              </Text>
                            </View>
                          )}
                          <View style={styles.messageHeader}>
                            <Text
                              variant="bodyMedium"
                              style={[
                                styles.messageText,
                                isActive && {
                                  color: (colors as any).success || colors.primary,
                                },
                              ]}
                            >
                              {message.message_content}
                            </Text>
                            {isActive && (
                              <IconButton
                                icon="check-circle"
                                size={20}
                                iconColor={(colors as any).success || colors.primary}
                                style={{ margin: 0 }}
                              />
                            )}
                          </View>
                          <View style={styles.messageFooter}>
                            <Text variant="bodySmall" style={styles.messageDate}>
                              {formatDate(message.transaction_date || '')}
                            </Text>
                            <View style={styles.statusContainer}>
                              {isActive && (
                                <Text
                                  variant="bodySmall"
                                  style={[
                                    styles.linkedText,
                                    { color: (colors as any).success || colors.primary },
                                  ]}
                                >
                                  Linked
                                </Text>
                              )}
                              {linkedElsewhere && !isActive && (
                                <Text
                                  variant="bodySmall"
                                  style={[
                                    styles.linkedElsewhereText,
                                    { color: colors.tertiary },
                                  ]}
                                >
                                  Linked Elsewhere
                                </Text>
                              )}
                            </View>
                          </View>
                        </View>
                      </SPressable>
                    );
                  })}

                  {/* Show count indicator when not searching and there are more messages */}
                  {!searchQuery.trim() && messages.length > 5 && (
                    <Text
                      variant="bodySmall"
                      style={[styles.moreIndicator, { color: colors.onSurfaceVariant }]}
                    >
                      Showing 5 of {messages.length} messages. Use search to see more.
                    </Text>
                  )}
                </View>
              ) : (
                <EmptyState
                  icon="message-outline"
                  title={
                    searchQuery
                      ? 'No messages found matching your search'
                      : 'No payment messages available'
                  }
                  description={
                    searchQuery
                      ? 'Try a different search term'
                      : 'Add payment messages in Settings to link them with receipts'
                  }
                />
              )}
            </ScrollView>
          </View>
        </BaseModal>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  linkButton: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    marginTop: 8,
    overflow: 'hidden',
  },
  linkButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    paddingLeft: 4,
  },
  linkButtonLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  linkIcon: {
    margin: 0,
  },
  modalContent: {
    flex: 1,
  },
  modalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 6,
  },
  modalActionsLeft: {
    flex: 1,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  searchInput: {
    marginBottom: 16,
  },
  messagesScrollView: {
    flex: 1,
  },
  messagesContainer: {
    paddingBottom: 16,
  },
  messageCard: {
    marginBottom: 8,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
  },
  selectedMessageCard: {
    borderWidth: 2,
  },
  linkedElsewhereCard: {
    borderWidth: 1,
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  newBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 8,
  },
  messageText: {
    flex: 1,
    marginBottom: 4,
    lineHeight: 20,
  },
  messageFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  messageDate: {
    fontSize: 12,
  },
  linkedText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  statusContainer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  linkedElsewhereText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  moreIndicator: {
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
});
