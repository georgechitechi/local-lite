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
});
