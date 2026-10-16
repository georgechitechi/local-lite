import { describe, it, expect, vi } from 'vitest';
import { SupabaseRemoteAdapter } from '../src/adapters/remote/supabase.js';

describe('SupabaseRemoteAdapter', () => {
  it('pushes mutations as upserts and handles soft deletes (deleted: true)', async () => {
    const upsertSpy = vi.fn().mockResolvedValue({ error: null });
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => ({
        upsert: upsertSpy,
        update: updateSpy,
      })),
    };

    const adapter = new SupabaseRemoteAdapter(mockSupabase as any, {
      tables: ['todos'],
      deletedColumn: 'deleted',
    });

    const success = await adapter.pushChanges([
      {
        id: 'op-1',
        tableName: 'todos',
        rowId: 'row-1',
        operation: 'INSERT',
        payload: { title: 'First Task' },
        timestamp: Date.now(),
      },
      {
        id: 'op-2',
        tableName: 'todos',
        rowId: 'row-1',
        operation: 'DELETE',
        payload: null,
        timestamp: Date.now(),
      },
    ]);

    expect(success).toBe(true);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'row-1',
        title: 'First Task',
        deleted: false,
      })
    );
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted: true,
      })
    );
  });

  it('fetches delta changes using updated_at cursor and extracts max server timestamp', async () => {
    const mockData = [
      { id: 't1', title: 'Task 1', updated_at: '2026-10-13T06:00:00.000Z', deleted: false },
      { id: 't2', title: 'Task 2', updated_at: '2026-10-13T06:05:00.000Z', deleted: true },
    ];

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          gt: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
          }),
        }),
      }),
    };

    const adapter = new SupabaseRemoteAdapter(mockSupabase as any, {
      tables: ['todos'],
      deletedColumn: 'deleted',
      updatedAtColumn: 'updated_at',
    });

    const sinceTs = new Date('2026-10-13T05:50:00.000Z').getTime();
    const result = await adapter.fetchChanges(sinceTs);

    expect(result.changes).toHaveLength(2);
    expect(result.changes[0].operation).toBe('UPDATE');
    expect(result.changes[1].operation).toBe('DELETE');
    expect(result.timestamp).toBe(new Date('2026-10-13T06:05:00.000Z').getTime());
  });

  it('safely handles null/uninitialized client without throwing Cannot read property channel of null', async () => {
    const adapter = new SupabaseRemoteAdapter(null, {
      tables: ['todos'],
    });

    // subscribeToLiveChanges must not throw when client is null
    expect(() => {
      const unsub = adapter.subscribeToLiveChanges(() => {});
      expect(typeof unsub).toBe('function');
      unsub!();
    }).not.toThrow();

    // pushChanges must return false instead of throwing
    const pushResult = await adapter.pushChanges([
      {
        id: 'op-1',
        tableName: 'todos',
        rowId: 'row-1',
        operation: 'INSERT',
        payload: { title: 'Test' },
        timestamp: Date.now(),
      },
    ]);
    expect(pushResult).toBe(false);

    // fetchChanges must return empty deltas instead of throwing
    const fetchResult = await adapter.fetchChanges(12345);
    expect(fetchResult.timestamp).toBe(12345);
    expect(fetchResult.changes).toEqual([]);

    // destroy must not throw
    expect(() => adapter.destroy()).not.toThrow();
  });

  it('supports dynamic client resolver function and setClient re-subscription', async () => {
    let currentClient: any = null;
    const channelOnSpy = vi.fn();
    const channelSubscribeSpy = vi.fn();
    const mockChannel = {
      on: channelOnSpy,
      subscribe: channelSubscribeSpy,
    };
    const removeChannelSpy = vi.fn();

    const mockSupabase = {
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: removeChannelSpy,
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
      }),
    };

    const adapter = new SupabaseRemoteAdapter(() => currentClient, {
      tables: ['todos', 'tasks'],
    });

    const liveCallback = vi.fn();
    // Subscribing when client resolves to null should not crash
    const unsub = adapter.subscribeToLiveChanges(liveCallback);
    expect(mockSupabase.channel).not.toHaveBeenCalled();

    // Now client is initialized
    currentClient = mockSupabase;
    adapter.setClient(() => currentClient);

    expect(mockSupabase.channel).toHaveBeenCalledWith('local_first_sync');
    expect(channelOnSpy).toHaveBeenCalledTimes(2); // once per table
    expect(channelSubscribeSpy).toHaveBeenCalledTimes(1);

    // Calling destroy cleans up channel
    adapter.destroy();
    expect(removeChannelSpy).toHaveBeenCalledWith(mockChannel);

    if (typeof unsub === 'function') unsub();
  });
});

