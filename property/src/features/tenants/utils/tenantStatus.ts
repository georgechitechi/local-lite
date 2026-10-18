import type { BatchMutation, LocalFirstClient } from 'local-lite';
import { getSyncClient } from '@/shared/services/sync/client';
import { formatDateForDB } from '@/shared/utils/formatters';
import {
  isActiveContractStatus,
  isActiveTenantStatus,
  isFormerTenantStatus,
  resolveHouseStatusFromContracts,
} from '@/shared/utils/statusHelper';

export interface UpdateTenantStatusParams {
  client?: LocalFirstClient | null;
  tenantId: string;
  newStatus: string;
}

/**
 * Safely add months to a date without calendar-overflow bugs.
 * e.g. Jan 31 + 1 month stays in Feb (last day) instead of rolling to Mar.
 */
export const addMonths = (date: Date, months: number): Date => {
  const d = new Date(date);
  const targetMonth = d.getMonth() + months;
  d.setMonth(targetMonth);
  if (d.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    d.setDate(0);
  }
  return d;
};

const toDateString = (date: Date) => formatDateForDB(date);

/** Returns true when the status change represents moving a tenant out of active life. */
export const isDeactivation = (newStatus: string) =>
  isFormerTenantStatus(newStatus) || newStatus === 'blacklisted';

async function applyClientMutations(
  client: LocalFirstClient,
  tenantId: string,
  newStatus: string,
  previousStatus?: string,
): Promise<void> {
  const today = toDateString(new Date());
  const wasInactive = !isActiveTenantStatus(previousStatus);
  const isNowActive = isActiveTenantStatus(newStatus);

  const mutations: BatchMutation[] = [
    {
      tableName: 'tenants',
      operation: 'UPDATE',
      rowId: tenantId,
      payload: { status: newStatus },
    },
  ];

  if (isDeactivation(newStatus)) {
    const allContracts =
      (await client.findMany('contracts', { where: { tenant_id: tenantId } })) || [];
    const activeContracts = allContracts.filter(c => isActiveContractStatus(c.status));

    const houseIds = activeContracts
      .map(c => c.house_id)
      .filter((id): id is string => Boolean(id));
    const houses = await client.findByIds('houses', houseIds);
    const houseMap = new Map(houses.map((h: any) => [h.id, h]));

    for (const c of activeContracts) {
      mutations.push({
        tableName: 'contracts',
        operation: 'UPDATE',
        rowId: c.id,
        payload: { status: 'terminated', end_date: today },
      });

      if (c.house_id) {
        const houseContracts =
          (await client.findMany('contracts', {
            where: { house_id: c.house_id },
          })) || [];
        const remainingContracts = houseContracts.map(hc =>
          activeContracts.some(active => active.id === hc.id)
            ? { ...hc, status: 'terminated', end_date: today }
            : hc,
        );
        const house = houseMap.get(c.house_id);
        const resolvedStatus = resolveHouseStatusFromContracts(
          house?.status,
          remainingContracts,
          c.house_id,
        );
        mutations.push({
          tableName: 'houses',
          operation: 'UPDATE',
          rowId: c.house_id,
          payload: { status: resolvedStatus },
        });
      }
    }
  } else if (wasInactive && isNowActive) {
    const validContracts = allContracts;
    const latest = [...validContracts].sort((a, b) =>
      (b.end_date || b.start_date || '').localeCompare(a.end_date || a.start_date || ''),
    )[0];

    if (latest) {
      const newEndDate = toDateString(addMonths(new Date(), 3));
      mutations.push({
        tableName: 'contracts',
        operation: 'UPDATE',
        rowId: latest.id,
        payload: { status: 'active', end_date: newEndDate },
      });

      if (latest.house_id) {
        mutations.push({
          tableName: 'houses',
          operation: 'UPDATE',
          rowId: latest.house_id,
          payload: { status: 'occupied' },
        });
      }
    }
  }

  await client.batch(mutations);
}

/** Persist a tenant status change and its contract/house cascade as one batch. */
export const updateTenantStatus = async ({
  client: providedClient,
  tenantId,
  newStatus,
}: UpdateTenantStatusParams): Promise<void> => {
  if (!tenantId) throw new Error('Tenant ID is required');
  const client = providedClient ?? (await getSyncClient());
  const tenant = await client.findById('tenants', tenantId);
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
  await applyClientMutations(client, tenantId, newStatus, tenant.status);
};
