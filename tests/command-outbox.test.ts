import { describe, expect, it } from 'vitest';
import { createCommandOutbox } from '../src/core/command-outbox.js';
import type { LocalDBAdapter, LocalTransaction } from '../src/adapters/local/index.js';

function createMemorySqlAdapter(): LocalDBAdapter {
  const tables = new Map<string, Map<string, Record<string, any>>>();
  const getTable = (name: string) => {
    const clean = name.replace(/[`"]/g, '');
    let t = tables.get(clean);
    if (!t) {
      t = new Map();
      tables.set(clean, t);
    }
    return t;
  };

  const exec = async (sql: string, params: any[] = []): Promise<any[]> => {
    if (sql.startsWith('CREATE TABLE')) return [];
    if (sql.startsWith('SELECT * FROM')) {
      const m = sql.match(/FROM\s+[`"]?(\w+)[`"]?\s+WHERE\s+id\s*=\s*\?/i);
      if (m) {
        const row = getTable(m[1]).get(String(params[0]));
        return row ? [{ ...row }] : [];
      }
    }
    if (sql.startsWith('SELECT id, cmd')) {
      const m = sql.match(/FROM\s+[`"]?(\w+)[`"]?/i);
      if (m) return [...getTable(m[1]).values()].sort((a, b) => a.created_at - b.created_at);
    }
    if (sql.startsWith('INSERT INTO') || sql.startsWith('INSERT OR REPLACE INTO')) {
      const m = sql.match(/INTO\s+[`"]?(\w+)[`"]?\s*\(([^)]+)\)/i);
      if (m) {
        const cols = m[2].split(',').map((c) => c.trim().replace(/[`"]/g, ''));
        const row: Record<string, any> = {};
        cols.forEach((c, i) => (row[c] = params[i]));
        getTable(m[1]).set(String(row.id), row);
      }
      return [];
    }
    if (sql.startsWith('UPDATE')) {
      const m = sql.match(/UPDATE\s+[`"]?(\w+)[`"]?\s+SET\s+(.+?)\s+WHERE\s+id\s*=\s*\?/i);
      if (m) {
        const t = getTable(m[1]);
        const id = String(params[params.length - 1]);
        const existing = t.get(id);
        if (existing) {
          const cols = m[2].split(',').map((s) => s.split('=')[0].trim().replace(/[`"]/g, ''));
          cols.forEach((c, i) => (existing[c] = params[i]));
        }
      }
      return [];
    }
    if (sql.startsWith('DELETE FROM')) {
      const m = sql.match(/FROM\s+[`"]?(\w+)[`"]?\s+WHERE\s+id\s*=\s*\?/i);
      if (m) getTable(m[1]).delete(String(params[0]));
      return [];
    }
    return [];
  };

  return {
    execute: exec,
    transaction: async <T>(fn: (tx: LocalTransaction) => Promise<T>) => fn({ execute: exec }),
  };
}

describe('CommandOutbox (optimistic apply, rollback & rebase)', () => {
  it('applies optimistic patches, rolls back rejected command, and rebases remaining queue', async () => {
    const db = createMemorySqlAdapter();
    const rejections: any[] = [];
    const committed: any[] = [];

    const fetchMock: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.args?.title === 'Bad') {
        return new Response(
          JSON.stringify({ rejected: true, code: 'INVALID', error: 'Bad title' }),
          { status: 409 },
        );
      }
      return new Response(
        JSON.stringify({ success: true, result: { ok: true }, checkpoint: 10 }),
        { status: 200 },
      );
    };

    const outbox = createCommandOutbox({
      db,
      url: 'http://localhost:3000',
      fetch: fetchMock,
      onRejection: (r) => rejections.push(r),
      onCommitted: (c) => committed.push(c),
    });

    await outbox.enqueue('notes/create', { title: 'Bad' }, [
      { op: 'insert', table: 'notes', row: { id: 'n1', title: 'Bad' } },
    ]);
    await outbox.enqueue('notes/create', { title: 'Good' }, [
      { op: 'insert', table: 'notes', row: { id: 'n2', title: 'Good' } },
    ]);

    // Both optimistic rows exist locally before flush
    expect(await db.execute('SELECT * FROM notes WHERE id = ? LIMIT 1', ['n1'])).toHaveLength(1);
    expect(await db.execute('SELECT * FROM notes WHERE id = ? LIMIT 1', ['n2'])).toHaveLength(1);

    const res = await outbox.flush();
    expect(res).toEqual({ committed: 1, rejected: 1, remaining: 0 });
    expect(rejections).toHaveLength(1);
    expect(rejections[0].code).toBe('INVALID');
    expect(committed).toHaveLength(1);

    // Rejected n1 was rolled back; rebased n2 remains!
    expect(await db.execute('SELECT * FROM notes WHERE id = ? LIMIT 1', ['n1'])).toHaveLength(0);
    expect(await db.execute('SELECT * FROM notes WHERE id = ? LIMIT 1', ['n2'])).toHaveLength(1);
  });
});
