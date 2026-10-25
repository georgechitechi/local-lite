import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import type {
  BackupStorage,
  CloudBackupClient,
  CreateDatabaseBackupOptions,
  ResolvableBackupDatabase,
} from './operations.js';
import { performBackup, performRestore } from './operations.js';
import type { EncryptedBackupOptions, RestoreEncryptedBackupOptions } from './encryption.js';
import type { GoogleAuthClient } from '../auth/google.js';

export interface CloudBackupFile {
  id: string;
  name: string;
  modifiedAt?: string;
  size?: number;
}

export type BackupAccessTokenProvider = () => Promise<string>;

const GOOGLE_API = 'https://www.googleapis.com/drive/v3';
const GOOGLE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_FOLDER = 'backups';

export interface GoogleDriveTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface GoogleDriveTokenStore {
  get(): Promise<GoogleDriveTokens | null>;
  set(tokens: GoogleDriveTokens): Promise<void>;
  remove(): Promise<void>;
}

export interface GoogleDriveKeyValueStorage {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface GoogleDriveAuthorizationRequest {
  authorizationUrl: string;
  redirectUri: string;
}

export interface GoogleDriveAuthorizationResponse {
  code: string;
  state: string;
}

export interface GoogleDriveBackupClientOptions {
  authClient?: GoogleAuthClient;
  clientId?: string;
  redirectUri?: string;
  authorize?: (
    request: GoogleDriveAuthorizationRequest,
  ) => Promise<GoogleDriveAuthorizationResponse | null>;
  tokenStore?: GoogleDriveTokenStore;
  storage?: GoogleDriveKeyValueStorage;
  randomBytes?: (length: number) => Uint8Array;
  fetch?: typeof fetch;
}

function secureRandomBytes(length: number): Uint8Array {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new Error('Secure random number generation is unavailable.');
  }
  return crypto.getRandomValues(new Uint8Array(length));
}

function base64UrlEncode(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    result += alphabet[first >> 2];
    result += alphabet[((first & 3) << 4) | (second === undefined ? 0 : second >> 4)];
    if (second !== undefined) {
      result += alphabet[((second & 15) << 2) | (third === undefined ? 0 : third >> 6)];
    }
    if (third !== undefined) result += alphabet[third & 63];
  }
  return result;
}

function validateGoogleTokens(value: unknown): value is GoogleDriveTokens {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as Partial<GoogleDriveTokens>;
  return (
    typeof tokens.accessToken === 'string' &&
    typeof tokens.expiresAt === 'number' &&
    (tokens.refreshToken === undefined || typeof tokens.refreshToken === 'string')
  );
}

export function createInMemoryGoogleDriveTokenStore(): GoogleDriveTokenStore {
  let stored: GoogleDriveTokens | null = null;
  return {
    get: async () => stored,
    set: async tokens => {
      stored = tokens;
    },
    remove: async () => {
      stored = null;
    },
  };
}

export function createGoogleDriveTokenStore(
  storage: GoogleDriveKeyValueStorage,
  key = 'local-lite-google-drive-backup-tokens',
): GoogleDriveTokenStore {
  return {
    get: async () => {
      const tokens = await storage.getItem(key);
      return validateGoogleTokens(tokens) ? tokens : null;
    },
    set: tokens => storage.setItem(key, tokens),
    remove: () => storage.removeItem(key),
  };
}

