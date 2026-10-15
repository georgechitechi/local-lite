import type { LocalFirstClient } from 'local-lite';
import { addMonths, updateTenantStatus } from '@/features/tenants/utils/tenantStatus';

jest.mock('@/shared/services/sync/client', () => ({ getSyncClient: jest.fn() }));
function clientFor(status: string, contracts: any[] = []) {
  return {
    findById: jest.fn(async (table: string) =>
      table === 'tenants' ? { id: 't1', status } : { id: 'h1', status: 'occupied' },
    ),
    findMany: jest.fn(async () => contracts),
    batch: jest.fn().mockResolvedValue([]),
  };
}
describe('tenant status local-lite mutations', () => {
  it('preserves end-of-month when adding months', () => {
    expect(addMonths(new Date(2025, 0, 31), 1).getDate()).toBe(28);
  });
  it('persists deactivation and cascades all active contracts in one batch', async () => {
    const client = clientFor('active', [
      { id: 'c1', tenant_id: 't1', house_id: 'h1', status: 'active' },
    ]);
    await updateTenantStatus({
      client: client as unknown as LocalFirstClient,
      tenantId: 't1',
      newStatus: 'former',
    });
    expect(client.batch).toHaveBeenCalledTimes(1);
    expect(client.batch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ tableName: 'tenants', payload: { status: 'former' } }),
        expect.objectContaining({
          tableName: 'contracts',
          rowId: 'c1',
          payload: expect.objectContaining({ status: 'terminated' }),
        }),
        expect.objectContaining({
          tableName: 'houses',
          rowId: 'h1',
          payload: { status: 'available' },
        }),
      ]),
    );
  });
  it('does not reactivate contracts for an already active tenant', async () => {
    const client = clientFor('active');
    await updateTenantStatus({
      client: client as unknown as LocalFirstClient,
      tenantId: 't1',
      newStatus: 'active',
    });
    expect(client.findMany).not.toHaveBeenCalled();
    expect(client.batch).toHaveBeenCalledWith([
      {
        tableName: 'tenants',
        operation: 'UPDATE',
        rowId: 't1',
        payload: { status: 'active' },
      },
    ]);
  });
  it('reactivates only the latest contract for an inactive tenant', async () => {
    const client = clientFor('former', [
      { id: 'old', end_date: '2024-01-01' },
      { id: 'new', end_date: '2025-01-01', house_id: 'h1' },
    ]);
    await updateTenantStatus({
      client: client as unknown as LocalFirstClient,
      tenantId: 't1',
      newStatus: 'active',
    });
    expect(client.batch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ tableName: 'contracts', rowId: 'new' }),
        expect.objectContaining({ tableName: 'houses', payload: { status: 'occupied' } }),
      ]),
    );
  });
  it('propagates persistence failure to the screen', async () => {
    const client = clientFor('active');
    client.batch.mockRejectedValueOnce(new Error('write failed'));
    await expect(
      updateTenantStatus({
        client: client as unknown as LocalFirstClient,
        tenantId: 't1',
        newStatus: 'active',
      }),
    ).rejects.toThrow('write failed');
  });
  it('rejects a missing tenant before mutating', async () => {
    const client = clientFor('active');
    client.findById.mockResolvedValueOnce(null as any);
    await expect(
      updateTenantStatus({
        client: client as unknown as LocalFirstClient,
        tenantId: 'missing',
        newStatus: 'active',
      }),
    ).rejects.toThrow('not found');
    expect(client.batch).not.toHaveBeenCalled();
  });
});
