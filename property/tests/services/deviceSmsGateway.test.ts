import * as Sms from 'native-android-sms';
import { Platform } from 'react-native';
import {
  addSmsDeliveredListener,
  addSmsSentListener,
  checkCanSendSms,
  checkSmsPermissions,
  formatToE164Phone,
  getActiveSimFilter,
  getAvailableSimCards,
  isDeviceSmsSupported,
  openDeviceSmsComposer,
  requestSmsPermissions,
  sendBulkDeviceSms,
  sendSingleDeviceSms,
  setActiveSimFilter,
} from '@/shared/services/deviceSmsGateway';
import { secureStorage } from '@/shared/services/secureStorage';
import * as LockStore from '@/stores/lockStore';

describe('deviceSmsGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'android';
  });

  describe('Active SIM Preference', () => {
    it('returns saved active SIM ID from secureStorage', async () => {
      jest.spyOn(secureStorage, 'getItem').mockResolvedValueOnce(2 as any);
      const result = await getActiveSimFilter();
      expect(result).toBe(2);
    });

    it('returns null if stored value is not a number or throws', async () => {
      jest.spyOn(secureStorage, 'getItem').mockResolvedValueOnce('invalid' as any);
      expect(await getActiveSimFilter()).toBeNull();

      jest.spyOn(secureStorage, 'getItem').mockRejectedValueOnce(new Error('fail'));
      expect(await getActiveSimFilter()).toBeNull();
    });

    it('saves SIM ID or removes it when null', async () => {
      const setSpy = jest.spyOn(secureStorage, 'setItem').mockResolvedValueOnce();
      const removeSpy = jest.spyOn(secureStorage, 'removeItem').mockResolvedValueOnce();

      await setActiveSimFilter(1);
      expect(setSpy).toHaveBeenCalledWith('device_sms_active_sim_id', 1);

      await setActiveSimFilter(null);
      expect(removeSpy).toHaveBeenCalledWith('device_sms_active_sim_id');
    });

    it('handles storage errors gracefully in setActiveSimFilter', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(secureStorage, 'setItem').mockRejectedValueOnce(new Error('Disk error'));

      await setActiveSimFilter(1);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('Platform & Telephony Capability', () => {
    it('checks if device SMS is supported based on platform', () => {
      Platform.OS = 'android';
      expect(isDeviceSmsSupported()).toBe(true);

      Platform.OS = 'ios';
      expect(isDeviceSmsSupported()).toBe(false);
    });

    it('returns capable false on non-android in checkCanSendSms', async () => {
      Platform.OS = 'ios';
      const result = await checkCanSendSms();
      expect(result).toEqual({ capable: false, reason: 'NOT_ANDROID' });
    });

    it('checks native canSendSmsAsync capability on Android', async () => {
      (Sms.canSendSmsAsync as jest.Mock).mockResolvedValueOnce(true);
      const res1 = await checkCanSendSms();
      expect(res1).toEqual({ capable: true, reason: null });

      (Sms.canSendSmsAsync as jest.Mock).mockResolvedValueOnce(false);
      const res2 = await checkCanSendSms();
      expect(res2).toEqual({ capable: false, reason: 'NO_TELEPHONY_FEATURE' });
    });

    it('catches errors during capability check', async () => {
      (Sms.canSendSmsAsync as jest.Mock).mockRejectedValueOnce(
        new Error('Telephony check failed'),
      );
      const res = await checkCanSendSms();
      expect(res).toEqual({ capable: false, reason: 'Telephony check failed' });
    });
  });

  describe('Permissions', () => {
    it('returns false permissions on non-android', async () => {
      Platform.OS = 'ios';
      expect(await checkSmsPermissions()).toEqual({
        sendSms: false,
        readPhoneState: false,
      });
      expect(await requestSmsPermissions()).toEqual({
        sendSms: false,
        readPhoneState: false,
      });
    });

    it('checks permissions via getPermissionsAsync', async () => {
      (Sms.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
        granted: true,
        sendSms: true,
        readPhoneState: true,
      });

      const res = await checkSmsPermissions();
      expect(res).toEqual({ sendSms: true, readPhoneState: true });
    });

    it('requests permissions via requestPermissionsAsync', async () => {
      (Sms.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
        granted: true,
        sendSms: true,
        readPhoneState: false,
      });

      const res = await requestSmsPermissions({ includePhoneState: true });
      expect(res).toEqual({ sendSms: true, readPhoneState: false });
      expect(Sms.requestPermissionsAsync).toHaveBeenCalledWith({
        sendSms: true,
        readPhoneState: true,
      });
    });

    it('handles permission rejection or errors gracefully', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (Sms.getPermissionsAsync as jest.Mock).mockRejectedValueOnce(
        new Error('Permission service down'),
      );

      const res = await checkSmsPermissions();
      expect(res).toEqual({ sendSms: false, readPhoneState: false });
      errorSpy.mockRestore();
    });

    it('handles permission request errors gracefully', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (Sms.requestPermissionsAsync as jest.Mock).mockRejectedValueOnce(
        new Error('Permission request crash'),
      );

      const res = await requestSmsPermissions();
      expect(res).toEqual({ sendSms: false, readPhoneState: false });
      errorSpy.mockRestore();
    });
  });

  describe('SIM Cards Query', () => {
    it('returns empty array on non-android', async () => {
      Platform.OS = 'ios';
      expect(await getAvailableSimCards()).toEqual([]);
    });

    it('returns empty array if readPhoneState permission is denied', async () => {
      (Sms.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'denied',
        granted: false,
        sendSms: true,
        readPhoneState: false,
      });

      const sims = await getAvailableSimCards();
      expect(sims).toEqual([]);
    });

    it('handles non-array response or exceptions in getAvailableSimCards', async () => {
      (Sms.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
        granted: true,
        sendSms: true,
        readPhoneState: true,
      });
      (Sms.getAvailableSimsAsync as jest.Mock).mockResolvedValueOnce(null);

      expect(await getAvailableSimCards()).toEqual([]);

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      (Sms.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
        granted: true,
        sendSms: true,
        readPhoneState: true,
      });
      (Sms.getAvailableSimsAsync as jest.Mock).mockRejectedValueOnce(
        new Error('SIM service error'),
      );

      expect(await getAvailableSimCards()).toEqual([]);
      warnSpy.mockRestore();
    });

    it('retrieves and maps available SIM cards from device', async () => {
      (Sms.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
        granted: true,
        sendSms: true,
        readPhoneState: true,
      });
      (Sms.getAvailableSimsAsync as jest.Mock).mockResolvedValueOnce([
        {
          subscriptionId: 1,
          displayName: 'SIM 1',
          carrierName: 'Safaricom',
          slotIndex: 0,
          number: '+254712345678',
          countryIso: 'ke',
          isActive: true,
        },
      ]);

      const sims = await getAvailableSimCards();
      expect(sims).toHaveLength(1);
      expect(sims[0]).toEqual({
        id: 1,
        displayName: 'SIM 1',
        carrierName: 'Safaricom',
        slotIndex: 0,
        simSlotIndex: 0,
        countryIso: 'ke',
        phoneNumber: '+254712345678',
        isDefaultSms: false,
        isDefaultData: false,
        isActive: true,
      });
    });
  });

  describe('formatToE164Phone', () => {
    it('formats Kenyan local numbers to international E.164', () => {
      expect(formatToE164Phone('0712345678')).toBe('+254712345678');
      expect(formatToE164Phone('254712345678')).toBe('+254712345678');
      expect(formatToE164Phone('+254 712 345 678')).toBe('+254712345678');
    });

    it('preserves valid international numbers', () => {
      expect(formatToE164Phone('+12025550123')).toBe('+12025550123');
      expect(formatToE164Phone('+44 20 7946 0958', 'GB')).toBe('+442079460958');
    });

    it('returns empty string for empty input', () => {
      expect(formatToE164Phone('')).toBe('');
      expect(formatToE164Phone('   ')).toBe('');
    });

    it('fallbacks to prepending + on unparseable digits', () => {
      expect(formatToE164Phone('12345')).toBe('+12345');
    });
  });

  describe('sendSingleDeviceSms', () => {
    it('fails if not Android', async () => {
      Platform.OS = 'ios';
      const res = await sendSingleDeviceSms({ to: '0712345678', message: 'Hello' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Android');
    });

    it('fails if SEND_SMS permission is not granted', async () => {
      (Sms.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'denied',
        granted: false,
        sendSms: false,
        readPhoneState: false,
      });

      const res = await sendSingleDeviceSms({ to: '0712345678', message: 'Hello' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('SMS permission was not granted');
    });

    it('fails if recipient phone number is invalid/empty', async () => {
      (Sms.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
        granted: true,
        sendSms: true,
      });

      const res = await sendSingleDeviceSms({ to: '???', message: 'Hello' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Invalid recipient phone number.');
    });

    it('dispatches SMS successfully via native sendSmsAsync', async () => {
      (Sms.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
        granted: true,
        sendSms: true,
        readPhoneState: true,
      });
      (Sms.sendSmsAsync as jest.Mock).mockResolvedValueOnce('uuid-1234');

      const res = await sendSingleDeviceSms({
        to: '0712345678',
        message: 'Hello Tenant',
        simCardId: 1,
      });

      expect(res.success).toBe(true);
      expect(Sms.sendSmsAsync).toHaveBeenCalledWith('+254712345678', 'Hello Tenant', {
        subscriptionId: 1,
        fallbackToDefaultSim: true,
        sanitize: true,
      });
    });

    it('handles dispatch failure', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (Sms.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
        granted: true,
        sendSms: true,
      });
      (Sms.sendSmsAsync as jest.Mock).mockRejectedValueOnce(new Error('Network failure'));

      const res = await sendSingleDeviceSms({ to: '0712345678', message: 'Test' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Network failure');
      errorSpy.mockRestore();
    });
  });

  describe('sendBulkDeviceSms', () => {
    it('returns empty summary when no items provided', async () => {
      const res = await sendBulkDeviceSms({ items: [] });
      expect(res.total).toBe(0);
      expect(res.successCount).toBe(0);
      expect(res.failedCount).toBe(0);
    });

    it('fails all items on non-Android platform', async () => {
      Platform.OS = 'ios';
      const items = [{ to: '0712345678', message: 'Hello' }];
      const res = await sendBulkDeviceSms({ items });
      expect(res.failedCount).toBe(1);
      expect(res.failed[0].error).toContain('Android');
    });

    it('fails all items if permissions are denied', async () => {
      (Sms.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'denied',
        granted: false,
        sendSms: false,
      });

      const items = [{ to: '0712345678', message: 'Hello' }];
      const res = await sendBulkDeviceSms({ items });
      expect(res.failedCount).toBe(1);
      expect(res.failed[0].error).toContain('permission not granted');
    });

    it('handles invalid phone numbers in bulk queue', async () => {
      (Sms.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
        granted: true,
        sendSms: true,
      });

      const items = [{ to: '???', message: 'Hello' }];
      const res = await sendBulkDeviceSms({ items });
      expect(res.failedCount).toBe(1);
      expect(res.failed[0].error).toBe('Invalid recipient phone number.');
    });

    it('dispatches bulk messages with progress and handles partial failures', async () => {
      (Sms.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
        status: 'granted',
        granted: true,
        sendSms: true,
      });

      const items = [
        { to: '0712345678', message: 'Rent due John', recipientName: 'John' },
        { to: '0722000000', message: 'Rent due Mary', recipientName: 'Mary' },
      ];

      (Sms.sendBulkSmsWithProgressAsync as jest.Mock).mockImplementationOnce(
        async (_recipients, options) => {
          options?.onProgress?.({
            current: 1,
            total: 2,
            label: 'Sending to John...',
            currentRecipient: 'John',
          });
          return {
            total: 2,
            successCount: 1,
            failedCount: 1,
            uuids: ['uuid-1'],
            successful: [
              { to: '+254712345678', message: 'Rent due John', uuid: 'uuid-1' },
            ],
            failed: [
              { to: '+254722000000', message: 'Rent due Mary', error: 'Radio off' },
            ],
          };
        },
      );

      const onProgress = jest.fn();
      const res = await sendBulkDeviceSms({
        items,
        simCardId: 1,
        delayMs: 1000,
        onProgress,
      });

      expect(res.total).toBe(2);
      expect(res.successCount).toBe(1);
      expect(res.failedCount).toBe(1);
      expect(res.successful[0].item.recipientName).toBe('John');
      expect(res.failed[0].item.recipientName).toBe('Mary');
      expect(res.failed[0].error).toBe('Radio off');
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ current: 1, total: 2 }),
      );
    });
  });

  describe('openDeviceSmsComposer', () => {
    it('delegates to native sendSmsUIAsync and pauses/resumes auto lock', async () => {
      const pauseSpy = jest.spyOn(LockStore, 'pauseAutoLock');
      const resumeSpy = jest.spyOn(LockStore, 'resumeAutoLock');
      (Sms.sendSmsUIAsync as jest.Mock).mockResolvedValueOnce(true);
      const result = await openDeviceSmsComposer('0712345678', 'Hello Jane');
      expect(result).toBe(true);
      expect(Sms.sendSmsUIAsync).toHaveBeenCalledWith('0712345678', 'Hello Jane');
      expect(pauseSpy).toHaveBeenCalled();
      expect(resumeSpy).toHaveBeenCalled();
    });
  });

  describe('SMS Status Event Listeners', () => {
    it('attaches sent and delivered listeners', () => {
      const sentCb = jest.fn();
      const deliveredCb = jest.fn();

      const subSent = addSmsSentListener(sentCb);
      const subDelivered = addSmsDeliveredListener(deliveredCb);

      expect(Sms.addSmsSentListener).toHaveBeenCalledWith(sentCb);
      expect(Sms.addSmsDeliveredListener).toHaveBeenCalledWith(deliveredCb);
      expect(subSent).toHaveProperty('remove');
      expect(subDelivered).toHaveProperty('remove');
    });
  });
});
