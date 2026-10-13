import { describe, it, expect, beforeEach } from 'vitest';
import { MetaStore } from '../src/core/meta-store.js';
import { MockDB } from './helpers/mock-db.js';

describe('MetaStore & Persistent Sync Cursor', () => {
  let db: MockDB;

  beforeEach(async () => {
    db = new MockDB();
    await MetaStore.ensureSchema(db);
  });

  it('starts with a default cursor of 0', async () => {
    const cursor = await MetaStore.getLastSyncedAt(db);
    expect(cursor).toBe(0);
  });

  it('persists and retrieves last_synced_at timestamp', async () => {
    const timestamp = 1712345678900;
    await MetaStore.setLastSyncedAt(db, timestamp);

    const retrieved = await MetaStore.getLastSyncedAt(db);
    expect(retrieved).toBe(timestamp);
  });

  it('clears persistent sync cursor on reset', async () => {
    await MetaStore.setLastSyncedAt(db, 1712345678900);
    await MetaStore.clearLastSyncedAt(db);

    const afterClear = await MetaStore.getLastSyncedAt(db);
    expect(afterClear).toBe(0);
  });

  it('stores and retrieves arbitrary key-value metadata', async () => {
    await MetaStore.set(db, 'schema_version', '4');
    const val = await MetaStore.get(db, 'schema_version');
    expect(val).toBe('4');

    const nonExistent = await MetaStore.get(db, 'unknown_key');
    expect(nonExistent).toBeNull();
  });
});
