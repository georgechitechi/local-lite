export interface ProjectUser {
  id: string;
  email: string;
  display_name?: string;
  phone?: string;
  created_at: string;
  last_sign_in_at: string | null;
  is_banned: boolean;
  mgmt_role?: string;
}

export interface SecretItem {
  name: string;
  value: string;
  isCustom?: boolean;
  isEditing?: boolean;
  description?: string;
  required?: boolean;
  url?: string;
  group?: string;
  isPasswordVisible?: boolean;
  isAlreadyConfigured?: boolean;
}

export interface CommonKeyConfig {
  name: string;
  desc: string;
  req: boolean;
  url?: string;
  group: string;
}

export const COMMON_KEYS: CommonKeyConfig[] = [
  {
    name: 'APP_SECRET_KEY',
    desc: 'Application Secret Key for Edge Function',
    req: true,
    group: 'System Core',
  },
  {
    name: 'CENTRAL_URL',
    desc: 'Central Relay URL for messaging service',
    req: true,
    group: 'System Core',
  },
  {
    name: 'APP_URL',
    desc: 'Application URL for tenancy services',
    req: true,
    group: 'System Core',
  },
  {
    name: 'SMTP_HOSTNAME',
    desc: 'Custom SMTP Server Host (e.g. mail.yourdomain.com)',
    req: false,
    group: 'Custom Email (SMTP)',
  },
  {
    name: 'SMTP_PORT',
    desc: 'Custom SMTP Server Port (e.g. 465 or 587)',
    req: false,
    group: 'Custom Email (SMTP)',
  },
  {
    name: 'SMTP_USERNAME',
    desc: 'Custom SMTP Username/Email',
    req: false,
    group: 'Custom Email (SMTP)',
  },
  {
    name: 'SMTP_PASSWORD',
    desc: 'Custom SMTP Password',
    req: false,
    group: 'Custom Email (SMTP)',
  },
  {
    name: 'SMTP_FROM',
    desc: 'Custom Sender Email (e.g. alerts@yourdomain.com)',
    req: false,
    group: 'Custom Email (SMTP)',
  },
  {
    name: 'SMS_GATEWAY_URL',
    desc: 'Generic SMS Gateway URL (e.g. https://api.provider.com/v1/sms/send)',
    req: false,
    group: 'SMS Integration',
  },
  {
    name: 'SMS_GATEWAY_METHOD',
    desc: 'HTTP method for SMS gateway: POST or GET (default: POST)',
    req: false,
    group: 'SMS Integration',
  },
  {
    name: 'SMS_GATEWAY_HEADERS',
    desc: 'JSON HTTP headers (e.g. {"Authorization": "Bearer ..."})',
    req: false,
    group: 'SMS Integration',
  },
  {
    name: 'SMS_GATEWAY_BODY',
    desc: 'Custom payload template with {{to}}, {{message}}, {{from}} placeholders',
    req: false,
    group: 'SMS Integration',
  },
  {
    name: 'SMS_GATEWAY_FROM',
    desc: 'Default Sender ID / number for Generic SMS Gateway',
    req: false,
    group: 'SMS Integration',
  },
  {
    name: 'BACKUP_TARGET_EMAIL',
    desc: 'Target user email to map records to during disaster recovery',
    req: false,
    group: 'Database Backup & Disaster Recovery',
  },
];

export const BACKUP_PROJECT_STORAGE_KEY = 'supabase_backup_project_ref';

/** Extract project ref from a Supabase URL */
export const extractProjectRef = (url: string): string | null => {
  const m = url.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/);
  return m ? m[1] : null;
};

const DEFAULT_JWT_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.';

export const encodeConnectionKey = (u: string, k: string): string => {
  try {
    let urlPart = (u || '').trim();
    const refMatch = urlPart.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
    if (refMatch) {
      urlPart = refMatch[1];
    }

    let keyPart = (k || '').trim();
    if (keyPart.startsWith(DEFAULT_JWT_HEADER)) {
      keyPart = `@.${keyPart.substring(DEFAULT_JWT_HEADER.length)}`;
    }

    return btoa(`${urlPart}|${keyPart}`).replace(/=+$/, '');
  } catch {
    return '';
  }
};

export const decodeConnectionKey = (connKey: string): { u: string; k: string } => {
  try {
    let b64 = (connKey || '').trim();
    if (!b64) return { u: '', k: '' };

    while (b64.length % 4 !== 0) {
      b64 += '=';
    }

    const rawStr = atob(b64);
    const pipeIdx = rawStr.indexOf('|');
    if (pipeIdx === -1) return { u: '', k: '' };

    let urlPart = rawStr.substring(0, pipeIdx);
    let keyPart = rawStr.substring(pipeIdx + 1);

    if (!urlPart.includes('://')) {
      urlPart = `https://${urlPart}.supabase.co`;
    }

    if (keyPart.startsWith('@.')) {
      keyPart = DEFAULT_JWT_HEADER + keyPart.substring(2);
    }

    return { u: urlPart, k: keyPart };
  } catch {
    return { u: '', k: '' };
  }
};

/**
 * Generates a cryptographically strong 32-character secret key.
 */
export const generateSecureSecret = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    const array = new Uint8Array(32);
    globalThis.crypto.getRandomValues(array);
    return Array.from(array, byte => chars[byte % chars.length]).join('');
  }
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};
