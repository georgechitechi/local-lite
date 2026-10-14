import { LocalDBAdapter, LocalTransaction } from '../../src/adapters/local/index.js';

export class MockDB implements LocalDBAdapter {
  private tables: Map<string, Map<string, any>> = new Map();

  getTable(name: string): Map<string, any> {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
    return this.tables.get(name)!;
  }

  async execute(query: string, params: any[] = []): Promise<any[]> {
    const q = query.trim();
    const normQ = q.replace(/\s+/g, ' ');
    const lowerQ = normQ.toLowerCase();

    if (q.startsWith('CREATE TABLE')) {
      const match = normQ.match(/CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?/i);
      if (match) this.getTable(match[1]);
      return [];
    }

    if (q.startsWith('ALTER TABLE') || q.startsWith('PRAGMA table_info')) {
      return [];
    }

    // sync_meta queries
    if (lowerQ.includes('from sync_meta where key = ?')) {
      const key = params[0];
      const row = this.getTable('sync_meta').get(key);
      return row ? [{ value: row.value }] : [];
    }

    if (lowerQ.includes('into sync_meta')) {
      const [key, value] = params;
      this.getTable('sync_meta').set(key, { key, value });
      return [];
    }

    if (lowerQ.includes('delete from sync_meta')) {
      this.getTable('sync_meta').delete('last_synced_at');
      return [];
    }

    // Select all rows from table
    const selectAllMatch = q.match(/^SELECT \* FROM "?(\w+)"?$/i);
    if (selectAllMatch) {
      const table = selectAllMatch[1];
      return Array.from(this.getTable(table).values());
    }

    // Select 1 from table where id = ?
    const select1Match = normQ.match(/SELECT 1 FROM "?(\w+)"? WHERE "?(\w+)"? = \?/i);
    if (select1Match) {
      const table = select1Match[1];
      const id = params[0];
      const rows = this.getTable(table);
      return rows.has(id) ? [{ 1: 1 }] : [];
    }

    // Outbox find pending by row
    if (normQ.includes('FROM sync_outbox WHERE table_name = ? AND row_id = ?')) {
      const rows = Array.from(this.getTable('sync_outbox').values());
      const filtered = rows.filter(
        (r) => r.table_name === params[0] && r.row_id === params[1] && r.status !== 'FAILED'
      );
      filtered.sort((a, b) => b.timestamp - a.timestamp);
      return filtered.slice(0, 1);
    }

    // Outbox get pending
    if (normQ.includes('FROM sync_outbox') && normQ.includes("status = 'PENDING'")) {
      const maxRetries = params[0];
      const rows = Array.from(this.getTable('sync_outbox').values());
      const pending = rows.filter(
        (r) => r.status === 'PENDING' || (r.status === 'FAILED' && r.retry_count < maxRetries)
      );
      pending.sort((a, b) => a.timestamp - b.timestamp);
      return pending.slice(0, 50);
    }

    // Select single row
    const selectRowMatch = q.match(/SELECT \* FROM "?(\w+)"? WHERE "?(\w+)"? = \?/i);
    if (selectRowMatch) {
      const table = selectRowMatch[1];
      const id = params[0];
      const rows = this.getTable(table);
      const row = rows.get(id);
      return row ? [row] : [];
    }

    // Insert into sync_outbox
    if (q.startsWith('INSERT INTO sync_outbox')) {
      const [id, table_name, row_id, operation, payload, timestamp] = params;
      this.getTable('sync_outbox').set(id, {
        id,
        table_name,
        row_id,
        operation,
        payload,
        timestamp,
        status: 'PENDING',
        retry_count: 0,
      });
      return [];
    }

    // Generic Insert
    const insertMatch = q.match(/INSERT INTO "?(\w+)"?\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (insertMatch) {
      const table = insertMatch[1];
      const cols = insertMatch[2].split(',').map((c) => c.trim().replace(/"/g, ''));
      const obj: any = {};
      cols.forEach((c, idx) => {
        obj[c] = params[idx];
      });
      const id = obj.id || params[0];
      this.getTable(table).set(id, obj);
      return [];
    }

    // Select id from sync_outbox where status = 'FAILED'
    if (lowerQ.startsWith('select') && lowerQ.includes('from sync_outbox') && lowerQ.includes("status = 'failed'")) {
      const rows = Array.from(this.getTable('sync_outbox').values());
      return rows.filter((r) => r.status === 'FAILED').map((r) => ({ id: r.id }));
    }

    // Reset sync_outbox status = 'PENDING'
    if (normQ.includes("UPDATE sync_outbox SET status = 'PENDING'")) {
      const rows = Array.from(this.getTable('sync_outbox').values());
      for (const r of rows) {
        if (params && params.length > 0) {
          if (params.includes(r.id)) {
            r.status = 'PENDING';
            r.retry_count = 0;
            r.last_error = null;
          }
        } else if (r.status === 'FAILED') {
          r.status = 'PENDING';
          r.retry_count = 0;
          r.last_error = null;
        }
      }
      return [];
    }

    // Delete failed records from sync_outbox
    if (lowerQ.includes('delete from sync_outbox') && lowerQ.includes("status = 'failed'")) {
      if (params && params.length > 0) {
        for (const id of params) {
          this.getTable('sync_outbox').delete(id);
        }
      } else {
        const rows = Array.from(this.getTable('sync_outbox').values());
        for (const r of rows) {
          if (r.status === 'FAILED') {
            this.getTable('sync_outbox').delete(r.id);
          }
        }
      }
      return [];
    }

    // Update sync_outbox status = 'PROCESSING'
    if (q.includes("UPDATE sync_outbox SET status = 'PROCESSING'")) {
      for (const id of params) {
        const item = this.getTable('sync_outbox').get(id);
        if (item) item.status = 'PROCESSING';
      }
      return [];
    }

    // Update sync_outbox status = 'FAILED'
    if (q.includes('UPDATE sync_outbox') && q.includes("status = 'FAILED'")) {
      const errMsg = params[0];
      const ids = params.slice(1);
      for (const id of ids) {
        const item = this.getTable('sync_outbox').get(id);
        if (item) {
          item.status = 'FAILED';
          item.retry_count = (item.retry_count || 0) + 1;
          item.last_error = errMsg;
        }
      }
      return [];
    }

    // Generic Update
    const updateMatch = q.match(/UPDATE "?(\w+)"?\s*SET\s*([^W]+)WHERE\s*"?(\w+)"?\s*=\s*\?/i);
    if (updateMatch) {
      const table = updateMatch[1];
      const setClauses = updateMatch[2]
        .split(',')
        .map((s) => s.trim().split('=')[0].trim().replace(/"/g, ''));
      const id = params[params.length - 1];
      const current = this.getTable(table).get(id) || { id };
      setClauses.forEach((col, idx) => {
        current[col] = params[idx];
      });
      this.getTable(table).set(id, current);
      return [];
    }

    // Delete from sync_outbox
    if (q.startsWith('DELETE FROM sync_outbox')) {
      for (const id of params) {
        this.getTable('sync_outbox').delete(id);
      }
      return [];
    }

    // Generic Delete
    const deleteMatch = q.match(/DELETE FROM "?(\w+)"?\s*WHERE\s*"?(\w+)"?\s*=\s*\?/i);
    if (deleteMatch) {
      const table = deleteMatch[1];
      const id = params[0];
      this.getTable(table).delete(id);
      return [];
    }

    // Unconditional DELETE FROM
    const deleteEntireTableMatch = q.match(/^DELETE FROM "?(\w+)"?;?$/i);
    if (deleteEntireTableMatch) {
      const table = deleteEntireTableMatch[1];
      this.getTable(table).clear();
      return [];
    }

    // DROP TABLE IF EXISTS
    const dropTableMatch = q.match(/^DROP TABLE (?:IF EXISTS )?"?(\w+)"?;?$/i);
    if (dropTableMatch) {
      const table = dropTableMatch[1];
      this.tables.delete(table);
      return [];
    }

    return [];
  }

  async transaction<T>(action: (tx: LocalTransaction) => Promise<T>): Promise<T> {
    const snapshot = new Map<string, Map<string, any>>();
    for (const [tName, map] of this.tables.entries()) {
      snapshot.set(tName, new Map(Array.from(map.entries()).map(([k, v]) => [k, { ...v }])));
    }

    try {
      const tx: LocalTransaction = {
        execute: (q: string, params?: any[]) => this.execute(q, params),
      };
      return await action(tx);
    } catch (err) {
      this.tables = snapshot;
      throw err;
    }
  }

  getAll(table: string): any[] {
    return Array.from(this.getTable(table).values());
  }

  clear(): void {
    this.tables.clear();
  }
}
