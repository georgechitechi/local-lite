import type {
  BackupAccessTokenProvider,
  BackupStorage,
  CloudBackupClient,
  CreateDatabaseBackupOptions,
  ResolvableBackupDatabase,
} from './operations.js';
import { performBackup, performRestore } from './operations.js';
import type { CloudBackupFile } from './cloud-storage.js';
import type { EncryptedBackupOptions, RestoreEncryptedBackupOptions } from './encryption.js';
import {
  MicrosoftAuthClient,
  type MicrosoftAuthClientOptions,
} from '../auth/microsoft.js';

export const MICROSOFT_GRAPH_DRIVE = 'https://graph.microsoft.com/v1.0/me/drive';
const BACKUP_FOLDER = 'backups';

export class OneDriveBackupStorage implements BackupStorage {
  constructor(
    private readonly getAccessToken: BackupAccessTokenProvider,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async save(fileName: string, data: Uint8Array): Promise<void> {
    const token = await this.getAccessToken();
    const encodedName = encodeURIComponent(fileName);
    const url = `${MICROSOFT_GRAPH_DRIVE}/special/approot:/${BACKUP_FOLDER}/${encodedName}:/content`;

    const response = await this.fetcher(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: data.slice().buffer,
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = (await response.json()) as any;
        detail = body?.error?.message || response.statusText;
      } catch {
        detail = response.statusText;
      }
      throw new Error(`OneDrive upload failed (${response.status}): ${detail}`);
    }
  }

  async read(fileIdOrName: string): Promise<Uint8Array> {
    const token = await this.getAccessToken();
    let url = `${MICROSOFT_GRAPH_DRIVE}/items/${encodeURIComponent(fileIdOrName)}/content`;

    // Support reading directly by filename inside approot:/backups/
    if (fileIdOrName.endsWith('.db') && !fileIdOrName.startsWith('item-')) {
      url = `${MICROSOFT_GRAPH_DRIVE}/special/approot:/${BACKUP_FOLDER}/${encodeURIComponent(fileIdOrName)}:/content`;
    }

    const response = await this.fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`OneDrive download failed (${response.status}): ${response.statusText}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  async delete(fileIdOrName: string): Promise<void> {
    const token = await this.getAccessToken();
    let url = `${MICROSOFT_GRAPH_DRIVE}/items/${encodeURIComponent(fileIdOrName)}`;

    if (fileIdOrName.endsWith('.db') && !fileIdOrName.startsWith('item-')) {
      url = `${MICROSOFT_GRAPH_DRIVE}/special/approot:/${BACKUP_FOLDER}/${encodeURIComponent(fileIdOrName)}`;
    }

    const response = await this.fetcher(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`OneDrive delete failed (${response.status}): ${response.statusText}`);
    }
  }

  async list(): Promise<CloudBackupFile[]> {
    const token = await this.getAccessToken();
    const url = `${MICROSOFT_GRAPH_DRIVE}/special/approot:/${BACKUP_FOLDER}:/children?$select=id,name,size,lastModifiedDateTime`;

    const response = await this.fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 404) {
      return []; // Folder does not exist yet
    }

    if (!response.ok) {
      throw new Error(`OneDrive list failed (${response.status}): ${response.statusText}`);
    }

    const result = (await response.json()) as {
      value?: Array<{ id: string; name: string; size?: number; lastModifiedDateTime?: string }>;
    };

    return (result.value ?? [])
      .filter(item => item.name.endsWith('.db'))
      .map(item => ({
        id: item.id,
        name: item.name,
        size: item.size,
        modifiedAt: item.lastModifiedDateTime,
      }));
  }
}

export type OneDriveBackupClientOptions =
  | MicrosoftAuthClientOptions
  | {
      authClient: MicrosoftAuthClient;
      fetch?: typeof fetch;
    };

export class OneDriveBackupClient implements CloudBackupClient {
  private readonly storage: OneDriveBackupStorage;
  private readonly authClient: MicrosoftAuthClient;
  private readonly listeners = new Set<(connected: boolean) => void>();

  constructor(options: OneDriveBackupClientOptions) {
    if ('authClient' in options && options.authClient) {
      this.authClient = options.authClient;
      this.storage = new OneDriveBackupStorage(
        () => this.authClient.getValidAccessToken(),
        options.fetch ?? fetch,
      );
    } else {
      const msOptions = options as MicrosoftAuthClientOptions;
      const scopes = msOptions.scopes ?? [
        'openid',
        'profile',
        'email',
        'User.Read',
        'Files.ReadWrite.AppFolder',
      ];
      this.authClient = new MicrosoftAuthClient({
        ...msOptions,
        scopes,
      });
      this.storage = new OneDriveBackupStorage(
        () => this.authClient.getValidAccessToken(),
        msOptions.fetch ?? fetch,
      );
    }

    this.authClient.onAuthStateChange(user => {
      this.notify(Boolean(user));
    });
  }

  onStatusChange(listener: (connected: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(connected: boolean): void {
    for (const listener of this.listeners) {
      try {
        listener(connected);
      } catch (err) {
        console.error('Error in OneDriveBackupClient status listener:', err);
      }
    }
  }

  async connect(): Promise<boolean> {
    const user = await this.authClient.signIn();
    const connected = user !== null;
    this.notify(connected);
    return connected;
  }

  async disconnect(): Promise<void> {
    await this.authClient.signOut();
    this.notify(false);
  }

  async isConnected(): Promise<boolean> {
    return this.authClient.isSignedIn();
  }

  save(fileName: string, data: Uint8Array): Promise<void> {
    return this.storage.save(fileName, data);
  }

  read(fileId: string): Promise<Uint8Array> {
    return this.storage.read(fileId);
  }

  delete(fileIdOrName: string): Promise<void> {
    return this.storage.delete(fileIdOrName);
  }

  deleteBackup(fileIdOrName: string): Promise<void> {
    return this.delete(fileIdOrName);
  }

  list(): Promise<CloudBackupFile[]> {
    return this.storage.list();
  }

  backup(
    database: ResolvableBackupDatabase,
    options?: CreateDatabaseBackupOptions & Partial<EncryptedBackupOptions>,
  ): Promise<string> {
    return performBackup(database, this, options);
  }

  restore(
    database: ResolvableBackupDatabase,
    fileNameOrId: string,
    options?: Partial<RestoreEncryptedBackupOptions>,
  ): Promise<void> {
    return performRestore(database, this, fileNameOrId, options);
  }
}
