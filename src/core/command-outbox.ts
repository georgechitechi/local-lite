import type {
  LocalDBAdapter,
  LocalTransaction,
} from '../adapters/local/index.js';
import { generateUUID } from '../utils/uuid.js';

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export type OptimisticPatch =
  | { op: 'insert'; table: string; row: Record<string, any> }
  | { op: 'patch'; table: string; id: string; patch: Record<string, any> }
  | { op: 'remove'; table: string; id: string };

interface InverseOp {
  op: 'restore' | 'delete';
  table: string;
  id: string;
  row: Record<string, any> | null;
}

export interface QueuedCommand {
  id: string;
  cmd: string;
  args: Record<string, unknown>;
  idempotencyKey: string;
  patches: OptimisticPatch[];
  inverse: InverseOp[];
  createdAt: number;
}

export interface CommandRejectionInfo {
  commandId: string;
  cmd: string;
  code?: string;
  error?: string;
  details?: unknown;
}

export interface CommandOutboxOptions {
  db: LocalDBAdapter;
  url: string;
  getToken?: () =>
    string | null | undefined | Promise<string | null | undefined>;
  fetch?: typeof fetch;
  tableName?: string;
  onRejection?: (info: CommandRejectionInfo) => void;
  onCommitted?: (info: {
    commandId: string;
    cmd: string;
    result: unknown;
    checkpoint?: number;
  }) => void;
}

async function applyPatch(
  tx: LocalTransaction,
  p: OptimisticPatch,
): Promise<InverseOp> {
  const qTable = quoteIdent(p.table);
  if (p.op === 'insert') {
    const id = String(p.row.id ?? generateUUID());
    const row: Record<string, any> = { ...p.row, id };
    const existing = await tx.execute(
      `SELECT * FROM ${qTable} WHERE id = ? LIMIT 1`,
      [id],
    );
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(', ');
    await tx.execute(
      `INSERT OR REPLACE INTO ${qTable} (${cols.map(quoteIdent).join(', ')}) VALUES (${placeholders})`,
      cols.map((c) => row[c]),
    );
    return existing[0]
      ? { op: 'restore', table: p.table, id, row: existing[0] }
      : { op: 'delete', table: p.table, id, row: null };
  }

  const existing = await tx.execute(
    `SELECT * FROM ${qTable} WHERE id = ? LIMIT 1`,
    [p.id],
  );
  const prev = existing[0] ?? null;

  if (p.op === 'patch') {
    const cols = Object.keys(p.patch);
    if (cols.length > 0 && prev) {
      const sets = cols.map((c) => `${quoteIdent(c)} = ?`).join(', ');
      await tx.execute(`UPDATE ${qTable} SET ${sets} WHERE id = ?`, [
        ...cols.map((c) => p.patch[c]),
        p.id,
      ]);
    }
    return prev
      ? { op: 'restore', table: p.table, id: p.id, row: prev }
      : { op: 'delete', table: p.table, id: p.id, row: null };
  }

  // remove
  await tx.execute(`DELETE FROM ${qTable} WHERE id = ?`, [p.id]);
  return prev
    ? { op: 'restore', table: p.table, id: p.id, row: prev }
    : { op: 'delete', table: p.table, id: p.id, row: null };
}

async function applyInverse(
  tx: LocalTransaction,
  inv: InverseOp,
): Promise<void> {
  const qTable = quoteIdent(inv.table);
  if (inv.op === 'delete') {
    await tx.execute(`DELETE FROM ${qTable} WHERE id = ?`, [inv.id]);
    return;
  }
  if (!inv.row) return;
  const cols = Object.keys(inv.row);
  const placeholders = cols.map(() => '?').join(', ');
  await tx.execute(
    `INSERT OR REPLACE INTO ${qTable} (${cols.map(quoteIdent).join(', ')}) VALUES (${placeholders})`,
    cols.map((c) => inv.row![c]),
  );
}

/**
 * Local-first command outbox: applies optimistic SQLite patches immediately,
 * persists queued intents, flushes to `POST /cmd/:module/:name` with
 * `Idempotency-Key`, and rolls back + rebases pending intents on `409` rejection.
 */
