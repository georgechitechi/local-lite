import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import {
  GoogleDriveBackupStorage,
  GoogleDriveBackupClient,
  type GoogleDriveBackupClientOptions,
} from '../backups/cloud-storage.js';

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
export const DEFAULT_GOOGLE_AUTH_SCOPES = ['openid', 'email', 'profile'];

export interface GoogleUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  locale?: string;
}

export interface GoogleAuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export interface GoogleAuthTokenStore {
  getTokens(): Promise<GoogleAuthTokens | null>;
  setTokens(tokens: GoogleAuthTokens): Promise<void>;
  removeTokens(): Promise<void>;
  getUser(): Promise<GoogleUser | null>;
  setUser(user: GoogleUser | null): Promise<void>;
}

export interface GoogleAuthKeyValueStorage {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface GoogleAuthorizationRequest {
  authorizationUrl: string;
  redirectUri: string;
  state: string;
}

export interface GoogleAuthorizationResponse {
  code: string;
  state: string;
}

export interface GoogleAuthClientOptions {
  clientId: string;
  redirectUri: string;
  scopes?: string[];
  authorize: (
    request: GoogleAuthorizationRequest,
  ) => Promise<GoogleAuthorizationResponse | null>;
  tokenStore?: GoogleAuthTokenStore;
  storage?: GoogleAuthKeyValueStorage;
  randomBytes?: (length: number) => Uint8Array;
  fetch?: typeof fetch;
  prompt?: 'consent' | 'select_account' | 'none';
  accessType?: 'offline' | 'online';
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

function validateTokens(value: unknown): value is GoogleAuthTokens {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as Partial<GoogleAuthTokens>;
  return (
    typeof tokens.accessToken === 'string' &&
    typeof tokens.expiresAt === 'number' &&
    (tokens.refreshToken === undefined || typeof tokens.refreshToken === 'string') &&
    (tokens.idToken === undefined || typeof tokens.idToken === 'string')
  );
}

function validateUser(value: unknown): value is GoogleUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<GoogleUser>;
  return (
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.name === 'string'
  );
}

export function createInMemoryGoogleTokenStore(): GoogleAuthTokenStore {
  let storedTokens: GoogleAuthTokens | null = null;
  let storedUser: GoogleUser | null = null;
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

export function createGoogleAuthTokenStore(
  storage: GoogleAuthKeyValueStorage,
  prefix = 'local-lite-google-auth',
): GoogleAuthTokenStore {
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

async function parseTokenResponse(response: Response): Promise<{
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}> {
  try {
    return (await response.json()) as any;
  } catch {
    throw new Error(`Google OAuth request failed (${response.status}).`);
  }
}

function throwOAuthError(
  payload: { error?: string; error_description?: string },
  status: number,
): never {
  throw new Error(
    payload.error_description ||
      payload.error ||
      `Google OAuth request failed (${status}).`,
  );
}

export class GoogleAuthClient {
  private readonly tokenStore: GoogleAuthTokenStore;
  private readonly fetcher: typeof fetch;
  private readonly listeners = new Set<(user: GoogleUser | null) => void>();
  private currentUser: GoogleUser | null = null;

  constructor(private readonly options: GoogleAuthClientOptions) {
    if (!options.clientId?.trim()) {
      throw new Error('Google OAuth client ID is required.');
    }
    if (!options.redirectUri?.trim()) {
      throw new Error('Google OAuth redirect URI is required.');
    }

    this.fetcher = options.fetch ?? fetch;
    if (options.tokenStore) {
      this.tokenStore = options.tokenStore;
    } else if (options.storage) {
      this.tokenStore = createGoogleAuthTokenStore(options.storage);
    } else {
      this.tokenStore = createInMemoryGoogleTokenStore();
    }
  }

  onAuthStateChange(listener: (user: GoogleUser | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(user: GoogleUser | null): void {
    this.currentUser = user;
    for (const listener of this.listeners) {
      try {
        listener(user);
      } catch (err) {
        console.error('Error in GoogleAuthClient auth listener:', err);
      }
    }
  }

  async signIn(): Promise<GoogleUser | null> {
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
      : DEFAULT_GOOGLE_AUTH_SCOPES;

    const authorizationParams = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: this.options.accessType ?? 'offline',
      prompt: this.options.prompt ?? 'select_account',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });

    const authorization = await this.options.authorize({
      authorizationUrl: `${GOOGLE_AUTHORIZATION_ENDPOINT}?${authorizationParams.toString()}`,
      redirectUri: this.options.redirectUri,
      state,
    });

    if (!authorization) {
      return null;
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
        client_id: this.options.clientId,
        code: authorization.code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: this.options.redirectUri,
      }).toString(),
    });

    const payload = await parseTokenResponse(response);
    if (!response.ok) {
      throwOAuthError(payload, response.status);
    }

    if (!payload.access_token) {
      throw new Error('Google OAuth did not return an access token.');
    }

    const priorTokens = await this.tokenStore.getTokens();
    const storedTokens: GoogleAuthTokens = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? priorTokens?.refreshToken,
      idToken: payload.id_token ?? priorTokens?.idToken,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
      tokenType: payload.token_type,
      scope: payload.scope,
    };

