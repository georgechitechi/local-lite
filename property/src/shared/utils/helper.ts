import 'react-native-get-random-values';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { v4 as uuidv4 } from 'uuid';
import type { NextOfKin } from '@/shared/types/types';

export const generateUUID = () => uuidv4();

export const EMPTY_ARRAY: any[] = [];

export function properCase(str: string | null | undefined): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function toAllCaps(str: string | null | undefined): string {
  return (str || '').toUpperCase();
}

export function capitalizeEachWord(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(
    /\w\S*/g,
    txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(),
  );
}

export function toLowerCase(str: string | null | undefined): string {
  return (str || '').toLowerCase();
}

export function camelCase(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^(.)/, m => m.toLowerCase());
}

export function kebabCase(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

export function getInitial(str: string | null | undefined): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase();
}

export function snakeCaseToTitleCase(str: string | null | undefined): string {
  if (!str) return '';
  return capitalizeEachWord(str.replace(/_/g, ' '));
}

export function safeParseJSON<T = Record<string, unknown>>(
  value: string | T | null | undefined,
  fallback: T = {} as T,
): T {
  if (!value) return fallback;
  if (typeof value !== 'string') return value as T;

  if (value === '{}') return {} as T;
  if (value === '[]') return [] as unknown as T;
  if (value === 'null') return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseMetadata(
  metadata: string | Record<string, unknown> | null | undefined,
): {
  breaks: any[];
  [key: string]: unknown;
} {
  const parsed = safeParseJSON<Record<string, unknown>>(metadata as any);
  return { breaks: [], ...parsed };
}

export const getPrimaryNextOfKin = (
  nextOfKin: NextOfKin[] | null | undefined,
): NextOfKin | null => {
  if (!Array.isArray(nextOfKin) || nextOfKin.length === 0) {
    return null;
  }

  const primary = nextOfKin.find(kin => kin.is_primary === true);
  if (primary) {
    return primary;
  }

  return nextOfKin[0];
};

export function extractAmount(text: string | null | undefined): number | undefined {
  if (!text) return undefined;

  const prefixRegex =
    /(?:Ksh|KES|KSH|kes|USD|EUR|GBP|Amount|Total|Sum|Value|Price|Received|Sent|Paid|Amt|[$€£])[\s.:-]*([\d,]+(?:\.\d{2,3})?)/i;
  const suffixRegex = /([\d,]+(?:\.\d{2})?)[\s]*(?:KES|Ksh|KSH|kes|USD|EUR|GBP)/i;
  const fallbackRegex = /([\d,]+\.\d{2})(?:\s|$)/;

  let match = text.match(prefixRegex);
  if (!match) {
    match = text.match(suffixRegex);
  }
  if (!match) {
    match = text.match(fallbackRegex);
  }

  if (match) {
    const amountStr = (match[1] || match[0]).replace(/,/g, '').trim();
    const amount = parseFloat(amountStr);
    if (!Number.isNaN(amount) && amount > 0) {
      return amount;
    }
  }

  return undefined;
}

/**
 * Preserves array reference if nothing is filtered out — prevents React re-render loops.
 */
export function filterArrayRef<T>(arr: T[], keepFn: (item: T) => boolean): T[];
export function filterArrayRef<T>(
  arr: T[] | undefined,
  keepFn: (item: T) => boolean,
): T[] | undefined;
export function filterArrayRef<T>(
  arr: T[] | undefined,
  keepFn: (item: T) => boolean,
): T[] | undefined {
  if (!arr) return arr;
  const filtered = arr.filter(keepFn);
  return filtered.length === arr.length ? arr : filtered;
}

/**
 * Calculates effective rent for a month considering holiday breaks.
 * Partial breaks prorate rent by occupied days; full breaks waive it entirely.
 */
export function calculateEffectiveRent(
  baseRent: number,
  month: number, // 1-indexed (1-12)
  year: number,
  breaks: any[],
): { effectiveRent: number; isOnFullBreak: boolean; daysOnBreak: number } {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const totalDaysInMonth = monthEnd.getDate();

  let daysOnBreak = 0;
  let hasFullWaiver = false;

  const partialIntervals: { start: number; end: number }[] = [];

  breaks.forEach(b => {
    if (!b?.start_date) return;
    const parseBreakDate = (d: any): Date => {
      if (d instanceof Date) return d;
      const s = String(d).split('T')[0].trim();
      if (s.includes('-')) {
        const parts = s.split('-').map(Number);
        return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
      }
      return new Date(d);
    };

    const breakStart = parseBreakDate(b.start_date);
    const breakEnd =
      !b.end_date || String(b.end_date).includes('2099')
        ? new Date(2099, 11, 31)
        : parseBreakDate(b.end_date);

    if (breakStart <= monthEnd && breakEnd >= monthStart) {
      if (b.is_partial) {
        partialIntervals.push({
          start: Math.max(breakStart.getTime(), monthStart.getTime()),
          end: Math.min(breakEnd.getTime(), monthEnd.getTime()),
        });
      } else {
        hasFullWaiver = true;
      }
    }
  });

  if (partialIntervals.length > 0) {
    partialIntervals.sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const iv of partialIntervals) {
      if (merged.length === 0 || iv.start > merged[merged.length - 1].end) {
        merged.push({ ...iv });
      } else {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, iv.end);
      }
    }
    for (const iv of merged) {
      daysOnBreak += Math.round((iv.end - iv.start) / (1000 * 60 * 60 * 24)) + 1;
    }
  }

  if (hasFullWaiver) {
    return { effectiveRent: 0, isOnFullBreak: true, daysOnBreak: totalDaysInMonth };
  }

  if (daysOnBreak > 0) {
    const daysOccupied = Math.max(0, totalDaysInMonth - daysOnBreak);
    const calculatedRent = (baseRent * daysOccupied) / totalDaysInMonth;
    const effectiveRent = Math.floor(calculatedRent / 100) * 100;

    return {
      effectiveRent,
      isOnFullBreak: daysOccupied === 0,
      daysOnBreak: Math.min(daysOnBreak, totalDaysInMonth),
    };
  }

  return {
    effectiveRent: baseRent,
    isOnFullBreak: false,
    daysOnBreak: 0,
  };
}

