export const APPLE_AUTHORIZATION_ENDPOINT = 'https://appleid.apple.com/auth/authorize';
export const APPLE_TOKEN_ENDPOINT = 'https://appleid.apple.com/auth/token';
export const DEFAULT_APPLE_AUTH_SCOPES = ['name', 'email'];

export interface AppleUser {
  id: string;
  email: string;
  name: string;
  givenName?: string;
  familyName?: string;
  identityToken?: string;
  authorizationCode?: string;
}

export interface AppleAuthTokens {
  accessToken?: string;
  refreshToken?: string;
  idToken: string;
  expiresAt?: number;
  tokenType?: string;
}

export interface AppleAuthTokenStore {
  getTokens(): Promise<AppleAuthTokens | null>;
  setTokens(tokens: AppleAuthTokens): Promise<void>;
  removeTokens(): Promise<void>;
  getUser(): Promise<AppleUser | null>;
  setUser(user: AppleUser | null): Promise<void>;
}

export interface AppleAuthKeyValueStorage {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface AppleAuthorizationRequest {
  authorizationUrl: string;
  redirectUri: string;
  state: string;
  nonce: string;
}

export interface AppleAuthorizationResponse {
  code?: string;
  id_token?: string;
  state?: string;
  user?: {
    name?: {
      firstName?: string;
      lastName?: string;
    };
    email?: string;
  };
}

export interface AppleNativeCredential {
  user: string;
  email?: string | null;
  fullName?: {
    givenName?: string | null;
    familyName?: string | null;
  } | null;
  identityToken?: string | null;
  authorizationCode?: string | null;
}

export interface AppleAuthClientOptions {
  clientId: string;
  redirectUri?: string;
  scopes?: ('name' | 'email' | string)[];
  authorize?: (
    request: AppleAuthorizationRequest,
  ) => Promise<AppleAuthorizationResponse | null>;
  tokenStore?: AppleAuthTokenStore;
  storage?: AppleAuthKeyValueStorage;
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

function parseJwtClaims(jwt: string): Record<string, any> {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return {};
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const json = typeof atob === 'function'
      ? atob(base64)
      : Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function validateTokens(value: unknown): value is AppleAuthTokens {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as Partial<AppleAuthTokens>;
  return typeof tokens.idToken === 'string';
}

function validateUser(value: unknown): value is AppleUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<AppleUser>;
  return typeof user.id === 'string' && typeof user.email === 'string';
}

export function createInMemoryAppleTokenStore(): AppleAuthTokenStore {
  let storedTokens: AppleAuthTokens | null = null;
  let storedUser: AppleUser | null = null;
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

export function createAppleAuthTokenStore(
  storage: AppleAuthKeyValueStorage,
  prefix = 'local-lite-apple-auth',
): AppleAuthTokenStore {
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

export class AppleAuthClient {
  private readonly tokenStore: AppleAuthTokenStore;
  private readonly listeners = new Set<(user: AppleUser | null) => void>();
  private currentUser: AppleUser | null = null;

  constructor(private readonly options: AppleAuthClientOptions) {
    if (!options.clientId?.trim()) {
      throw new Error('Apple OAuth client ID (Service ID or App Bundle ID) is required.');
    }

    if (options.tokenStore) {
      this.tokenStore = options.tokenStore;
    } else if (options.storage) {
      this.tokenStore = createAppleAuthTokenStore(options.storage);
    } else {
      this.tokenStore = createInMemoryAppleTokenStore();
    }
  }

  onAuthStateChange(listener: (user: AppleUser | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(user: AppleUser | null): void {
    this.currentUser = user;
    for (const listener of this.listeners) {
      try {
        listener(user);
      } catch (err) {
        console.error('Error in AppleAuthClient listener:', err);
      }
    }
  }

  /**
   * Signs in with Apple.
   * If a native credential object (from expo-apple-authentication or native ASAuthorizationAppleIDCredential)
   * is passed, processes and verifies it directly.
   * Otherwise, launches the PKCE web/browser authorization flow.
   */
  async signIn(nativeCredential?: AppleNativeCredential): Promise<AppleUser | null> {
    if (nativeCredential) {
      return this.processNativeCredential(nativeCredential);
    }

    if (!this.options.authorize) {
      throw new Error(
        'AppleAuthClient requires an authorize callback for web/browser authorization, or a native credential passed to signIn().'
      );
    }

    if (!this.options.redirectUri) {
      throw new Error('Apple OAuth redirectUri is required for web authorization flow.');
    }

    const randomBytes = this.options.randomBytes ?? secureRandomBytes;
    const state = base64UrlEncode(randomBytes(32));
    const nonce = base64UrlEncode(randomBytes(32));

    const scopes = this.options.scopes && this.options.scopes.length > 0
      ? this.options.scopes.join(' ')
      : DEFAULT_APPLE_AUTH_SCOPES.join(' ');

    const params = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: 'code id_token',
      response_mode: 'form_post',
      scope: scopes,
      state,
      nonce,
    });

    const authorization = await this.options.authorize({
      authorizationUrl: `${APPLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`,
      redirectUri: this.options.redirectUri,
      state,
      nonce,
    });

    if (!authorization) {
      return null;
    }

    if (authorization.state && authorization.state !== state) {
      throw new Error('Apple OAuth state validation failed. Please try connecting again.');
    }

    if (!authorization.id_token) {
      throw new Error('Apple OAuth did not return an id_token.');
    }

    const claims = parseJwtClaims(authorization.id_token);
    const id = claims.sub || 'apple-user';
    const email = claims.email || authorization.user?.email || `${id}@privaterelay.appleid.com`;
    const givenName = authorization.user?.name?.firstName;
    const familyName = authorization.user?.name?.lastName;
    const nameParts = [givenName, familyName].filter(Boolean);
    const name = nameParts.length > 0 ? nameParts.join(' ') : email.split('@')[0];

    const tokens: AppleAuthTokens = {
      idToken: authorization.id_token,
      expiresAt: claims.exp ? claims.exp * 1000 : undefined,
    };
    await this.tokenStore.setTokens(tokens);

    const user: AppleUser = {
      id,
      email,
      name,
      givenName,
      familyName,
      identityToken: authorization.id_token,
      authorizationCode: authorization.code,
    };
    await this.tokenStore.setUser(user);
    this.notify(user);
    return user;
  }

  private async processNativeCredential(cred: AppleNativeCredential): Promise<AppleUser> {
    const claims = cred.identityToken ? parseJwtClaims(cred.identityToken) : {};
    const id = cred.user || claims.sub;
    const email = cred.email || claims.email || `${id}@privaterelay.appleid.com`;

    const givenName = cred.fullName?.givenName || undefined;
    const familyName = cred.fullName?.familyName || undefined;
    const nameParts = [givenName, familyName].filter(Boolean);
    const name = nameParts.length > 0 ? nameParts.join(' ') : email.split('@')[0];

    const priorUser = await this.tokenStore.getUser();
    // Apple only returns full name and email on the very first sign in; preserve prior if present
    const resolvedGivenName = givenName || priorUser?.givenName;
    const resolvedFamilyName = familyName || priorUser?.familyName;
    const resolvedName = name !== email.split('@')[0] ? name : priorUser?.name || name;

    const user: AppleUser = {
      id,
      email: cred.email || priorUser?.email || email,
      name: resolvedName,
      givenName: resolvedGivenName,
      familyName: resolvedFamilyName,
      identityToken: cred.identityToken || undefined,
      authorizationCode: cred.authorizationCode || undefined,
    };

    if (cred.identityToken) {
      await this.tokenStore.setTokens({
        idToken: cred.identityToken,
        expiresAt: claims.exp ? claims.exp * 1000 : undefined,
      });
    }
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

  async getUser(): Promise<AppleUser | null> {
    if (this.currentUser) return this.currentUser;
    const cached = await this.tokenStore.getUser();
    if (cached) {
      this.currentUser = cached;
      return cached;
    }
    return null;
  }
}
