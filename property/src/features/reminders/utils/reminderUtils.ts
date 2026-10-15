import { supabase } from '@/shared/services/supabase';
import { getSyncClient } from '@/shared/services/sync/client';
import {
  getDefaultTemplate,
  getMessageTemplate,
  plainToHtml,
  replacePlaceholders,
} from '@/shared/services/templateService';
import type * as T from '@/shared/types/types';
import { type Currency, formatWithCurrency } from '@/shared/utils/formatters';
import { getAuthStateSnapshot } from '@/stores/authStore';

export type Tenant = T.ReminderTenant;
export type ReminderLog = T.ReminderLog;
export type ReminderCategory = T.ReminderCategory;
export type ReminderCategoryType = T.ReminderCategoryType;
export type Business = T.Business;

const getWhatsappGroupLink = async (businessId: string): Promise<string> => {
  if (!businessId) return '';
  try {
    const client = await getSyncClient();
    const rows = await client.findMany('settings', {
      where: { business_id: businessId, setting_key: 'links' },
    });
    const setting = (rows || []).find((s: any) => !s.deleted);
    let val = setting?.setting_value;
    if (typeof val === 'string') {
      try {
        val = JSON.parse(val);
      } catch {}
    }
    return val?.whatsapp_group || '';
  } catch {
    return '';
  }
};

export const getReminderCategories = (colors: any): ReminderCategory[] => [
  {
    id: 'payment',
    title: 'Payment Reminders',
    description: 'Send rent payment reminders',
    icon: 'cash',
    color: colors.primary,
  },
  {
    id: 'welcome',
    title: 'Welcome Messages',
    description: 'Welcome new tenants',
    icon: 'home-account',
    color: colors.success,
  },
  {
    id: 'whatsapp_invite',
    title: 'WhatsApp Invite',
    description: 'Invite to community group',
    icon: 'whatsapp',
    color: '#25D366', // Green/Primary
  },
  {
    id: 'data_cleanup',
    title: 'Request Information',
    description: 'Request missing info',
    icon: 'account-question',
    color: '#9C27B0', // Purple/Tertiary
  },
  {
    id: 'mark_holiday',
    title: 'Update holiday status',
    description: 'Request holiday break',
    icon: 'beach',
    color: '#00BCD4', // Cyan
  },
  {
    id: 'announcement',
    title: 'Announcements',
    description: 'Send general updates',
    icon: 'bullhorn',
    color: '#FF9800', // Orange/Secondary
  },
];

export const generateInfoRequestUrl = async (
  tenantId: string,
): Promise<string | null> => {
  try {
    const { data, error } = await supabase.functions.invoke(
      'tenant-management/scan/request-info',
      {
        headers: getAuthStateSnapshot().session
          ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
          : undefined,
        body: { tenant_id: tenantId, skip_email: true },
      },
    );

    if (error) throw error;
    if (!data?.success || !data?.results?.[0]?.url) {
      throw new Error(data?.results?.[0]?.error || 'Failed to generate request link');
    }

    return data.results[0].url;
  } catch (error) {
    console.warn('Failed to generate info request token via Edge Function', error);
    return null;
  }
};

const generateholidayRequestUrl = async (tenantId: string): Promise<string | null> => {
  try {
    const { data, error } = await supabase.functions.invoke(
      'tenant-management/scan/mark-holiday',
      {
        headers: getAuthStateSnapshot().session
          ? { Authorization: `Bearer ${getAuthStateSnapshot().session?.access_token}` }
          : undefined,
        body: { tenant_id: tenantId, skip_email: true },
      },
    );

    if (error) throw error;
    if (!data?.success || !data?.results?.[0]?.url) {
      throw new Error(data?.results?.[0]?.error || 'Failed to generate holiday link');
    }

    return data.results[0].url;
  } catch (error) {
    console.warn('Failed to generate holiday request token via Edge Function', error);
    return null;
  }
};

/**
 * Collects data for template placeholder replacement
 */
