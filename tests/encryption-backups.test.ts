import { describe, expect, it } from 'vitest';
import {
  createEncryptedDatabaseBackup,
  restoreEncryptedDatabaseBackup,
  encryptBackupData,
  decryptBackupData,
  isEncryptedBackup,
  type BackupDatabase,
  type BackupStorage,
} from '../src/backups/index.js';

describe('encrypted database backups', () => {
  const sampleData = new TextEncoder().encode('SQLite format 3\x00 table records demo');
  const testPassphrase = 'super-secret-user-passphrase-2026';
  const fastIterations = 100; // For fast test runs

  it('encrypts and decrypts arbitrary byte arrays with AES-256-GCM', async () => {
    const encrypted = await encryptBackupData(sampleData, testPassphrase, {
      iterations: fastIterations,
    });

    expect(isEncryptedBackup(encrypted)).toBe(true);
    expect(encrypted.length).toBeGreaterThan(sampleData.length);
    // Ciphertext should not contain plaintext
    expect(encrypted).not.toEqual(sampleData);

    const decrypted = await decryptBackupData(encrypted, testPassphrase, {
      iterations: fastIterations,
    });
    expect(decrypted).toEqual(sampleData);
  });

  it('detects unencrypted backups correctly', () => {
    expect(isEncryptedBackup(sampleData)).toBe(false);
    expect(isEncryptedBackup(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isEncryptedBackup(new Uint8Array())).toBe(false);
  });

  it('fails to decrypt when given the wrong passphrase', async () => {
    const encrypted = await encryptBackupData(sampleData, testPassphrase, {
      iterations: fastIterations,
    });

    await expect(
      decryptBackupData(encrypted, 'wrong-password-here', { iterations: fastIterations }),
    ).rejects.toThrow(/Incorrect passphrase or corrupted database backup/);
  });

  it('fails when attempting to decrypt corrupted/tampered bytes', async () => {
    const encrypted = await encryptBackupData(sampleData, testPassphrase, {
      iterations: fastIterations,
    });

    // Corrupt the ciphertext payload
    encrypted[encrypted.length - 1] ^= 0xff;

    await expect(
      decryptBackupData(encrypted, testPassphrase, { iterations: fastIterations }),
    ).rejects.toThrow(/Incorrect passphrase or corrupted database backup/);
  });

  it('rejects empty or whitespace-only passphrases', async () => {
    await expect(encryptBackupData(sampleData, '')).rejects.toThrow(/passphrase is required/);
    await expect(encryptBackupData(sampleData, '   ')).rejects.toThrow(/passphrase is required/);
    await expect(decryptBackupData(sampleData, '')).rejects.toThrow(/passphrase is required/);
  });

  it('full backup and restore cycle with createEncryptedDatabaseBackup', async () => {
    const stored = new Map<string, Uint8Array>();
    let restoredBytes = new Uint8Array();

    const database: BackupDatabase = {
      exportDatabase: async () => sampleData,
      importDatabase: async data => {
        restoredBytes = data.slice();
      },
    };

    const storage: BackupStorage = {
      save: async (fileName, data) => {
        stored.set(fileName, data.slice());
      },
      read: async fileName => {
        const file = stored.get(fileName);
        if (!file) throw new Error('File not found');
        return file;
      },
    };

    const fileName = await createEncryptedDatabaseBackup(database, storage, {
      passphrase: testPassphrase,
      fileName: 'vault.enc.db',
      iterations: fastIterations,
    });

    expect(fileName).toBe('vault.enc.db');
    expect(isEncryptedBackup(stored.get(fileName)!)).toBe(true);

    await restoreEncryptedDatabaseBackup(database, storage, fileName, {
      passphrase: testPassphrase,
    });

    expect(restoredBytes).toEqual(sampleData);
  });
});