export function createCommandOutbox(opts: CommandOutboxOptions) {
  const { db } = opts;
  const baseUrl = opts.url.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? globalThis.fetch;
  const outboxTable = opts.tableName ?? '_local_command_outbox';
  const qOutbox = quoteIdent(outboxTable);
  let initialized = false;

  const ensureTable = async () => {
    if (initialized) return;
    await db.execute(
      `CREATE TABLE IF NOT EXISTS ${qOutbox} (
        id TEXT PRIMARY KEY,
        cmd TEXT NOT NULL,
        args_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        patches_json TEXT NOT NULL,
        inverse_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    );
    initialized = true;
  };

  const listPending = async (): Promise<QueuedCommand[]> => {
    await ensureTable();
    const rows = await db.execute(
      `SELECT id, cmd, args_json, idempotency_key, patches_json, inverse_json, created_at FROM ${qOutbox} ORDER BY created_at ASC`,
    );
    return rows.map((r: any) => ({
      id: String(r.id),
      cmd: String(r.cmd),
      args: JSON.parse(r.args_json),
      idempotencyKey: String(r.idempotency_key),
      patches: JSON.parse(r.patches_json),
      inverse: JSON.parse(r.inverse_json),
      createdAt: Number(r.created_at),
    }));
  };

  const enqueue = async (
    cmd: string,
    args: Record<string, unknown>,
    optimisticPatches: OptimisticPatch[] = [],
  ): Promise<QueuedCommand> => {
    await ensureTable();
    const id = generateUUID();
    const idempotencyKey = generateUUID();
    const createdAt = Date.now();

    const inverse = await db.transaction(async (tx) => {
      const inv: InverseOp[] = [];
      for (const p of optimisticPatches) {
        inv.push(await applyPatch(tx, p));
      }
      await tx.execute(
        `INSERT INTO ${qOutbox} (id, cmd, args_json, idempotency_key, patches_json, inverse_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          cmd,
          JSON.stringify(args),
          idempotencyKey,
          JSON.stringify(optimisticPatches),
          JSON.stringify(inv),
          createdAt,
        ],
      );
      return inv;
    });

    return {
      id,
      cmd,
      args,
      idempotencyKey,
      patches: optimisticPatches,
      inverse,
      createdAt,
    };
  };

  const rollbackAndRebase = async (
    rejectedId: string,
    allPending: QueuedCommand[],
  ) => {
    const idx = allPending.findIndex((q) => q.id === rejectedId);
    if (idx === -1) return;
    const tail = allPending.slice(idx + 1);

    await db.transaction(async (tx) => {
      // 1. Undo tail in reverse order
      for (let i = tail.length - 1; i >= 0; i--) {
        for (let j = tail[i].inverse.length - 1; j >= 0; j--) {
          await applyInverse(tx, tail[i].inverse[j]);
        }
      }
      // 2. Undo rejected command
      const rejected = allPending[idx];
      for (let j = rejected.inverse.length - 1; j >= 0; j--) {
        await applyInverse(tx, rejected.inverse[j]);
      }
      await tx.execute(`DELETE FROM ${qOutbox} WHERE id = ?`, [rejectedId]);
      // 3. Rebase remaining tail commands in forward order
      for (const item of tail) {
        const nextInv: InverseOp[] = [];
        for (const p of item.patches) {
          nextInv.push(await applyPatch(tx, p));
        }
        await tx.execute(
          `UPDATE ${qOutbox} SET inverse_json = ? WHERE id = ?`,
          [JSON.stringify(nextInv), item.id],
        );
      }
    });
  };

  const flush = async (): Promise<{
    committed: number;
    rejected: number;
    remaining: number;
  }> => {
    let committed = 0;
    let rejected = 0;

    for (;;) {
      const pending = await listPending();
      if (pending.length === 0) break;
      const head = pending[0];

      const token = await opts.getToken?.();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Idempotency-Key': head.idempotencyKey,
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await doFetch(`${baseUrl}/cmd/${head.cmd}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ args: head.args }),
      });
      const body = (await res.json().catch(() => ({}))) as any;

      if (res.status === 409 || body.rejected) {
        await rollbackAndRebase(head.id, pending);
        rejected += 1;
        opts.onRejection?.({
          commandId: head.id,
          cmd: head.cmd,
          code: body.code,
          error: body.error,
          details: body.details,
        });
        continue;
      }

      if (!res.ok) {
        // Transient network/server error — keep head in outbox for retry with same Idempotency-Key
        break;
      }

      await db.execute(`DELETE FROM ${qOutbox} WHERE id = ?`, [head.id]);
      committed += 1;
      opts.onCommitted?.({
        commandId: head.id,
        cmd: head.cmd,
        result: body.result,
        checkpoint: body.checkpoint,
      });
    }

    const remaining = (await listPending()).length;
    return { committed, rejected, remaining };
  };

  return {
    enqueue,
    flush,
    listPending,
    pendingCount: async () => (await listPending()).length,
  };
}