async function parseTokenResponse(response: Response): Promise<{
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}> {
  try {
    return (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
  } catch {
    throw new Error(`Google OAuth request failed (${response.status}).`);
  }
}

function createStoredTokens(
  payload: { access_token?: string; refresh_token?: string; expires_in?: number },
  prior?: GoogleDriveTokens | null,
): GoogleDriveTokens {
  if (!payload.access_token) {
    throw new Error('Google OAuth did not return an access token.');
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? prior?.refreshToken,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
}

function throwTokenError(
  payload: { error?: string; error_description?: string },
  status: number,
): never {
  throw new Error(
    payload.error_description ||
      payload.error ||
      `Google OAuth request failed (${status}).`,
  );
}

async function parseApiError(response: Response): Promise<Error> {
  let detail = '';
  try {
    const body = (await response.json()) as {
      error?: { message?: string } | string;
      error_description?: string;
      message?: string;
    };
    detail =
      (typeof body.error === 'object' ? body.error?.message : body.error) ??
      body.error_description ??
      body.message ??
      '';
  } catch {
    detail = response.statusText;
  }
  return new Error(
    `Google Drive request failed (${response.status})${detail ? `: ${detail}` : ''}`,
  );
}

async function getGoogleFolderId(
  token: string,
  fetcher: typeof fetch,
): Promise<string> {
  const query = encodeURIComponent(
    `name = '${BACKUP_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const lookup = await fetcher(
    `${GOOGLE_API}/files?q=${query}&spaces=drive&fields=files(id,name)&pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!lookup.ok) throw await parseApiError(lookup);
  const result = (await lookup.json()) as { files?: { id: string }[] };
  if (result.files?.[0]?.id) return result.files[0].id;

  const create = await fetcher(`${GOOGLE_API}/files?fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: BACKUP_FOLDER,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  if (!create.ok) throw await parseApiError(create);
  const folder = (await create.json()) as { id?: string };
  if (!folder.id) throw new Error('Google Drive did not return a backup folder ID.');
  return folder.id;
}

export class GoogleDriveBackupStorage implements BackupStorage {
  constructor(
    private readonly getAccessToken: BackupAccessTokenProvider,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async save(fileName: string, data: Uint8Array): Promise<void> {
    const token = await this.getAccessToken();
    const folderId = await getGoogleFolderId(token, this.fetcher);
    const session = await this.fetcher(
      `${GOOGLE_UPLOAD_API}/files?uploadType=resumable&fields=id`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'application/octet-stream',
          'X-Upload-Content-Length': String(data.byteLength),
        },
        body: JSON.stringify({
          name: fileName,
          mimeType: 'application/octet-stream',
          parents: [folderId],
        }),
      },
    );
    if (!session.ok) throw await parseApiError(session);
    const uploadUrl = session.headers.get('Location');
    if (!uploadUrl) {
      throw new Error('Google Drive did not return a resumable upload URL.');
    }

    const uploaded = await this.fetcher(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes 0-${data.byteLength - 1}/${data.byteLength}`,
      },
      body: data.slice().buffer,
    });
    if (!uploaded.ok) throw await parseApiError(uploaded);
  }

  async read(fileId: string): Promise<Uint8Array> {
    const token = await this.getAccessToken();
    const response = await this.fetcher(
      `${GOOGLE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw await parseApiError(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  async delete(fileId: string): Promise<void> {
    const token = await this.getAccessToken();
    const response = await this.fetcher(
      `${GOOGLE_API}/files/${encodeURIComponent(fileId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok && response.status !== 404) {
      throw await parseApiError(response);
    }
  }

  async list(): Promise<CloudBackupFile[]> {
    const token = await this.getAccessToken();
    const folderId = await getGoogleFolderId(token, this.fetcher);
    const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const response = await this.fetcher(
      `${GOOGLE_API}/files?q=${query}&fields=files(id,name,size,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw await parseApiError(response);
    const result = (await response.json()) as {
      files?: { id: string; name: string; size?: string; modifiedTime?: string }[];
    };
    return (result.files ?? [])
      .filter(file => file.name.endsWith('.db'))
      .map(file => ({
        id: file.id,
        name: file.name,
        modifiedAt: file.modifiedTime,
        size: file.size ? Number(file.size) : undefined,
      }));
  }
}

export class GoogleDriveBackupClient implements CloudBackupClient {
  private readonly storage: GoogleDriveBackupStorage;
  private readonly fetcher: typeof fetch;
  private readonly authClient?: GoogleAuthClient;
  private readonly tokenStore?: GoogleDriveTokenStore;
  private readonly listeners = new Set<(connected: boolean) => void>();

  constructor(private readonly options: GoogleDriveBackupClientOptions) {
    this.fetcher = options.fetch ?? fetch;

    if (options.authClient) {
      this.authClient = options.authClient;
      this.storage = new GoogleDriveBackupStorage(
        () => this.authClient!.getValidAccessToken(),
        this.fetcher,
      );
      this.authClient.onAuthStateChange(user => {
        this.notify(Boolean(user));
      });
    } else {
      if (!options.clientId?.trim()) {
        throw new Error('Google OAuth client ID is required when authClient is not provided.');
      }
      if (!options.redirectUri?.trim()) {
        throw new Error('Google OAuth redirect URI is required when authClient is not provided.');
      }
      if (!options.authorize) {
        throw new Error('Google OAuth authorize function is required when authClient is not provided.');
      }

      this.tokenStore =
        options.tokenStore ??
        (options.storage
          ? createGoogleDriveTokenStore(options.storage)
          : createInMemoryGoogleDriveTokenStore());

      this.storage = new GoogleDriveBackupStorage(
        () => this.getValidAccessToken(),
        this.fetcher,
      );
    }
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
        console.error('Error in GoogleDriveBackupClient status listener:', err);
      }
    }
  }

  async connect(): Promise<boolean> {
    if (this.authClient) {
      const user = await this.authClient.signIn();
      const connected = user !== null;
      this.notify(connected);
      return connected;
    }

    const randomBytes = this.options.randomBytes ?? secureRandomBytes;
    const verifierBytes = randomBytes(32);
    const stateBytes = randomBytes(32);
    if (verifierBytes.length !== 32 || stateBytes.length !== 32) {
      throw new Error('The randomBytes provider returned an invalid number of bytes.');
    }

    const codeVerifier = base64UrlEncode(verifierBytes);
    const codeChallenge = base64UrlEncode(sha256(utf8ToBytes(codeVerifier)));
    const state = base64UrlEncode(stateBytes);
    const authorizationParams = new URLSearchParams({
      client_id: this.options.clientId!,
      redirect_uri: this.options.redirectUri!,
      response_type: 'code',
      scope: GOOGLE_DRIVE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });
    const authorization = await this.options.authorize!({
      authorizationUrl: `${GOOGLE_AUTHORIZATION_ENDPOINT}?${authorizationParams}`,
      redirectUri: this.options.redirectUri!,
    });
    if (!authorization) {
      this.notify(false);
      return false;
    }
    if (authorization.state !== state) {
      throw new Error('Google OAuth state validation failed. Please try connecting again.');
    }
    if (!authorization.code) {
      throw new Error('Google OAuth did not return an authorization code.');
    }

    const response = await this.fetcher(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.options.clientId!,
        code: authorization.code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: this.options.redirectUri!,
      }).toString(),
    });
    const payload = await parseTokenResponse(response);
    if (!response.ok) throwTokenError(payload, response.status);
    const prior = await this.tokenStore!.get();
    await this.tokenStore!.set(createStoredTokens(payload, prior));
    this.notify(true);
    return true;
  }

  async disconnect(): Promise<void> {
    if (this.authClient) {
      await this.authClient.signOut();
    } else if (this.tokenStore) {
      await this.tokenStore.remove();
    }
    this.notify(false);
  }

  async isConnected(): Promise<boolean> {
    if (this.authClient) {
      return this.authClient.isSignedIn();
    }
    const tokens = await this.tokenStore!.get();
    return validateGoogleTokens(tokens);
  }

  async getValidAccessToken(): Promise<string> {
    if (this.authClient) {
      return this.authClient.getValidAccessToken();
    }

    const tokens = await this.tokenStore!.get();
    if (!validateGoogleTokens(tokens)) {
      throw new Error('Connect Google Drive before using cloud backups.');
    }
    if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
    if (!tokens.refreshToken) {
      throw new Error(
        'Your Google Drive sign-in expired. Disconnect and connect the account again.',
      );
    }

    const response = await this.fetcher(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.options.clientId!,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        scope: GOOGLE_DRIVE_SCOPE,
      }).toString(),
    });
    const payload = await parseTokenResponse(response);
    if (!response.ok) throwTokenError(payload, response.status);
    const updatedTokens = createStoredTokens(payload, tokens);
    await this.tokenStore!.set(updatedTokens);
    return updatedTokens.accessToken;
  }

  save(fileName: string, data: Uint8Array): Promise<void> {
    return this.storage.save(fileName, data);
  }

  read(fileId: string): Promise<Uint8Array> {
    return this.storage.read(fileId);
  }

  delete(fileId: string): Promise<void> {
    return this.storage.delete(fileId);
  }

  deleteBackup(fileId: string): Promise<void> {
    return this.delete(fileId);
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
