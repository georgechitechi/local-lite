import { getSyncClient } from '@/shared/services/sync/client';

export interface MessageTemplate {
  id: string;
  business_id: string;
  name: string;
  channel: 'sms' | 'email' | 'whatsapp';
  title?: string;
  content: string;
  is_html: boolean;
  metadata?: Record<string, any>;
  deleted?: boolean;
}

/**
 * Fetches a message template from local SQLite via local-lite
 * @param businessId The business ID
 * @param name The template name (e.g., 'payment', 'welcome')
 * @param channel The channel (e.g., 'sms', 'email')
 * @returns The message template or null if not found
 */
export async function getMessageTemplate(
  businessId: string,
  name: string,
  channel: 'sms' | 'email' | 'whatsapp',
): Promise<MessageTemplate | null> {
  try {
    const client = await getSyncClient();
    const rows = await client.findMany<MessageTemplate>('message_templates', {
      where: {
        business_id: businessId,
        name,
        channel,
        deleted: false,
      },
      limit: 1,
    });

    return rows && rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error('Unexpected error fetching template from local-lite:', err);
    return null;
  }
}

/**
 * Replaces placeholders in a template with actual values.
 * Supports whitespace inside brackets (e.g. {{ tenant_name }} and {{tenant_name}}).
 * @param template The template string
 * @param data The data object with replacement values
 * @returns The final formatted message
 */
