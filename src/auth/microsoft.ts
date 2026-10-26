import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import {
  OneDriveBackupStorage,
  OneDriveBackupClient,
  type OneDriveBackupClientOptions,
} from '../backups/onedrive.js';

export const MICROSOFT_GRAPH_ENDPOINT = 'https://graph.microsoft.com/v1.0';
export const DEFAULT_MICROSOFT_AUTH_SCOPES = ['openid', 'profile', 'email', 'User.Read'];

export interface MicrosoftUser {
  id: string;
  email: string;
  name: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  userPrincipalName?: string;
}

export interface MicrosoftAuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export interface MicrosoftAuthTokenStore {
  getTokens(): Promise<MicrosoftAuthTokens | null>;
  setTokens(tokens: MicrosoftAuthTokens): Promise<void>;
  removeTokens(): Promise<void>;
  getUser(): Promise<MicrosoftUser | null>;
  setUser(user: MicrosoftUser | null): Promise<void>;
}

export interface MicrosoftAuthKeyValueStorage {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface MicrosoftAuthorizationRequest {
  authorizationUrl: string;
  redirectUri: string;
  state: string;
}

export interface MicrosoftAuthorizationResponse {
  code: string;
  state: string;
}

export interface MicrosoftAuthClientOptions {
  clientId: string;
  redirectUri: string;
  tenantId?: 'common' | 'consumers' | 'organizations' | string;
  scopes?: string[];
  authorize: (
    request: MicrosoftAuthorizationRequest,
  ) => Promise<MicrosoftAuthorizationResponse | null>;
  tokenStore?: MicrosoftAuthTokenStore;
  storage?: MicrosoftAuthKeyValueStorage;
  randomBytes?: (length: number) => Uint8Array;
  fetch?: typeof fetch;
  prompt?: 'select_account' | 'consent' | 'login' | 'none';
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

function validateTokens(value: unknown): value is MicrosoftAuthTokens {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as Partial<MicrosoftAuthTokens>;
  return (
    typeof tokens.accessToken === 'string' &&
    typeof tokens.expiresAt === 'number' &&
    (tokens.refreshToken === undefined || typeof tokens.refreshToken === 'string') &&
    (tokens.idToken === undefined || typeof tokens.idToken === 'string')
  );
}

function validateUser(value: unknown): value is MicrosoftUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<MicrosoftUser>;
  return (
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.name === 'string'
  );
}

export function createInMemoryMicrosoftTokenStore(): MicrosoftAuthTokenStore {
  let storedTokens: MicrosoftAuthTokens | null = null;
  let storedUser: MicrosoftUser | null = null;
  return {
    getTokens: async () => storedTokens,
    setTokens: async tokens => {
      storedTokens = tokens;
    },
    removeTokens: async () => {
      storedTokens = null;
    },
    getUser: async () => storedUser,
    setUser: async user => {
      storedUser = user;
    },
  };
}

export function createMicrosoftAuthTokenStore(
  storage: MicrosoftAuthKeyValueStorage,
  prefix = 'local-lite-microsoft-auth',
): MicrosoftAuthTokenStore {
  const tokensKey = `${prefix}-tokens`;
  const userKey = `${prefix}-user`;
  return {
    getTokens: async () => {
      const raw = await storage.getItem(tokensKey);
      return validateTokens(raw) ? raw : null;
    },
    setTokens: tokens => storage.setItem(tokensKey, tokens),
    removeTokens: () => storage.removeItem(tokensKey),
    getUser: async () => {
      const raw = await storage.getItem(userKey);
      return validateUser(raw) ? raw : null;
    },
    setUser: async user => {
      if (user) {
        await storage.setItem(userKey, user);
      } else {
        await storage.removeItem(userKey);
      }
    },
  };
}

export class MicrosoftAuthClient {
  private readonly tokenStore: MicrosoftAuthTokenStore;
  private readonly fetcher: typeof fetch;
  private readonly listeners = new Set<(user: MicrosoftUser | null) => void>();
  private readonly tenant: string;
  private currentUser: MicrosoftUser | null = null;

  constructor(private readonly options: MicrosoftAuthClientOptions) {
    if (!options.clientId?.trim()) {
      throw new Error('Microsoft OAuth client ID is required.');
    }
    if (!options.redirectUri?.trim()) {
      throw new Error('Microsoft OAuth redirect URI is required.');
    }

    this.tenant = options.tenantId?.trim() || 'common';
    this.fetcher = options.fetch ?? fetch;

    if (options.tokenStore) {
      this.tokenStore = options.tokenStore;
    } else if (options.storage) {
      this.tokenStore = createMicrosoftAuthTokenStore(options.storage);
    } else {
      this.tokenStore = createInMemoryMicrosoftTokenStore();
    }
  }

  get authorizationEndpoint(): string {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize`;
  }

  get tokenEndpoint(): string {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`;
  }

