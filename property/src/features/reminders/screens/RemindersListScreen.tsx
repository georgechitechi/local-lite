import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef } from 'react';
import { RefreshControl, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import {
  Button,
  Chip,
  IconButton,
  Portal,
  SegmentedButtons,
  Surface,
  Text,
  TextInput,
} from 'react-native-paper';
import ReminderCard from '@/features/reminders/components/ReminderCard';
import ReminderHistoryModal from '@/features/reminders/components/ReminderHistoryModal';
import BaseModal, { MODAL_HORIZONTAL_PADDING } from '@/shared/components/BaseModal';
import BulkProgressOverlay from '@/shared/components/BulkProgressOverlay';
import BulkSelectionModal from '@/shared/components/BulkSelectionModal';
import DatePicker from '@/shared/components/DatePicker';
import EmptyState from '@/shared/components/EmptyState';
import FilterButtons from '@/shared/components/FilterButtons';
import LoadingCard from '@/shared/components/LoadingCard';
import SectionGroup from '@/shared/components/SectionGroup';
import Select from '@/shared/components/Select';
import SPressable from '@/shared/components/SlightPressable';
import { useReminders } from '@/shared/hooks/useReminders';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import {
  getAvailableSimCards,
  isDeviceSmsSupported,
  setActiveSimFilter,
} from '@/shared/services/deviceSmsGateway';
import { snakeCaseToTitleCase } from '@/shared/utils/helper';

const AnnouncementInput = React.memo(function AnnouncementInput({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (text: string) => void;
}) {
  const localRef = useRef(value);
  const [localValue, setLocalValue] = React.useState(value);

  // Sync from parent only when parent resets (e.g. after send)
  React.useEffect(() => {
    if (value !== localRef.current) {
      localRef.current = value;
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = useCallback(
    (text: string) => {
      localRef.current = text;
      setLocalValue(text);
      onChangeText(text);
    },
    [onChangeText],
  );

  return (
    <TextInput
      mode="outlined"
      multiline
      numberOfLines={6}
      style={{ minHeight: 100 }}
      placeholder="Write the announcement message..."
      value={localValue}
      onChangeText={handleChange}
    />
  );
});

export default function RemindersScreen() {
  const colors = useThemeColors();
  const r = useReminders();
  const { setSelectedCategory } = r;
  const params = useLocalSearchParams<{ payment?: string; category?: string }>();

  useEffect(() => {
    if (params.payment === 'true') {
      setSelectedCategory('payment');
    } else if (params.category) {
      setSelectedCategory(params.category as any);
    }
  }, [params.payment, params.category, setSelectedCategory]);

  if (r.loading) {
    return <LoadingCard iconName="bell-outline" text="Loading reminders..." />;
  }

  return (
    <React.Fragment>
      {/* ── Category List ─────────────────────────────────── */}
      <ScrollView
        style={[styles.container, { backgroundColor: r.colors.background }]}
        refreshControl={
          <RefreshControl refreshing={r.refreshing} onRefresh={r.fetchData} />
        }
      >
        <View style={styles.content}>
          <View style={styles.reportsList}>
            {r.reminderCategories.map(category => (
              <Surface key={category.id} style={styles.reportCard} elevation={1}>
                <SPressable
                  style={styles.reportContent}
                  onPress={() => r.setSelectedCategory(category.id)}
                >
                  <View style={[styles.reportIcon, { backgroundColor: category.color }]}>
                    <MaterialCommunityIcons
                      name={category.icon as any}
                      size={24}
                      color={r.colors.onPrimary}
                    />
                  </View>
                  <View style={styles.reportInfo}>
                    <Text variant="titleMedium">{category.title}</Text>
                    <Text variant="bodySmall" style={styles.reportDescription}>
                      {category.description}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={24}
                    color={r.colors.onSurfaceVariant}
                  />
                </SPressable>
              </Surface>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Category Detail Modal */}
      <BaseModal
        visible={!!r.selectedCategory}
        onDismiss={r.dismissCategoryModal}
        title={
          r.reminderCategories.find(c => c.id === r.selectedCategory)?.title ||
          'Reminders'
        }
        subtitle="Manage communications"
        edgeToEdge
        search={
          r.showSearch && r.selectedCategory !== 'announcement'
            ? {
                placeholder: 'Search reminders...',
                value: r.searchQuery,
                onChangeText: r.setSearchQuery,
                onClear: () => r.setSearchQuery(''),
              }
            : null
        }
        actions={[
          ...(r.selectedCategory
            ? [
                {
                  label: 'Bulk Email',
                  onPress: r.handleBulkEmailReminders,
                  mode: 'contained',
                  disabled:
                    r.getPendingTenants.length === 0 ||
                    (r.selectedCategory === 'announcement' &&
                      !r.bulkAnnouncementMessage.trim()),
                  icon: 'email-multiple',
                } as any,
                {
                  label: 'Bulk SMS',
                  onPress: r.handleBulkSMSReminders,
                  mode: 'contained',
                  disabled:
                    r.getPendingTenants.length === 0 ||
                    (r.selectedCategory === 'announcement' &&
                      !r.bulkAnnouncementMessage.trim()),
                  icon: 'message-text-outline',
                  style: { marginLeft: 8 },
                } as any,
              ]
            : []),
        ]}
        scrollable={false}
        maxHeight="90%"
        headerRight={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {r.selectedCategory === 'announcement' && (
              <>
                <IconButton
                  icon="pencil"
                  size={24}
                  onPress={() => r.setShowAnnouncementEditor(!r.showAnnouncementEditor)}
                  iconColor={
                    r.showAnnouncementEditor
                      ? r.colors.primary
                      : r.colors.onSurfaceVariant
                  }
                />
                <IconButton
                  icon="filter-variant"
                  size={24}
                  onPress={() => r.setShowFilters(!r.showFilters)}
                  iconColor={r.showFilters ? r.colors.primary : r.colors.onSurfaceVariant}
                />
              </>
            )}
            {r.selectedCategory !== 'announcement' && (
              <IconButton
                icon={r.showSearch ? 'magnify-minus' : 'magnify'}
                size={24}
                onPress={() => {
                  if (r.showSearch) r.setSearchQuery('');
                  r.setShowSearch(!r.showSearch);
                }}
                iconColor={r.showSearch ? r.colors.primary : r.colors.onSurfaceVariant}
              />
            )}
          </View>
        }
      >
        {/* Tenant Section List */}
        <SectionList
          sections={r.groupedReminders}
          extraData={r.expandedSections}
          keyExtractor={item => item.id}
          ListHeaderComponent={(() => {
            const showAnnouncementControls = r.selectedCategory === 'announcement';
            const showPaymentDatePicker = r.selectedCategory === 'payment';

            const showHolidayFilters = r.selectedCategory === 'mark_holiday';
            const showDataCleanupFilters = r.selectedCategory === 'data_cleanup';

            if (
              !showAnnouncementControls &&
              !showPaymentDatePicker &&
              !showHolidayFilters &&
              !showDataCleanupFilters
            ) {
              return null;
            }

            return (
              <View>
                {showHolidayFilters && (
                  <View style={[styles.listHeaderInset, { marginBottom: 16 }]}>
                    <FilterButtons
                      options={[
                        { label: 'Active', value: 'active' },
                        { label: 'Expiring Soon', value: 'expiring_soon' },
                        { label: 'Paused', value: 'paused' },
                        { label: 'All Status', value: 'all' },
                      ]}
                      selectedValue={r.contractStatusFilter}
                      onValueChange={r.setContractStatusFilter}
                    />
                  </View>
                )}
                {showDataCleanupFilters && (
                  <FilterButtons
                    options={[
                      { label: 'Missing Info', value: 'missing' },
                      { label: 'All Active', value: 'all' },
                    ]}
                    selectedValue={r.dataCleanupStatusFilter}
                    onValueChange={r.setDataCleanupStatusFilter}
                  />
                )}
                {showAnnouncementControls && (
                  <View style={styles.listHeaderInset}>
                    {r.showFilters && (
                      <View style={styles.filterRow}>
                        <View style={{ flex: 1 }}>
                          <Select
                            value={r.selectedPropertyId || ''}
                            onValueChange={val =>
                              r.setSelectedPropertyId(val === 'all' ? null : String(val))
                            }
                            options={[
                              { label: 'All Properties', value: 'all' },
                              ...r.properties.map(p => ({
                                label: p.name || 'Unknown',
                                value: p.id,
                              })),
                            ]}
                            placeholder="Property"
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Select
                            value={r.selectedHouseTypeId || ''}
                            onValueChange={val =>
                              r.setSelectedHouseTypeId(val === 'all' ? null : String(val))
                            }
                            options={[
                              { label: 'All Types', value: 'all' },
                              ...r.houseTypes.map((t: any) => ({
                                label: t.label,
                                value: t.value,
                              })),
                            ]}
                            placeholder="House Type"
                          />
                        </View>
                      </View>
                    )}
                    {r.showAnnouncementEditor && (
                      <View style={{ marginBottom: 16 }}>
                        <Text variant="titleSmall" style={{ marginBottom: 6 }}>
                          Announcement Message
                        </Text>
                        <AnnouncementInput
                          value={r.bulkAnnouncementMessage}
                          onChangeText={r.setBulkAnnouncementMessage}
                        />
                      </View>
                    )}
                  </View>
                )}

                {showPaymentDatePicker && (
                  <View
                    style={[
                      styles.datePickerHeader,
                      { backgroundColor: r.colors.surfaceVariant },
                    ]}
                  >
                    <IconButton
                      icon="chevron-left"
                      onPress={r.handlePrevMonth}
                      size={24}
                    />
                    <SPressable
                      onPress={() => r.setShowDatePicker(true)}
                      style={styles.dateDisplay}
                    >
                      <MaterialCommunityIcons
                        name="calendar-month"
                        size={20}
                        color={r.colors.primary}
                      />
                      <Text
                        variant="titleMedium"
                        style={{ color: r.colors.primary, fontWeight: 'bold' }}
                      >
                        {r.selectedDate.toLocaleDateString(undefined, {
                          month: 'long',
                          year: 'numeric',
                        })}
                      </Text>
                    </SPressable>
                    <IconButton
                      icon="chevron-right"
                      onPress={r.handleNextMonth}
                      size={24}
                    />
                  </View>
                )}
              </View>
            );
          })()}
          renderItem={({ item, index }) => (
            <ReminderCard
              item={item}
              index={index}
              selectedCategory={r.selectedCategory}
              defaultCurrency={r.defaultCurrency}
              reminderLogs={r.reminderLogs}
              selectedDate={r.selectedDate}
              menuVisible={r.menuVisible}
              onMenuToggle={r.setMenuVisible}
              onSendSMS={r.handleSendMessage}
              onSendWhatsApp={r.handleSendWhatsApp}
              onSendEmail={r.handleSendEmail}
              onSendInfoRequest={r.handleSendInfoRequest}
              onDelete={log => {
                r.setSelectedReminder(log);
                r.setDeleteDialogVisible(true);
              }}
              onShowHistory={r.setHistoryTenant}
              hasAdminAccess={r.isAdmin}
            />
          )}
          renderSectionHeader={({ section: { title, key, count } }: { section: any }) => (
            <SectionGroup
              title={title}
              subtitle={`Total: ${count} ${snakeCaseToTitleCase(key)}`}
              isExpanded={r.expandedSections.has(key)}
              onToggle={() => r.toggleSection(key)}
            />
          )}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={true}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState icon="bell-off-outline" title="No tenants found" />
          }
        />
      </BaseModal>

      <Portal>
        <BaseModal
          mode="confirm"
          visible={r.deleteDialogVisible}
          onDismiss={() => r.setDeleteDialogVisible(false)}
          onConfirm={r.handleDeleteReminder}
          title="Delete Reminder Log"
          message="Are you sure you want to delete this reminder log?"
          confirmText="Delete"
          cancelText="Cancel"
          loading={r.deleteLoading}
          destructive={true}
        />

        {/* Results Modal */}
        <BaseModal
          mode="info"
          visible={r.resultModalVisible}
          onDismiss={() => r.setResultModalVisible(false)}
          title={r.resultModalData.title}
          subtitle="Manage your properties"
          message={r.resultModalData.message}
        />

        {/* Bulk Email Selection */}
        <BulkSelectionModal
          visible={r.bulkEmailDialogVisible}
          onDismiss={() => r.setBulkEmailDialogVisible(false)}
          title="Send Bulk Emails"
          subtitle={
            r.selectedCategory === 'announcement'
              ? 'Select tenants to send an announcement to.'
              : 'Select tenants specifically to send email reminders to.'
          }
          tenants={r.getPendingTenants}
          selectedTenants={r.selectedTenants}
          onToggleTenant={r.handleTenantSelection}
          onSetSelected={r.setSelectedTenants}
          onConfirm={r.confirmBulkEmailReminders}
          loading={r.bulkEmailLoading}
          contactField="email"
          headerComponent={
            <View style={{ marginBottom: 0 }}>
              <DatePicker
                label="Schedule Send (Optional)"
                mode="datetime"
                value={r.scheduleSendDate ? r.scheduleSendDate.toISOString() : null}
                onChange={date => {
                  if (!date) {
                    r.setScheduleSendDate(null);
                    r.setScheduleSendTime(null);
                  } else {
                    const newDate = new Date(date);
                    r.setScheduleSendDate(newDate);
                    r.setScheduleSendTime(null);
                  }
                }}
                placeholder="Send Immediately"
              />
            </View>
          }
        />

        {/* Bulk SMS Selection */}
        <BulkSelectionModal
          visible={r.bulkSMSDialogVisible}
          onDismiss={() => r.setBulkSMSDialogVisible(false)}
          title="Send Bulk SMS"
          subtitle={
            r.selectedCategory === 'announcement'
              ? 'Select tenants to send an SMS announcement to.'
              : 'Select tenants specifically to send SMS reminders to.'
          }
          tenants={r.getPendingTenants}
          selectedTenants={r.selectedTenants}
          onToggleTenant={r.handleTenantSelection}
          onSetSelected={r.setSelectedTenants}
          onConfirm={r.confirmBulkSMSReminders}
          loading={r.bulkSMSLoading}
          contactField="phone"
          headerComponent={
            <View style={{ marginBottom: 12, gap: 10 }}>
              {isDeviceSmsSupported() && (
                <View>
                  <Text
                    variant="labelMedium"
                    style={{ marginBottom: 6, fontWeight: '600' }}
                  >
                    SMS Gateway
                  </Text>
                  <SegmentedButtons
                    value={r.smsGateway}
                    onValueChange={val => r.setSmsGateway(val as 'device' | 'cloud')}
                    buttons={[
                      {
                        value: 'device',
                        label: 'Device SIM',
                        icon: 'cellphone-wireless',
                      },
                      {
                        value: 'cloud',
                        label: 'Cloud Queue',
                        icon: 'cloud-upload-outline',
                      },
                    ]}
                    density="small"
                  />
                </View>
              )}

              {r.smsGateway === 'device' ? (
                <View
                  style={{
                    backgroundColor: colors.surfaceVariant,
                    padding: 10,
                    borderRadius: 8,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialCommunityIcons name="sim" size={18} color={colors.primary} />
                    <Text variant="labelMedium" style={{ fontWeight: '600' }}>
                      Carrier SIM Dispatch
                    </Text>
                  </View>
                  {r.availableSimCards.length > 1 ? (
                    <>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {r.availableSimCards.map((sim, idx) => {
                          const slotNum =
                            sim.slotIndex !== undefined && sim.slotIndex !== null
                              ? sim.slotIndex + 1
                              : idx + 1;
                          const carrier = sim.carrierName || sim.displayName || '';
                          const label =
                            carrier && !carrier.toLowerCase().startsWith('sim')
                              ? `SIM ${slotNum} • ${carrier}`
                              : carrier || `SIM ${slotNum}`;

                          return (
                            <Chip
                              key={sim.id}
                              selected={r.selectedSimId === sim.id}
                              onPress={() =>
                                r.setSelectedSimId(
                                  r.selectedSimId === sim.id ? null : sim.id,
                                )
                              }
                              compact
                              icon="sim"
                              style={{ flex: 1 }}
                              textStyle={{ fontSize: 12 }}
                            >
                              {label}
                            </Chip>
                          );
                        })}
                      </View>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 4,
                        }}
                      >
                        <Text
                          variant="labelSmall"
                          style={{ color: colors.onSurfaceVariant }}
                        >
                          {r.selectedSimId === null
                            ? 'Using system default SIM.'
                            : 'Selected SIM.'}
                        </Text>
                        {r.selectedSimId !== null && (
                          <Button
                            compact
                            mode="text"
                            labelStyle={{ fontSize: 11, marginHorizontal: 0 }}
                            onPress={async () => {
                              await setActiveSimFilter(r.selectedSimId);
                              const sims = await getAvailableSimCards();
                              r.setAvailableSimCards(
                                sims.filter(s => s.id === r.selectedSimId),
                              );
                            }}
                          >
                            Only this SIM is active
                          </Button>
                        )}
                      </View>
                    </>
                  ) : (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 4,
                      }}
                    >
                      <Text
                        variant="bodySmall"
                        style={{ color: colors.onSurfaceVariant, flex: 1 }}
                      >
                        Sending via{' '}
                        {r.availableSimCards[0]
                          ? r.availableSimCards[0].slotIndex !== undefined &&
                            r.availableSimCards[0].slotIndex !== null
                            ? `SIM ${r.availableSimCards[0].slotIndex + 1} (${r.availableSimCards[0].carrierName || r.availableSimCards[0].displayName || 'Active'})`
                            : r.availableSimCards[0].carrierName ||
                              r.availableSimCards[0].displayName ||
                              'active phone SIM'
                          : 'active phone SIM'}
                        .
                      </Text>
                      <Button
                        compact
                        mode="text"
                        labelStyle={{ fontSize: 11, marginHorizontal: 0 }}
                        onPress={async () => {
                          const activeSims = await getAvailableSimCards(false);
                          if (activeSims.length <= 1) {
                            const activeName = activeSims[0]
                              ? activeSims[0].slotIndex !== undefined &&
                                activeSims[0].slotIndex !== null
                                ? `SIM ${activeSims[0].slotIndex + 1} (${activeSims[0].carrierName || activeSims[0].displayName || 'Active'})`
                                : activeSims[0].carrierName ||
                                  activeSims[0].displayName ||
                                  'SIM 1'
                              : 'SIM 1';
                            r.showSnackbar(
                              `Only ${activeName} is currently active on this device.`,
                              'info',
                            );
                            return;
                          }
                          await setActiveSimFilter(null);
                          r.setAvailableSimCards(activeSims);
                        }}
                      >
                        Show all slots
                      </Button>
                    </View>
                  )}
                  <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                    Dispatches directly from your phone&apos;s cellular plan.
                  </Text>
                </View>
              ) : (
                <View style={{ marginBottom: 0 }}>
                  <DatePicker
                    label="Schedule Send (Optional)"
                    mode="datetime"
                    value={r.scheduleSendDate ? r.scheduleSendDate.toISOString() : null}
                    onChange={date => {
                      if (!date) {
                        r.setScheduleSendDate(null);
                        r.setScheduleSendTime(null);
                      } else {
                        const newDate = new Date(date);
                        r.setScheduleSendDate(newDate);
                        r.setScheduleSendTime(null);
                      }
                    }}
                    placeholder="Send Immediately"
                  />
                  <Text
                    variant="labelSmall"
                    style={{ color: colors.onSurfaceVariant, marginTop: 4 }}
                  >
                    Queued in cloud and sent via SMS Gateway / messaging relay.
                  </Text>
                </View>
              )}
            </View>
          }
        />

        {/* Reminder History */}
        <ReminderHistoryModal
          tenant={r.historyTenant}
          onDismiss={() => r.setHistoryTenant(null)}
          reminderLogs={r.reminderLogs}
          selectedCategory={r.selectedCategory}
          selectedDate={r.selectedDate}
        />

        {/* Bulk Send Progress */}
        <BulkProgressOverlay progress={r.bulkProgress} isEmail={r.bulkEmailLoading} />
      </Portal>
    </React.Fragment>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  reportsList: {
    gap: 12,
  },
  reportCard: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
  },
  reportContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  reportIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  reportInfo: {
    flex: 1,
  },
  reportDescription: {
    marginTop: 2,
    opacity: 0.7,
  },
  listContent: {
    padding: 0,
    paddingBottom: 80,
  },
  listHeaderInset: {
    paddingHorizontal: MODAL_HORIZONTAL_PADDING,
  },
  filterRow: {
    paddingVertical: 8,
    flexDirection: 'row',
    gap: 12,
  },
  datePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingVertical: 2,
    marginBottom: 6,
  },
  dateDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
});