export function replacePlaceholders(
  template: string,
  data: Record<string, string | number | null | undefined>,
): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_match, key) => {
    const val = data[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
}

export {
  getSmsSegmentInfo,
  type SmsSegmentInfo,
  sanitizeSmsText,
} from 'native-android-sms';

const ALL_CATEGORIES = [
  'payment',
  'welcome',
  'whatsapp_invite',
  'announcement',
  'data_cleanup',
  'mark_holiday',
];

export const PLACEHOLDERS = [
  {
    key: 'tenant_name',
    label: 'Tenant Name',
    mock: 'John Doe',
    categories: ALL_CATEGORIES,
  },
  {
    key: 'business_name',
    label: 'Business Name',
    mock: 'Sunshine Properties',
    categories: ALL_CATEGORIES,
  },
  {
    key: 'business_phone',
    label: 'Business Phone',
    mock: '+254 712 345 678',
    categories: ALL_CATEGORIES,
  },
  {
    key: 'business_email',
    label: 'Business Email',
    mock: 'info@sunshine.com',
    categories: ALL_CATEGORIES,
  },
  {
    key: 'business_address',
    label: 'Business Address',
    mock: '123 Main St, Nairobi',
    categories: ALL_CATEGORIES,
  },
  {
    key: 'property_name',
    label: 'Property Name',
    mock: 'The Heights',
    categories: ALL_CATEGORIES,
  },
  {
    key: 'house_number',
    label: 'House Number',
    mock: 'S-001',
    categories: ALL_CATEGORIES,
  },
  {
    key: 'current_month',
    label: 'Current Month',
    mock: 'August 2024',
    categories: ALL_CATEGORIES,
  },

  // Specific constraints for contextual placeholders
  {
    key: 'monthly_rent',
    label: 'Monthly Rent',
    mock: 'Ksh 12,000',
    categories: ['payment', 'welcome'],
  },
  {
    key: 'pending_amount',
    label: 'Pending Rent',
    mock: 'Ksh 4,000',
    categories: ['payment'],
  },
  {
    key: 'paid_amount',
    label: 'Paid Amount',
    mock: 'Ksh 8,000',
    categories: ['payment'],
  },
  {
    key: 'whatsapp_group_link',
    label: 'WhatsApp Group Link',
    mock: 'https://chat.whatsapp.com/sunshine',
    categories: ['whatsapp_invite'],
  },
  {
    key: 'info_request_url',
    label: 'Info Request URL',
    mock: 'https://sunshine.link/req',
    categories: ['data_cleanup'],
  },
  {
    key: 'holiday_request_url',
    label: 'Holiday Request URL',
    mock: 'https://sunshine.link/holiday',
    categories: ['mark_holiday'],
  },
  {
    key: 'announcement_body',
    label: 'Announcement Body',
    mock: 'Water supply interruption scheduled from 10 AM to 2 PM.',
    categories: ['announcement'],
  },
];

export interface TemplateDefinition {
  title: string;
  content: string;
  is_html: boolean;
}

export type TemplateChannel = 'sms' | 'email' | 'whatsapp';

/**
 * Canonical Single Source of Truth for all default communication templates across the application.
 * If template wording or defaults are changed, update here.
 */
export const DEFAULT_TEMPLATES: Record<
  TemplateChannel,
  Record<string, TemplateDefinition>
> = {
  sms: {
    payment: {
      title: 'Rent Payment Reminder',
      content:
        'Hi {{tenant_name}}, {{pending_amount}} rent for {{property_name}} {{house_number}} ({{current_month}}) at {{business_name}} is due. Call: {{business_phone}}.',
      is_html: false,
    },
    welcome: {
      title: 'Welcome Message',
      content:
        'Welcome {{tenant_name}} to {{property_name}} {{house_number}} at {{business_name}}! Rent is {{monthly_rent}}. Contact: {{business_phone}}.',
      is_html: false,
    },
    whatsapp_invite: {
      title: 'WhatsApp Group Invite',
      content:
        'Hi {{tenant_name}}, join the {{business_name}} tenant WhatsApp group for updates & notices: {{whatsapp_group_link}}',
      is_html: false,
    },
    data_cleanup: {
      title: 'Information Update Request',
      content:
        'Hi {{tenant_name}}, please update your tenant records for {{business_name}} here: {{info_request_url}}',
      is_html: false,
    },
    announcement: {
      title: 'Important Announcement',
      content:
        'Hi {{tenant_name}}, Announcement from {{business_name}}: {{announcement_body}}',
      is_html: false,
    },
    mark_holiday: {
      title: 'Holiday Update Request',
      content:
        'Hi {{tenant_name}}, are you traveling for the holidays? Please update your holiday plan here: {{holiday_request_url}}',
      is_html: false,
    },
  },
  whatsapp: {
    payment: {
      title: 'Rent Payment Reminder',
      content: `Dear *{{tenant_name}}*,

This is a friendly reminder that your rent payment for *{{current_month}}* is pending. 

*Payment Details:*
Amount Due: {{pending_amount}}
Property: {{property_name}}
House Number: {{house_number}}

Please make your payment as soon as possible.

If you have already made the payment, please send a confirmation to:
Phone: {{business_phone}}
Email: {{business_email}}

Best regards,
*{{business_name}} Team*`,
      is_html: false,
    },
    welcome: {
      title: 'Welcome Message',
      content: `Dear *{{tenant_name}}*,

Welcome to *{{property_name}}*! We're delighted to have you as our tenant at {{business_name}}.

*Your House Details:*
Property: {{property_name}}
House Number: {{house_number}}
Monthly Rent: {{monthly_rent}}

We hope you'll enjoy your stay. If you need any assistance, please don't hesitate to reach out.

*Contact Information:*
Phone: {{business_phone}}
Email: {{business_email}}
Address: {{business_address}}

Best regards,
*{{business_name}} Team*`,
      is_html: false,
    },
    whatsapp_invite: {
      title: 'WhatsApp Group Invite',
      content: `Dear *{{tenant_name}}*,

We invite you to join our community WhatsApp Group for {{business_name}}!

*Stay updated on:*
• Property announcements
• Maintenance schedules
• Important payment notices

Click here to join: 
{{whatsapp_group_link}}

*Your House Details:*
Property: {{property_name}}
House Number: {{house_number}}

If you have any questions, feel free to reach out.

Best regards,
*{{business_name}} Team*`,
      is_html: false,
    },
    data_cleanup: {
      title: 'Information Update Request',
      content: `Dear *{{tenant_name}}*,

We are updating our records and noticed that your contact information is missing or incomplete.

Please securely update your details using this link:
{{info_request_url}}

Thank you for your cooperation.

Best regards,
*{{business_name}} Team*`,
      is_html: false,
    },
    announcement: {
      title: 'Important Announcement',
      content: `Dear *{{tenant_name}}*,

*Important Announcement from {{business_name}}:*

{{announcement_body}}

Best regards,
*{{business_name}} Team*`,
      is_html: false,
    },
    mark_holiday: {
      title: 'Holiday Update Request',
      content: `Dear *{{tenant_name}}*,

Please let {{business_name}} know if you will be away during the holiday.

Update your holiday information here:
{{holiday_request_url}}

Best regards,
*{{business_name}} Team*`,
      is_html: false,
    },
  },
  email: {
    payment: {
      title: 'Rent Payment Reminder - {{current_month}}',
      content: `Dear **{{tenant_name}}**,

This is a friendly reminder that your rent payment for **{{current_month}}** is pending.

**Payment Details**
  **Amount Due:** {{pending_amount}}
  **Property:** {{property_name}}
  **House Number:** {{house_number}}

Please make the payment as soon as possible to avoid any late payment fees.

If you have already made the payment, please share the confirmation message.

Best regards,
**{{business_name}} Team**`,
      is_html: true,
    },
    welcome: {
      title: 'Welcome to {{property_name}}',
      content: `Dear **{{tenant_name}}**,

Welcome to **{{property_name}}** at {{business_name}}! We're delighted to have you as our tenant.

**Your House Details**
  **Property:** {{property_name}}
  **House Number:** {{house_number}}
  **Monthly Rent:** {{monthly_rent}}

We hope you'll enjoy your stay with us. If you need any assistance, please don't hesitate to reach out.

**Contact Information**
  **Phone:** {{business_phone}}
  **Email:** {{business_email}}
  **Address:** {{business_address}}

Best regards,
**{{business_name}} Team**`,
      is_html: true,
    },
    whatsapp_invite: {
      title: 'Join {{business_name}} WhatsApp Group',
      content: `Dear **{{tenant_name}}**,

We invite you to join our community WhatsApp Group for:
- Property updates and announcements
- Maintenance requests and updates
- Important notices and reminders

[Join WhatsApp Group]({{whatsapp_group_link}})

If the button above doesn't work, you can use this link: [{{whatsapp_group_link}}]({{whatsapp_group_link}})

Best regards,
**{{business_name}} Team**`,
      is_html: true,
    },
    data_cleanup: {
      title: 'Action Required: Update Contact Information',
      content: `Dear **{{tenant_name}}**,

We are currently updating our records and noticed some of your contact information is missing or incomplete.

**Action Required**

[Update Details Now]({{info_request_url}})

Or copy this link: [{{info_request_url}}]({{info_request_url}})

Thank you for your cooperation.

Best regards,
**{{business_name}} Team**`,
      is_html: true,
    },
    announcement: {
      title: 'Important Announcement from {{business_name}}',
      content: `Dear **{{tenant_name}}**,

**Important Announcement**

{{announcement_body}}

Best regards,
**{{business_name}} Team**`,
      is_html: true,
    },
    mark_holiday: {
      title: 'Update Your Holiday Information',
      content: `Dear **{{tenant_name}}**,

Please let {{business_name}} know if you will be away during the holiday.

[Update Holiday Dates]({{holiday_request_url}})

Or copy this link: [{{holiday_request_url}}]({{holiday_request_url}})

Best regards,
**{{business_name}} Team**`,
      is_html: true,
    },
  },
};

/**
 * Convenience accessor for SMS defaults
 */
export const DEFAULT_SMS_TEMPLATES: Record<string, { title: string; content: string }> =
  DEFAULT_TEMPLATES.sms;

export function getDefaultTemplate(
  name: string,
  channel: TemplateChannel,
): TemplateDefinition | null {
  const channelTemplates = DEFAULT_TEMPLATES[channel];
  if (!channelTemplates) return null;
  const tpl = channelTemplates[name];
  if (tpl) return tpl;
  return null;
}

// Strip HTML tags → plain text for editing but preserve markdown semantics
export function htmlToPlain(html: string): string {
  if (!html) return '';
  let plain = html
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '*$1*')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '*$1*')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '_$1_')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '_$1_')
    .replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)');

  // Convert both unordered and ordered lists
  plain = plain.replace(
    /<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi,
    (_, tag: string, content: string) => {
      let index = 1;
      return `\n${content.replace(/<li[^>]*>(.*?)<\/li>/gi, (__, liContent: string) =>
        tag.toLowerCase() === 'ol' ? `${index++}. ${liContent}\n` : `- ${liContent}\n`,
      )}\n`;
    },
  );

  // Preserve indentations via a temporary token (e.g., 2 spaces per 20px)
  plain = plain.replace(
    /<p[^>]*style="[^"]*margin-left:\s*(\d+)px[^"]*"[^>]*>(.*?)<\/p>/gi,
    (_match, margin, content) => {
      const spaces = Math.ceil(parseInt(margin, 10) / 10);
      return `\n__INTENTIONAL_INDENT__${spaces}__${content}\n`;
    },
  );

  plain = plain
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove style blocks entirely
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove script blocks entirely
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n\n')
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '*$1*\n\n') // headers to WhatsApp bold
    .replace(/<[^>]+>/g, '') // remove remaining HTML
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&copy;/g, '©');

  // Restore the indents and strip arbitrary HTML source spacing
  return plain
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      const match = trimmed.match(/^__INTENTIONAL_INDENT__(\d+)__(.*)/);
      if (match) {
        return ' '.repeat(parseInt(match[1], 10)) + match[2];
      }
      return trimmed;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // Normalize multiple blank lines to double
    .replace(/^\n+|\n+$/g, ''); // Trim only newlines at start/end to preserve indentation
}
// Plain text → HTML for sending emails (supports markdown-like bullets, numbering, bold, links, indents)
export function plainToHtml(text: string): string {
  if (!text) return '';
  const lines = text.split('\n');
  const htmlLines: string[] = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Process bold and italic and links
    const processedLine = line
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.*?)__/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/_(.*?)_/g, '<em>$1</em>')
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" style="color: #3498db; text-decoration: none;">$1</a>',
      );

    // Bullet lists
    if (/^[-*]\s/.test(trimmed)) {
      if (inOl) {
        htmlLines.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        htmlLines.push('<ul style="margin: 5px 0;">');
        inUl = true;
      }
      htmlLines.push(`  <li>${processedLine.trim().substring(2)}</li>`);
      continue;
    }

    // Numbered lists
    if (/^\d+\.\s/.test(trimmed)) {
      if (inUl) {
        htmlLines.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        htmlLines.push('<ol style="margin: 5px 0;">');
        inOl = true;
      }
      const content = processedLine.trim().replace(/^\d+\.\s/, '');
      htmlLines.push(`  <li>${content}</li>`);
      continue;
    }

    // Close lists if no longer in one
    if (inUl) {
      htmlLines.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      htmlLines.push('</ol>');
      inOl = false;
    }

    // Empty lines
    if (trimmed === '') {
      htmlLines.push('<br/>');
      continue;
    }

    // Indentation detection (line starts with spaces or tabs, not a list item)
    const paddingMatch = line.match(/^(\s+)/);
    if (paddingMatch && paddingMatch[1].length > 0) {
      // 1 space ~ 10px
      const paddingPixels = Math.min(paddingMatch[1].length * 10, 100);
      htmlLines.push(
        `<p style="margin-left: ${paddingPixels}px; margin-top: 5px; margin-bottom: 5px;">${processedLine.trim()}</p>`,
      );
      continue;
    }

    // Standard paragraph
    htmlLines.push(
      `<p style="margin-top: 5px; margin-bottom: 5px;">${processedLine}</p>`,
    );
  }

  if (inUl) {
    htmlLines.push('</ul>');
  }
  if (inOl) {
    htmlLines.push('</ol>');
  }

  return htmlLines.join('\n');
}
