import { describe, expect, it, vi } from 'vitest';
import {
  AppleAuthClient,
  createAppleAuthTokenStore,
  createInMemoryAppleTokenStore,
  type AppleAuthKeyValueStorage,
  type AppleUser,
} from '../src/auth/index.js';

describe('AppleAuthClient', () => {
  const sampleUser: AppleUser = {
    id: 'apple-user-001',
    email: 'parent@privaterelay.appleid.com',
    name: 'Jane Doe',
    givenName: 'Jane',
    familyName: 'Doe',
    identityToken: 'header.eyJzdWIiOiJhcHBsZS11c2VyLTAwMSIsImVtYWlsIjoicGFyZW50QHByaXZhdGVyZWxheS5hcHBsZWlkLmNvbSJ9.sig',
  };

  it('signs in with native Apple credential (iOS / expo-apple-authentication)', async () => {
    const authEvents: (AppleUser | null)[] = [];
    const client = new AppleAuthClient({
      clientId: 'com.example.app',
    });

    client.onAuthStateChange(user => authEvents.push(user));

    const user = await client.signIn({
      user: 'apple-user-001',
      email: 'parent@privaterelay.appleid.com',
      fullName: { givenName: 'Jane', familyName: 'Doe' },
      identityToken: 'header.eyJzdWIiOiJhcHBsZS11c2VyLTAwMSIsImVtYWlsIjoicGFyZW50QHByaXZhdGVyZWxheS5hcHBsZWlkLmNvbSJ9.signature',
      authorizationCode: 'auth-code-apple',
    });

    expect(user).toBeDefined();
    expect(user?.id).toBe('apple-user-001');
    expect(user?.name).toBe('Jane Doe');
    expect(user?.email).toBe('parent@privaterelay.appleid.com');
    expect(await client.isSignedIn()).toBe(true);
    expect(authEvents).toHaveLength(1);
    expect(authEvents[0]?.id).toBe('apple-user-001');
  });

  it('signs in via web authorization flow when native credential is not supplied', async () => {
    let authUrl = '';
    const client = new AppleAuthClient({
      clientId: 'com.example.service',
      redirectUri: 'https://example.com/oauth/apple',
      authorize: async req => {
        authUrl = req.authorizationUrl;
        return {
          id_token: 'header.eyJzdWIiOiJhcHBsZS11c2VyLTk5OSIsImVtYWlsIjoidXNlckBleGFtcGxlLmNvbSJ9.signature',
          state: req.state,
          user: { name: { firstName: 'Taylor', lastName: 'Swift' } },
        };
      },
    });

    const user = await client.signIn();
    expect(user?.id).toBe('apple-user-999');
    expect(user?.name).toBe('Taylor Swift');
    expect(authUrl).toContain('appleid.apple.com/auth/authorize');
    expect(authUrl).toContain('client_id=com.example.service');
  });

  it('signs out and clears stored tokens', async () => {
    const tokenStore = createInMemoryAppleTokenStore();
    await tokenStore.setUser(sampleUser);
    await tokenStore.setTokens({ idToken: 'some-token' });

    const client = new AppleAuthClient({
      clientId: 'com.example.app',
      tokenStore,
    });

    expect(await client.isSignedIn()).toBe(true);
    await client.signOut();
    expect(await client.isSignedIn()).toBe(false);
    expect(await tokenStore.getUser()).toBeNull();
  });

  it('persists tokens and user info via key-value storage adapter', async () => {
    const memory = new Map<string, unknown>();
    const storage: AppleAuthKeyValueStorage = {
      getItem: async key => memory.get(key) ?? null,
      setItem: async (key, val) => {
        memory.set(key, val);
      },
      removeItem: async key => {
        memory.delete(key);
      },
    };

    const store = createAppleAuthTokenStore(storage, 'test-apple');
    await store.setTokens({ idToken: 'token-apple-123' });
    await store.setUser(sampleUser);

    expect(await store.getTokens()).toMatchObject({ idToken: 'token-apple-123' });
    expect(await store.getUser()).toEqual(sampleUser);

    await store.removeTokens();
    await store.setUser(null);

    expect(await store.getTokens()).toBeNull();
    expect(await store.getUser()).toBeNull();
  });
});
