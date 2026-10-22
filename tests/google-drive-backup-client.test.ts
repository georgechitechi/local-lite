import { describe, expect, it, vi } from 'vitest';
import {
  GoogleDriveBackupClient,
  type GoogleDriveTokenStore,
  type GoogleDriveTokens,
} from '../src/backups/index.js';

function createTokenStore(): {
  store: GoogleDriveTokenStore;
  getTokens: () => GoogleDriveTokens | null;
} {
  let tokens: GoogleDriveTokens | null = null;
  return {
    store: {
      get: async () => tokens,
      set: async value => {
        tokens = value;
      },
      remove: async () => {
        tokens = null;
      },
    },
    getTokens: () => tokens,
  };
}

function response(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Google Drive backup client', () => {
  it('builds a PKCE authorization request and stores exchanged tokens', async () => {
    const tokenStore = createTokenStore();
    let authorizationUrl = '';
    let tokenRequest: RequestInit | undefined;
    const client = new GoogleDriveBackupClient({
      clientId: 'google-client-id',
      redirectUri: 'propertyadmin://oauth',
      authorize: async request => {
        authorizationUrl = request.authorizationUrl;
        const state = new URL(request.authorizationUrl).searchParams.get('state');
        return { code: 'authorization-code', state: state ?? '' };
      },
      tokenStore: tokenStore.store,
      randomBytes: length => new Uint8Array(length).fill(7),
      fetch: async (_input, init) => {
        tokenRequest = init;
        return response({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
        });
      },
    });

    await expect(client.connect()).resolves.toBe(true);

    const authorization = new URL(authorizationUrl);
    expect(authorization.searchParams.get('client_id')).toBe('google-client-id');
    expect(authorization.searchParams.get('redirect_uri')).toBe('propertyadmin://oauth');
    expect(authorization.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/drive.file',
    );
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(tokenRequest?.body).toContain('code_verifier=');
    expect(tokenStore.getTokens()).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(await client.isConnected()).toBe(true);
  });

  it('rejects a mismatched OAuth state without exchanging the code', async () => {
    const tokenStore = createTokenStore();
    const fetch = vi.fn(async () => response({ access_token: 'unused' }));
    const client = new GoogleDriveBackupClient({
      clientId: 'google-client-id',
      redirectUri: 'propertyadmin://oauth',
      authorize: async () => ({ code: 'authorization-code', state: 'wrong-state' }),
      tokenStore: tokenStore.store,
      randomBytes: length => new Uint8Array(length).fill(7),
      fetch,
    });

    await expect(client.connect()).rejects.toThrow('state validation failed');
    expect(fetch).not.toHaveBeenCalled();
    expect(tokenStore.getTokens()).toBeNull();
  });

  it('refreshes an expired access token and preserves its refresh token', async () => {
    const tokenStore = createTokenStore();
    await tokenStore.store.set({
      accessToken: 'expired-access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000,
    });
    const fetch = vi.fn(async () =>
      response({ access_token: 'new-access-token', expires_in: 3600 }),
    );
    const client = new GoogleDriveBackupClient({
      clientId: 'google-client-id',
      redirectUri: 'propertyadmin://oauth',
      authorize: async () => null,
      tokenStore: tokenStore.store,
      fetch,
    });

    await expect(client.getValidAccessToken()).resolves.toBe('new-access-token');
    expect(tokenStore.getTokens()).toMatchObject({
      accessToken: 'new-access-token',
      refreshToken: 'refresh-token',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not request authorization again when the user cancels', async () => {
    const tokenStore = createTokenStore();
    const fetch = vi.fn(async () => response({ access_token: 'unused' }));
    const client = new GoogleDriveBackupClient({
      clientId: 'google-client-id',
      redirectUri: 'propertyadmin://oauth',
      authorize: async () => null,
      tokenStore: tokenStore.store,
      randomBytes: length => new Uint8Array(length).fill(7),
      fetch,
    });

    await expect(client.connect()).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(tokenStore.getTokens()).toBeNull();
  });
});
