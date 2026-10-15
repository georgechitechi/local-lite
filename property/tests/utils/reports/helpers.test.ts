import {
  findEarliestContractDate,
  findEarliestDate,
  getAllTimeStartDate,
  getEffectiveDate,
  getPropertyName,
  groupDataByPeriod,
  groupDataByProperty,
  groupDataByStatus,
  isCommissionedAsOf,
  isReportAllTime,
  toLocalDateKey,
} from '@/features/reports/utils/helpers';

describe('Reports Helpers', () => {
  describe('getPropertyName', () => {
    it('returns "Not assigned" if property is falsy', () => {
      expect(getPropertyName(null)).toBe('Not assigned');
      expect(getPropertyName(undefined)).toBe('Not assigned');
    });

    it('returns first property name if property is an array', () => {
      expect(getPropertyName([{ name: 'Villa A' }, { name: 'Villa B' }])).toBe('Villa A');
    });

    it('returns "Unknown" if property array first element has no name', () => {
      expect(getPropertyName([{}])).toBe('Unknown');
    });

    it('returns "Not assigned" if property array is empty', () => {
      expect(getPropertyName([])).toBe('Not assigned');
    });

    it('returns name if property is an object', () => {
      expect(getPropertyName({ name: 'Sunset Apartments' })).toBe('Sunset Apartments');
    });

    it('returns "Not assigned" if property object has no name', () => {
      expect(getPropertyName({})).toBe('Not assigned');
    });
  });

  describe('groupDataByProperty', () => {
    it('groups data by property and inserts headers', () => {
      const data = [
        { id: 1, property: 'Prop A', amount: 100 },
        { id: 2, property: 'Prop A', amount: 200 },
        { id: 3, property: 'Prop B', amount: 300 },
      ];
      const result = groupDataByProperty(data);
      expect(result).toHaveLength(5);
      expect(result[0]).toEqual({
        isGroupHeader: true,
        property: 'Prop A',
        groupedBy: 'property',
      });
      expect(result[1]).toEqual(data[0]);
      expect(result[2]).toEqual(data[1]);
      expect(result[3]).toEqual({
        isGroupHeader: true,
        property: 'Prop B',
        groupedBy: 'property',
      });
      expect(result[4]).toEqual(data[2]);
    });
  });

  describe('isReportAllTime', () => {
    it('returns true if allTime is truthy', () => {
      expect(isReportAllTime({ allTime: true })).toBe(true);
    });

    it('returns false otherwise', () => {
      expect(isReportAllTime({})).toBe(false);
      expect(isReportAllTime(undefined)).toBe(false);
    });
  });

  describe('findEarliestDate', () => {
    it('returns null for empty array', () => {
      expect(findEarliestDate([], 'date')).toBeNull();
    });

    it('finds the earliest date from objects', () => {
      const items = [
        { date: '2023-05-10T00:00:00Z' },
        { date: '2023-01-01T00:00:00Z' },
        { date: '2024-10-15T00:00:00Z' },
      ];
      const earliest = findEarliestDate(items, 'date');
      expect(earliest).toBeInstanceOf(Date);
      expect(earliest?.toISOString()).toBe('2023-01-01T00:00:00.000Z');
    });
  });

  describe('getEffectiveDate', () => {
    it('prefers house metadata over property metadata and created_at', () => {
      const d = getEffectiveDate({
        created_at: '2020-01-01',
        metadata: { effective_date: '2024-06-15' },
        property: { metadata: { effective_date: '2023-01-01' } },
      });
      expect(toLocalDateKey(d as any)).toBe('2024-06-15');
    });

    it('falls back to property effective date then created_at', () => {
      const fromProp = getEffectiveDate({
        created_at: '2020-01-01',
        property: { metadata: { effective_date: '2023-03-10' } },
      });
      expect(toLocalDateKey(fromProp as any)).toBe('2023-03-10');

      const fromCreated = getEffectiveDate({ created_at: '2021-12-25' });
      expect(toLocalDateKey(fromCreated as any)).toBe('2021-12-25');
    });
  });

  describe('isCommissionedAsOf', () => {
    it('treats missing effective date as commissioned', () => {
      expect(isCommissionedAsOf({}, new Date(2026, 7, 20))).toBe(true);
    });

    it('includes the commissioning calendar day and excludes later days', () => {
      const house = { metadata: { effective_date: '2026-08-20' } };
      expect(isCommissionedAsOf(house, new Date(2026, 7, 20))).toBe(true);
      expect(isCommissionedAsOf(house, new Date(2026, 7, 19))).toBe(false);
    });
  });

  describe('findEarliestContractDate', () => {
    it('returns null if no houses or contracts', () => {
      expect(findEarliestContractDate([])).toBeNull();
      expect(findEarliestContractDate([{ contracts: [] }])).toBeNull();
    });

    it('finds earliest active contract date', () => {
      const houses = [
        {
          contracts: [
            { start_date: '2023-02-01', status: 'active' },
            { start_date: '2021-01-01', status: 'cancelled' }, // Should be ignored because not active
          ],
        },
        {
          contracts: [{ start_date: '2022-05-15', status: 'active' }],
        },
      ];
      const earliest = findEarliestContractDate(houses);
      expect(earliest).toBeInstanceOf(Date);
      expect(earliest?.toISOString().startsWith('2022-05-15')).toBe(true);
    });
  });

  describe('getAllTimeStartDate', () => {
    it('returns first of the month for provided date', () => {
      const input = new Date(2023, 4, 15); // May 15, 2023
      const result = getAllTimeStartDate(input);
      expect(result.getFullYear()).toBe(2023);
      expect(result.getMonth()).toBe(4);
      expect(result.getDate()).toBe(1);
    });

    it('returns Jan 1, 2000 if input is null', () => {
      const result = getAllTimeStartDate(null);
      expect(result.getFullYear()).toBe(2000);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(1);
    });
  });

  describe('groupDataByStatus', () => {
    it('groups data by status and sorts them alphabetically', () => {
      const data = [
        { id: 1, status: 'pending' },
        { id: 2, status: 'active' },
        { id: 3, status: 'pending' },
      ];
      const result = groupDataByStatus(data);
      // active should be first, then pending
      expect(result).toHaveLength(5);
      expect(result[0]).toEqual({
        isGroupHeader: true,
        property: 'Active',
        groupedBy: 'status',
      });
      expect(result[1]).toEqual(data[1]);
      expect(result[2]).toEqual({
        isGroupHeader: true,
        property: 'Pending',
        groupedBy: 'status',
      });
      expect(result[3]).toEqual(data[0]);
      expect(result[4]).toEqual(data[2]);
    });
  });

  describe('groupDataByPeriod', () => {
    it('groups data by period and inserts headers', () => {
      const data = [
        { id: 1, period: 'Jan 2023' },
        { id: 2, period: 'Jan 2023' },
        { id: 3, period: 'Feb 2023' },
      ];
      const result = groupDataByPeriod(data);
      expect(result).toHaveLength(5);
      expect(result[0]).toEqual({
        isGroupHeader: true,
        property: 'Jan 2023',
        groupedBy: 'period',
      });
      expect(result[1]).toEqual(data[0]);
      expect(result[2]).toEqual(data[1]);
      expect(result[3]).toEqual({
        isGroupHeader: true,
        property: 'Feb 2023',
        groupedBy: 'period',
      });
      expect(result[4]).toEqual(data[2]);
    });
  });
});
