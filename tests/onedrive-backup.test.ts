import { describe, expect, it } from 'vitest';
import {
  OneDriveBackupStorage,
  OneDriveBackupClient,
  MICROSOFT_GRAPH_DRIVE,
} from '../src/backups/index.js';
import { createInMemoryMicrosoftTokenStore, type MicrosoftAuthTokens } from '../src/auth/microsoft.js';

function createTokenStore() {
  const store = createInMemoryMicrosoftTokenStore();
  return {
    store,
    getTokens: () => store.getTokens(),
  };
}

describe('OneDrive backup storage', () => {
  it('saves backups into approot:/backups/:fileName with PUT request', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? 'GET';
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = init?.body;
      return new Response(JSON.stringify({ id: 'item-123', name: 'test.db' }), { status: 200 });
    };

    const storage = new OneDriveBackupStorage(async () => 'fake-access-token', mockFetch as any);
    const backupData = new TextEncoder().encode('SQLite binary content');

    await storage.save('test-backup.db', backupData);

    expect(capturedUrl).toBe(
      `${MICROSOFT_GRAPH_DRIVE}/special/approot:/backups/test-backup.db:/content`,
    );
    expect(capturedMethod).toBe('PUT');
    expect(capturedHeaders.Authorization).toBe('Bearer fake-access-token');
    expect(capturedHeaders['Content-Type']).toBe('application/octet-stream');
  });

  it('reads backups by filename or id', async () => {
    const fileBytes = new TextEncoder().encode('Restored SQLite backup');
    let requestedUrl = '';

    const mockFetch = async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(fileBytes, { status: 200 });
    };

    const storage = new OneDriveBackupStorage(async () => 'fake-token', mockFetch as any);

    // Read by filename
    const data1 = await storage.read('snapshot.db');
    expect(requestedUrl).toBe(
      `${MICROSOFT_GRAPH_DRIVE}/special/approot:/backups/snapshot.db:/content`,
    );
    expect(data1).toEqual(fileBytes);

    // Read by item id
    const data2 = await storage.read('item-xyz987');
    expect(requestedUrl).toBe(`${MICROSOFT_GRAPH_DRIVE}/items/item-xyz987/content`);
    expect(data2).toEqual(fileBytes);
  });

  it('lists backup files in approot:/backups', async () => {
    const mockFetch = async () => {
      return new Response(
        JSON.stringify({
          value: [
            {
              id: 'file-1',
              name: 'local-lite-2026-01-01.db',
              size: 40960,
              lastModifiedDateTime: '2026-01-01T12:00:00Z',
            },
            {
              id: 'file-2',
              name: 'notes.txt', // Non-db file should be filtered out
              size: 100,
              lastModifiedDateTime: '2026-01-01T12:00:00Z',
            },
          ],
        }),
        { status: 200 },
      );
    };

    const storage = new OneDriveBackupStorage(async () => 'fake-token', mockFetch as any);
    const files = await storage.list();

    expect(files.length).toBe(1);
    expect(files[0]).toEqual({
      id: 'file-1',
      name: 'local-lite-2026-01-01.db',
      size: 40960,
      modifiedAt: '2026-01-01T12:00:00Z',
    });
  });

  it('handles 404 when listing empty approot gracefully', async () => {
    const mockFetch = async () => {
      return new Response('Not found', { status: 404 });
    };

    const storage = new OneDriveBackupStorage(async () => 'fake-token', mockFetch as any);
    const files = await storage.list();
    expect(files).toEqual([]);
  });

  it('OneDriveBackupClient connects using MicrosoftAuthClient and persists tokens', async () => {
    const tokenStore = createTokenStore();
    const client = new OneDriveBackupClient({
      clientId: 'ms-client-123',
      redirectUri: 'myapp://oauth-ms',
      authorize: async request => {
        const state = new URL(request.authorizationUrl).searchParams.get('state');
        return { code: 'ms-auth-code', state: state ?? '' };
      },
      tokenStore: tokenStore.store,
      randomBytes: len => new Uint8Array(len).fill(5),
      fetch: async (input: RequestInfo | URL) => {
        const urlStr = String(input);
        if (urlStr.includes('/oauth2/v2.0/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'ms-access-token',
              refresh_token: 'ms-refresh-token',
              expires_in: 3600,
              token_type: 'Bearer',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (urlStr.includes('/me')) {
          return new Response(
            JSON.stringify({ id: 'ms-user-1', displayName: 'Jane Doe', mail: 'jane@ms.com' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('OK', { status: 200 });
      },
    });

    const connected = await client.connect();
    expect(connected).toBe(true);
    expect(await client.isConnected()).toBe(true);

    const tokens = await tokenStore.getTokens();
    expect(tokens?.accessToken).toBe('ms-access-token');

    await client.disconnect();
    expect(await client.isConnected()).toBe(false);
  });
});
