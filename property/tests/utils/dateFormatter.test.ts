import {
  formatDate,
  formatDateForDB,
  formatDateTime,
  formatDisplayDate,
  formatMonthYear,
  formatPeriod,
  formatTime,
  parseLocalDate,
  toLocalNoon,
} from '@/shared/utils/formatters';

describe('dateFormatter utility', () => {
  describe('formatMonthYear', () => {
    it('returns empty string for null or undefined', () => {
      expect(formatMonthYear(null)).toBe('');
      expect(formatMonthYear(undefined)).toBe('');
    });

    it('formats a valid date string correctly', () => {
      expect(formatMonthYear('2023-05-15')).toBe('May 2023');
    });

    it('formats a valid Date object correctly', () => {
      const date = new Date(2023, 4, 15); // Month is 0-indexed
      expect(formatMonthYear(date)).toBe('May 2023');
    });

    it('returns empty string for invalid date string', () => {
      expect(formatMonthYear('invalid-date')).toBe('');
    });
  });

  describe('formatDate', () => {
    it('returns empty string for null or undefined', () => {
      expect(formatDate(null)).toBe('');
      expect(formatDate(undefined)).toBe('');
    });

    it('formats a valid date string correctly', () => {
      expect(formatDate('2023-05-15')).toBe('May 15, 2023');
    });

    it('returns "Invalid Date" for invalid date string', () => {
      expect(formatDate('invalid-date')).toBe('Invalid Date');
    });
  });

  describe('formatDisplayDate', () => {
    it('returns empty string for null or undefined', () => {
      expect(formatDisplayDate(null)).toBe('');
      expect(formatDisplayDate(undefined)).toBe('');
    });

    it('formats a valid date string correctly', () => {
      expect(formatDisplayDate('2023-05-15')).toBe('15 May 2023');
    });
  });

  describe('formatDateTime', () => {
    it('returns empty string for null or undefined', () => {
      expect(formatDateTime(null)).toBe('');
    });

    it('formats a valid date string correctly with time', () => {
      // Create a specific time to avoid timezone issues in testing
      const date = new Date(2023, 4, 15, 14, 30);
      const formatted = formatDateTime(date);
      expect(formatted).toContain('May 15, 2023');
      expect(formatted).toMatch(/2:30 PM/i);
    });
  });

  describe('formatTime', () => {
    it('returns empty string for null or undefined', () => {
      expect(formatTime(null)).toBe('');
    });

    it('formats a time string correctly', () => {
      expect(formatTime('14:30')).toMatch(/2:30 PM/i);
    });

    it('formats a Date object correctly', () => {
      const date = new Date(2023, 4, 15, 14, 30);
      expect(formatTime(date)).toMatch(/2:30 PM/i);
    });
  });

  describe('formatDateForDB', () => {
    it('returns empty string for null or undefined', () => {
      expect(formatDateForDB(null)).toBe('');
    });

    it('formats a valid date to YYYY-MM-DD', () => {
      expect(formatDateForDB('2023-05-15')).toBe('2023-05-15');
    });

    it('formats a valid Date object to YYYY-MM-DD', () => {
      const date = new Date(2023, 4, 5); // May 5th
      expect(formatDateForDB(date)).toBe('2023-05-05');
    });

    it('keeps the local calendar day at local midnight (not UTC)', () => {
      const date = new Date(2026, 7, 1, 0, 0, 0); // 1 Aug 2026 local
      expect(formatDateForDB(date)).toBe('2026-08-01');
      expect(formatDateForDB(toLocalNoon(date))).toBe('2026-08-01');
    });
  });

  describe('parseLocalDate', () => {
    it('parses YYYY-MM-DD as a local calendar date', () => {
      const d = parseLocalDate('2026-08-01');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(7);
      expect(d.getDate()).toBe(1);
    });
  });

  describe('formatPeriod', () => {
    it('returns "No period set" for null or incomplete period', () => {
      expect(formatPeriod(null)).toBe('No period set');
      expect(formatPeriod({ month: 5, year: 0 })).toBe('No period set');
      expect(formatPeriod({ month: 0, year: 2023 })).toBe('No period set');
    });

    it('formats a valid period correctly', () => {
      expect(formatPeriod({ month: 5, year: 2023 })).toBe('May 2023');
      expect(formatPeriod({ month: 12, year: 2024 })).toBe('Dec 2024');
    });
  });
});
