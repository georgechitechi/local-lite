import { describe, expect, it, vi } from 'vitest';
import {
  MicrosoftAuthClient,
  OneDriveAuthClient,
  createMicrosoftAuthTokenStore,
  createInMemoryMicrosoftTokenStore,
  type MicrosoftAuthKeyValueStorage,
  type MicrosoftUser,
} from '../src/auth/index.js';

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MicrosoftAuthClient / OneDriveAuthClient', () => {
  const sampleUser: MicrosoftUser = {
    id: 'ms-user-789',
    email: 'developer@outlook.com',
    name: 'Morgan Taylor',
    givenName: 'Morgan',
    familyName: 'Taylor',
    userPrincipalName: 'developer@outlook.com',
  };

  it('performs PKCE authorization code flow and fetches Microsoft Graph user profile', async () => {
    let authorizationUrl = '';
    let tokenRequestBody: string | undefined;
    const authEvents: (MicrosoftUser | null)[] = [];

    const client = new MicrosoftAuthClient({
      clientId: 'ms-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async request => {
        authorizationUrl = request.authorizationUrl;
        return { code: 'ms-auth-code-123', state: request.state };
      },
      randomBytes: length => new Uint8Array(length).fill(3),
      fetch: async (url, init) => {
        const urlStr = String(url);
        if (urlStr.includes('/oauth2/v2.0/token')) {
          tokenRequestBody = String(init?.body);
          return jsonResponse({
            access_token: 'ms-access-token-1',
            refresh_token: 'ms-refresh-token-1',
            expires_in: 3600,
            token_type: 'Bearer',
          });
        }
        if (urlStr.includes('graph.microsoft.com/v1.0/me')) {
          expect(init?.headers).toMatchObject({
            Authorization: 'Bearer ms-access-token-1',
          });
          return jsonResponse({
            id: sampleUser.id,
            displayName: sampleUser.name,
            givenName: sampleUser.givenName,
            surname: sampleUser.familyName,
            mail: sampleUser.email,
            userPrincipalName: sampleUser.userPrincipalName,
          });
        }
        return jsonResponse({}, 404);
      },
    });

    client.onAuthStateChange(user => authEvents.push(user));

    const user = await client.signIn();

    expect(user).toEqual(sampleUser);
    expect(authEvents).toEqual([sampleUser]);

    const authUrl = new URL(authorizationUrl);
    expect(authUrl.searchParams.get('client_id')).toBe('ms-client-id-xyz');
    expect(authUrl.searchParams.get('redirect_uri')).toBe('myapp://oauth');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('scope')).toContain('User.Read');
    expect(tokenRequestBody).toContain('code=ms-auth-code-123');
    expect(tokenRequestBody).toContain('grant_type=authorization_code');

    expect(await client.isSignedIn()).toBe(true);
    expect(await client.getUser()).toEqual(sampleUser);
    expect(await client.getValidAccessToken()).toBe('ms-access-token-1');
  });

  it('rejects mismatched state (CSRF protection)', async () => {
    const fetchMock = vi.fn();
    const client = new MicrosoftAuthClient({
      clientId: 'ms-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async () => ({
        code: 'ms-code',
        state: 'tampered-state',
      }),
      fetch: fetchMock,
    });

    await expect(client.signIn()).rejects.toThrow('state validation failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles user cancellation gracefully', async () => {
    const client = new MicrosoftAuthClient({
      clientId: 'ms-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async () => null,
    });

    const user = await client.signIn();
    expect(user).toBeNull();
    expect(await client.isSignedIn()).toBe(false);
  });

  it('refreshes expired access tokens automatically using refresh_token', async () => {
    const tokenStore = createInMemoryMicrosoftTokenStore();
    await tokenStore.setTokens({
      accessToken: 'expired-token',
      refreshToken: 'my-ms-refresh-token',
      expiresAt: Date.now() - 5000,
    });

    const client = new MicrosoftAuthClient({
      clientId: 'ms-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async () => null,
      tokenStore,
      fetch: async (url: any) => {
        if (String(url).includes('/token')) {
          return jsonResponse({
            access_token: 'new-ms-token',
            expires_in: 3600,
          });
        }
        return jsonResponse({}, 404);
      },
    });

    const token = await client.getValidAccessToken();
    expect(token).toBe('new-ms-token');
    const stored = await tokenStore.getTokens();
    expect(stored?.accessToken).toBe('new-ms-token');
    expect(stored?.refreshToken).toBe('my-ms-refresh-token');
  });

  it('OneDriveAuthClient works as an alias to MicrosoftAuthClient', () => {
    expect(OneDriveAuthClient).toBe(MicrosoftAuthClient);
  });

  it('persists tokens and user info via key-value storage adapter', async () => {
    const memory = new Map<string, unknown>();
    const storage: MicrosoftAuthKeyValueStorage = {
      getItem: async key => memory.get(key) ?? null,
      setItem: async (key, val) => {
        memory.set(key, val);
      },
      removeItem: async key => {
        memory.delete(key);
      },
    };

    const store = createMicrosoftAuthTokenStore(storage, 'test-app');
    await store.setTokens({
      accessToken: 'access-ms',
      refreshToken: 'refresh-ms',
      expiresAt: 999999999,
    });
    await store.setUser(sampleUser);

    expect(await store.getTokens()).toMatchObject({ accessToken: 'access-ms' });
    expect(await store.getUser()).toEqual(sampleUser);

    await store.removeTokens();
    await store.setUser(null);

    expect(await store.getTokens()).toBeNull();
    expect(await store.getUser()).toBeNull();
  });
});
