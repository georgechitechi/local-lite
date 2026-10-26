import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { MockDB } from './helpers/mock-db.js';
import { SessionManager } from '../src/auth/session.js';
import { useSession } from '../src/react/index.js';

interface TestUser {
  id: string;
  name: string;
  email: string;
  role: string;
  organizationId: string;
}

describe('SessionManager & Offline-First Session Management', () => {
  let db: MockDB;
  let network: DefaultNetworkStatusProvider;
  let client: LocalFirstClient;
  let sessionManager: SessionManager;

  const mockUser: TestUser = {
    id: 'user_101',
    name: 'Sarah Connor',
    email: 'sarah@skynet-patrol.org',
    role: 'ADMIN',
    organizationId: 'org_omega',
  };

  beforeEach(async () => {
    db = new MockDB();
    network = new DefaultNetworkStatusProvider(true); // online
    sessionManager = new SessionManager(db);
    await sessionManager.initialize();

    client = new LocalFirstClient({
      local: db,
      remote: new MemoryDemoRemoteAdapter(0),
      network,
      autoStart: false,
    });
    await client.initialize();
  });

  afterEach(() => {
    client.stop();
  });

  it('creates and persists a user session in SQLite', async () => {
    const session = await sessionManager.createSession<TestUser>({
      userId: mockUser.id,
      user: mockUser,
      token: 'jwt_access_token_abc',
      refreshToken: 'jwt_refresh_token_xyz',
      provider: 'google',
      offlineDurationMs: 14 * 24 * 60 * 60 * 1000, // 14 days
    });

    expect(session.id.startsWith('sess_')).toBe(true);
    expect(session.userId).toBe(mockUser.id);
    expect(session.user.name).toBe('Sarah Connor');
    expect(session.token).toBe('jwt_access_token_abc');
    expect(session.isActive).toBe(true);

    // Retrieve active session
    const active = await sessionManager.getActiveSession<TestUser>();
    expect(active).not.toBeNull();
    expect(active?.userId).toBe(mockUser.id);
    expect(active?.user.email).toBe('sarah@skynet-patrol.org');

    // Retrieve user directly
    const user = await sessionManager.getUser<TestUser>();
    expect(user?.role).toBe('ADMIN');

    expect(await sessionManager.isAuthenticated()).toBe(true);
  });

  it('session remains active and authenticated when device is offline', async () => {
    await client.session.createSession<TestUser>({
      userId: mockUser.id,
      user: mockUser,
      token: 'token_offline_test',
      expiresAt: Date.now() - 5000, // token technically expired remotely
      offlineDurationMs: 30 * 24 * 60 * 60 * 1000, // 30-day offline grace period
    });

    // Simulate device going offline
    network.setOnline(false);

    // User should STILL be authenticated offline!
    expect(await client.session.isAuthenticated()).toBe(true);

    const offlineUser = await client.session.getUser<TestUser>();
    expect(offlineUser).not.toBeNull();
    expect(offlineUser?.id).toBe(mockUser.id);
    expect(offlineUser?.name).toBe('Sarah Connor');

    const activeSession = await client.session.getActiveSession<TestUser>();
    expect(activeSession?.isActive).toBe(true);
  });

  it('allows updating user profile and tokens in place', async () => {
    await sessionManager.createSession<TestUser>({
      userId: mockUser.id,
      user: mockUser,
    });

    const updated = await sessionManager.updateUser<TestUser>({
      role: 'SUPER_ADMIN',
    });

    expect(updated?.user.role).toBe('SUPER_ADMIN');
    expect(updated?.user.name).toBe('Sarah Connor'); // retained other fields

    await sessionManager.updateTokens({
      token: 'renewed_access_token_999',
    });

    const refreshed = await sessionManager.getActiveSession();
    expect(refreshed?.token).toBe('renewed_access_token_999');
  });

  it('supports multi-session switching between accounts offline', async () => {
    // User 1
    await sessionManager.createSession<TestUser>({
      id: 'sess_user1',
      userId: 'user_1',
      user: { ...mockUser, id: 'user_1', name: 'User One' },
    });

    // User 2 (becomes active)
    await sessionManager.createSession<TestUser>({
      id: 'sess_user2',
      userId: 'user_2',
      user: { ...mockUser, id: 'user_2', name: 'User Two' },
    });

    let current = await sessionManager.getActiveSession<TestUser>();
    expect(current?.userId).toBe('user_2');

    // Switch back to User 1
    const switched = await sessionManager.switchSession<TestUser>('sess_user1');
    expect(switched?.userId).toBe('user_1');

    current = await sessionManager.getActiveSession<TestUser>();
    expect(current?.userId).toBe('user_1');
    expect(current?.user.name).toBe('User One');

    // List all cached accounts
    const all = await sessionManager.listSessions<TestUser>();
    expect(all).toHaveLength(2);
  });

  it('clears session on signOut', async () => {
    await sessionManager.createSession<TestUser>({
      userId: mockUser.id,
      user: mockUser,
    });

    expect(await sessionManager.isAuthenticated()).toBe(true);

    await sessionManager.clearSession();
    expect(await sessionManager.isAuthenticated()).toBe(false);
    expect(await sessionManager.getActiveSession()).toBeNull();
    expect(await sessionManager.getUser()).toBeNull();
  });

  it('exports useSession React hook function cleanly', () => {
    expect(typeof useSession).toBe('function');
  });
});
