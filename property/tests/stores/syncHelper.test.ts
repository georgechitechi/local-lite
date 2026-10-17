import Storage from 'expo-sqlite/kv-store';
import { safeReloadApp } from '@/shared/utils/safeReload';
import { clearAllPersistence } from '@/stores/syncHelper';

const mockExecute = jest.fn();
const mockStop = jest.fn();
jest.mock('@/shared/services/sync/client', () => ({
  getSyncClient: jest.fn(async () => ({
    tables: ['businesses', 'tenants'],
    stop: mockStop,
    reset: jest.fn(async ({ dropTables: _dropTables }: { dropTables?: boolean } = {}) => {
      mockStop();
      await mockExecute('DELETE FROM "businesses"');
      await mockExecute('DELETE FROM "tenants"');
      await mockExecute('DELETE FROM "sync_outbox"');
      await mockExecute('DELETE FROM "sync_meta"');
    }),
    resetSyncCursor: jest.fn(),
    events: { emit: jest.fn() },
    syncWorker: { start: jest.fn() },
    db: { transaction: async (fn: any) => fn({ execute: mockExecute }) },
  })),
}));
jest.mock('@/shared/utils/safeReload', () => ({ safeReloadApp: jest.fn() }));
jest.mock('expo-sqlite/kv-store', () => ({ clearAsync: jest.fn() }));
describe('clearAllPersistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecute.mockResolvedValue([]);
  });
  it('clears domain tables and sync metadata before reloading', async () => {
    await clearAllPersistence();
    expect(mockStop).toHaveBeenCalled();
    expect(mockExecute.mock.calls.map(args => args[0])).toEqual([
      'DELETE FROM "businesses"',
      'DELETE FROM "tenants"',
      'DELETE FROM "sync_outbox"',
      'DELETE FROM "sync_meta"',
    ]);
    expect(Storage.clearAsync).toHaveBeenCalled();
    expect(safeReloadApp).toHaveBeenCalled();
  });
  it('propagates database failures without reloading', async () => {
    mockExecute.mockRejectedValueOnce(new Error('disk failure'));
    await expect(clearAllPersistence()).rejects.toThrow('disk failure');
    expect(safeReloadApp).not.toHaveBeenCalled();
  });
});
