import {
  generateInfoRequestUrl,
  getEmailForCategory,
  getMessageForCategory,
  getReminderCategories,
} from '@/features/reminders/utils/reminderUtils';
import { supabase } from '@/shared/services/supabase';
import { getAuthStateSnapshot } from '@/stores/authStore';

jest.mock('@/stores/authStore', () => ({ getAuthStateSnapshot: jest.fn() }));

import { getSyncClient } from '@/shared/services/sync/client';

jest.mock('@/shared/services/sync/client', () => ({
  getSyncClient: jest.fn(),
  getSyncClientSync: jest.fn(),
}));

jest.mock('@/shared/services/supabase', () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

describe('reminderUtils Utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthStateSnapshot as jest.Mock).mockReturnValue({ session: null });
    (getSyncClient as jest.Mock).mockResolvedValue({
      findMany: jest.fn().mockResolvedValue([]),
    });
  });

  describe('getReminderCategories', () => {
    it('returns standard reminder categories with provided colors', () => {
      const colors = {
        primary: '#123456',
        success: '#654321',
      };
      const categories = getReminderCategories(colors);
      expect(categories).toHaveLength(6);
      expect(categories.map(c => c.id)).toEqual([
        'payment',
        'welcome',
        'whatsapp_invite',
        'data_cleanup',
        'mark_holiday',
        'announcement',
      ]);
      expect(categories[0].color).toBe('#123456');
      expect(categories[1].color).toBe('#654321');
    });
  });

  describe('generateInfoRequestUrl', () => {
    it('returns url when Supabase edge function responds successfully', async () => {
      (getAuthStateSnapshot as jest.Mock).mockReturnValue({
        session: { access_token: 'mock-token' },
      });

      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          results: [{ url: 'https://app.com/request-info?token=abc' }],
        },
        error: null,
      });

      const url = await generateInfoRequestUrl('tenant-123');
      expect(url).toBe('https://app.com/request-info?token=abc');
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'tenant-management/scan/request-info',
        expect.objectContaining({
          headers: { Authorization: 'Bearer mock-token' },
          body: { tenant_id: 'tenant-123', skip_email: true },
        }),
      );
    });

    it('returns null when Supabase returns an error', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: null,
        error: new Error('Network error'),
      });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const url = await generateInfoRequestUrl('tenant-123');
      expect(url).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('returns null when response indicates success=false or missing url', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: {
          success: false,
          results: [{ error: 'Tenant not found' }],
        },
        error: null,
      });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const url = await generateInfoRequestUrl('tenant-123');
      expect(url).toBeNull();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('getMessageForCategory', () => {
    const mockTenant: any = {
      id: 't-1',
      name: 'Alice Wambui',
      pendingRentAmount: 15000,
      paidAmount: 5000,
      contracts: [
        {
          rent_amount: 20000,
          house: {
            house_number: 'B4',
            property: { name: 'Sunset Ridge' },
          },
        },
      ],
    };

    const mockBusiness: any = {
      id: 'biz-1',
      name: 'Sunrise Properties',
      phone: '+254700112233',
      email: 'info@sunrise.com',
      address: 'Nairobi, Kenya',
    };

    const mockCurrency: any = {
      code: 'KES',
      symbol: 'Ksh',
      position: 'before',
    };

    it('generates payment reminder SMS with replaced placeholders', async () => {
      const message = await getMessageForCategory(
        'payment',
        mockTenant,
        mockBusiness,
        mockCurrency,
        'sms',
      );

      expect(message).toContain('Alice Wambui');
      expect(message).toContain('Sunrise Properties');
      expect(message).toContain('B4');
      expect(message).toContain('15,000');
    });

    it('generates welcome message for WhatsApp channel', async () => {
      const message = await getMessageForCategory(
        'welcome',
        mockTenant,
        mockBusiness,
        mockCurrency,
        'whatsapp',
      );

      expect(message).toContain('Alice Wambui');
      expect(message).toContain('Sunset Ridge');
    });

    it('fetches info request URL automatically for data_cleanup category if not provided', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          results: [{ url: 'https://app.com/info-link' }],
        },
        error: null,
      });

      const message = await getMessageForCategory(
        'data_cleanup',
        mockTenant,
        mockBusiness,
        mockCurrency,
        'sms',
      );

      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'tenant-management/scan/request-info',
        expect.any(Object),
      );
      expect(message).toContain('https://app.com/info-link');
    });

    it('fetches holiday request URL automatically for mark_holiday category if not provided', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          results: [{ url: 'https://app.com/holiday-link' }],
        },
        error: null,
      });

      const message = await getMessageForCategory(
        'mark_holiday',
        mockTenant,
        mockBusiness,
        mockCurrency,
        'sms',
      );

      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'tenant-management/scan/mark-holiday',
        expect.any(Object),
      );
      expect(message).toContain('https://app.com/holiday-link');
    });

    it('uses whatsapp group link from business store settings if present', async () => {
      (getSyncClient as jest.Mock).mockResolvedValue({
        findMany: jest.fn().mockImplementation((table: string) => {
          if (table === 'settings') {
            return Promise.resolve([
              {
                setting_key: 'links',
                setting_value: { whatsapp_group: 'https://chat.whatsapp.com/testgroup' },
                deleted: false,
              },
            ]);
          }
          return Promise.resolve([]);
        }),
      });

      const message = await getMessageForCategory(
        'whatsapp_invite',
        mockTenant,
        mockBusiness,
        mockCurrency,
        'whatsapp',
      );

      expect(message).toContain('https://chat.whatsapp.com/testgroup');
    });

    it('handles fallback defaults when tenant contracts or business are minimal', async () => {
      const bareTenant: any = { id: 't-bare' };
      const message = await getMessageForCategory(
        'payment',
        bareTenant,
        null,
        null,
        'sms',
      );

      expect(message).toContain('Tenant');
      expect(message).toContain('Property Management');
      expect(message).toContain('N/A');
    });
  });

  describe('getEmailForCategory', () => {
    const mockTenant: any = {
      id: 't-1',
      name: 'Alice Wambui',
      pendingRentAmount: 15000,
      paidAmount: 5000,
      contracts: [
        {
          rent_amount: 20000,
          house: {
            house_number: 'B4',
            property: { name: 'Sunset Ridge' },
          },
        },
      ],
    };

    const mockBusiness: any = {
      id: 'biz-1',
      name: 'Sunrise Properties',
      phone: '+254700112233',
      email: 'info@sunrise.com',
      address: 'Nairobi, Kenya',
    };

    it('generates subject and HTML formatted body for email reminders', async () => {
      const email = await getEmailForCategory('payment', mockTenant, mockBusiness, {
        code: 'KES',
        symbol: 'KSh',
        name: 'Kenyan Shilling',
        default: true,
      });

      expect(email.subject).toContain('Rent Payment Reminder');
      expect(email.body).toContain('<div style="font-family: sans-serif;');
      expect(email.body).toContain('Sunrise Properties');
      expect(email.body).toContain('Alice Wambui');
    });

    it('fetches info request URL for email if needed', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          results: [{ url: 'https://app.com/email-info' }],
        },
        error: null,
      });

      const email = await getEmailForCategory(
        'data_cleanup',
        mockTenant,
        mockBusiness,
        null,
      );

      expect(email.body).toContain('https://app.com/email-info');
    });

    it('fetches holiday request URL for email if needed', async () => {
      (supabase.functions.invoke as jest.Mock).mockResolvedValue({
        data: {
          success: true,
          results: [{ url: 'https://app.com/email-holiday' }],
        },
        error: null,
      });

      const email = await getEmailForCategory(
        'mark_holiday',
        mockTenant,
        mockBusiness,
        null,
      );

      expect(email.body).toContain('https://app.com/email-holiday');
    });
  });
});