/**
 * Normalizes a phone number to E.164 international format (Kenyan default).
 */
export function normalizePhoneNumber(
  phone: string | null | undefined,
  defaultCountry: any = 'KE',
): string {
  if (!phone) return '';

  const cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned) return '';

  const phoneNumber = parsePhoneNumberFromString(cleaned, defaultCountry);

  if (phoneNumber?.isValid()) {
    return phoneNumber.format('E.164');
  }

  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

/**
 * Safely adds opacity to a color string (hex, rgb, or rgba).
 */
export function addOpacity(color: string, opacity: number): string {
  if (!color) return 'rgba(0,0,0,0)';
  if (color.startsWith('rgba')) {
    return color.replace(/,\s*[\d.]+\s*\)$/, `,${opacity})`);
  }
  if (color.startsWith('rgb')) {
    return color.replace('rgb', 'rgba').replace(')', `, ${opacity})`);
  }
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map(c => c + c)
        .join('');
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return color;
}

/**
 * Masks phone numbers within a text string.
 * Example: "254700012340" -> "2547000***40"
 */
export function maskPhoneNumber(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\b(\+?254[17]\d{3}|0[17]\d{3})(\d{3})(\d{2})\b/g, '$1***$3');
}

/**
 * Groups items by a key extractor and returns only groups with duplicates.
 */
export function findDuplicateGroups<T>(
  items: T[],
  keyExtractor: (item: T) => string | null | undefined,
): T[][] {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyExtractor(item);
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return Object.values(groups).filter(g => g.length > 1);
}

/**
 * Formats unformatted decimal amounts missing thousands separators within a text string.
 * Example: "Received 3000.00 KES" -> "Received 3,000.00 KES"
 */
export function formatAmountsInText(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\b(\d+)(\.\d{2})\b/g, (match, intPart, decPart) => {
    if (intPart.length >= 4) {
      return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + decPart;
    }
    return match;
  });
}

/**
 * Checks whether a text string contains unformatted decimal amounts missing thousands separators.
 */
export function hasUnformattedAmount(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\b\d{4,}\.\d{2}\b/.test(text);
}