const getPlaceholderData = async (
  tenant: Tenant,
  business: Business | null,
  defaultCurrency: Currency | null,
  extraData: Record<string, any> = {},
) => {
  const contract = tenant.contracts?.[0];
  const house = contract?.house;
  const businessName = business?.name || 'Property Management';
  const whatsappGroupLink = await getWhatsappGroupLink(business?.id || '');

  const targetDate =
    (extraData?.target_date as any) instanceof Date
      ? (extraData?.target_date as Date)
      : new Date();

  return {
    tenant_name: tenant.name || 'Tenant',
    business_name: businessName,
    business_phone: business?.phone || 'N/A',
    business_email: business?.email || 'N/A',
    business_address: business?.address || 'N/A',
    property_name: house?.property?.name || 'our property',
    house_number: house?.house_number || 'N/A',
    monthly_rent:
      defaultCurrency && contract
        ? formatWithCurrency(contract.rent_amount || 0, defaultCurrency)
        : 'N/A',
    pending_amount: defaultCurrency
      ? formatWithCurrency(
          tenant.pendingRentAmount ?? contract?.rent_amount ?? 0,
          defaultCurrency,
        )
      : (tenant.pendingRentAmount ?? contract?.rent_amount ?? 0),
    paid_amount: defaultCurrency
      ? formatWithCurrency(tenant.paidAmount || 0, defaultCurrency)
      : tenant.paidAmount || 0,
    current_month: targetDate.toLocaleString('default', {
      month: 'long',
      year: 'numeric',
    }),
    whatsapp_group_link: whatsappGroupLink || '',
    info_request_url: extraData?.info_request_url || '',
    holiday_request_url: extraData?.holiday_request_url || '',
    ...extraData,
  };
};

export const getMessageForCategory = async (
  category: ReminderCategoryType,
  tenant: Tenant,
  business: Business | null,
  defaultCurrency: Currency | null,
  channel: 'sms' | 'whatsapp' = 'sms', // Default to sms if not specified
  extraData: Record<string, any> = {},
): Promise<string> => {
  const finalExtraData = { ...extraData };

  if (
    (category === 'data_cleanup' || category === 'request_info') &&
    !finalExtraData.info_request_url &&
    tenant.id
  ) {
    const url = await generateInfoRequestUrl(tenant.id);
    if (url) {
      finalExtraData.info_request_url = url;
    }
  }

  if (category === 'mark_holiday' && !finalExtraData.holiday_request_url && tenant.id) {
    const url = await generateholidayRequestUrl(tenant.id);
    if (url) {
      finalExtraData.holiday_request_url = url;
    }
  }

  const templateName = category === 'request_info' ? 'data_cleanup' : category;
  const dbTemplate = business?.id
    ? await getMessageTemplate(business.id, templateName, channel)
    : null;
  const template = dbTemplate || getDefaultTemplate(templateName, channel);

  if (template) {
    const data = await getPlaceholderData(
      tenant,
      business,
      defaultCurrency,
      finalExtraData,
    );
    return replacePlaceholders(template.content, data);
  }

  return '';
};

// HTML Email Templates wrapper
const getHtmlTemplate = (content: string) =>
  `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">${content}</div>`;

export const getEmailForCategory = async (
  category: ReminderCategoryType,
  tenant: Tenant,
  business: Business | null,
  defaultCurrency: Currency | null,
  extraData: Record<string, any> = {},
): Promise<{ subject: string; body: string }> => {
  const finalExtraData = { ...extraData };
  if (
    (category === 'data_cleanup' || category === 'request_info') &&
    !finalExtraData.info_request_url &&
    tenant.id
  ) {
    const url = await generateInfoRequestUrl(tenant.id);
    if (url) {
      finalExtraData.info_request_url = url;
    }
  }

  if (category === 'mark_holiday' && !finalExtraData.holiday_request_url && tenant.id) {
    const url = await generateholidayRequestUrl(tenant.id);
    if (url) {
      finalExtraData.holiday_request_url = url;
    }
  }

  const templateName = category === 'request_info' ? 'data_cleanup' : category;
  const dbTemplate = business?.id
    ? await getMessageTemplate(business.id, templateName, 'email')
    : null;
  const template = dbTemplate || getDefaultTemplate(templateName, 'email');

  const data = await getPlaceholderData(
    tenant,
    business,
    defaultCurrency,
    finalExtraData,
  );

  const rawSubject = template?.title || `Message from {{business_name}}`;
  const subject = replacePlaceholders(rawSubject, data);
  const rawContent = template?.content ? replacePlaceholders(template.content, data) : '';

  let body = rawContent;
  if (template?.is_html) {
    const bodyHtml = plainToHtml(rawContent);
    body = getHtmlTemplate(bodyHtml);
  }

  return { subject, body };
};
