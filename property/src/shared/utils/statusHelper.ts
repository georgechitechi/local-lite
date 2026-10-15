/**
 * Status comparison utilities for consistent handling across the application
 */
import { formatDateForDB, parseLocalDate } from '@/shared/utils/formatters';
import { generateUUID, parseMetadata } from '@/shared/utils/helper';

export type HouseStatus = 'available' | 'occupied' | 'maintenance' | 'closed';

type StatusItem =
  | { status?: string | null; deleted?: boolean | null; [key: string]: any }
  | string
  | null
  | undefined;

const extractStatusAndDeleted = (item: StatusItem) => {
  if (typeof item === 'string' || item === null || item === undefined) {
    return { status: item, deleted: false };
  }
  return { status: item.status, deleted: item.deleted };
};

/**
 * Check if a contract status is considered "active"
 * Active statuses include: active, expiring_soon, and renewed
 * Automatically returns false if the item is deleted
 */
export const isActiveContractStatus = (item: StatusItem): boolean => {
  const { status, deleted } = extractStatusAndDeleted(item);
  if (deleted) return false;
  const s = status?.toLowerCase();
  return s === 'active' || s === 'expiring_soon' || s === 'renewed';
};

/**
 * Check if a contract status is considered "former"
 * Former statuses include: expired and terminated
 * Automatically returns false if the item is deleted
 */
export const isFormerContractStatus = (item: StatusItem): boolean => {
  const { status, deleted } = extractStatusAndDeleted(item);
  if (deleted) return false;
  const s = status?.toLowerCase();
  return s === 'expired' || s === 'terminated';
};

/**
 * Check if a tenant status is considered "active"
 * Active statuses include: active and expiring_soon
 * Automatically returns false if the item is deleted
 */
export const isActiveTenantStatus = (item: StatusItem): boolean => {
  const { status, deleted } = extractStatusAndDeleted(item);
  if (deleted) return false;
  const s = status?.toLowerCase();
  return s === 'active' || s === 'expiring_soon';
};

/**
 * Check if a tenant status is considered "former"
 * Uses an explicit allowlist so unknown/null statuses are not silently
 * bucketed as "former", which could hide data quality issues.
 * Automatically returns false if the item is deleted
 */
export const isFormerTenantStatus = (item: StatusItem): boolean => {
  const { status, deleted } = extractStatusAndDeleted(item);
  if (deleted) return false;
  const s = status?.toLowerCase();
  return s === 'former' || s === 'terminated' || s === 'expired' || s === 'inactive';
};

/**
 * Check if a schedule status is considered "active"
 */
export const isActiveScheduleStatus = (item: StatusItem): boolean => {
  const { status, deleted } = extractStatusAndDeleted(item);
  if (deleted) return false;
  return status?.toLowerCase() === 'active';
};

/**
 * Check if a business share status is considered "active"
 */
export const isActiveShareStatus = (item: StatusItem): boolean => {
  const { status, deleted } = extractStatusAndDeleted(item);
  if (deleted) return false;
  return status?.toLowerCase() === 'active';
};

export const isManualHouseStatus = (status?: string | null): boolean =>
  status === 'maintenance' || status === 'closed';

export const isHouseOccupiedByContracts = (
  contracts?: { status?: string | null; deleted?: boolean | null }[] | null,
): boolean => (contracts ?? []).some(c => isActiveContractStatus(c));

/**
 * Compute the display status for a house.
 * Active contracts take precedence over manual statuses.
 */
export const getHouseDisplayStatus = (house: {
  status?: string | null;
  contracts?: { status?: string | null; deleted?: boolean | null }[] | null;
}): HouseStatus => {
  if (isHouseOccupiedByContracts(house.contracts)) return 'occupied';
  if (isManualHouseStatus(house.status)) return house.status as HouseStatus;
  return 'available';
};

/**
 * Resolve house status from active contracts, preserving maintenance/closed when vacant.
 */
export const resolveHouseStatusFromContracts = (
  houseStatus: string | null | undefined,
  contracts: {
    house_id?: string | null;
    status?: string | null;
    deleted?: boolean | null;
  }[],
  houseId: string,
): HouseStatus => {
  const hasActive = contracts.some(
    c => c.house_id === houseId && isActiveContractStatus(c),
  );
  if (hasActive) return 'occupied';
  if (isManualHouseStatus(houseStatus)) return houseStatus as HouseStatus;
  return 'available';
};

