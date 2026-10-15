import {
  buildHouseStatusMenuItems,
  canTransitionHouseStatus,
  compareHouseNumbers,
  getHouseDisplayStatus,
  getHouseOccupancyLabel,
  getHouseStatusAfterContractEnds,
  getPropertyHouseStats,
  isActiveContractStatus,
  isActiveTenantStatus,
  isContractPaused,
  isFormerContractStatus,
  isFormerTenantStatus,
  isHouseOccupiedByContracts,
  isManualHouseStatus,
  resolveHouseStatusFromContracts,
} from '@/shared/utils/statusHelper';

describe('statusHelper Utility', () => {
  describe('isActiveContractStatus', () => {
    it('returns true for active statuses', () => {
      expect(isActiveContractStatus('active')).toBe(true);
      expect(isActiveContractStatus('expiring_soon')).toBe(true);
      expect(isActiveContractStatus('renewed')).toBe(true);
      // Case insensitive
      expect(isActiveContractStatus('ACTIVE')).toBe(true);
    });

    it('returns false for other statuses', () => {
      expect(isActiveContractStatus('expired')).toBe(false);
      expect(isActiveContractStatus('terminated')).toBe(false);
      expect(isActiveContractStatus(null)).toBe(false);
      expect(isActiveContractStatus(undefined)).toBe(false);
    });
  });

  describe('isFormerContractStatus', () => {
    it('returns true for former statuses', () => {
      expect(isFormerContractStatus('expired')).toBe(true);
      expect(isFormerContractStatus('terminated')).toBe(true);
    });

    it('returns false for active statuses', () => {
      expect(isFormerContractStatus('active')).toBe(false);
      expect(isFormerContractStatus(null)).toBe(false);
    });
  });

  describe('isActiveTenantStatus', () => {
    it('returns true for active statuses', () => {
      expect(isActiveTenantStatus('active')).toBe(true);
      expect(isActiveTenantStatus('expiring_soon')).toBe(true);
    });

    it('returns false for former statuses', () => {
      expect(isActiveTenantStatus('former')).toBe(false);
      expect(isActiveTenantStatus('inactive')).toBe(false);
      expect(isActiveTenantStatus(null)).toBe(false);
    });
  });

  describe('isFormerTenantStatus', () => {
    it('returns true for former statuses', () => {
      expect(isFormerTenantStatus('former')).toBe(true);
      expect(isFormerTenantStatus('terminated')).toBe(true);
      expect(isFormerTenantStatus('expired')).toBe(true);
      expect(isFormerTenantStatus('inactive')).toBe(true);
    });

    it('returns false for active statuses and null', () => {
      expect(isFormerTenantStatus('active')).toBe(false);
      expect(isFormerTenantStatus(null)).toBe(false);
      expect(isFormerTenantStatus('unknown')).toBe(false);
    });
  });

  describe('isContractPaused', () => {
    beforeAll(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2023-10-15T12:00:00Z'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    it('returns true if contract has an active break', () => {
      expect(
        isContractPaused({
          metadata: {
            breaks: [{ start_date: '2023-10-10', end_date: '2023-10-20' }],
          },
        }),
      ).toBe(true);
    });

    it('returns false if contract has no active break', () => {
      expect(
        isContractPaused({
          metadata: {
            breaks: [{ start_date: '2023-01-01', end_date: '2023-01-10' }],
          },
        }),
      ).toBe(false);
    });

    it('handles stringified metadata', () => {
      expect(
        isContractPaused({
          metadata: JSON.stringify({
            breaks: [{ start_date: '2023-10-15', end_date: '2099-12-31' }],
          }),
        }),
      ).toBe(true);
    });

    it('returns false for null or missing metadata', () => {
      expect(isContractPaused(null)).toBe(false);
      expect(isContractPaused({ metadata: null })).toBe(false);
    });
  });

  describe('isManualHouseStatus', () => {
    it('returns true for manual statuses', () => {
      expect(isManualHouseStatus('maintenance')).toBe(true);
      expect(isManualHouseStatus('closed')).toBe(true);
    });

    it('returns false for other statuses', () => {
      expect(isManualHouseStatus('available')).toBe(false);
      expect(isManualHouseStatus('occupied')).toBe(false);
    });
  });

  describe('isHouseOccupiedByContracts', () => {
    it('returns true if any active contract exists', () => {
      expect(
        isHouseOccupiedByContracts([
          { status: 'expired', deleted: false },
          { status: 'active', deleted: false },
        ]),
      ).toBe(true);
    });

    it('returns false if all active contracts are deleted', () => {
      expect(isHouseOccupiedByContracts([{ status: 'active', deleted: true }])).toBe(
        false,
      );
    });

    it('returns false if no contracts exist or null', () => {
      expect(isHouseOccupiedByContracts([])).toBe(false);
      expect(isHouseOccupiedByContracts(null)).toBe(false);
      expect(isHouseOccupiedByContracts(undefined)).toBe(false);
    });
  });

  describe('getHouseDisplayStatus', () => {
    it('returns occupied if it has active contracts', () => {
      expect(
        getHouseDisplayStatus({
          status: 'maintenance',
          contracts: [{ status: 'active' }],
        }),
      ).toBe('occupied');
    });

    it('returns manual status if vacant', () => {
      expect(
        getHouseDisplayStatus({
          status: 'maintenance',
          contracts: [],
        }),
      ).toBe('maintenance');
    });

    it('returns available if no active contracts and no manual status', () => {
      expect(
        getHouseDisplayStatus({
          status: null,
          contracts: null,
        }),
      ).toBe('available');
    });
  });

  describe('resolveHouseStatusFromContracts', () => {
    it('returns occupied if house has active contract', () => {
      expect(
        resolveHouseStatusFromContracts(
          'available',
          [{ house_id: '1', status: 'active', deleted: false }],
          '1',
        ),
      ).toBe('occupied');
    });

    it('returns house status if no active contract', () => {
      expect(
        resolveHouseStatusFromContracts(
          'maintenance',
          [{ house_id: '1', status: 'expired', deleted: false }],
          '1',
        ),
      ).toBe('maintenance');
    });
  });

  describe('getHouseStatusAfterContractEnds', () => {
    it('preserves manual statuses', () => {
      expect(getHouseStatusAfterContractEnds('maintenance')).toBe('maintenance');
      expect(getHouseStatusAfterContractEnds('closed')).toBe('closed');
    });

    it('defaults to available otherwise', () => {
      expect(getHouseStatusAfterContractEnds('occupied')).toBe('available');
      expect(getHouseStatusAfterContractEnds(null)).toBe('available');
    });
  });

  describe('canTransitionHouseStatus', () => {
    it('prevents transition to current status', () => {
      expect(
        canTransitionHouseStatus('available', {
          isOccupied: false,
          currentStatus: 'available',
        }),
      ).toBe(false);
    });

    it('prevents transition if occupied', () => {
      expect(
        canTransitionHouseStatus('maintenance', {
          isOccupied: true,
          currentStatus: 'available',
        }),
      ).toBe(false);
    });

    it('allows valid transitions', () => {
      expect(
        canTransitionHouseStatus('maintenance', {
          isOccupied: false,
          currentStatus: 'available',
        }),
      ).toBe(true);
    });
  });

  describe('getPropertyHouseStats', () => {
    it('computes correct statistics', () => {
      const houses = [
        { contracts: [{ status: 'active' }] }, // Occupied
        { status: 'maintenance' }, // Maintenance
        { status: 'closed' }, // Closed
        { status: 'available' }, // Available
        { contracts: [{ status: 'expired' }] }, // Available (contract expired)
      ];

      const stats = getPropertyHouseStats(houses);
      expect(stats).toEqual({
        total: 5,
        occupied: 1,
        maintenance: 1,
        closed: 1,
        available: 2,
      });
    });
  });

  describe('getHouseOccupancyLabel', () => {
    it('returns tenant name if provided', () => {
      expect(getHouseOccupancyLabel('occupied', 'John Doe')).toBe(' (John Doe)');
    });

    it('returns maintenance label', () => {
      expect(getHouseOccupancyLabel('maintenance')).toBe(' (Maintenance)');
    });

    it('returns vacat label', () => {
      expect(getHouseOccupancyLabel('available')).toBe(' (Vacant)');
    });
  });

  describe('buildHouseStatusMenuItems', () => {
    it('builds menu items correctly', () => {
      const colors = {
        success: 'green',
        primary: 'blue',
        warning: 'yellow',
        error: 'red',
      };
      const house = { status: 'available' };

      const items = buildHouseStatusMenuItems({ house, colors });
      expect(items).toHaveLength(4);
      expect(items[0]).toEqual({
        id: 'available',
        title: 'Available',
        color: 'green',
        disabled: true, // displayStatus is available
      });
      expect(items[1].disabled).toBe(true); // not occupied
    });
  });

  describe('compareHouseNumbers', () => {
    it('sorts numerically if possible', () => {
      expect(compareHouseNumbers('2', '10')).toBeLessThan(0); // 2 < 10
      expect(compareHouseNumbers('A10', 'A2')).toBeGreaterThan(0); // 10 > 2
    });

    it('falls back to localeCompare for non-numeric', () => {
      expect(compareHouseNumbers('A', 'B')).toBeLessThan(0);
    });
  });
});
