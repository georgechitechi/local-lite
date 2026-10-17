import { getSyncClient } from '@/shared/services/sync/client';
import { properCase } from '@/shared/utils/helper';

interface Period {
  month: number;
  year: number;
}

interface MonthOption {
  label: string;
  value: number;
}

interface YearOption {
  label: string;
  value: number;
}

export const parseLocalDate = (date: string | Date): Date => {
  if (date instanceof Date) return date;
  if (typeof date === 'string') {
    if (date.includes('T') || /\s\d/.test(date)) {
      const d = new Date(date);
      if (!Number.isNaN(d.getTime())) return d;
    }

    const cleanDate = date.split('T')[0].trim();
    if (cleanDate.includes('-')) {
      const parts = cleanDate.split('-');
      if (parts.length >= 2) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parts[2] ? parseInt(parts[2], 10) : 1;
        const d = new Date(year, month, day);
        if (!Number.isNaN(d.getTime())) return d;
      }
    }
  }
  return new Date(date);
};

/** Noon local time for a calendar day so native date pickers do not shift to the previous UTC day. */
export const toLocalNoon = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);

export const formatMonthYear = (date: string | Date | null | undefined): string => {
  if (!date) return '';
  const d = parseLocalDate(date);
  if (Number.isNaN(d.getTime())) return '';
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
};