export const getHouseStatusAfterContractEnds = (
  currentHouseStatus?: string | null,
): HouseStatus => {
  if (isManualHouseStatus(currentHouseStatus)) return currentHouseStatus as HouseStatus;
  return 'available';
};

export const canTransitionHouseStatus = (
  newStatus: string,
  options: { isOccupied: boolean; currentStatus?: string | null },
): boolean => {
  const { isOccupied, currentStatus } = options;
  if (newStatus === currentStatus) return false;
  if (isOccupied) return false;
  return ['available', 'maintenance', 'closed'].includes(newStatus);
};

export const buildHouseStatusMenuItems = (options: {
  house: { status?: string | null; contracts?: { status?: string | null }[] | null };
  colors: { success: string; primary: string; warning: string; error: string };
}) => {
  const { house, colors } = options;
  const isOccupied = isHouseOccupiedByContracts(house.contracts);
  const displayStatus = getHouseDisplayStatus(house);

  return [
    {
      id: 'available',
      title: 'Available',
      color: colors.success,
      disabled: isOccupied || displayStatus === 'available',
    },
    {
      id: 'occupied',
      title: 'Occupied',
      color: colors.primary,
      disabled: !isOccupied || displayStatus === 'occupied',
    },
    {
      id: 'maintenance',
      title: 'Maintenance',
      color: colors.warning,
      disabled: isOccupied || displayStatus === 'maintenance',
    },
    {
      id: 'closed',
      title: 'Closed',
      color: colors.error,
      disabled: isOccupied || displayStatus === 'closed',
    },
  ];
};

export const getPropertyHouseStats = (
  houses: {
    status?: string | null;
    contracts?: { status?: string | null; deleted?: boolean | null }[] | null;
  }[],
) => {
  const total = houses.length;
  const occupied = houses.filter(h => isHouseOccupiedByContracts(h.contracts)).length;
  const maintenance = houses.filter(
    h => !isHouseOccupiedByContracts(h.contracts) && h.status === 'maintenance',
  ).length;
  const closed = houses.filter(
    h => !isHouseOccupiedByContracts(h.contracts) && h.status === 'closed',
  ).length;
  const available = total - occupied - maintenance - closed;
  return { total, occupied, available, maintenance, closed };
};

export const getHouseOccupancyLabel = (
  displayStatus: string,
  tenantName?: string | null,
): string => {
  if (tenantName) return ` (${tenantName})`;
  if (displayStatus === 'maintenance') return ' (Maintenance)';
  if (displayStatus === 'closed') return ' (Closed)';
  return ' (Vacant)';
};

export const compareHouseNumbers = (a: string, b: string): number => {
  const aNum = parseInt(a.replace(/\D/g, ''), 10);
  const bNum = parseInt(b.replace(/\D/g, ''), 10);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
  return a.localeCompare(b, undefined, { numeric: true });
};

/**
 * Check if a contract is currently paused via an open-ended or ongoing Holiday Break
 */
export const isContractPaused = (
  contract: { metadata?: any } | null | undefined,
): boolean => {
  if (!contract) return false;
  const { breaks } = parseMetadata(contract.metadata);
  const today = formatDateForDB(new Date());
  return breaks.some(
    (b: any) => b.start_date <= today && (!b.end_date || b.end_date >= today),
  );
};

export const calculatePausedBreaks = (metadata: any, actionDate: string) => {
  const meta = parseMetadata(metadata);
  const breaks = meta.breaks || [];
  const newBreak = {
    id: generateUUID(),
    start_date: actionDate,
    end_date: '2099-12-31',
    is_partial: true,
    reason: 'Contract Paused',
    created_at: new Date().toISOString(),
  };
  return { ...meta, breaks: [...breaks, newBreak] };
};

export const calculateResumedBreaks = (metadata: any, actionDate: string) => {
  const meta = parseMetadata(metadata);
  const breaks = meta.breaks || [];

  const selectedDateStr = actionDate;
  const resumeDateObj = parseLocalDate(selectedDateStr);
  resumeDateObj.setDate(resumeDateObj.getDate() - 1);
  const breakEndDate = formatDateForDB(resumeDateObj);

  const updatedBreaks = breaks.map((b: any) => {
    if (
      b.end_date === '2099-12-31' ||
      (b.start_date <= selectedDateStr && b.end_date >= selectedDateStr)
    ) {
      return {
        ...b,
        end_date: breakEndDate,
        updated_at: new Date().toISOString(),
      };
    }
    return b;
  });

  return { ...meta, breaks: updatedBreaks };
};
