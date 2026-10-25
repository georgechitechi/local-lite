import {
  type EncryptedBackupOptions,
  type RestoreEncryptedBackupOptions,
  createEncryptedDatabaseBackup,
  restoreEncryptedDatabaseBackup,
  isEncryptedBackup,
} from './encryption.js';
import type { CloudBackupFile } from './cloud-storage.js';

export type BackupAccessTokenProvider = () => Promise<string>;

export interface BackupDatabase {
  exportDatabase(): Promise<Uint8Array>;
  importDatabase(data: Uint8Array): Promise<void>;
}

export interface BackupStorage {
  save(fileName: string, data: Uint8Array): Promise<void>;
  read(fileName: string): Promise<Uint8Array>;
  list?(): Promise<CloudBackupFile[]>;
  delete?(fileName: string): Promise<void>;
}

export interface CloudBackupClient extends BackupStorage {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  list(): Promise<CloudBackupFile[]>;
  deleteBackup?(fileIdOrName: string): Promise<void>;
  onStatusChange?(listener: (connected: boolean) => void): () => void;
  backup?(
    database: ResolvableBackupDatabase,
    options?: CreateDatabaseBackupOptions & Partial<EncryptedBackupOptions>,
  ): Promise<string>;
  restore?(
    database: ResolvableBackupDatabase,
    fileNameOrId: string,
    options?: Partial<RestoreEncryptedBackupOptions>,
  ): Promise<void>;
}

export interface CreateDatabaseBackupOptions {
  fileName?: string;
}

export type ResolvableBackupDatabase =
  | BackupDatabase
  | { exportDatabase(): Promise<Uint8Array>; importDatabase(data: Uint8Array): Promise<void> }
  | { db: any; exportDatabase?(): Promise<Uint8Array>; importDatabase?(data: Uint8Array): Promise<void> };

export function resolveBackupDatabase(target: any): BackupDatabase {
  if (!target) {
    throw new Error('A valid database or LocalFirstClient is required for backup.');
  }

  if (typeof target.exportDatabase === 'function' && typeof target.importDatabase === 'function') {
    return target as BackupDatabase;
  }

  if (
    target.db &&
    typeof target.db.exportDatabase === 'function' &&
    typeof target.db.importDatabase === 'function'
  ) {
    return target.db as BackupDatabase;
  }

  throw new Error(
    'Provided target does not implement BackupDatabase. It must provide exportDatabase() and importDatabase().',
  );
}

function validateFileName(fileName: string): void {
  if (!fileName || /[\\/]/.test(fileName)) {
    throw new Error('Backup file name must be a single file name.');
  }
}

export async function createDatabaseBackup(
  database: ResolvableBackupDatabase,
  storage: BackupStorage,
  options: CreateDatabaseBackupOptions = {},
): Promise<string> {
  const resolved = resolveBackupDatabase(database);
  const fileName =
    options.fileName ?? `local-lite-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  validateFileName(fileName);

  const databaseBytes = await resolved.exportDatabase();
  if (databaseBytes.length === 0) {
    throw new Error('Cannot create a backup from an empty database.');
  }
  await storage.save(fileName, databaseBytes);
  return fileName;
}

export async function restoreDatabaseBackup(
  database: ResolvableBackupDatabase,
  storage: BackupStorage,
  fileName: string,
): Promise<void> {
  validateFileName(fileName);
  const resolved = resolveBackupDatabase(database);
  const databaseBytes = await storage.read(fileName);
  if (databaseBytes.length === 0) {
    throw new Error('Cannot restore an empty database backup.');
  }
  await resolved.importDatabase(databaseBytes);
}

export async function performBackup(
  database: ResolvableBackupDatabase,
  storage: BackupStorage,
  options: CreateDatabaseBackupOptions & Partial<EncryptedBackupOptions> = {},
): Promise<string> {
  const resolved = resolveBackupDatabase(database);
  if (options.passphrase && options.passphrase.trim()) {
    return createEncryptedDatabaseBackup(resolved, storage, {
      passphrase: options.passphrase,
      fileName: options.fileName,
      iterations: options.iterations,
    });
  }
  return createDatabaseBackup(resolved, storage, options);
}

export async function performRestore(
  database: ResolvableBackupDatabase,
  storage: BackupStorage,
  fileNameOrId: string,
  options: Partial<RestoreEncryptedBackupOptions> = {},
): Promise<void> {
  const resolved = resolveBackupDatabase(database);
  if (options.passphrase && options.passphrase.trim()) {
    return restoreEncryptedDatabaseBackup(resolved, storage, fileNameOrId, {
      passphrase: options.passphrase,
    });
  }

  const rawBytes = await storage.read(fileNameOrId);
  if (isEncryptedBackup(rawBytes)) {
    throw new Error(
      'This backup is encrypted. A passphrase is required to restore it.',
    );
  }
  if (rawBytes.length === 0) {
    throw new Error('Cannot restore an empty database backup.');
  }
  await resolved.importDatabase(rawBytes);
}
