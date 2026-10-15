import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import type React from 'react';
import { useMemo, useState } from 'react';
import { LayoutAnimation, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  Chip,
  Divider,
  HelperText,
  SegmentedButtons,
  Surface,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import { useAuth } from '@/providers/AuthProvider';
import BaseModal from '@/shared/components/BaseModal';
import KeyboardScroll from '@/shared/components/KeyboardScroll';
import LoadingCard from '@/shared/components/LoadingCard';
import { useOfflineCheck } from '@/shared/hooks/useOfflineCheck';
import { useCoreMutations, useMessageTemplates } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import { supabase } from '@/shared/services/supabase';
import {
  DEFAULT_TEMPLATES,
  getDefaultTemplate,
  getSmsSegmentInfo,
  htmlToPlain,
  PLACEHOLDERS,
  replacePlaceholders,
} from '@/shared/services/templateService';
import { EMPTY_ARRAY, generateUUID } from '@/shared/utils/helper';

type Channel = 'sms' | 'email' | 'whatsapp';

const ParsedMarkdown = ({ text, channel }: { text: string; channel?: string }) => {
  const colors = useThemeColors();

  if (!text || text === '(Empty)')
    return (
      <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
        (Empty)
      </Text>
    );

  const lines = text.replace(/\r/g, '').split('\n');

  return (
    <View style={{ gap: 4 }}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        let marginLeft = 0;
        let prefix = null;
        let content = line;

        // Check for unordered lists
        if (/^[-*]\s/.test(trimmed)) {
          marginLeft = 16;
          prefix = (
            <Text style={{ fontWeight: 'bold', fontSize: 16, marginRight: 6 }}>•</Text>
          );
          content = trimmed.substring(2);
        }
        // Check for ordered lists
        else if (/^\d+\.\s/.test(trimmed)) {
          marginLeft = 16;
          const numMatch = trimmed.match(/^(\d+\.)\s/);
          if (numMatch) {
            prefix = (
              <Text style={{ fontWeight: 'bold', marginRight: 6 }}>{numMatch[1]}</Text>
            );
            content = trimmed.replace(/^\d+\.\s/, '');
          }
        }
        // Check for simple indentation
        else {
          const spaceMatch = line.match(/^(\s+)/);
          if (spaceMatch) {
            marginLeft = spaceMatch[1].length * 8;
            content = trimmed;
          }
        }

        // Inline parse
        const parseInline = (str: string) => {
          const parts: React.ReactNode[] = [];

          const isWhatsApp = channel === 'whatsapp';
          const regex = isWhatsApp
            ? // WhatsApp: *bold*, _italic_, ~strikethrough~
              /(\[.*?\]\(.*?\))|(\*.*?\*)|(_.*?_)|(~.*?~)/g
            : // Standard: **bold**, __bold__, *italic*, _italic_
              /(\[.*?\]\(.*?\))|(\*\*.*?\*\*)|(__.*?__)|(\*.*?\*)|(_.*?_)/g;

          let lastIndex = 0;
          let match = regex.exec(str);

          while (match !== null) {
            if (match.index > lastIndex) {
              parts.push(
                <Text key={`t-${lastIndex}`}>
                  {str.substring(lastIndex, match.index)}
                </Text>,
              );
            }

            const token = match[0];
            if (token.startsWith('[') && token.includes('](')) {
              const linkMatch = token.match(/\[(.*?)\]\((.*?)\)/);
              if (linkMatch) {
                parts.push(
                  <Text
                    key={`l-${match.index}`}
                    style={{ color: colors.primary, textDecorationLine: 'underline' }}
                  >
                    {linkMatch[1]}
                  </Text>,
                );
              }
            } else if (isWhatsApp) {
              if (token.startsWith('*') && token.endsWith('*')) {
                parts.push(
                  <Text key={`b-${match.index}`} style={{ fontWeight: 'bold' }}>
                    {token.substring(1, token.length - 1)}
                  </Text>,
                );
              } else if (token.startsWith('_') && token.endsWith('_')) {
                parts.push(
                  <Text key={`i-${match.index}`} style={{ fontStyle: 'italic' }}>
                    {token.substring(1, token.length - 1)}
                  </Text>,
                );
              } else if (token.startsWith('~') && token.endsWith('~')) {
                parts.push(
                  <Text
                    key={`s-${match.index}`}
                    style={{ textDecorationLine: 'line-through' }}
                  >
                    {token.substring(1, token.length - 1)}
                  </Text>,
                );
              }
            } else {
              if (
                (token.startsWith('**') && token.endsWith('**')) ||
                (token.startsWith('__') && token.endsWith('__'))
              ) {
                parts.push(
                  <Text key={`b-${match.index}`} style={{ fontWeight: 'bold' }}>
                    {token.substring(2, token.length - 2)}
                  </Text>,
                );
              } else if (
                (token.startsWith('*') && token.endsWith('*')) ||
                (token.startsWith('_') && token.endsWith('_'))
              ) {
                parts.push(
                  <Text key={`i-${match.index}`} style={{ fontStyle: 'italic' }}>
                    {token.substring(1, token.length - 1)}
                  </Text>,
                );
              }
            }

            lastIndex = regex.lastIndex;
            match = regex.exec(str);
          }

          if (lastIndex < str.length) {
            parts.push(<Text key={`t-${lastIndex}`}>{str.substring(lastIndex)}</Text>);
          }

          return parts.length > 0 ? parts : <Text>{str}</Text>;
        };

        return (
          <View
            key={`line-${index}`}
            style={{
              flexDirection: 'row',
              marginLeft,
              minHeight: trimmed === '' ? 8 : 20,
            }}
          >
            {prefix}
            <Text style={{ flex: 1, flexWrap: 'wrap' }} variant="bodyMedium">
              {parseInline(content)}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

interface TemplateEditorProps {
  template: any;
  onFormChange: (data: { title: string; content: string; is_html: boolean }) => void;
}

function TemplateEditor({ template, onFormChange }: TemplateEditorProps) {
  const colors = useThemeColors();
  const [showPreview, setShowPreview] = useState(false);

  // editContent is always plain text in the textarea
  const initContent = template.is_html
    ? htmlToPlain(template.content || '')
    : template.content || '';

  const [formData, setFormData] = useState({
    title: template.title || '',
    content: template.content || '', // raw saved value (HTML if is_html)
    is_html: template.is_html || false,
    editContent: initContent, // plain text shown in editor
  });

  const updateFormData = (updater: (prev: typeof formData) => typeof formData) => {
    setFormData(prev => {
      const next = updater(prev);
      onFormChange({ title: next.title, content: next.content, is_html: next.is_html });
      return next;
    });
  };

  const handleEditContentChange = (text: string) => {
    updateFormData(prev => ({
      ...prev,
      editContent: text,
      content: text, // ALWAYS save as raw markdown
    }));
  };

  const handleHtmlToggle = (v: boolean) => {
    updateFormData(prev => ({
      ...prev,
      is_html: v,
      // No longer converting back and forth. The raw markdown stays as content.
    }));
  };

  const togglePreview = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowPreview(!showPreview);
  };

  const { renderedPreview, renderedSubject } = useMemo(() => {
    const mockData: Record<string, string> = {};
    for (const p of PLACEHOLDERS) {
      mockData[p.key] = p.mock;
    }
    return {
      renderedPreview: replacePlaceholders(formData.editContent, mockData),
      renderedSubject: replacePlaceholders(formData.title, mockData),
    };
  }, [formData.editContent, formData.title]);

  const smsInfo = useMemo(() => {
    const textToCheck = showPreview ? renderedPreview : formData.editContent;
    return getSmsSegmentInfo(textToCheck);
  }, [showPreview, renderedPreview, formData.editContent]);

  const insertPlaceholder = (key: string) => {
    updateFormData(prev => {
      const newEdit = `${prev.editContent}{{${key}}}`;
      return {
        ...prev,
        editContent: newEdit,
        content: newEdit,
      };
    });
  };

  const defaultTpl = getDefaultTemplate(template.name, template.channel);
  const handleResetToDefault = () => {
    if (defaultTpl) {
      updateFormData(prev => ({
        ...prev,
        title: defaultTpl.title,
        content: defaultTpl.content,
        editContent: defaultTpl.content,
        is_html: defaultTpl.is_html,
      }));
    }
  };

  return (
    <View style={styles.modalContent}>
      <Surface
        style={[
          styles.modalControlSection,
          { backgroundColor: colors.surfaceVariant, borderColor: colors.outlineVariant },
        ]}
        elevation={0}
      >
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text variant="labelLarge">Enable HTML Formatting</Text>
            <Text variant="bodySmall" style={{ opacity: 0.7 }}>
              Recommended for Email only.
            </Text>
          </View>
          <Switch value={formData.is_html} onValueChange={handleHtmlToggle} />
        </View>

        <Divider style={{ marginVertical: 8 }} />

        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text variant="labelLarge">Live Mock Preview</Text>
            <Text variant="bodySmall" style={{ opacity: 0.7 }}>
              See how the placeholders look.
            </Text>
          </View>
          <Switch value={showPreview} onValueChange={togglePreview} />
        </View>
      </Surface>

      {defaultTpl && (
        <Button
          mode="text"
          icon="restore"
          compact
          onPress={handleResetToDefault}
          style={{ alignSelf: 'flex-start', marginVertical: 2 }}
        >
          Reset to Concise Recommended Template
        </Button>
      )}

      {template.channel === 'email' &&
        (showPreview ? (
          <View
            style={[
              styles.subjectPreview,
              {
                backgroundColor: colors.surfaceVariant,
                borderColor: colors.outlineVariant,
              },
            ]}
          >
            <Text variant="labelSmall" style={styles.subjectPreviewLabel}>
              SUBJECT
            </Text>
            <Text variant="bodyMedium">{renderedSubject || '(No subject)'}</Text>
          </View>
        ) : (
          <TextInput
            label="Email Subject Line"
            placeholder="e.g., Rent Payment Received"
            value={formData.title}
            onChangeText={t => updateFormData(p => ({ ...p, title: t }))}
            mode="outlined"
            style={styles.input}
          />
        ))}

      {showPreview ? (
        <View
          style={[
            styles.previewSection,
            { borderLeftColor: colors.primary, backgroundColor: colors.surfaceVariant },
          ]}
        >
          <Text variant="labelSmall" style={styles.previewLabel}>
            MOCK PREVIEW
          </Text>
          <View style={styles.previewContent}>
            <ParsedMarkdown
              text={renderedPreview || '(Empty)'}
              channel={template.channel}
            />
          </View>
        </View>
      ) : (
        <>
          <TextInput
            label={
              formData.is_html
                ? 'Message Body (Markdown - Sends as HTML)'
                : 'Message Body'
            }
            placeholder="Write your template here..."
            value={formData.editContent}
            onChangeText={handleEditContentChange}
            mode="outlined"
            multiline
            numberOfLines={8}
            style={styles.textArea}
          />
          {formData.is_html && (
            <Text variant="bodySmall" style={styles.htmlHint}>
              ✦ Your markdown text is safely formatted to HTML immediately before sending.
            </Text>
          )}
        </>
      )}

      {template.channel === 'sms' && (
        <HelperText
          type={smsInfo.segments > 1 ? 'error' : 'info'}
          style={{ fontWeight: smsInfo.segments > 1 ? '600' : 'normal' }}
        >
          {smsInfo.chars} characters • {smsInfo.segments} SMS segment
          {smsInfo.segments > 1 ? 's' : ''}
          {smsInfo.segments === 1 ? ` (${smsInfo.remaining} left in segment)` : ''}
          {smsInfo.isUnicode
            ? ' • ⚠️ Unicode/Emoji detected (70 chars/segment limit)'
            : ''}
          {showPreview ? ' [mock]' : ''}
        </HelperText>
      )}

      {!showPreview && (
        <>
          <Divider style={styles.divider} />

          <View style={styles.sectionHeader}>
            <MaterialCommunityIcons
              name="code-brackets"
              size={20}
              color={colors.primary}
            />
            <Text variant="titleSmall" style={styles.placeholderTitle}>
              Template Variables
            </Text>
          </View>

          <View style={styles.placeholderContainer}>
            {PLACEHOLDERS.filter(p => p.categories.includes(template.name)).map(p => {
              const isIncluded = formData.editContent.includes(p.key);
              return (
                <Chip
                  key={p.key}
                  icon={isIncluded ? 'check' : 'plus'}
                  selected={isIncluded}
                  onPress={() => insertPlaceholder(p.key)}
                  style={styles.chip}
                  mode="outlined"
                  showSelectedOverlay
                >
                  <Text
                    variant="labelSmall"
                    style={{
                      fontSize: 11,
                      textAlign: 'center',
                      flex: 1,
                      fontWeight: isIncluded ? '600' : 'normal',
                    }}
                  >
                    {p.label}
                  </Text>
                </Chip>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

export default function MessageTemplatesManager() {
  const colors = useThemeColors();
  const { checkOnline } = useOfflineCheck();
  const { user } = useAuth();
  const { selectedBusiness } = useBusiness();
  const { showSnackbar } = useSnackbar();
  const { insert, update } = useCoreMutations();
  const messageTemplates = useMessageTemplates(selectedBusiness?.id);

  const [channel, setChannel] = useState<Channel>('sms');
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [editorFormData, setEditorFormData] = useState<{
    title: string;
    content: string;
    is_html: boolean;
  } | null>(null);

  const filteredTemplates = useMemo(() => {
    const templatesForChannel = messageTemplates.filter(t => t.channel === channel);
    const order = Object.keys(DEFAULT_TEMPLATES.sms);
    return templatesForChannel.sort((a, b) => {
      const indexA = order.indexOf(a.name);
      const indexB = order.indexOf(b.name);
      const posA = indexA === -1 ? order.length : indexA;
      const posB = indexB === -1 ? order.length : indexB;
      return posA - posB;
    });
  }, [messageTemplates, channel]);

  const handleEdit = (template: any) => {
    setEditingTemplate(template);
    setEditorFormData({
      title: template.title || '',
      content: template.content || '',
      is_html: template.is_html || false,
    });
    setEditModalVisible(true);
  };

  const handleSave = async () => {
    if (!checkOnline('Saving template')) return;
    const formData = editorFormData;
    if (!editingTemplate || !formData) return;

    try {
      setSaving(true);
      await update('message_templates', editingTemplate.id, {
        title: formData.title,
        content: formData.content,
        is_html: formData.is_html,
        updated_at: new Date().toISOString(),
      });

      showSnackbar('Template updated successfully', 'success');
      setEditModalVisible(false);
    } catch (error) {
      console.error('Error saving template:', error);
      showSnackbar('Failed to save template', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSeedOrResetChannel = async (
    targetChannel: Channel = channel,
    showToast = true,
  ): Promise<number> => {
    if (!checkOnline('Seeding templates')) return 0;
    if (!selectedBusiness?.id) return 0;
    try {
      const defaultsForChannel = DEFAULT_TEMPLATES[targetChannel];
      if (!defaultsForChannel) return 0;

      const existingForChannel = messageTemplates.filter(
        t => t.channel === targetChannel,
      );
      const existingByName = new Map(existingForChannel.map(t => [t.name, t]));

      const userId = user?.id || selectedBusiness.user_id;
      if (!userId) {
        showSnackbar('User authentication required to seed templates', 'error');
        return 0;
      }

      let count = 0;
      const now = new Date().toISOString();
      const recordsToUpsert: any[] = [];

      for (const [tplName, defaultTpl] of Object.entries(defaultsForChannel)) {
        const existing = existingByName.get(tplName);
        const recordId = existing?.id || generateUUID();
        const recordData = {
          id: recordId,
          business_id: selectedBusiness.id,
          user_id: userId,
          name: tplName,
          channel: targetChannel,
          title: defaultTpl.title,
          content: defaultTpl.content,
          is_html: defaultTpl.is_html,
          deleted: false,
          created_at: existing?.created_at || now,
          updated_at: now,
        };

        // 1. Update local-lite SQLite store
        if (existing) {
          await update('message_templates', recordId, recordData);
        } else {
          await insert('message_templates', recordData);
        }

        recordsToUpsert.push(recordData);
        count++;
      }



      if (showToast) {
        showSnackbar(
          `Updated ${count} ${targetChannel.toUpperCase()} templates from presets`,
          'success',
        );
      }
      return count;
    } catch (error: any) {
      console.error(`Error configuring ${targetChannel} templates:`, error);
      if (showToast) {
        showSnackbar(
          `Failed to save templates: ${error?.message || 'Database error'}`,
          'error',
        );
      }
      return 0;
    }
  };

  const handleSeedAllChannels = async () => {
    if (!checkOnline('Seeding templates')) return;
    try {
      setSeeding(true);
      let total = 0;
      for (const ch of ['sms', 'whatsapp', 'email'] as Channel[]) {
        total += (await handleSeedOrResetChannel(ch, false)) || 0;
      }
      showSnackbar(
        `Seeded ${total} templates from presets across SMS, WhatsApp, and Email`,
        'success',
      );
    } finally {
      setSeeding(false);
    }
  };

  if (!selectedBusiness?.id) {
    return <LoadingCard iconName="message-draw" text="Loading templates..." />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <SegmentedButtons
          value={channel}
          onValueChange={v => setChannel(v as Channel)}
          buttons={[
            { value: 'sms', label: 'SMS', icon: 'message-text' },
            { value: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
            { value: 'email', label: 'Email', icon: 'email' },
          ]}
          style={styles.segmentedButtons}
        />
      </View>
      <KeyboardScroll
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <View style={styles.sectionHeading}>
          <View>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              {channel.toUpperCase()} Templates
            </Text>
            <Text variant="bodySmall" style={styles.subtitle}>
              Personalize how your {channel} messages look.
            </Text>
          </View>
          <MaterialCommunityIcons
            name={
              channel === 'sms'
                ? 'message-text'
                : channel === 'email'
                  ? 'email'
                  : 'whatsapp'
            }
            size={28}
            color={colors.primary}
          />
        </View>

        <Surface
          style={[
            styles.presetBanner,
            {
              backgroundColor: colors.surfaceVariant,
              borderColor: colors.outlineVariant,
            },
          ]}
          elevation={0}
        >
          <View style={styles.presetHeaderRow}>
            <Text variant="labelLarge" style={{ fontWeight: 'bold' }}>
              Recommended Presets
            </Text>
            <Button
              mode="text"
              compact
              icon="database-sync"
              loading={seeding}
              disabled={seeding}
              onPress={handleSeedAllChannels}
              style={{ marginRight: -8 }}
            >
              Seed Templates
            </Button>
          </View>
          <Text
            variant="bodySmall"
            style={{ color: colors.onSurfaceVariant, marginTop: 2 }}
          >
            Optimized layouts across SMS, WhatsApp, and Email.
          </Text>
        </Surface>

        {filteredTemplates.length === 0 ? (
          <Surface style={styles.emptyCard} elevation={1}>
            <View style={styles.emptyContent}>
              <MaterialCommunityIcons
                name="message-off"
                size={48}
                color={colors.onSurfaceVariant}
              />
              <Text variant="titleMedium" style={{ fontWeight: 'bold' }}>
                No {channel.toUpperCase()} Templates Found
              </Text>
              <Text
                variant="bodySmall"
                style={{
                  color: colors.onSurfaceVariant,
                  textAlign: 'center',
                  paddingHorizontal: 16,
                }}
              >
                Templates are not auto-seeded into the database. Seed them now using our
                clean presets.
              </Text>
              <Button
                mode="contained"
                icon="database-sync"
                loading={seeding}
                disabled={seeding}
                onPress={handleSeedAllChannels}
              >
                Seed All Templates
              </Button>
            </View>
          </Surface>
        ) : (
          filteredTemplates.map(template => (
            <Card
              key={template.id}
              style={styles.templateCard}
              onPress={() => handleEdit(template)}
              mode="elevated"
            >
              <View style={styles.cardContentRow}>
                <Surface
                  style={[
                    styles.iconSurface,
                    { backgroundColor: colors.primaryContainer },
                  ]}
                  elevation={0}
                >
                  <MaterialCommunityIcons
                    name="pencil-box-outline"
                    size={20}
                    color={colors.primary}
                  />
                </Surface>
                <View style={styles.cardTextContainer}>
                  <Text
                    variant="titleSmall"
                    style={{ fontWeight: '700', fontSize: 13 }}
                    numberOfLines={1}
                  >
                    {template.name.replace(/_/g, ' ').toUpperCase()}
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{
                      color: colors.onSurfaceVariant,
                      fontSize: 12,
                      marginTop: 1,
                    }}
                    numberOfLines={1}
                  >
                    {template.title || 'No Subject Line'}
                  </Text>
                </View>
                <View style={styles.cardRightAction}>
                  {template.is_html && (
                    <MaterialCommunityIcons
                      name="code-tags"
                      size={16}
                      color={colors.primary}
                      style={{ marginRight: 4 }}
                    />
                  )}
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={22}
                    color={colors.onSurfaceVariant}
                  />
                </View>
              </View>
            </Card>
          ))
        )}
      </KeyboardScroll>
      <BaseModal
        visible={editModalVisible}
        onDismiss={() => setEditModalVisible(false)}
        title={`Edit ${editingTemplate?.name?.replace(/_/g, ' ')}`}
        subtitle="Manage your properties"
        scrollable
        actions={[
          {
            label: 'Cancel',
            onPress: () => setEditModalVisible(false),
            mode: 'outlined',
            disabled: saving,
          },
          {
            label: 'Save Changes',
            onPress: handleSave,
            mode: 'contained',
            loading: saving,
            disabled: saving || !editorFormData,
            icon: 'content-save',
          },
        ]}
      >
        {editingTemplate && (
          <TemplateEditor
            key={editingTemplate.id}
            template={editingTemplate}
            onFormChange={setEditorFormData}
          />
        )}
      </BaseModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  segmentedButtons: {
    width: '100%',
  },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontWeight: 'bold',
  },
  subtitle: {
    opacity: 0.7,
  },
  presetBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  presetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  templateCard: {
    marginBottom: 8,
    borderRadius: 10,
  },
  cardContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  iconSurface: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  cardTextContainer: {
    flex: 1,
    marginLeft: 10,
    marginRight: 6,
  },
  cardRightAction: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyCard: {
    marginTop: 32,
    padding: 32,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyContent: {
    alignItems: 'center',
    gap: 16,
  },
  modalContent: {
    gap: 16,
  },
  modalControlSection: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleInfo: {
    flex: 1,
  },
  input: {
    marginBottom: 4,
  },
  textArea: {
    minHeight: 200,
    textAlignVertical: 'top',
  },
  previewSection: {
    minHeight: 160,
    padding: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
  },
  previewLabel: {
    opacity: 0.5,
    marginBottom: 8,
    letterSpacing: 1,
  },
  previewContent: {},
  divider: {
    marginVertical: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  placeholderTitle: {
    fontWeight: 'bold',
  },
  placeholderContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  chip: {
    width: '48.5%',
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  htmlHint: {
    opacity: 0.6,
    fontStyle: 'italic',
    marginTop: -8,
  },
  subjectPreview: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
  },
  subjectPreviewLabel: {
    opacity: 0.45,
    letterSpacing: 1,
  },
});
