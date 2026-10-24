export const GITHUB_AUTHORIZATION_ENDPOINT = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
export const GITHUB_API_ENDPOINT = 'https://api.github.com';
export const DEFAULT_GITHUB_AUTH_SCOPES = ['read:user', 'user:email'];

export interface GitHubUser {
  id: string;
  login: string;
  name: string;
  email: string;
  avatarUrl?: string;
  bio?: string;
  company?: string;
  location?: string;
}

export interface GitHubAuthTokens {
  accessToken: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
}

export interface GitHubAuthTokenStore {
  getTokens(): Promise<GitHubAuthTokens | null>;
  setTokens(tokens: GitHubAuthTokens): Promise<void>;
  removeTokens(): Promise<void>;
  getUser(): Promise<GitHubUser | null>;
  setUser(user: GitHubUser | null): Promise<void>;
}

export interface GitHubAuthKeyValueStorage {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface GitHubAuthorizationRequest {
  authorizationUrl: string;
  redirectUri: string;
  state: string;
}

export interface GitHubAuthorizationResponse {
  code: string;
  state: string;
}

export interface GitHubAuthClientOptions {
  clientId: string;
  clientSecret?: string;
  tokenExchangeUrl?: string;
  redirectUri: string;
  scopes?: string[];
  authorize: (
    request: GitHubAuthorizationRequest,
  ) => Promise<GitHubAuthorizationResponse | null>;
  tokenStore?: GitHubAuthTokenStore;
  storage?: GitHubAuthKeyValueStorage;
  randomBytes?: (length: number) => Uint8Array;
  fetch?: typeof fetch;
  allowSignup?: boolean;
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

function validateTokens(value: unknown): value is GitHubAuthTokens {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as Partial<GitHubAuthTokens>;
  return typeof tokens.accessToken === 'string';
}

function validateUser(value: unknown): value is GitHubUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<GitHubUser>;
  return (
    typeof user.id === 'string' &&
    typeof user.login === 'string' &&
    typeof user.name === 'string'
  );
}

export function createInMemoryGitHubTokenStore(): GitHubAuthTokenStore {
  let storedTokens: GitHubAuthTokens | null = null;
  let storedUser: GitHubUser | null = null;
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

export function createGitHubAuthTokenStore(
  storage: GitHubAuthKeyValueStorage,
  prefix = 'local-lite-github-auth',
): GitHubAuthTokenStore {
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

export class GitHubAuthClient {
  private readonly tokenStore: GitHubAuthTokenStore;
  private readonly fetcher: typeof fetch;
  private readonly listeners = new Set<(user: GitHubUser | null) => void>();
  private currentUser: GitHubUser | null = null;

  constructor(private readonly options: GitHubAuthClientOptions) {
    if (!options.clientId?.trim()) {
      throw new Error('GitHub OAuth client ID is required.');
    }
    if (!options.redirectUri?.trim()) {
      throw new Error('GitHub OAuth redirect URI is required.');
    }

    this.fetcher = options.fetch ?? fetch;

    if (options.tokenStore) {
      this.tokenStore = options.tokenStore;
    } else if (options.storage) {
      this.tokenStore = createGitHubAuthTokenStore(options.storage);
    } else {
      this.tokenStore = createInMemoryGitHubTokenStore();
    }
  }

  onAuthStateChange(listener: (user: GitHubUser | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(user: GitHubUser | null): void {
    this.currentUser = user;
    for (const listener of this.listeners) {
      try {
        listener(user);
      } catch (err) {
        console.error('Error in GitHubAuthClient listener:', err);
      }
    }
  }

  async signIn(): Promise<GitHubUser | null> {
    const randomBytes = this.options.randomBytes ?? secureRandomBytes;
    const stateBytes = randomBytes(32);
    if (stateBytes.length !== 32) {
      throw new Error('The randomBytes provider returned an invalid number of bytes.');
    }
    const state = base64UrlEncode(stateBytes);

    const scopes = this.options.scopes && this.options.scopes.length > 0
      ? this.options.scopes
      : DEFAULT_GITHUB_AUTH_SCOPES;

    const authorizationParams = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      scope: scopes.join(' '),
      state,
      allow_signup: String(this.options.allowSignup ?? true),
    });

    const authorization = await this.options.authorize({
      authorizationUrl: `${GITHUB_AUTHORIZATION_ENDPOINT}?${authorizationParams.toString()}`,
      redirectUri: this.options.redirectUri,
      state,
    });

    if (!authorization) {
      return null;
    }

    if (authorization.state !== state) {
      throw new Error('GitHub OAuth state validation failed. Please try connecting again.');
    }

    if (!authorization.code) {
      throw new Error('GitHub OAuth did not return an authorization code.');
    }

    const tokenEndpoint = this.options.tokenExchangeUrl || GITHUB_TOKEN_ENDPOINT;
    const requestPayload: Record<string, string> = {
      client_id: this.options.clientId,
      code: authorization.code,
      redirect_uri: this.options.redirectUri,
      state,
    };

    if (this.options.clientSecret) {
      requestPayload.client_secret = this.options.clientSecret;
    }

    const response = await this.fetcher(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestPayload),
    });

    const payload = (await response.json()) as any;
    if (!response.ok || payload.error) {
      throw new Error(
        payload.error_description || payload.error || `GitHub OAuth token exchange failed (${response.status}).`
      );
    }

    if (!payload.access_token) {
      throw new Error('GitHub OAuth did not return an access token.');
    }

    const storedTokens: GitHubAuthTokens = {
      accessToken: payload.access_token,
      tokenType: payload.token_type,
      scope: payload.scope,
      expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined,
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

  async getUser(): Promise<GitHubUser | null> {
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
      const user = await this.fetchUserProfile(tokens.accessToken);
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
      throw new Error('No GitHub account signed in. Please sign in first.');
    }
    return tokens.accessToken;
  }

  private async fetchUserProfile(accessToken: string): Promise<GitHubUser> {
    const res = await this.fetcher(`${GITHUB_API_ENDPOINT}/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'local-lite-auth',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch GitHub user profile (${res.status}).`);
    }

    const raw = (await res.json()) as any;
    let email = raw.email;

    // If email is private on profile, fetch from /user/emails endpoint
    if (!email) {
      try {
        const emailsRes = await this.fetcher(`${GITHUB_API_ENDPOINT}/user/emails`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'local-lite-auth',
          },
        });
        if (emailsRes.ok) {
          const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
          const primary = emails.find(e => e.primary && e.verified) || emails[0];
          if (primary) email = primary.email;
        }
      } catch {
        // Fallback to username generated placeholder if emails restricted
      }
    }

    return {
      id: String(raw.id),
      login: raw.login,
      name: raw.name || raw.login,
      email: email || `${raw.login}@users.noreply.github.com`,
      avatarUrl: raw.avatar_url,
      bio: raw.bio,
      company: raw.company,
      location: raw.location,
    };
  }
}