  onAuthStateChange(listener: (user: MicrosoftUser | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(user: MicrosoftUser | null): void {
    this.currentUser = user;
    for (const listener of this.listeners) {
      try {
        listener(user);
      } catch (err) {
        console.error('Error in MicrosoftAuthClient listener:', err);
      }
    }
  }

  async signIn(): Promise<MicrosoftUser | null> {
    const randomBytes = this.options.randomBytes ?? secureRandomBytes;
    const verifierBytes = randomBytes(32);
    const stateBytes = randomBytes(32);
    if (verifierBytes.length !== 32 || stateBytes.length !== 32) {
      throw new Error('The randomBytes provider returned an invalid number of bytes.');
    }

    const codeVerifier = base64UrlEncode(verifierBytes);
    const codeChallenge = base64UrlEncode(sha256(utf8ToBytes(codeVerifier)));
    const state = base64UrlEncode(stateBytes);

    const scopes = this.options.scopes && this.options.scopes.length > 0
      ? this.options.scopes
      : DEFAULT_MICROSOFT_AUTH_SCOPES;

    const authorizationParams = new URLSearchParams({
      client_id: this.options.clientId,
      response_type: 'code',
      redirect_uri: this.options.redirectUri,
      response_mode: 'query',
      scope: scopes.join(' '),
      prompt: this.options.prompt ?? 'select_account',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });

    const authorization = await this.options.authorize({
      authorizationUrl: `${this.authorizationEndpoint}?${authorizationParams.toString()}`,
      redirectUri: this.options.redirectUri,
      state,
    });

    if (!authorization) {
      return null;
    }

    if (authorization.state !== state) {
      throw new Error('Microsoft OAuth state validation failed. Please try connecting again.');
    }

    if (!authorization.code) {
      throw new Error('Microsoft OAuth did not return an authorization code.');
    }

    const response = await this.fetcher(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        code: authorization.code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: this.options.redirectUri,
        scope: scopes.join(' '),
      }).toString(),
    });

    const payload = (await response.json()) as any;
    if (!response.ok) {
      throw new Error(
        payload.error_description || payload.error || `Microsoft OAuth token request failed (${response.status}).`
      );
    }

    if (!payload.access_token) {
      throw new Error('Microsoft OAuth did not return an access token.');
    }

    const priorTokens = await this.tokenStore.getTokens();
    const storedTokens: MicrosoftAuthTokens = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? priorTokens?.refreshToken,
      idToken: payload.id_token ?? priorTokens?.idToken,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
      tokenType: payload.token_type,
      scope: payload.scope,
    };

    await this.tokenStore.setTokens(storedTokens);

    const user = await this.fetchUserProfile(storedTokens.accessToken);
    await this.tokenStore.setUser(user);
    this.notify(user);
    return user;
  }

  async signOut(): Promise<void> {
    await this.tokenStore.removeTokens();
    await this.tokenStore.setUser(null);
    this.notify(null);
  }

  async isSignedIn(): Promise<boolean> {
    const tokens = await this.tokenStore.getTokens();
    return validateTokens(tokens);
  }

  async getUser(): Promise<MicrosoftUser | null> {
    if (this.currentUser) {
      return this.currentUser;
    }

    const cached = await this.tokenStore.getUser();
    if (cached) {
      this.currentUser = cached;
      return cached;
    }

    const tokens = await this.tokenStore.getTokens();
    if (!validateTokens(tokens)) {
      return null;
    }

    try {
      const accessToken = await this.getValidAccessToken();
      const user = await this.fetchUserProfile(accessToken);
      await this.tokenStore.setUser(user);
      this.currentUser = user;
      return user;
    } catch {
      return null;
    }
  }

  async getValidAccessToken(): Promise<string> {
    const tokens = await this.tokenStore.getTokens();
    if (!validateTokens(tokens)) {
      throw new Error('No Microsoft account signed in. Please sign in first.');
    }

    if (tokens.expiresAt > Date.now() + 60_000) {
      return tokens.accessToken;
    }

    if (!tokens.refreshToken) {
      throw new Error('Your Microsoft sign-in session expired. Please sign in again.');
    }

    const scopes = this.options.scopes && this.options.scopes.length > 0
      ? this.options.scopes
      : DEFAULT_MICROSOFT_AUTH_SCOPES;

    const response = await this.fetcher(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        scope: scopes.join(' '),
      }).toString(),
    });

    const payload = (await response.json()) as any;
    if (!response.ok) {
      throw new Error(
        payload.error_description || payload.error || `Microsoft OAuth token refresh failed (${response.status}).`
      );
    }

    if (!payload.access_token) {
      throw new Error('Microsoft OAuth token refresh did not return an access token.');
    }

    const updatedTokens: MicrosoftAuthTokens = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? tokens.refreshToken,
      idToken: payload.id_token ?? tokens.idToken,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
      tokenType: payload.token_type ?? tokens.tokenType,
      scope: payload.scope ?? tokens.scope,
    };

    await this.tokenStore.setTokens(updatedTokens);
    return updatedTokens.accessToken;
  }

  private async fetchUserProfile(accessToken: string): Promise<MicrosoftUser> {
    const res = await this.fetcher(`${MICROSOFT_GRAPH_ENDPOINT}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch Microsoft user profile (${res.status}).`);
    }

    const raw = (await res.json()) as any;
    const email = raw.mail || raw.userPrincipalName || `${raw.id}@microsoft.account`;

    return {
      id: raw.id,
      email,
      name: raw.displayName || raw.givenName || email,
      givenName: raw.givenName,
      familyName: raw.surname,
      userPrincipalName: raw.userPrincipalName,
    };
  }

  createOneDriveBackupStorage(): OneDriveBackupStorage {
    return new OneDriveBackupStorage(
      () => this.getValidAccessToken(),
      this.fetcher,
    );
  }

  createOneDriveBackupClient(options?: Partial<OneDriveBackupClientOptions>): OneDriveBackupClient {
    return new OneDriveBackupClient({
      authClient: this,
      fetch: this.fetcher,
      ...options,
    });
  }
}

