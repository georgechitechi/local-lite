import { describe, expect, it, vi } from 'vitest';
import {
  GitHubAuthClient,
  createGitHubAuthTokenStore,
  createInMemoryGitHubTokenStore,
  type GitHubAuthKeyValueStorage,
  type GitHubUser,
} from '../src/auth/index.js';

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GitHubAuthClient', () => {
  const sampleUser: GitHubUser = {
    id: '123456',
    login: 'octocat',
    name: 'The Octocat',
    email: 'octocat@github.com',
    avatarUrl: 'https://github.com/images/error/octocat_happy.gif',
    bio: 'Open source mascot',
    location: 'San Francisco',
  };

  it('performs GitHub OAuth flow and fetches profile (with /user/emails fallback)', async () => {
    let authorizationUrl = '';
    let tokenPayload: any;
    const authEvents: (GitHubUser | null)[] = [];

    const client = new GitHubAuthClient({
      clientId: 'gh-client-id-xyz',
      clientSecret: 'gh-secret-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async request => {
        authorizationUrl = request.authorizationUrl;
        return { code: 'gh-auth-code-123', state: request.state };
      },
      fetch: async (url, init) => {
        const urlStr = String(url);
        if (urlStr.includes('/oauth/access_token')) {
          tokenPayload = JSON.parse(String(init?.body));
          return jsonResponse({
            access_token: 'gh-access-token-1',
            token_type: 'bearer',
            scope: 'read:user,user:email',
          });
        }
        if (urlStr.includes('api.github.com/user/emails')) {
          return jsonResponse([
            { email: 'secondary@github.com', primary: false, verified: true },
            { email: 'octocat@github.com', primary: true, verified: true },
          ]);
        }
        if (urlStr.includes('api.github.com/user')) {
          expect(init?.headers).toMatchObject({
            Authorization: 'Bearer gh-access-token-1',
          });
          return jsonResponse({
            id: 123456,
            login: 'octocat',
            name: 'The Octocat',
            email: null, // Test private email fallback to /user/emails
            avatar_url: 'https://github.com/images/error/octocat_happy.gif',
            bio: 'Open source mascot',
            location: 'San Francisco',
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
    expect(authUrl.searchParams.get('client_id')).toBe('gh-client-id-xyz');
    expect(authUrl.searchParams.get('redirect_uri')).toBe('myapp://oauth');
    expect(authUrl.searchParams.get('scope')).toContain('read:user');
    expect(authUrl.searchParams.get('scope')).toContain('user:email');

    expect(tokenPayload).toMatchObject({
      client_id: 'gh-client-id-xyz',
      client_secret: 'gh-secret-xyz',
      code: 'gh-auth-code-123',
    });

    expect(await client.isSignedIn()).toBe(true);
    expect(await client.getUser()).toEqual(sampleUser);
    expect(await client.getValidAccessToken()).toBe('gh-access-token-1');
  });

  it('rejects mismatched state (CSRF protection)', async () => {
    const fetchMock = vi.fn();
    const client = new GitHubAuthClient({
      clientId: 'gh-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async () => ({
        code: 'gh-code',
        state: 'tampered-state',
      }),
      fetch: fetchMock,
    });

    await expect(client.signIn()).rejects.toThrow('state validation failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles user cancellation gracefully', async () => {
    const client = new GitHubAuthClient({
      clientId: 'gh-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async () => null,
    });

    const user = await client.signIn();
    expect(user).toBeNull();
    expect(await client.isSignedIn()).toBe(false);
  });

  it('signs out and clears stored tokens', async () => {
    const tokenStore = createInMemoryGitHubTokenStore();
    await tokenStore.setTokens({ accessToken: 'gh-token-to-clear' });
    await tokenStore.setUser(sampleUser);

    const client = new GitHubAuthClient({
      clientId: 'gh-client-id-xyz',
      redirectUri: 'myapp://oauth',
      authorize: async () => null,
      tokenStore,
    });

    expect(await client.isSignedIn()).toBe(true);
    await client.signOut();
    expect(await client.isSignedIn()).toBe(false);
    expect(await tokenStore.getTokens()).toBeNull();
    expect(await tokenStore.getUser()).toBeNull();
  });

  it('persists tokens and user info via key-value storage adapter', async () => {
    const memory = new Map<string, unknown>();
    const storage: GitHubAuthKeyValueStorage = {
      getItem: async key => memory.get(key) ?? null,
      setItem: async (key, val) => {
        memory.set(key, val);
      },
      removeItem: async key => {
        memory.delete(key);
      },
    };

    const store = createGitHubAuthTokenStore(storage, 'test-app');
    await store.setTokens({ accessToken: 'access-gh' });
    await store.setUser(sampleUser);

    expect(await store.getTokens()).toMatchObject({ accessToken: 'access-gh' });
    expect(await store.getUser()).toEqual(sampleUser);

    await store.removeTokens();
    await store.setUser(null);

    expect(await store.getTokens()).toBeNull();
    expect(await store.getUser()).toBeNull();
  });
});
