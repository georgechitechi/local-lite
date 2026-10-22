export {
  type BackupAccessTokenProvider,
  type CloudBackupFile,
  type GoogleDriveAuthorizationRequest,
  type GoogleDriveAuthorizationResponse,
  type GoogleDriveBackupClientOptions,
  type GoogleDriveKeyValueStorage,
  type GoogleDriveTokenStore,
  type GoogleDriveTokens,
  GoogleDriveBackupClient,
  GoogleDriveBackupStorage,
  createGoogleDriveTokenStore,
} from './cloud-storage.js';

export interface BackupDatabase {
  exportDatabase(): Promise<Uint8Array>;
  importDatabase(data: Uint8Array): Promise<void>;
}

export interface BackupStorage {
  save(fileName: string, data: Uint8Array): Promise<void>;
  read(fileName: string): Promise<Uint8Array>;
}

export interface CreateDatabaseBackupOptions {
  fileName?: string;
}

function validateFileName(fileName: string): void {
  if (!fileName || /[\\/]/.test(fileName)) {
    throw new Error('Backup file name must be a single file name.');
  }
}

export async function createDatabaseBackup(
  database: BackupDatabase,
  storage: BackupStorage,
  options: CreateDatabaseBackupOptions = {},
): Promise<string> {
  const fileName =
    options.fileName ?? `local-lite-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  validateFileName(fileName);

  const databaseBytes = await database.exportDatabase();
  if (databaseBytes.length === 0) {
    throw new Error('Cannot create a backup from an empty database.');
  }
  await storage.save(fileName, databaseBytes);
  return fileName;
}

export async function restoreDatabaseBackup(
  database: BackupDatabase,
  storage: BackupStorage,
  fileName: string,
): Promise<void> {
  validateFileName(fileName);
  const databaseBytes = await storage.read(fileName);
  if (databaseBytes.length === 0) {
    throw new Error('Cannot restore an empty database backup.');
  }
  await database.importDatabase(databaseBytes);
}
