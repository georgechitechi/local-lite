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

    if (q.startsWith('CREATE TABLE') || q.startsWith('CREATE VIRTUAL TABLE')) {
      const match = normQ.match(/CREATE (?:VIRTUAL )?TABLE (?:IF NOT EXISTS )?"?(w+)"?/i);
      if (match) this.getTable(match[1]);
      return [];
    }
    if (q.startsWith('CREATE TABLE')) {
      const match = normQ.match(/CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?/i);
      if (match) this.getTable(match[1]);
      return [];
    }

    if (q.startsWith('ALTER TABLE') || q.startsWith('PRAGMA table_info') || q.startsWith('CREATE INDEX')) {
      return [];
    }

    
    // KV: keys listing (SELECT key FROM _local_kv WHERE expires_at IS NULL OR expires_at > ?)
    if (lowerQ.includes('from _local_kv') && lowerQ.includes('expires_at is null or expires_at > ?')) {
      const now = Number(params[0] || Date.now());
      const rows = Array.from(this.getTable('_local_kv').values());
      const active = rows.filter((r) => r.expires_at == null || Number(r.expires_at) > now);
      return active.map((r) => ({ key: r.key }));
    }

    // KV: prune expired (DELETE FROM _local_kv WHERE expires_at IS NOT NULL AND expires_at <= ?)
    if (lowerQ.includes('delete from _local_kv where expires_at is not null and expires_at <= ?')) {
      const now = Number(params[0] || Date.now());
      for (const [k, row] of this.getTable('_local_kv').entries()) {
        if (row.expires_at != null && Number(row.expires_at) <= now) {
          this.getTable('_local_kv').delete(k);
        }
      }
      return [];
    }

    // FTS: search match query
    if (lowerQ.includes('match ?')) {
      const matchIdx = normQ.match(/FROM\s+"?(_fts_\w+)"?\s+WHERE/i);
      const tableName = matchIdx ? matchIdx[1] : null;
      if (tableName) {
        const queryTerm = String(params[0] || '').replace(/["*]/g, '').toLowerCase().trim();
        const rows = Array.from(this.getTable(tableName).values());
        const matched = rows.filter((r) => {
          const combined = Object.values(r).map(String).join(' ').toLowerCase();
          return combined.includes(queryTerm);
        });
        const limit = params[1] ?? 20;
        const offset = params[2] ?? 0;
        return matched.slice(offset, offset + limit).map((r, idx) => ({
          row_id: r.row_id || r.id,
          rank: -1 * (100 - idx),
          snippet_text: 'Match: <mark>' + queryTerm + '</mark>',
        }));
      }
      return [];
    }

    // Scheduler: get due jobs
    if (lowerQ.includes('from _local_scheduled_jobs') && lowerQ.includes('enabled = 1 and next_run_at <= ?')) {
      const now = Number(params[0] || Date.now());
      const rows = Array.from(this.getTable('_local_scheduled_jobs').values());
      const due = rows.filter((r) => (r.enabled === 1 || r.enabled === true) && Number(r.next_run_at ?? r.nextRunAt) <= now);
      due.sort((a, b) => Number(a.next_run_at) - Number(b.next_run_at));
      return due;
    }

    // Scheduler: update schedule
    if (lowerQ.includes('update _local_scheduled_jobs set last_run_at = ?')) {
      const [lastRunAt, nextRunAt, id] = params;
      const row = this.getTable('_local_scheduled_jobs').get(id);
      if (row) {
        row.last_run_at = lastRunAt;
        row.next_run_at = nextRunAt;
      }
      return [];
    }

    // Scheduler: set enabled
    if (lowerQ.includes('update _local_scheduled_jobs set enabled = ? where id = ?')) {
      const [enabled, id] = params;
      const row = this.getTable('_local_scheduled_jobs').get(id);
      if (row) {
        row.enabled = enabled;
      }
      return [];
    }

    // Scheduler: run start
    if (lowerQ.includes('insert into _local_job_runs')) {
      const [id, job_id, status, started_at] = params;
      this.getTable('_local_job_runs').set(id, {
        id,
        job_id,
        status,
        started_at,
        finished_at: null,
        duration_ms: null,
        error: null,
      });
      return [];
    }

    // Scheduler: run finish
    if (lowerQ.includes('update _local_job_runs set status = ?')) {
      const [status, finished_at, duration_ms, error, id] = params;
      const row = this.getTable('_local_job_runs').get(id);
      if (row) {
        row.status = status;
        row.finished_at = finished_at;
        row.duration_ms = duration_ms;
        row.error = error;
      }
      return [];
    }

    // Scheduler: get runs
    if (lowerQ.includes('from _local_job_runs')) {
      const rows = Array.from(this.getTable('_local_job_runs').values());
      if (lowerQ.includes('where job_id = ?')) {
        const jobId = params[0];
        const limit = params[1] || 50;
        const filtered = rows.filter((r) => r.job_id === jobId);
        filtered.sort((a, b) => Number(b.started_at) - Number(a.started_at));
        return filtered.slice(0, limit);
      }
      const limit = params[0] || 50;
      rows.sort((a, b) => Number(b.started_at) - Number(a.started_at));
      return rows.slice(0, limit);
    }

    // Blobs: list by status
    if (lowerQ.includes('from _local_blobs where status = ?')) {
      const status = params[0];
      const rows = Array.from(this.getTable('_local_blobs').values());
      const filtered = rows.filter((r) => r.status === status);
      filtered.sort((a, b) => Number(b.created_at) - Number(a.created_at));
      return filtered;
    }

    // Blobs: update status
    if (lowerQ.includes('update _local_blobs set status = ?')) {
      if (lowerQ.includes('remote_url = ?')) {
        const [status, remote_url, updated_at, id] = params;
        const row = this.getTable('_local_blobs').get(id);
        if (row) {
          row.status = status;
          row.remote_url = remote_url;
          row.updated_at = updated_at;
        }
      } else {
        const [status, updated_at, id] = params;
        const row = this.getTable('_local_blobs').get(id);
        if (row) {
          row.status = status;
          row.updated_at = updated_at;
        }
      }
      return [];
    }

    // Outbox status counts
    if (lowerQ.startsWith('select status, count(*)') && lowerQ.includes('from sync_outbox')) {
      const counts = new Map<string, number>();
      for (const r of this.getTable('sync_outbox').values()) {
        counts.set(r.status, (counts.get(r.status) || 0) + 1);
      }
      return Array.from(counts.entries()).map(([status, count]) => ({ status, count }));
    }

    // Outbox listing: SELECT * FROM sync_outbox [WHERE status = ?] ORDER BY timestamp DESC [LIMIT ? OFFSET ?]
    if (/^SELECT \* FROM sync_outbox(?: WHERE status = \?)? ORDER BY timestamp DESC/i.test(normQ)) {
      const p = [...params];
      let rows = Array.from(this.getTable('sync_outbox').values());
      if (/WHERE status = \?/i.test(normQ)) {
        const status = p.shift();
        rows = rows.filter((r) => r.status === status);
      }
      rows.sort((a, b) => b.timestamp - a.timestamp);
      if (/LIMIT \? OFFSET \?/i.test(normQ)) {
        const [limit, offset] = p;
        rows = rows.slice(offset, limit > 0 ? offset + limit : undefined);
      }
      return rows;
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

    // Select 1 from table where id = ?
    const select1Match = normQ.match(/SELECT 1 FROM "?(\w+)"? WHERE "?(\w+)"? = \?/i);
    if (select1Match) {
      const table = select1Match[1];
      const id = params[0];
      const rows = this.getTable(table);
      return rows.has(id) ? [{ 1: 1 }] : [];
    }

    // Active outbox records (non-FAILED)
    if (lowerQ.includes('from sync_outbox') && lowerQ.includes("status != 'failed'") && !lowerQ.includes('table_name = ?')) {
      const rows = Array.from(this.getTable('sync_outbox').values());
      const filtered = rows.filter((r) => r.status !== 'FAILED');
      filtered.sort((a, b) => b.timestamp - a.timestamp);
      return filtered;
    }

    // Outbox find pending by row
    if (normQ.includes('FROM sync_outbox') && normQ.includes('table_name = ? AND row_id = ?')) {
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

    // Select single row or filter by column (with optional LIMIT 1)
    const selectRowMatch = normQ.match(/^SELECT \* FROM "?(\w+)"? WHERE "?(\w+)"? = \?(?:\s+LIMIT \d+)?;?$/i);
    if (selectRowMatch && selectRowMatch[1] !== 'sync_outbox') {
      const table = selectRowMatch[1];
      const col = selectRowMatch[2];
      const val = params[0];
      const rows = this.getTable(table);
      if (rows.has(val)) {
        return [rows.get(val)];
      }
      return Array.from(rows.values()).filter((r: any) => r[col] === val);
    }

    // Select multiple rows by column IN (...)
    const selectInMatch = normQ.match(/^SELECT \* FROM "?(\w+)"? WHERE "?(\w+)"? IN \([^)]+\)$/i);
    if (selectInMatch && selectInMatch[1] !== 'sync_outbox') {
      const table = selectInMatch[1];
      const col = selectInMatch[2];
      const rows = this.getTable(table);
      const idSet = new Set(params);
      if (col.toLowerCase() === 'id' || col.toLowerCase() === 'key') {
        return params.map((id) => rows.get(id)).filter(Boolean);
      }
      return Array.from(rows.values()).filter((r: any) => idSet.has(r[col]));
    }

        // Reset _local_actions executing on startup
    if (normQ.includes("UPDATE _local_actions SET status = 'PENDING' WHERE status = 'EXECUTING'")) {
      for (const row of this.getTable('_local_actions').values()) {
        if (row.status === 'EXECUTING') row.status = 'PENDING';
      }
      return [];
    }

    // Cancel action: UPDATE _local_actions SET status = 'CANCELLED' WHERE id = ? AND status = 'PENDING'
    if (normQ.includes("UPDATE _local_actions SET status = 'CANCELLED' WHERE id = ? AND status = 'PENDING'")) {
      const id = params[0];
      const row = this.getTable('_local_actions').get(id);
      if (row && row.status === 'PENDING') {
        row.status = 'CANCELLED';
      }
      return [];
    }

    // Pending actions: SELECT * FROM _local_actions WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT ?
    if (lowerQ.includes('from _local_actions') && lowerQ.includes("status = 'pending'")) {
      const limit = params[0] || 50;
      const rows = Array.from(this.getTable('_local_actions').values());
      const pending = rows.filter((r) => r.status === 'PENDING');
      pending.sort((a, b) => (Number(a.created_at) || 0) - (Number(b.created_at) || 0));
      return pending.slice(0, limit);
    }

    // Prune _local_actions
    if (lowerQ.startsWith('delete from _local_actions where status =')) {
      const cutoff = params[0];
      const match = lowerQ.match(/status = '(\w+)'/);
      const targetStatus = match ? match[1].toUpperCase() : null;
      for (const [id, row] of this.getTable('_local_actions').entries()) {
        if (row.status === targetStatus) {
          const ts = row.status === 'COMPLETED' ? Number(row.executed_at) : Number(row.created_at);
          if (cutoff === undefined || ts <= cutoff) {
            this.getTable('_local_actions').delete(id);
          }
        }
      }
      return [];
    }

    // Select rows from table (with optional projection / WHERE / ORDER / LIMIT)
    const selectAllMatch = normQ.match(/^SELECT (?:[\w",\s]+|\*) FROM "?(\w+)"?(?:\s+WHERE\s+[^;]+)?(?:\s+ORDER BY\s+[^;]+)?(?:\s+LIMIT\s+[^;]+)?;?$/i);
    if (selectAllMatch) {
      const table = selectAllMatch[1];
      return Array.from(this.getTable(table).values());
    }

    // Insert into sync_outbox (single or multi-row batch)
    if (q.startsWith('INSERT INTO sync_outbox')) {
      const stride = 6;
      for (let i = 0; i < params.length; i += stride) {
        const [id, table_name, row_id, operation, payload, timestamp, status] = params.slice(i, i + stride);
        if (!id) break;
        this.getTable('sync_outbox').set(id, {
          id,
          table_name,
          row_id,
          operation,
          payload,
          timestamp,
          status: status || 'PENDING',
          retry_count: 0,
        });
      }
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
      const id = obj.id || obj.key || obj.row_id || params[0];
      const existing = this.getTable(table).get(id);
      if (existing && /ON CONFLICT/i.test(q)) {
        this.getTable(table).set(id, { ...existing, ...obj });
      } else {
        this.getTable(table).set(id, obj);
      }
      return [];
    }

    // Select count from sync_outbox where status = 'FAILED'
    if (lowerQ.startsWith('select count') && lowerQ.includes('from sync_outbox') && lowerQ.includes("status = 'failed'")) {
      const rows = Array.from(this.getTable('sync_outbox').values());
      const count = rows.filter((r) => r.status === 'FAILED').length;
      return [{ count }];
    }

    // Select id from sync_outbox where status = 'FAILED'
    if (lowerQ.startsWith('select') && lowerQ.includes('from sync_outbox') && lowerQ.includes("status = 'failed'")) {
      const rows = Array.from(this.getTable('sync_outbox').values());
      return rows.filter((r) => r.status === 'FAILED').map((r) => ({ id: r.id }));
    }

    // Recover interrupted pushes without changing failure history.
    

    if (normQ === "UPDATE sync_outbox SET status = 'PENDING' WHERE status = 'PROCESSING'") {
      for (const row of this.getTable('sync_outbox').values()) {
        if (row.status === 'PROCESSING') row.status = 'PENDING';
      }
      return [];
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

        // Update _local_api_keys revoked
    if (lowerQ.includes('update _local_api_keys set revoked = 1')) {
      const revokedAt = params[0];
      const id = params[1];
      const row = this.getTable('_local_api_keys').get(id);
      if (row && !row.revoked) {
        row.revoked = 1;
        row.revoked_at = revokedAt;
      }
      return [];
    }

    // Prune _local_api_keys
    if (lowerQ.includes('delete from _local_api_keys where')) {
      const cutoff = params[0];
      if (lowerQ.includes('revoked = 1')) {
        for (const [id, row] of this.getTable('_local_api_keys').entries()) {
          if (row.revoked && (cutoff === undefined || Number(row.revoked_at) <= cutoff)) {
            this.getTable('_local_api_keys').delete(id);
          }
        }
      } else if (lowerQ.includes('expires_at is not null')) {
        for (const [id, row] of this.getTable('_local_api_keys').entries()) {
          if (row.expires_at != null && Number(row.expires_at) <= cutoff) {
            this.getTable('_local_api_keys').delete(id);
          }
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
      const col = deleteMatch[2];
      const val = params[0];
      if (this.getTable(table).has(val)) {
        this.getTable(table).delete(val);
      } else {
        for (const [k, r] of this.getTable(table).entries()) {
          if (r[col] === val) this.getTable(table).delete(k);
        }
      }
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
