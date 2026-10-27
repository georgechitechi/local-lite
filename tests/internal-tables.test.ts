import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LocalFirstClient } from '../src/core/client.js';
import { isInternalTable } from '../src/utils/sql.js';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';

describe('Internal Tables Filtering', () => {
  it('correctly identifies internal tables', () => {
    expect(isInternalTable('properties')).toBe(false);
    expect(isInternalTable('houses')).toBe(false);
    expect(isInternalTable('tenants')).toBe(false);

    expect(isInternalTable('_fts_houses')).toBe(true);
    expect(isInternalTable('_fts_houses_content')).toBe(true);
    expect(isInternalTable('_fts_houses_config')).toBe(true);
    expect(isInternalTable('_local_kv')).toBe(true);
    expect(isInternalTable('_local_sessions')).toBe(true);
    expect(isInternalTable('sync_outbox')).toBe(true);
    expect(isInternalTable('sync_meta')).toBe(true);
    expect(isInternalTable('sqlite_master')).toBe(true);
    expect(isInternalTable('schema_migrations')).toBe(true);
  });

  it('excludes internal tables from getTables() and getAllTableNames() by default', async () => {
    const raw = new DatabaseSync(':memory:');
    const client = new LocalFirstClient({
      local: new NodeSQLiteAdapter(raw),
      remote: {
        pushChanges: async () => {},
        fetchChanges: async () => {},
        subscribeToLiveChanges() {},
      },
      autoStart: false,
      autoSchema: false,
      tables: ['properties', 'houses'],
    });

    await client.initialize();
    await client.db.execute('CREATE TABLE IF NOT EXISTS properties (id TEXT PRIMARY KEY, name TEXT)');
    await client.db.execute('CREATE TABLE IF NOT EXISTS houses (id TEXT PRIMARY KEY, number TEXT)');
    await client.db.execute('CREATE TABLE IF NOT EXISTS _fts_houses (rowid INTEGER PRIMARY KEY)');

    const defaultTables = await client.getTables();
    expect(defaultTables.sort()).toEqual(['houses', 'properties']);

    const allTables = await client.getTables({ includeInternal: true });
    expect(allTables).toContain('_fts_houses');
    expect(allTables).toContain('sync_outbox');

    const stats = await client.maintenance.getStorageStats();
    expect(stats.tables['properties']).toBeDefined();
    expect(stats.tables['_fts_houses']).toBeUndefined();

    const statsAll = await client.maintenance.getStorageStats({ includeInternal: true });
    expect(statsAll.tables['_fts_houses']).toBeDefined();

    await client.close();
  });
});
