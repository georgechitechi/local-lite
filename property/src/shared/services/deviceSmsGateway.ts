import { parsePhoneNumberFromString } from 'libphonenumber-js';
import {
  addSmsDeliveredListener,
  addSmsSentListener,
  type BulkSmsRecipient,
  canSendSmsAsync,
  getAvailableSimsAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  type SimInfo,
  type SmsStatusEvent,
  sendBulkSmsWithProgressAsync,
  sendSmsAsync,
  sendSmsUIAsync,
} from 'native-android-sms';
import { Platform } from 'react-native';
import { secureStorage } from '@/shared/services/secureStorage';
import { pauseAutoLock, resumeAutoLock } from '@/stores/lockStore';

export const getActiveSimFilter = async (): Promise<number | null> => {
  try {
    const val = await secureStorage.getItem('device_sms_active_sim_id');
    return typeof val === 'number' ? val : null;
  } catch {
    return null;
  }
};

export const setActiveSimFilter = async (simId: number | null): Promise<void> => {
  try {
    if (simId === null) {
      await secureStorage.removeItem('device_sms_active_sim_id');
    } else {
      await secureStorage.setItem('device_sms_active_sim_id', simId);
    }
  } catch (error) {
    console.warn('Failed to save active SIM preference:', error);
  }
};

export interface SimCardInfo {
  id: number;
  displayName: string;
  carrierName: string;
  slotIndex?: number | null;
  simSlotIndex?: number | null;
  countryIso?: string | null;
  phoneNumber?: string | null;
  isDefaultSms?: boolean;
  isDefaultData?: boolean;
  isActive?: boolean;
}

export interface SendSmsResult {
  success: boolean;
  delivered?: boolean;
  error?: string;
}

export interface BulkSmsItem {
  to: string;
  message: string;
  recipientName?: string;
  tenantId?: string;
  contractId?: string | null;
}

export interface BulkSmsProgress {
  current: number;
  total: number;
  label: string;
  currentRecipient?: string;
}

export interface BulkSmsResult {
  total: number;
  successCount: number;
  failedCount: number;
  successful: Array<{ item: BulkSmsItem }>;
  failed: Array<{ item: BulkSmsItem; error: string }>;
}

export {
  addSmsDeliveredListener,
  addSmsSentListener,
  type SmsStatusEvent,
  sendSmsUIAsync,
};

/**
 * Natively opens the device's SMS composer UI with recipient and prefilled message.
 * On Android, uses native ACTION_SENDTO intent without browser URL encoding bugs.
 */
export const openDeviceSmsComposer = async (
  phoneNumber: string,
  message: string,
): Promise<boolean> => {
  await pauseAutoLock();
  try {
    return await sendSmsUIAsync(phoneNumber, message);
  } finally {
    resumeAutoLock();
  }
};

export const isDeviceSmsSupported = (): boolean => {
  return Platform.OS === 'android';
};

export const checkCanSendSms = async (): Promise<{
  capable: boolean;
  reason?: string | null;
}> => {
  if (Platform.OS !== 'android') {
    return { capable: false, reason: 'NOT_ANDROID' };
  }
  try {
    const isCapable = await canSendSmsAsync();
    return { capable: isCapable, reason: isCapable ? null : 'NO_TELEPHONY_FEATURE' };
  } catch (err: any) {
    return { capable: false, reason: err.message || 'ERROR_CHECKING_CAPABILITY' };
  }
};

export const checkSmsPermissions = async (): Promise<{
  sendSms: boolean;
  readPhoneState: boolean;
}> => {
  if (Platform.OS !== 'android') {
    return { sendSms: false, readPhoneState: false };
  }
  try {
    const res = await getPermissionsAsync({ sendSms: true, readPhoneState: true });
    return {
      sendSms: Boolean(res.sendSms ?? res.granted),
      readPhoneState: Boolean(res.readPhoneState ?? res.granted),
    };
  } catch (error) {
    console.error('Error checking SMS permissions:', error);
    return { sendSms: false, readPhoneState: false };
  }
};

export const requestSmsPermissions = async (options?: {
  includePhoneState?: boolean;
}): Promise<{
  sendSms: boolean;
  readPhoneState: boolean;
}> => {
  if (Platform.OS !== 'android') {
    return { sendSms: false, readPhoneState: false };
  }
  await pauseAutoLock();
  try {
    const res = await requestPermissionsAsync({
      sendSms: true,
      readPhoneState: options?.includePhoneState !== false,
    });
    return {
      sendSms: Boolean(res.sendSms ?? res.granted),
      readPhoneState: Boolean(res.readPhoneState ?? res.granted),
    };
  } catch (error) {
    console.error('Error requesting SMS permissions:', error);
    return { sendSms: false, readPhoneState: false };
  } finally {
    resumeAutoLock();
  }
};