    await this.tokenStore.setTokens(storedTokens);

    const user = await this.fetchUserProfile(storedTokens.accessToken);
    if (this.tokenStore.setUser) {
      await this.tokenStore.setUser(user);
    }

    this.notify(user);
    return user;
  }

  async signOut(): Promise<void> {
    await this.tokenStore.removeTokens();
    if (this.tokenStore.setUser) {
      await this.tokenStore.setUser(null);
    }
    this.notify(null);
  }

  async isSignedIn(): Promise<boolean> {
    const tokens = await this.tokenStore.getTokens();
    return validateTokens(tokens);
  }

  async getUser(): Promise<GoogleUser | null> {
    if (this.currentUser) {
      return this.currentUser;
    }

    if (this.tokenStore.getUser) {
      const cached = await this.tokenStore.getUser();
      if (cached) {
        this.currentUser = cached;
        return cached;
      }
    }

    const tokens = await this.tokenStore.getTokens();
    if (!validateTokens(tokens)) {
      return null;
    }

    try {
      const accessToken = await this.getValidAccessToken();
      const user = await this.fetchUserProfile(accessToken);
      if (this.tokenStore.setUser) {
        await this.tokenStore.setUser(user);
      }
      this.currentUser = user;
      return user;
    } catch {
      return null;
    }
  }

  async getValidAccessToken(): Promise<string> {
    const tokens = await this.tokenStore.getTokens();
    if (!validateTokens(tokens)) {
      throw new Error('No Google account signed in. Please sign in first.');
    }

    if (tokens.expiresAt > Date.now() + 60_000) {
      return tokens.accessToken;
    }

    if (!tokens.refreshToken) {
      throw new Error('Your Google sign-in session expired. Please sign in again.');
    }

    const response = await this.fetcher(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }).toString(),
    });

    const payload = await parseTokenResponse(response);
    if (!response.ok) {
      throwOAuthError(payload, response.status);
    }

    if (!payload.access_token) {
      throw new Error('Google OAuth token refresh did not return an access token.');
    }

    const updatedTokens: GoogleAuthTokens = {
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

  private async fetchUserProfile(accessToken: string): Promise<GoogleUser> {
    const res = await this.fetcher(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch Google user profile (${res.status}).`);
    }

    const raw = (await res.json()) as any;
    return {
      id: raw.sub,
      email: raw.email,
      emailVerified: Boolean(raw.email_verified),
      name: raw.name || raw.email || 'Google User',
      givenName: raw.given_name,
      familyName: raw.family_name,
      picture: raw.picture,
      locale: raw.locale,
    };
  }

  createDriveBackupStorage(): GoogleDriveBackupStorage {
    return new GoogleDriveBackupStorage(
      () => this.getValidAccessToken(),
      this.fetcher,
    );
  }

  createDriveBackupClient(options: Partial<GoogleDriveBackupClientOptions> = {}): GoogleDriveBackupClient {
    return new GoogleDriveBackupClient({
      authClient: this,
      fetch: this.fetcher,
      ...options,
    });
  }
}
