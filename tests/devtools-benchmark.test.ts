import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { LocalFirstClient } from '../src/core/client.js';
import { runSQLiteBenchmark } from '../src/devtools/BenchmarkModal.js';

describe('SQLite benchmark workload', () => {
  let raw: { close(): void } | undefined;
  let client: LocalFirstClient | undefined;

  afterEach(async () => {
    if (client) {
      await client.close();
    } else {
      raw?.close();
    }
  });

  it('scales with app rows and seeds benchmark payloads from app data', async () => {
    const sqliteModuleName = ['node', 'sqlite'].join(':');
    const { DatabaseSync } = await import(sqliteModuleName);
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
    await db.execute('CREATE TABLE app_records (id TEXT PRIMARY KEY, title TEXT)');
    await db.transaction(async (tx) => {
      for (let i = 0; i < 1001; i++) {
        await tx.execute('INSERT INTO app_records (id, title) VALUES (?, ?)', [
          `app-${i}`,
          `Real app record ${i}`,
        ]);
      }
    });

    const batchSpy = vi.spyOn(client, 'batch');
    const results = await runSQLiteBenchmark(client);

    expect(results[0].operations).toBe(1000);
    expect(results[0].note).toContain('1,001 app rows');
    const firstMutation = batchSpy.mock.calls[0][0][0];
    const payload = firstMutation.payload;
    if (payload == null) {
      throw new Error('Expected the first mutation to have a payload');
    }
    const metadata = JSON.parse(String(payload.metadata));
    expect(metadata.appRecord).toContain('Real app record');
  });
});