export const getAvailableSimCards = async (
  includeInactive = false,
): Promise<SimCardInfo[]> => {
  if (Platform.OS !== 'android') return [];

  try {
    // Ensure permission to read phone/SIM state
    const perms = await requestSmsPermissions({ includePhoneState: true });
    if (!perms.readPhoneState) return [];

    // Native getAvailableSimsAsync automatically filters inactive slots unless includeInactive is true
    const sims = await getAvailableSimsAsync({ includeInactive });
    if (!Array.isArray(sims)) return [];

    return sims.map((s: SimInfo) => ({
      id: Number(s.subscriptionId),
      displayName: s.displayName ? String(s.displayName) : '',
      carrierName: s.carrierName ? String(s.carrierName) : '',
      slotIndex: s.slotIndex ?? null,
      simSlotIndex: s.slotIndex ?? null,
      countryIso: s.countryIso ?? null,
      phoneNumber: s.number ? String(s.number) : null,
      isDefaultSms: false,
      isDefaultData: false,
      isActive: s.isActive ?? true,
    }));
  } catch (error) {
    console.warn('Failed to retrieve SIM cards from device:', error);
    return [];
  }
};

/**
 * Normalizes a phone number strictly to E.164 international format using libphonenumber-js.
 */
export const formatToE164Phone = (phone: string, defaultCountry: any = 'KE'): string => {
  if (!phone) return '';
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned) return '';

  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (parsed?.isValid()) {
    return parsed.format('E.164');
  }

  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
};

export const sendSingleDeviceSms = async ({
  to,
  message,
  simCardId,
}: {
  to: string;
  message: string;
  simCardId?: number | null;
}): Promise<SendSmsResult> => {
  if (Platform.OS !== 'android') {
    return {
      success: false,
      error: 'Direct SMS sending is only supported on Android devices.',
    };
  }

  // Ensure SEND_SMS permission is granted
  const perms = await requestSmsPermissions({ includePhoneState: false });
  if (!perms.sendSms) {
    return {
      success: false,
      error: 'SMS permission was not granted by the user.',
    };
  }

  const formattedPhone = formatToE164Phone(to);
  if (!formattedPhone) {
    return {
      success: false,
      error: 'Invalid recipient phone number.',
    };
  }

  await pauseAutoLock();
  try {
    // Native sendSmsAsync handles text sanitization, multi-part divide, and fallback to default SIM
    await sendSmsAsync(formattedPhone, message, {
      subscriptionId: simCardId ?? null,
      fallbackToDefaultSim: true,
      sanitize: true,
    });
    return { success: true };
  } catch (error: any) {
    const errorMessage = error?.message || 'Failed to dispatch SMS';
    console.error(
      `Failed to dispatch SMS to ${formattedPhone} (SIM ID: ${simCardId ?? 'Default'}):`,
      error,
    );
    return { success: false, error: errorMessage };
  } finally {
    resumeAutoLock();
  }
};

export const sendBulkDeviceSms = async ({
  items,
  simCardId,
  delayMs = 2500,
  onProgress,
}: {
  items: BulkSmsItem[];
  simCardId?: number | null;
  delayMs?: number;
  onProgress?: (progress: BulkSmsProgress) => void;
}): Promise<BulkSmsResult> => {
  const result: BulkSmsResult = {
    total: items.length,
    successCount: 0,
    failedCount: 0,
    successful: [],
    failed: [],
  };

  if (items.length === 0) return result;

  if (Platform.OS !== 'android') {
    items.forEach(item => {
      result.failed.push({
        item,
        error: 'Direct device SMS gateway is only supported on Android.',
      });
    });
    result.failedCount = items.length;
    return result;
  }

  const permissions = await requestSmsPermissions({ includePhoneState: false });
  if (!permissions.sendSms) {
    items.forEach(item => {
      result.failed.push({
        item,
        error: 'SMS permission not granted.',
      });
    });
    result.failedCount = items.length;
    return result;
  }

  // Prepare recipient items for native dispatch
  const recipientMap = new Map<string, BulkSmsItem>();
  const validRecipients: BulkSmsRecipient[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const formattedPhone = formatToE164Phone(item.to);
    if (!formattedPhone) {
      result.failed.push({ item, error: 'Invalid recipient phone number.' });
      result.failedCount++;
      continue;
    }

    const recipientKey = `${formattedPhone}_${item.message}`;
    recipientMap.set(recipientKey, item);
    validRecipients.push({
      to: formattedPhone,
      message: item.message,
      recipientName: item.recipientName || item.to,
      id: String(i),
    });
  }

  if (validRecipients.length === 0) {
    return result;
  }

  await pauseAutoLock();
  try {
    const nativeResult = await sendBulkSmsWithProgressAsync(validRecipients, {
      delayMs,
      subscriptionId: simCardId ?? null,
      fallbackToDefaultSim: true,
      sanitize: true,
      onProgress,
    });

    nativeResult.successful.forEach(s => {
      const recipientKey = `${s.to}_${s.message}`;
      const originalItem = recipientMap.get(recipientKey) ||
        items.find(it => it.message === s.message) || {
          to: s.to,
          message: s.message,
        };
      result.successful.push({ item: originalItem });
      result.successCount++;
    });

    nativeResult.failed.forEach(f => {
      const recipientKey = `${f.to}_${f.message}`;
      const originalItem = recipientMap.get(recipientKey) ||
        items.find(it => it.message === f.message) || {
          to: f.to,
          message: f.message,
        };
      result.failed.push({ item: originalItem, error: f.error });
      result.failedCount++;
    });

    return result;
  } finally {
    resumeAutoLock();
  }
};
