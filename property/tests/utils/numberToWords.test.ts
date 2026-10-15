import { numberToOrdinal, numberToWords } from '@/shared/utils/formatters';

describe('numberToWords Utility', () => {
  describe('numberToWords', () => {
    it('returns "Zero" for 0', () => {
      expect(numberToWords(0)).toBe('Zero');
    });

    it('formats single digit numbers', () => {
      expect(numberToWords(5)).toBe('Five');
      expect(numberToWords(9)).toBe('Nine');
    });

    it('formats teens correctly', () => {
      expect(numberToWords(11)).toBe('Eleven');
      expect(numberToWords(15)).toBe('Fifteen');
    });

    it('formats tens correctly', () => {
      expect(numberToWords(20)).toBe('Twenty');
      expect(numberToWords(45)).toBe('Forty-Five');
      expect(numberToWords(99)).toBe('Ninety-Nine');
    });

    it('formats hundreds correctly', () => {
      expect(numberToWords(100)).toBe('One Hundred');
      expect(numberToWords(105)).toBe('One Hundred And Five');
      expect(numberToWords(999)).toBe('Nine Hundred And Ninety-Nine');
    });

    it('formats thousands correctly', () => {
      expect(numberToWords(1000)).toBe('One Thousand');
      expect(numberToWords(1001)).toBe('One Thousand One');
      expect(numberToWords(1500)).toBe('One Thousand Five Hundred');
      expect(numberToWords(1525)).toBe('One Thousand Five Hundred And Twenty-Five');
      expect(numberToWords(10000)).toBe('Ten Thousand');
      expect(numberToWords(999999)).toBe(
        'Nine Hundred And Ninety-Nine Thousand Nine Hundred And Ninety-Nine',
      );
    });

    it('formats millions correctly', () => {
      expect(numberToWords(1000000)).toBe('One Million');
      expect(numberToWords(1500000)).toBe('One Million Five Hundred Thousand');
    });
  });

  describe('numberToOrdinal', () => {
    it('handles 1, 2, 3 properly', () => {
      expect(numberToOrdinal(1)).toBe('1st');
      expect(numberToOrdinal(2)).toBe('2nd');
      expect(numberToOrdinal(3)).toBe('3rd');
    });

    it('handles 4 through 20 properly with "th"', () => {
      expect(numberToOrdinal(4)).toBe('4th');
      expect(numberToOrdinal(11)).toBe('11th');
      expect(numberToOrdinal(12)).toBe('12th');
      expect(numberToOrdinal(13)).toBe('13th');
      expect(numberToOrdinal(20)).toBe('20th');
    });

    it('handles numbers above 20 properly', () => {
      expect(numberToOrdinal(21)).toBe('21st');
      expect(numberToOrdinal(22)).toBe('22nd');
      expect(numberToOrdinal(23)).toBe('23rd');
      expect(numberToOrdinal(24)).toBe('24th');
      expect(numberToOrdinal(101)).toBe('101st');
      expect(numberToOrdinal(111)).toBe('111th');
      expect(numberToOrdinal(112)).toBe('112th');
    });

    it('handles string numbers', () => {
      expect(numberToOrdinal('5')).toBe('5th');
    });

    it('returns empty string for invalid numbers', () => {
      expect(numberToOrdinal('abc')).toBe('');
      expect(numberToOrdinal(NaN)).toBe('');
    });
  });
});
