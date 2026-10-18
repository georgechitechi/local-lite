import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type {
  ReminderCategoryType,
  ReminderLog,
} from '@/features/reminders/utils/reminderUtils';
import { DEFAULT_HOUSE_TYPES } from '@/features/settings/utils/settingsHelper';
import type { SimCardInfo } from '@/shared/services/deviceSmsGateway';

export function useReminderState(settingsOrStore?: any) {
  const [sending, setSending] = useState(false);
  const [loading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [contractStatusFilter, setContractStatusFilter] = useState<string | null>(
    'active',
  );
  const [dataCleanupStatusFilter, setDataCleanupStatusFilter] = useState<string | null>(
    'missing',
  );
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [selectedHouseTypeId, setSelectedHouseTypeId] = useState<string | null>(null);

  const houseTypes = useMemo(() => {
    let types: any[] = [];
    const settingsList: any[] = Array.isArray(settingsOrStore)
      ? settingsOrStore
      : Object.values(settingsOrStore?.settings$?.get?.() || {});

    const setting = settingsList.find((s: any) => s.setting_key === 'house_types');
    if (setting?.setting_value) {
      const val =
        typeof setting.setting_value === 'string'
          ? JSON.parse(setting.setting_value)
          : setting.setting_value;
      if (Array.isArray(val)) {
        types = val
          .filter((type: any) => type.active)
          .map((type: any) => ({
            id: type.id,
            label: type.label,
            value: type.value,
            amenities: type.amenities,
            active: type.active,
          }));
      }
    }
    return types.length > 0 ? types : DEFAULT_HOUSE_TYPES;
  }, [settingsOrStore]);

  const [bulkAnnouncementMessage, _setBulkAnnouncementMessage] = useState('');
  const bulkAnnouncementMessageRef = useRef('');
  const setBulkAnnouncementMessage = useCallback((text: string) => {
    bulkAnnouncementMessageRef.current = text;
    _setBulkAnnouncementMessage(text);
  }, []);

  const [showAnnouncementEditor, setShowAnnouncementEditor] = useState(false);
  const [scheduleSendDate, setScheduleSendDate] = useState<Date | null>(null);
  const [scheduleSendTime, setScheduleSendTime] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);
  const [historyTenant, setHistoryTenant] = useState<{
    id: string;
    name?: string | null;
  } | null>(null);
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [resultModalData, setResultModalData] = useState<{
    title: string;
    message: string;
  }>({
    title: '',
    message: '',
  });

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [selectedReminder, setSelectedReminder] = useState<ReminderLog | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [bulkEmailDialogVisible, setBulkEmailDialogVisible] = useState(false);
  const [bulkEmailLoading, setBulkEmailLoading] = useState(false);
  const [bulkSMSDialogVisible, setBulkSMSDialogVisible] = useState(false);
  const [bulkSMSLoading, setBulkSMSLoading] = useState(false);
  const [selectedTenants, setSelectedTenants] = useState<Set<string>>(new Set());
  const [smsGateway, setSmsGateway] = useState<'device' | 'cloud'>(
    Platform.OS === 'android' ? 'device' : 'cloud',
  );
  const [selectedSimId, setSelectedSimId] = useState<number | null>(null);
  const [availableSimCards, setAvailableSimCards] = useState<SimCardInfo[]>([]);

  const [selectedCategory, setSelectedCategory] = useState<ReminderCategoryType | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  return {
    sending,
    setSending,
    loading,
    searchQuery,
    setSearchQuery,
    showSearch,
    setShowSearch,
    showFilters,
    setShowFilters,
    contractStatusFilter,
    setContractStatusFilter,
    dataCleanupStatusFilter,
    setDataCleanupStatusFilter,
    selectedPropertyId,
    setSelectedPropertyId,
    selectedHouseTypeId,
    setSelectedHouseTypeId,
    houseTypes,
    bulkAnnouncementMessage,
    setBulkAnnouncementMessage,
    bulkAnnouncementMessageRef,
    showAnnouncementEditor,
    setShowAnnouncementEditor,
    scheduleSendDate,
    setScheduleSendDate,
    scheduleSendTime,
    setScheduleSendTime,
    bulkProgress,
    setBulkProgress,
    historyTenant,
    setHistoryTenant,
    resultModalVisible,
    setResultModalVisible,
    resultModalData,
    setResultModalData,
    expandedSections,
    setExpandedSections,
    menuVisible,
    setMenuVisible,
    deleteDialogVisible,
    setDeleteDialogVisible,
    selectedReminder,
    setSelectedReminder,
    deleteLoading,
    setDeleteLoading,
    bulkEmailDialogVisible,
    setBulkEmailDialogVisible,
    bulkEmailLoading,
    setBulkEmailLoading,
    bulkSMSDialogVisible,
    setBulkSMSDialogVisible,
    bulkSMSLoading,
    setBulkSMSLoading,
    selectedTenants,
    setSelectedTenants,
    selectedCategory,
    setSelectedCategory,
    selectedDate,
    setSelectedDate,
    showDatePicker,
    setShowDatePicker,
    smsGateway,
    setSmsGateway,
    selectedSimId,
    setSelectedSimId,
    availableSimCards,
    setAvailableSimCards,
  };
}
