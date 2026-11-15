import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base64UrlEncode, requireSecureRandomBytes } from './crypto.js';

export interface OAuthKeyValueStorage {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface OAuthTokenStore<TTokens, TUser> {
  getTokens(): Promise<TTokens | null>;
  setTokens(tokens: TTokens): Promise<void>;
  removeTokens(): Promise<void>;
  getUser(): Promise<TUser | null>;
  setUser(user: TUser | null): Promise<void>;
}

export function createInMemoryOAuthTokenStore<TTokens, TUser>(): OAuthTokenStore<
  TTokens,
  TUser
> {
  let storedTokens: TTokens | null = null;
  let storedUser: TUser | null = null;
  return {
    getTokens: async () => storedTokens,
    setTokens: async (tokens) => {
      storedTokens = tokens;
    },
    removeTokens: async () => {
      storedTokens = null;
    },
    getUser: async () => storedUser,
    setUser: async (user) => {
      storedUser = user;
    },
  };
}

export function createOAuthTokenStore<TTokens, TUser>(
  storage: OAuthKeyValueStorage,
  prefix: string,
  validateTokens: (value: unknown) => value is TTokens,
  validateUser: (value: unknown) => value is TUser,
): OAuthTokenStore<TTokens, TUser> {
  const tokensKey = `${prefix}-tokens`;
  const userKey = `${prefix}-user`;
  return {
    getTokens: async () => {
      const raw = await storage.getItem(tokensKey);
      return validateTokens(raw) ? raw : null;
    },
    setTokens: (tokens) => storage.setItem(tokensKey, tokens),
    removeTokens: () => storage.removeItem(tokensKey),
    getUser: async () => {
      const raw = await storage.getItem(userKey);
      return validateUser(raw) ? raw : null;
    },
    setUser: async (user) => {
      if (user) {
        await storage.setItem(userKey, user);
      } else {
        await storage.removeItem(userKey);
      }
    },
  };
}

export interface OAuthTokenErrorPayload {
  error?: string;
  error_description?: string;
}

export async function parseOAuthTokenResponse<
  T extends OAuthTokenErrorPayload = Record<string, any>,
>(response: Response, providerLabel: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`${providerLabel} OAuth request failed (${response.status}).`);
  }
}

export function throwOAuthError(
  payload: OAuthTokenErrorPayload,
  status: number,
  providerLabel: string,
): never {
  throw new Error(
    payload.error_description ||
      payload.error ||
      `${providerLabel} OAuth request failed (${status}).`,
  );
}

export interface PkceChallengePair {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

/**
 * Generates a PKCE S256 verifier/challenge pair and an OAuth state token using a CSPRNG.
 */
export function createPkceChallengePair(
  randomBytes: (length: number) => Uint8Array = requireSecureRandomBytes,
): PkceChallengePair {
  const verifierBytes = randomBytes(32);
  const stateBytes = randomBytes(32);
  if (verifierBytes.length !== 32 || stateBytes.length !== 32) {
    throw new Error(
      'The randomBytes provider returned an invalid number of bytes.',
    );
  }
  const codeVerifier = base64UrlEncode(verifierBytes);
  const codeChallenge = base64UrlEncode(sha256(utf8ToBytes(codeVerifier)));
  const state = base64UrlEncode(stateBytes);
  return { codeVerifier, codeChallenge, state };
}
