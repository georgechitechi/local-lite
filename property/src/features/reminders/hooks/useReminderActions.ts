import { Linking, Platform, Share } from 'react-native';
import {
  generateInfoRequestUrl,
  getEmailForCategory,
  getMessageForCategory,
  type Tenant,
} from '@/features/reminders/utils/reminderUtils';
import { useCoreMutations } from '@/shared/hooks/useStore';
import {
  getActiveSimFilter,
  getAvailableSimCards,
  isDeviceSmsSupported,
  openDeviceSmsComposer,
  sendBulkDeviceSms,
  sendSingleDeviceSms,
} from '@/shared/services/deviceSmsGateway';
import { supabase } from '@/shared/services/supabase';
import { generateUUID } from '@/shared/utils/helper';

export function useReminderActions(
  user: any,
  business: any,
  defaultCurrency: any,
  showSnackbar: any,
  checkOnline: any,
  requireCloudSync: any,
  isAdmin: boolean,
  state: any,
  data: any,
) {
  const { insert, insertMany, delete: deleteRecord } = useCoreMutations();

  const logReminder = async (
    tenant: Tenant,
    channel: string,
    message: string,
    customReminderType: string | null = null,
    status: string = 'sent',
  ) => {
    try {
      if (!user) {
        console.error('Error getting user: User not authenticated');
        return;
      }

      const reminderType = customReminderType || state.selectedCategory;
      const metadata: Record<string, any> = {};

      if (reminderType === 'payment') {
        metadata.target_date = state.selectedDate.toISOString();
        metadata.amount_pending = tenant.pendingRentAmount;
      }

      const id = generateUUID();
      const now = new Date().toISOString();

      const record = {
        id,
        tenant_id: tenant.id,
        business_id: business?.id || '',
        user_id: user.id || null,
        reminder_type: reminderType || 'general',
        channel: channel,
        message: message,
        status: status,
        sent_at: now,
        contract_id: tenant.contracts?.[0]?.id || null,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
      };

      if (insert) {
        await insert('reminder_logs', record as any);
      }
    } catch (error) {
      console.error('Error logging reminder:', error);
    }
  };

  const logRemindersBulk = async (
    successfulTenants: { tenant: any; message: string }[],
    channel: 'sms' | 'email',
    delaySeconds: number,
  ) => {
    try {
      if (!user) return;

      const now = new Date().toISOString();
      const records = successfulTenants.map(({ tenant, message }) => {
        const id = generateUUID();
        const reminderType = state.selectedCategory;
        const metadata: Record<string, any> = {};

        if (reminderType === 'payment') {
          metadata.target_date = state.selectedDate.toISOString();
          metadata.amount_pending = tenant.pendingRentAmount;
        }

        return {
          id,
          tenant_id: tenant.id,
          business_id: business?.id || '',
          user_id: user.id,
          reminder_type: reminderType || 'general',
          channel,
          message,
          status: delaySeconds > 0 ? 'scheduled' : 'sent',
          sent_at: now,
          contract_id: tenant.contracts?.[0]?.id || null,
          metadata: Object.keys(metadata).length > 0 ? metadata : null,
        };
      });

      if (insertMany && records.length > 0) {
        await insertMany('reminder_logs', records);
      }
    } catch (error) {
      console.error(`Error in bulk log ${channel} reminders:`, error);
    }
  };

  const handleSendMessage = async (tenant: Tenant) => {
    if (!state.selectedCategory) return;
    if (!tenant.phone) {
      showSnackbar('Tenant has no phone number', 'error');
      return;
    }

    state.setSending(true);
    try {
      const message = await getMessageForCategory(
        state.selectedCategory,
        tenant,
        business,
        defaultCurrency,
        'sms',
        {
          target_date: state.selectedDate,
          ...(state.selectedCategory === 'announcement'
            ? { announcement_body: state.bulkAnnouncementMessageRef.current }
            : {}),
        },
      );
      const phoneNumber = tenant.phone;

      // On Android, attempt direct programmatic dispatch via device SIM first
      if (isDeviceSmsSupported()) {
        const directResult = await sendSingleDeviceSms({
          to: phoneNumber,
          message,
          simCardId: state.selectedSimId,
        });

        if (directResult.success) {
          await logReminder(tenant, 'sms', message);
          showSnackbar(`SMS sent to ${tenant.name || phoneNumber}`, 'success');
          return;
        }

        if (directResult.error) {
          showSnackbar(`SMS failed: ${directResult.error}`, 'error');
        }
      }

      // Fallback: Open device default messaging app via native composer
      await openDeviceSmsComposer(phoneNumber, message);
      await logReminder(tenant, 'sms', message);
    } catch (error) {
      console.error('Error sending message:', error);
      showSnackbar('Failed to send SMS', 'error');
    } finally {
      state.setSending(false);
    }
  };

  const handleSendWhatsApp = async (tenant: Tenant) => {
    if (!state.selectedCategory) return;
    if (!tenant.phone) {
      showSnackbar('Tenant has no phone number', 'error');
      return;
    }

    try {
      const message = await getMessageForCategory(
        state.selectedCategory,
        tenant,
        business,
        defaultCurrency,
        'whatsapp',
        {
          target_date: state.selectedDate,
          ...(state.selectedCategory === 'announcement'
            ? { announcement_body: state.bulkAnnouncementMessageRef.current }
            : {}),
        },
      );
      const phoneNumber = tenant.phone?.replace(/\D/g, '');
      const encodedMessage = encodeURIComponent(message);

      const url = `https://wa.me/${phoneNumber}?text=${encodedMessage}`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) throw new Error('Cannot open WhatsApp');

      await Linking.openURL(url);
      await logReminder(tenant, 'whatsapp', message);
    } catch (error) {
      console.error('Error sending WhatsApp:', error);
      showSnackbar('Failed to send WhatsApp message', 'error');
    }
  };

  const handleSendEmail = async (tenant: Tenant) => {
    if (!state.selectedCategory) return;
    if (!tenant.email) {
      showSnackbar('Tenant has no email address', 'error');
      return;
    }

    try {
      const { subject, body } = await getEmailForCategory(
        state.selectedCategory,
        tenant,
        business,
        defaultCurrency,
        {
          target_date: state.selectedDate,
          ...(state.selectedCategory === 'announcement'
            ? { announcement_body: state.bulkAnnouncementMessageRef.current }
            : {}),
        },
      );

      const encodedSubject = encodeURIComponent(subject);
      const encodedBody = encodeURIComponent(body);

      const url = `mailto:${tenant.email}?subject=${encodedSubject}&body=${encodedBody}`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) throw new Error('Cannot open email app');

      await Linking.openURL(url);
      await logReminder(tenant, 'email', body);
    } catch (error) {
      console.error('Error sending email:', error);
      showSnackbar('Failed to send email', 'error');
    }
  };

  const handleSendInfoRequest = async (item: Tenant | any) => {
    const tenant = (item as any).tenant || (item as Tenant);

    state.setSending(true);
    try {
      const infoUrl = await generateInfoRequestUrl(tenant.id);
      if (!infoUrl) throw new Error('Failed to generate request link');

      const message = await getMessageForCategory(
        'request_info',
        tenant,
        business,
        null,
        'whatsapp',
        { info_request_url: infoUrl, target_date: state.selectedDate },
      );

      await Share.share({
        message,
        url: infoUrl,
        title: 'Request Information',
      });

      await logReminder(tenant, 'share', message);
    } catch (error: any) {
      console.error('Error generating/sharing info request:', error);
      showSnackbar(
        error.message || 'Failed to generate information request link',
        'error',
      );
    } finally {
      state.setSending(false);
    }
  };

  const handleSendWhatsAppGroupInvite = async (tenant: Tenant) => {
    if (!tenant.phone) {
      showSnackbar('Tenant has no phone number', 'error');
      return;
    }

    try {
      const message = await getMessageForCategory(
        'whatsapp_invite',
        tenant,
        business,
        defaultCurrency,
        'whatsapp',
        { target_date: state.selectedDate },
      );
      const phoneNumber = tenant.phone?.replace(/\D/g, '');
      const encodedMessage = encodeURIComponent(message);

      const url = `https://wa.me/${phoneNumber}?text=${encodedMessage}`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) throw new Error('Cannot open WhatsApp');

      await Linking.openURL(url);
      await logReminder(tenant, 'whatsapp_group', message, 'whatsapp_invite');
    } catch (error) {
      console.error('Error sending WhatsApp group invite:', error);
      showSnackbar('Failed to send WhatsApp group invitation', 'error');
    }
  };

  const toggleSection = (sectionKey: string) => {
    state.setExpandedSections((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  };

  const handleDeleteReminder = async () => {
    if (!isAdmin) {
      showSnackbar('You do not have permission to delete reminders', 'error');
      return;
    }
    if (!state.selectedReminder) return;

    try {
      state.setDeleteLoading(true);
      if (deleteRecord) {
        await deleteRecord('reminder_logs', state.selectedReminder.id);
      }
      state.setDeleteDialogVisible(false);
      state.setSelectedReminder(null);
    } catch (error) {
      console.error('Error deleting reminder:', error);
      showSnackbar('Failed to delete reminder', 'error');
    } finally {
      state.setDeleteLoading(false);
    }
  };

  const handleTenantSelection = (tenantId: string) => {
    state.setSelectedTenants((prev: Set<string>) => {
      const newSet = new Set(prev);
      if (newSet.has(tenantId)) {
        newSet.delete(tenantId);
      } else {
        newSet.add(tenantId);
      }
      return newSet;
    });
  };

  const handleBulkEmailReminders = async () => {
    if (!checkOnline('Bulk Email')) return;
    if (!requireCloudSync('Bulk Email')) return;
    if (!isAdmin) {
      showSnackbar('You do not have permission to send bulk reminders', 'error');
      return;
    }
    if (data.getPendingTenants.length === 0) {
      showSnackbar('No tenants found for this category.', 'info');
      return;
    }
    state.setBulkEmailDialogVisible(true);
  };

  const confirmBulkEmailReminders = async () => {
    if (!checkOnline('Bulk Email')) return;
    if (!requireCloudSync('Bulk Email')) return;
    try {
      const selectedTenantIds = Array.from(state.selectedTenants);
      const selectedTenantObjects = data.getPendingTenants.filter((tenant: any) =>
        selectedTenantIds.includes(tenant.id),
      );
      const tenantsWithEmail = selectedTenantObjects.filter(
        (tenant: any) => tenant.email && !tenant.email.startsWith('placeholder'),
      );

      if (selectedTenantObjects.length === 0) {
        showSnackbar(
          'Please select at least one tenant to send reminders to.',
          'warning',
        );
        return;
      }
      if (tenantsWithEmail.length === 0) {
        showSnackbar(
          'None of the selected tenants have valid email addresses.',
          'warning',
        );
        return;
      }

      state.setBulkEmailLoading(true);
      state.setBulkEmailDialogVisible(false);
      state.setBulkProgress({
        current: 0,
        total: tenantsWithEmail.length,
        label: 'Preparing…',
      });

      let successCount = 0;
      let failedCount = 0;
      const failedTenants: string[] = [];
      const noEmailTenants: string[] = [];

      let delaySeconds = 0;
      if (state.scheduleSendDate) {
        const target = new Date(state.scheduleSendDate);
        if (state.scheduleSendTime) {
          const [hours, minutes] = state.scheduleSendTime.split(':');
          target.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
        }
        delaySeconds = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
      }

      const payloads: any[] = [];
      const successfulTenants: { tenant: any; message: string }[] = [];

      for (const tenant of tenantsWithEmail) {
        if (!state.selectedCategory) continue;
        try {
          const { subject, body } = await getEmailForCategory(
            state.selectedCategory,
            tenant,
            business,
            defaultCurrency,
            {
              target_date: state.selectedDate,
              ...(state.selectedCategory === 'announcement'
                ? { announcement_body: state.bulkAnnouncementMessageRef.current }
                : {}),
            },
          );

          payloads.push({
            to: tenant.email,
            subject: subject,
            html: body,
            cc: business?.email ? business.email : undefined,
            channel: 'email',
          });
          successfulTenants.push({ tenant, message: body });
        } catch (error) {
          console.error(`Error generating email for ${tenant.name}:`, error);
          failedCount++;
          failedTenants.push(tenant.name || 'Unknown');
        }
      }

      if (payloads.length > 0) {
        state.setBulkProgress({
          current: Math.floor(payloads.length / 2),
          total: tenantsWithEmail.length,
          label: 'Queueing batch...',
        });

        const { error } = await supabase.rpc('enqueue_batch_items', {
          queue_name: 'bulk_messages',
          payloads: payloads,
          delay_seconds: delaySeconds,
        });

        if (error) {
          console.error('Error in batch enqueueing:', error);
          failedCount += successfulTenants.length;
          failedTenants.push(...successfulTenants.map(t => t.tenant.name || 'Unknown'));
        } else {
          successCount += successfulTenants.length;

          state.setBulkProgress({
            current: payloads.length,
            total: tenantsWithEmail.length,
            label: 'Finalizing...',
          });

          logRemindersBulk(successfulTenants, 'email', delaySeconds);
        }
      }

      const selectedTenantsWithoutEmail = selectedTenantObjects.filter(
        (tenant: any) => !tenant.email || tenant.email.startsWith('placeholder'),
      );
      selectedTenantsWithoutEmail.forEach((tenant: any) => {
        noEmailTenants.push(tenant.name || 'Unknown');
      });

      let resultMessage = '';
      if (successCount > 0)
        resultMessage += `Email reminders sent successfully to ${successCount} tenants.\n`;
      if (failedCount > 0)
        resultMessage += `\nFailed to send to ${failedCount} tenants:\n• ${failedTenants.join('\n• ')}\n`;
      if (noEmailTenants.length > 0)
        resultMessage += `\nSelected tenants without email addresses (${noEmailTenants.length}):\n• ${noEmailTenants.join('\n• ')}`;

      if (successCount > 0 || failedCount > 0 || noEmailTenants.length > 0) {
        state.setResultModalData({ title: 'Email Results', message: resultMessage });
        state.setResultModalVisible(true);
      } else {
        showSnackbar(
          'No selected tenants with email addresses found to send reminders to.',
          'info',
        );
      }

      state.setSelectedTenants(new Set());
    } catch (error) {
      console.error('Error sending bulk email:', error);
      showSnackbar('Failed to send email reminders', 'error');
    } finally {
      state.setBulkEmailLoading(false);
      state.setBulkProgress(null);
      state.setBulkAnnouncementMessage('');
      state.setScheduleSendDate(null);
      state.setScheduleSendTime(null);
    }
  };

  const handleBulkSMSReminders = async () => {
    // If on Android, detect active SIM cards for device gateway
    if (isDeviceSmsSupported()) {
      try {
        const sims = await getAvailableSimCards();
        const activeFilterId = await getActiveSimFilter();
        if (activeFilterId !== null && sims.some(s => s.id === activeFilterId)) {
          state.setAvailableSimCards(sims.filter(s => s.id === activeFilterId));
          state.setSelectedSimId(activeFilterId);
        } else {
          state.setAvailableSimCards(sims);
          if (sims.length === 1) {
            state.setSelectedSimId(sims[0].id);
          }
        }
      } catch (err) {
        console.warn('Failed to load device SIM cards:', err);
      }
    }

    if (state.smsGateway === 'cloud') {
      if (!checkOnline('Bulk SMS')) return;
      if (!requireCloudSync('Bulk SMS')) return;
    }

    if (!isAdmin) {
      showSnackbar('You do not have permission to send bulk reminders', 'error');
      return;
    }
    if (data.getPendingTenants.length === 0) {
      showSnackbar('No tenants found for this category.', 'info');
      return;
    }
    state.setBulkSMSDialogVisible(true);
  };

  const confirmBulkSMSReminders = async () => {
    if (state.smsGateway === 'cloud') {
      if (!checkOnline('Bulk SMS')) return;
      if (!requireCloudSync('Bulk SMS')) return;
    }
    try {
      const selectedTenantIds = Array.from(state.selectedTenants);
      const selectedTenantObjects = data.getPendingTenants.filter((tenant: any) =>
        selectedTenantIds.includes(tenant.id),
      );
      const tenantsWithPhone = selectedTenantObjects.filter(
        (tenant: any) => !!tenant.phone,
      );

      if (selectedTenantObjects.length === 0) {
        showSnackbar(
          'Please select at least one tenant to send reminders to.',
          'warning',
        );
        return;
      }
      if (tenantsWithPhone.length === 0) {
        showSnackbar('None of the selected tenants have valid phone numbers.', 'warning');
        return;
      }

      state.setBulkSMSLoading(true);
      state.setBulkSMSDialogVisible(false);
      state.setBulkProgress({
        current: 0,
        total: tenantsWithPhone.length,
        label: 'Preparing…',
      });

      let successCount = 0;
      let failedCount = 0;
      const failedTenants: string[] = [];
      const noPhoneTenants: string[] = [];

      let delaySeconds = 0;
      if (state.scheduleSendDate) {
        const target = new Date(state.scheduleSendDate);
        if (state.scheduleSendTime) {
          const [hours, minutes] = state.scheduleSendTime.split(':');
          target.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
        }
        delaySeconds = Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
      }

      const payloads: any[] = [];
      const successfulTenants: { tenant: any; message: string }[] = [];

      for (const tenant of tenantsWithPhone) {
        if (!state.selectedCategory) continue;
        try {
          const message = await getMessageForCategory(
            state.selectedCategory,
            tenant,
            business,
            defaultCurrency,
            'sms',
            {
              target_date: state.selectedDate,
              ...(state.selectedCategory === 'announcement'
                ? { announcement_body: state.bulkAnnouncementMessageRef.current }
                : {}),
            },
          );

          payloads.push({
            to: tenant.phone as string,
            message: message,
            channel: 'sms',
            provider: business?.sms_provider || 'generic',
            senderId: business?.sms_sender_id || undefined,
          });
          successfulTenants.push({ tenant, message });
        } catch (error) {
          console.error(`Error generating SMS for ${tenant.name}:`, error);
          failedCount++;
          failedTenants.push(tenant.name || 'Unknown');
        }
      }

      if (state.smsGateway === 'device') {
        // Send directly using device SIM gateway via native-android-sms
        const itemsToDispatch = successfulTenants.map(({ tenant, message }) => ({
          to: tenant.phone as string,
          message,
          recipientName: tenant.name,
          tenantId: tenant.id,
          contractId: tenant.contracts?.[0]?.id || null,
        }));

        state.setBulkProgress({
          current: 0,
          total: itemsToDispatch.length,
          label: 'Starting on-device SMS dispatch...',
        });

        const dispatchResult = await sendBulkDeviceSms({
          items: itemsToDispatch,
          simCardId: state.selectedSimId,
          delayMs: 2500,
          onProgress: p => {
            state.setBulkProgress({
              current: p.current,
              total: p.total,
              label: p.label,
            });
          },
        });

        successCount = dispatchResult.successCount;
        failedCount += dispatchResult.failedCount;
        dispatchResult.failed.forEach(f => {
          failedTenants.push(`${f.item.recipientName || f.item.to} (${f.error})`);
        });

        if (dispatchResult.successful.length > 0) {
          const sentTenants = dispatchResult.successful.map(s => {
            const match = successfulTenants.find(t => t.tenant.id === s.item.tenantId);
            return (
              match || {
                tenant: { id: s.item.tenantId, name: s.item.recipientName },
                message: s.item.message,
              }
            );
          });
          logRemindersBulk(sentTenants as any, 'sms', 0);
        }
      } else {
        if (payloads.length > 0) {
          state.setBulkProgress({
            current: Math.floor(payloads.length / 2),
            total: tenantsWithPhone.length,
            label: 'Queueing batch...',
          });

          const { error } = await supabase.rpc('enqueue_batch_items', {
            queue_name: 'bulk_messages',
            payloads: payloads,
            delay_seconds: delaySeconds,
          });

          if (error) {
            console.error('Error in batch enqueueing:', error);
            failedCount += successfulTenants.length;
            failedTenants.push(...successfulTenants.map(t => t.tenant.name || 'Unknown'));
          } else {
            successCount += successfulTenants.length;

            state.setBulkProgress({
              current: payloads.length,
              total: tenantsWithPhone.length,
              label: 'Finalizing...',
            });

            logRemindersBulk(successfulTenants, 'sms', delaySeconds);
          }
        }
      }

      const selectedTenantsWithoutPhone = selectedTenantObjects.filter(
        (tenant: any) => !tenant.phone,
      );
      selectedTenantsWithoutPhone.forEach((tenant: any) => {
        noPhoneTenants.push(tenant.name || 'Unknown');
      });

      let resultMessage = '';
      if (successCount > 0)
        resultMessage +=
          delaySeconds > 0
            ? `SMS reminders scheduled successfully for ${successCount} tenants.\n`
            : state.smsGateway === 'device'
              ? `SMS reminders sent successfully via device SIM for ${successCount} tenants.\n`
              : `SMS reminders queued successfully for ${successCount} tenants.\n`;
      if (failedCount > 0)
        resultMessage += `\nFailed to send to ${failedCount} tenants:\n• ${failedTenants.join('\n• ')}\n`;
      if (noPhoneTenants.length > 0)
        resultMessage += `\nSelected tenants without phone numbers (${noPhoneTenants.length}):\n• ${noPhoneTenants.join('\n• ')}`;

      if (successCount > 0 || failedCount > 0 || noPhoneTenants.length > 0) {
        state.setResultModalData({ title: 'SMS Results', message: resultMessage });
        state.setResultModalVisible(true);
      } else {
        showSnackbar(
          'No selected tenants with phone numbers found to send reminders to.',
          'info',
        );
      }

      state.setSelectedTenants(new Set());
    } catch (error) {
      console.error('Error sending bulk SMS:', error);
      showSnackbar('Failed to send SMS reminders', 'error');
    } finally {
      state.setBulkSMSLoading(false);
      state.setShowAnnouncementEditor(false);
      state.setBulkProgress(null);
      state.setScheduleSendDate(null);
      state.setScheduleSendTime(null);
    }
  };

  const onChangeDate = (_event: any, selected: Date | undefined) => {
    const currentDate = selected || state.selectedDate;
    state.setShowDatePicker(Platform.OS === 'ios');
    state.setSelectedDate(currentDate);
  };

  const handlePrevMonth = () => {
    const newDate = new Date(state.selectedDate);
    newDate.setMonth(newDate.getMonth() - 1);
    state.setSelectedDate(newDate);
  };

  const handleNextMonth = () => {
    const newDate = new Date(state.selectedDate);
    newDate.setMonth(newDate.getMonth() + 1);
    state.setSelectedDate(newDate);
  };

  const dismissCategoryModal = () => {
    state.setSelectedCategory(null);
    state.setSearchQuery('');
    state.setShowSearch(false);
    state.setShowFilters(false);
    state.setSelectedPropertyId(null);
    state.setSelectedHouseTypeId(null);
    state.setSelectedTenants(new Set());
    state.setSelectedDate(new Date());
    state.setExpandedSections(new Set());
    state.setMenuVisible(null);
  };

  return {
    handleSendMessage,
    handleSendWhatsApp,
    handleSendEmail,
    handleSendInfoRequest,
    handleSendWhatsAppGroupInvite,
    toggleSection,
    handleDeleteReminder,
    handleTenantSelection,
    handleBulkEmailReminders,
    confirmBulkEmailReminders,
    handleBulkSMSReminders,
    confirmBulkSMSReminders,
    onChangeDate,
    handlePrevMonth,
    handleNextMonth,
    dismissCategoryModal,
  };
}
