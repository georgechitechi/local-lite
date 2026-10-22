import { describe, expect, it } from 'vitest';
import {
  createDatabaseBackup,
  restoreDatabaseBackup,
  type BackupDatabase,
  type BackupStorage,
} from '../src/backups/index.js';

describe('database backups', () => {
  it('stores and restores a plain SQLite snapshot', async () => {
    const original = new TextEncoder().encode('SQLite database snapshot');
    const stored = new Map<string, Uint8Array>();
    let restored = new Uint8Array();
    const database: BackupDatabase = {
      exportDatabase: async () => original,
      importDatabase: async data => {
        restored = data.slice();
      },
    };
    const storage: BackupStorage = {
      save: async (fileName, data) => {
        stored.set(fileName, data.slice());
      },
      read: async fileName => {
        const data = stored.get(fileName);
        if (!data) throw new Error('File not found');
        return data;
      },
    };

    const fileName = await createDatabaseBackup(database, storage, {
      fileName: 'backup.db',
    });
    await restoreDatabaseBackup(database, storage, fileName);

    expect(fileName).toBe('backup.db');
    expect(restored).toEqual(original);
    expect(stored.get(fileName)).toEqual(original);
  });

  it('creates a timestamped .db filename by default', async () => {
    const database: BackupDatabase = {
      exportDatabase: async () => new Uint8Array([1, 2, 3]),
      importDatabase: async () => {},
    };
    let savedName = '';
    const storage: BackupStorage = {
      save: async fileName => {
        savedName = fileName;
      },
      read: async () => new Uint8Array([1, 2, 3]),
    };

    await createDatabaseBackup(database, storage);

    expect(savedName).toMatch(/^local-lite-.*\.db$/);
  });

  it('rejects empty database snapshots and invalid file names', async () => {
    const database: BackupDatabase = {
      exportDatabase: async () => new Uint8Array(),
      importDatabase: async () => {},
    };
    const storage: BackupStorage = {
      save: async () => {},
      read: async () => new Uint8Array([1]),
    };

    await expect(createDatabaseBackup(database, storage)).rejects.toThrow(
      'empty database',
    );
    await expect(
      createDatabaseBackup(database, storage, { fileName: '../backup.db' }),
    ).rejects.toThrow('single file name');
    await expect(restoreDatabaseBackup(database, storage, '../backup.db')).rejects.toThrow(
      'single file name',
    );
  });
});
