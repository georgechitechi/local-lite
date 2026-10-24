import { describe, expect, it, vi } from 'vitest';
import {
  GoogleAuthClient,
  createGoogleAuthTokenStore,
  createInMemoryGoogleTokenStore,
  type GoogleAuthKeyValueStorage,
  type GoogleUser,
} from '../src/auth/index.js';

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GoogleAuthClient', () => {
  const sampleUser: GoogleUser = {
    id: 'google-user-123',
    email: 'test@example.com',
    emailVerified: true,
    name: 'Test Parent',
    givenName: 'Test',
    familyName: 'Parent',
    picture: 'https://lh3.googleusercontent.com/photo.jpg',
  };

  it('performs PKCE authorization code flow and fetches user profile', async () => {
    let authorizationUrl = '';
    let tokenRequestBody: string | undefined;
    const authEvents: (GoogleUser | null)[] = [];

    const client = new GoogleAuthClient({
      clientId: 'google-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async request => {
        authorizationUrl = request.authorizationUrl;
        const state = new URL(request.authorizationUrl).searchParams.get('state');
        return { code: 'auth-code-123', state: state ?? '' };
      },
      randomBytes: length => new Uint8Array(length).fill(9),
      fetch: async (url, init) => {
        const urlStr = String(url);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          tokenRequestBody = String(init?.body);
          return jsonResponse({
            access_token: 'valid-access-token-1',
            refresh_token: 'valid-refresh-token-1',
            expires_in: 3600,
            token_type: 'Bearer',
          });
        }
        if (urlStr.includes('googleapis.com/oauth2/v3/userinfo')) {
          expect(init?.headers).toMatchObject({
            Authorization: 'Bearer valid-access-token-1',
          });
          return jsonResponse({
            sub: sampleUser.id,
            email: sampleUser.email,
            email_verified: sampleUser.emailVerified,
            name: sampleUser.name,
            given_name: sampleUser.givenName,
            family_name: sampleUser.familyName,
            picture: sampleUser.picture,
          });
        }
        return jsonResponse({}, 404);
      },
    });

    client.onAuthStateChange(user => {
      authEvents.push(user);
    });

    const user = await client.signIn();

    expect(user).toEqual(sampleUser);
    expect(authEvents).toEqual([sampleUser]);

    const authUrl = new URL(authorizationUrl);
    expect(authUrl.searchParams.get('client_id')).toBe('google-client-id-xyz');
    expect(authUrl.searchParams.get('redirect_uri')).toBe('myapp://oauth');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('scope')).toContain('openid');
    expect(authUrl.searchParams.get('scope')).toContain('email');
    expect(authUrl.searchParams.get('scope')).toContain('profile');
    expect(tokenRequestBody).toContain('code=auth-code-123');
    expect(tokenRequestBody).toContain('code_verifier=');
    expect(tokenRequestBody).toContain('grant_type=authorization_code');

    expect(await client.isSignedIn()).toBe(true);
    expect(await client.getUser()).toEqual(sampleUser);
    expect(await client.getValidAccessToken()).toBe('valid-access-token-1');
  });

  it('rejects mismatched state and prevents token exchange (CSRF protection)', async () => {
    const fetchMock = vi.fn();
    const client = new GoogleAuthClient({
      clientId: 'google-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async () => ({
        code: 'forged-code',
        state: 'tampered-state-xyz',
      }),
      fetch: fetchMock,
    });

    await expect(client.signIn()).rejects.toThrow('state validation failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await client.isSignedIn()).toBe(false);
  });

  it('handles user cancellation gracefully', async () => {
    const fetchMock = vi.fn();
    const client = new GoogleAuthClient({
      clientId: 'google-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async () => null,
      fetch: fetchMock,
    });

    const user = await client.signIn();
    expect(user).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await client.isSignedIn()).toBe(false);
  });

  it('refreshes expired access tokens automatically using refresh_token', async () => {
    const tokenStore = createInMemoryGoogleTokenStore();
    await tokenStore.setTokens({
      accessToken: 'expired-token',
      refreshToken: 'my-refresh-token',
      expiresAt: Date.now() - 5000,
    });

    const fetchMock = vi.fn(async (url: any) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return jsonResponse({
          access_token: 'fresh-refreshed-token',
          expires_in: 3600,
        });
      }
      return jsonResponse({}, 404);
    });

    const client = new GoogleAuthClient({
      clientId: 'google-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async () => null,
      tokenStore,
      fetch: fetchMock as any,
    });

    const token = await client.getValidAccessToken();
    expect(token).toBe('fresh-refreshed-token');
    expect(fetchMock).toHaveBeenCalledOnce();

    const stored = await tokenStore.getTokens();
    expect(stored?.accessToken).toBe('fresh-refreshed-token');
    expect(stored?.refreshToken).toBe('my-refresh-token');
  });

  it('signs out and clears stored tokens and user state', async () => {
    const authEvents: (GoogleUser | null)[] = [];
    const client = new GoogleAuthClient({
      clientId: 'google-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async req => ({ code: 'c', state: req.state }),
      fetch: async (url: any) => {
        if (String(url).includes('/token')) {
          return jsonResponse({ access_token: 't', expires_in: 3600 });
        }
        return jsonResponse({ sub: '1', email: 'a@b.com', name: 'A' });
      },
    });

    client.onAuthStateChange(u => authEvents.push(u));

    // Sign in first
    await client.signIn();
    expect(await client.isSignedIn()).toBe(true);

    // Now sign out
    await client.signOut();
    expect(await client.isSignedIn()).toBe(false);
    expect(await client.getUser()).toBeNull();
    expect(authEvents[authEvents.length - 1]).toBeNull();
  });

  it('persists tokens and user info via key-value storage adapter', async () => {
    const memory = new Map<string, unknown>();
    const storage: GoogleAuthKeyValueStorage = {
      getItem: async key => memory.get(key) ?? null,
      setItem: async (key, val) => {
        memory.set(key, val);
      },
      removeItem: async key => {
        memory.delete(key);
      },
    };

    const store = createGoogleAuthTokenStore(storage, 'test-app');
    await store.setTokens({
      accessToken: 'access-123',
      refreshToken: 'refresh-123',
      expiresAt: 999999999,
    });
    await store.setUser(sampleUser);

    expect(await store.getTokens()).toMatchObject({ accessToken: 'access-123' });
    expect(await store.getUser()).toEqual(sampleUser);

    await store.removeTokens();
    await store.setUser(null);

    expect(await store.getTokens()).toBeNull();
    expect(await store.getUser()).toBeNull();
  });

  it('creates compatible Google Drive backup storage from the auth client', async () => {
    const tokenStore = createInMemoryGoogleTokenStore();
    await tokenStore.setTokens({
      accessToken: 'token-for-drive',
      expiresAt: Date.now() + 600000,
    });

    const client = new GoogleAuthClient({
      clientId: 'google-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async () => null,
      tokenStore,
    });

    const driveStorage = client.createDriveBackupStorage();
    expect(driveStorage).toBeDefined();
    expect(typeof driveStorage.save).toBe('function');
    expect(typeof driveStorage.read).toBe('function');
    expect(typeof driveStorage.list).toBe('function');
  });
});