export const formatDate = (date: string | Date | null | undefined): string => {
  if (!date) return '';
  const d = parseLocalDate(date);
  if (Number.isNaN(d.getTime())) return 'Invalid Date';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export const formatDisplayDate = (date: string | Date | null | undefined): string => {
  if (!date) return '';
  const d = parseLocalDate(date);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

export const formatDateTime = (date: string | Date | null | undefined): string => {
  if (!date) return '';
  const d = parseLocalDate(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatTime = (date: string | Date | null | undefined): string => {
  if (!date) return '';
  const d =
    date instanceof Date
      ? date
      : new Date(date.includes(':') && !date.includes('T') ? `2000-01-01T${date}` : date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

export const formatDateForDB = (date: string | Date | null | undefined): string => {
  if (!date) return '';
  const d = parseLocalDate(date);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const formatCompactDateTime = (timestamp: number | string | Date): string => {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  const YYYY = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const HH = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${YYYY}${MM}${DD} ${HH}:${mm}`;
};

/**
 * Formats a start and end date as a readable date range string.
 * Example: formatDateRange('2026-01-01', '2026-12-31') -> "Jan 1, 2026 – Dec 31, 2026"
 */
export const formatDateRange = (
  startDate: string | Date | null | undefined,
  endDate: string | Date | null | undefined,
  separator: string = ' – ',
  fallback: string = 'N/A',
): string => {
  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  const isStartValid = startStr && startStr !== 'Invalid Date';
  const isEndValid = endStr && endStr !== 'Invalid Date';

  if (isStartValid && isEndValid) {
    return `${startStr}${separator}${endStr}`;
  }
  if (isStartValid) {
    return `From ${startStr}`;
  }
  if (isEndValid) {
    return `Until ${endStr}`;
  }
  return fallback;
};

export const parsePeriod = (period: any): { month: number; year: number } => {
  if (!period) return { month: 0, year: 0 };
  let obj = period;
  if (typeof period === 'string') {
    try {
      obj = JSON.parse(period);
    } catch {
      const date = new Date(period);
      if (!Number.isNaN(date.getTime())) {
        return { month: date.getMonth() + 1, year: date.getFullYear() };
      }
      return { month: 0, year: 0 };
    }
  }

  const month = Number(obj?.month ?? obj?.Month);
  const year = Number(obj?.year ?? obj?.Year);

  if (
    !Number.isNaN(month) &&
    !Number.isNaN(year) &&
    month >= 1 &&
    month <= 12 &&
    year > 0
  ) {
    return { month, year };
  }

  return { month: 0, year: 0 };
};

export const formatPeriod = (period: Period | string | null | undefined): string => {
  const parsed = parsePeriod(period);
  if (!parsed?.month || !parsed.year) return 'No period set';

  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  return `${months[parsed.month - 1]} ${parsed.year}`;
};

export const MONTHS: MonthOption[] = [
  { label: 'Jan', value: 1 },
  { label: 'Feb', value: 2 },
  { label: 'Mar', value: 3 },
  { label: 'Apr', value: 4 },
  { label: 'May', value: 5 },
  { label: 'Jun', value: 6 },
  { label: 'Jul', value: 7 },
  { label: 'Aug', value: 8 },
  { label: 'Sep', value: 9 },
  { label: 'Oct', value: 10 },
  { label: 'Nov', value: 11 },
  { label: 'Dec', value: 12 },
];

export const YEARS: YearOption[] = Array.from({ length: 5 }, (_, i) => ({
  label: `${new Date().getFullYear() - 2 + i}`,
  value: new Date().getFullYear() - 2 + i,
}));

export interface Currency {
  code: string;
  symbol: string;
  name: string;
  default: boolean;
}

export const defaultCurrencies: Currency[] = [
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', default: true },
  { code: 'USD', symbol: '$', name: 'US Dollar', default: false },
  { code: 'EUR', symbol: '€', name: 'Euro', default: false },
  { code: 'GBP', symbol: '£', name: 'British Pound', default: false },
];

export const getDefaultCurrency = async (businessId?: string): Promise<Currency> => {
  if (!businessId) return defaultCurrencies[0];
  try {
    const client = await getSyncClient();
    const settings = await client.findMany('settings', {
      where: { business_id: businessId, setting_key: 'currency_settings' },
    });
    const setting = settings.find(row => !row.deleted);
    if (setting?.setting_value) {
      let val = setting.setting_value;
      if (typeof val === 'string') {
        try {
          val = JSON.parse(val);
        } catch {}
      }
      if (Array.isArray(val)) {
        return val.find((c: any) => c.default) || defaultCurrencies[0];
      }
    }
  } catch {}
  return defaultCurrencies[0];
};

export const formatWithCurrency = (amount: number, currency: Currency): string => {
  if (!currency?.code) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  try {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch (_error) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      return `$${amount.toFixed(2)}`;
    }
  }
};

export const numberToWords = (num: number): string => {
  const ones = [
    '',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
  ];
  const tens = [
    '',
    '',
    'twenty',
    'thirty',
    'forty',
    'fifty',
    'sixty',
    'seventy',
    'eighty',
    'ninety',
  ];
  const teens = [
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
  ];

  const convertLessThanThousand = (n: number): string => {
    if (n === 0) return '';

    if (n < 10) return ones[n];

    if (n < 20) return teens[n - 10];

    if (n < 100) {
      return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? `-${ones[n % 10]}` : '');
    }

    return (
      ones[Math.floor(n / 100)] +
      ' hundred' +
      (n % 100 !== 0 ? ` and ${convertLessThanThousand(n % 100)}` : '')
    );
  };

  const capitalizeWord = (word: string): string => {
    return word
      .split('-')
      .map(part => properCase(part))
      .join('-');
  };

  if (num === 0) return 'Zero';

  let words = '';
  let remaining = num;

  if (remaining >= 1000000) {
    words += `${convertLessThanThousand(Math.floor(remaining / 1000000))} Million `;
    remaining %= 1000000;
  }

  if (remaining >= 1000) {
    words += `${convertLessThanThousand(Math.floor(remaining / 1000))} Thousand `;
    remaining %= 1000;
  }

  words += convertLessThanThousand(remaining);

  return words.trim().split(' ').map(capitalizeWord).join(' ');
};

// Returns an ordinal string like 1st, 2nd, 3rd, 4th ...
export const numberToOrdinal = (value: number | string): string => {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const mod100 = abs % 100;
  const mod10 = abs % 10;

  let suffix = 'th';
  if (mod100 < 11 || mod100 > 13) {
    if (mod10 === 1) suffix = 'st';
    else if (mod10 === 2) suffix = 'nd';
    else if (mod10 === 3) suffix = 'rd';
  }

  return `${n}${suffix}`;
};
