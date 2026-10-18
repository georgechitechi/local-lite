import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { OutboxStore } from '../src/core/outbox-store.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import { useLiveRow, useLiveInfiniteQuery, useMutations, SyncInspector } from '../src/react/index.js';

describe('local-lite Architectural Enhancements', () => {
  let db: MockDB;
  let remote: MemoryDemoRemoteAdapter;
  let network: DefaultNetworkStatusProvider;
  let client: LocalFirstClient;

  beforeEach(async () => {
    db = new MockDB();
    remote = new MemoryDemoRemoteAdapter(0);
    network = new DefaultNetworkStatusProvider(true);

    client = new LocalFirstClient({
      local: db,
      remote,
      network,
      autoStart: false,
      jsonColumns: {
        profiles: ['preferences', 'tags'],
      },
      syncScope: { organization_id: 'org-99' },
    });

    await client.initialize();
  });

  afterEach(() => {
    client.stop();
  });

  describe('Automatic JSON Column Hydration', () => {
    it('hydrates stringified JSON columns into native JS objects and arrays', () => {
      const row = {
        id: 'p1',
        name: 'Alice',
        preferences: JSON.stringify({ theme: 'dark', notifications: true }),
        tags: JSON.stringify(['developer', 'admin']),
      };

      const hydrated = client.hydrateRow('profiles', row);
      expect(hydrated.preferences).toEqual({ theme: 'dark', notifications: true });
      expect(hydrated.tags).toEqual(['developer', 'admin']);
      expect(hydrated.name).toBe('Alice');
    });

    it('safely retains non-JSON or invalid strings without throwing', () => {
      const row = {
        id: 'p2',
        preferences: 'plain text not json',
        tags: 12345,
      };

      const hydrated = client.hydrateRow('profiles', row);
      expect(hydrated.preferences).toBe('plain text not json');
      expect(hydrated.tags).toBe(12345);
    });

    it('automatically hydrates JSON columns on findById and findMany queries', async () => {
      await client.insert('profiles', {
        id: 'p3',
        name: 'Bob',
        preferences: JSON.stringify({ locale: 'en-US' }),
        tags: JSON.stringify(['tester']),
      });

      const found = await client.findById('profiles', 'p3');
      expect(found).not.toBeNull();
      expect(found.preferences).toEqual({ locale: 'en-US' });
      expect(found.tags).toEqual(['tester']);

      const many = await client.findMany('profiles');
      expect(many).toHaveLength(1);
      expect(many[0].preferences).toEqual({ locale: 'en-US' });
    });
  });

  describe('Multi-Row Outbox Batch Writes', () => {
    it('efficiently inserts multiple outbox records via OutboxStore.insertRecords', async () => {
      const ops = [
        { id: 'op-1', tableName: 'items', rowId: 'r1', operation: 'INSERT' as const, payload: { val: 1 }, timestamp: 100 },
        { id: 'op-2', tableName: 'items', rowId: 'r2', operation: 'UPDATE' as const, payload: { val: 2 }, timestamp: 101 },
        { id: 'op-3', tableName: 'items', rowId: 'r3', operation: 'DELETE' as const, payload: {}, timestamp: 102 },
      ];

      await OutboxStore.insertRecords(db, ops);

      const outbox = db.getAll('sync_outbox');
      expect(outbox).toHaveLength(3);
      expect(outbox.map((o) => o.id)).toEqual(['op-1', 'op-2', 'op-3']);
      expect(outbox.map((o) => o.table_name)).toEqual(['items', 'items', 'items']);
    });
  });

  describe('Scoped Remote Synchronization', () => {
    it('passes syncScope to remote.fetchChanges during delta pulls', async () => {
      const fetchSpy = vi.spyOn(remote, 'fetchChanges');
      await client.syncWorker.pullRemoteChanges();

      expect(fetchSpy).toHaveBeenCalledWith(0, { organization_id: 'org-99' });
    });

    it('supports dynamic callback syncScope and setSyncScope runtime update', async () => {
      let activeOrg = 'org-initial';
      client.setSyncScope(() => ({ organization_id: activeOrg }));

      const fetchSpy = vi.spyOn(remote, 'fetchChanges');
      await client.syncWorker.pullRemoteChanges();
      expect(fetchSpy).toHaveBeenLastCalledWith(0, { organization_id: 'org-initial' });

      // Update active organization
      activeOrg = 'org-updated';
      await client.syncWorker.pullRemoteChanges();
      expect(fetchSpy).toHaveBeenLastCalledWith(expect.any(Number), { organization_id: 'org-updated' });
    });
  });

  describe('Column Projections (options.select)', () => {
    it('only returns specified fields when select projection is passed', async () => {
      await client.insert('houses', 'h1', {
        house_number: 'A101',
        status: 'vacant',
        metadata: { notes: 'Large blob' },
        amenities: ['wifi', 'ac'],
      });

      const projected = await client.findMany('houses', {
        select: ['id', 'house_number', 'status'],
        where: { id: 'h1' },
      });

      expect(projected).toHaveLength(1);
      expect(projected[0]).toEqual({
        id: 'h1',
        house_number: 'A101',
        status: 'vacant',
      });
      expect(projected[0].metadata).toBeUndefined();
      expect(projected[0].amenities).toBeUndefined();
    });

    it('works inside client.transaction with transactional findMany', async () => {
      await client.insert('houses', 'h2', {
        house_number: 'B202',
        status: 'occupied',
        secret: 'hidden',
      });

      await client.transaction(async (tx) => {
        const results = await tx.findMany('houses', {
          select: ['id', 'house_number'],
          where: { id: 'h2' },
        });

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({ id: 'h2', house_number: 'B202' });
        expect(results[0].secret).toBeUndefined();
      });
    });
  });

  describe('Automatic Soft-Delete Omission', () => {
    beforeEach(async () => {
      await client.insert('items', 'active-1', { name: 'Active 1', deleted: 0 });
      await client.insert('items', 'active-2', { name: 'Active 2', deleted: null });
      await client.insert('items', 'deleted-1', { name: 'Deleted 1', deleted: 1 });
      await client.insert('items', 'deleted-2', { name: 'Deleted 2', deleted: true });
    });

    it('omits deleted: 1 and deleted: true records by default in findMany', async () => {
      const results = await client.findMany('items');
      const ids = results.map((r: any) => r.id);

      expect(ids).toContain('active-1');
      expect(ids).toContain('active-2');
      expect(ids).not.toContain('deleted-1');
      expect(ids).not.toContain('deleted-2');
    });

    it('returns deleted records when includeDeleted: true or explicit deleted where is passed', async () => {
      const all = await client.findMany('items', { includeDeleted: true });
      expect(all.map((r: any) => r.id)).toEqual(
        expect.arrayContaining(['active-1', 'active-2', 'deleted-1', 'deleted-2'])
      );

      const onlyDeleted = await client.findMany('items', { where: { deleted: 1 } });
      expect(onlyDeleted.map((r: any) => r.id)).toContain('deleted-1');
    });

    it('omits deleted records in findById and findByIds by default', async () => {
      expect(await client.findById('items', 'deleted-1')).toBeNull();
      expect(await client.findById('items', 'deleted-1', { includeDeleted: true })).toMatchObject({
        id: 'deleted-1',
      });

      const batched = await client.findByIds('items', ['active-1', 'deleted-1']);
      expect(batched.map((r: any) => r.id)).toEqual(['active-1']);

      const batchedWithDeleted = await client.findByIds('items', ['active-1', 'deleted-1'], {
        includeDeleted: true,
      });
      expect(batchedWithDeleted.map((r: any) => r.id)).toEqual(['active-1', 'deleted-1']);
    });
  });

  describe('React Exports & Component Availability', () => {
    it('exports useLiveRow, useLiveInfiniteQuery, useMutations, and SyncInspector', () => {
      expect(typeof useLiveRow).toBe('function');
      expect(typeof useLiveInfiniteQuery).toBe('function');
      expect(typeof useMutations).toBe('function');
      expect(typeof SyncInspector).toBe('function');
    });
  });
});
