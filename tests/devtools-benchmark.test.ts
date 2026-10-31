import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore node:sqlite may be missing from older @types/node versions.
import { DatabaseSync } from 'node:sqlite';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { LocalFirstClient } from '../src/core/client.js';
import { runSQLiteBenchmark } from '../src/devtools/BenchmarkModal.js';

describe('SQLite benchmark workload', () => {
  let raw: DatabaseSync | undefined;
  let client: LocalFirstClient | undefined;

  afterEach(async () => {
    if (client) {
      await client.close();
    } else {
      raw?.close();
    }
    client = undefined;
  });

  async function setup(appRows: number, tableName = 'app_records') {
    raw = new DatabaseSync(':memory:');
    const db = new NodeSQLiteAdapter(raw);
    client = new LocalFirstClient({
      local: db,
      remote: new MemoryDemoRemoteAdapter(0),
      network: new DefaultNetworkStatusProvider(false),
      autoSchema: true,
      autoStart: false,
      logger: false,
    });
    await client.initialize();
    if (appRows > 0) {
      await db.execute(`CREATE TABLE ${tableName} (id TEXT PRIMARY KEY, title TEXT)`);
      await db.transaction(async (tx) => {
        for (let i = 0; i < appRows; i++) {
          await tx.execute(`INSERT INTO ${tableName} (id, title) VALUES (?, ?)`, [
            `app-${i}`,
            `Real app record ${i}`,
          ]);
        }
      });
    }
    return db;
  }

  it('scales with app rows and seeds benchmark payloads from app data', async () => {
    await setup(1001);

    const batchSpy = vi.spyOn(client!, 'batch');
    const results = await runSQLiteBenchmark(client);

    expect(results[0].operations).toBe(1000);
    expect(results[0].note).toContain('1,001 app rows');
    const firstMutation = batchSpy.mock.calls[0][0][0];
    const metadata = JSON.parse(String(firstMutation.payload!.metadata));
    expect(metadata.appRecord).toContain('Real app record');
  });

  it('uses the baseline workload for an empty database', async () => {
    await setup(0);
    const results = await runSQLiteBenchmark(client);

    expect(results[0].operations).toBe(500);
    expect(results[0].note).toContain('0 app rows');
    expect(results.some((r) => r.category === 'App Data')).toBe(false);
  });

  it('caps the workload multiplier at 10x', async () => {
    await setup(12000);
    const results = await runSQLiteBenchmark(client);

    expect(results[0].operations).toBe(5000);
  });

  it('benchmarks real app tables read-only and leaves app data untouched', async () => {
    const db = await setup(50);
    const results = await runSQLiteBenchmark(client);

    const appResults = results.filter((r) => r.category === 'App Data');
    expect(appResults.map((r) => r.name)).toEqual([
      'Real table scan: app_records',
      'Real point lookups: app_records',
    ]);
    for (const r of appResults) {
      expect(r.durationMs).toBeGreaterThan(0);
      expect(r.opsPerSec).toBeGreaterThan(0);
    }

    const count = await db.execute('SELECT COUNT(*) AS c FROM app_records');
    expect(Number(count[0].c)).toBe(50);
  });

  it('drops its temporary tables after running', async () => {
    const db = await setup(10);
    await runSQLiteBenchmark(client);

    const leftovers = await db.execute(
      "SELECT name FROM sqlite_master WHERE name LIKE '_sync_bench%'",
    );
    expect(leftovers).toHaveLength(0);
  });

  it('treats app tables prefixed with sync_ as internal', async () => {
    await setup(30, 'sync_settings');
    const results = await runSQLiteBenchmark(client);

    expect(results[0].note).toContain('0 app rows');
  });

  it('falls back to the baseline workload when given a plain db adapter', async () => {
    const db = await setup(2000);
    const results = await runSQLiteBenchmark(db);

    expect(results[0].operations).toBe(500);
    expect(results.some((r) => r.category === 'App Data')).toBe(false);
  });
});
