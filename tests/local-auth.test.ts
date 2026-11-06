import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { LocalFirstClient } from '../src/core/client.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';
import { EventEmitter } from '../src/reactive/event-emitter.js';
import {
  LocalAuthEngine,
  hashPassword,
  verifyPassword,
  generateCryptoToken,
  LocalUser,
} from '../src/auth/local.js';
import { useLocalAuth } from '../src/react/auth.js';

describe('LocalAuthEngine - Fully Local SQLite Auth Engine', () => {
  let raw: DatabaseSync;
  let db: NodeSQLiteAdapter;
  let events: EventEmitter;
  let auth: LocalAuthEngine;

  beforeEach(async () => {
    raw = new DatabaseSync(':memory:');
    db = new NodeSQLiteAdapter(raw);
    events = new EventEmitter();
    auth = new LocalAuthEngine(db, undefined, events, {
      iterations: 10_000, // fast iterations for test suite
      maxFailedAttempts: 3,
      lockoutDurationMs: 60 * 1000,
    });
    await auth.initialize();
  });

  afterEach(() => {
    try {
      raw.close();
    } catch {
      // Ignore if already closed by client.close()
    }
  });

  describe('High-Level Crypto Credentials', () => {
    it('hashes passwords using PBKDF2-SHA512 with random salts', async () => {
      const password = 'SuperSecretPassword123!';
      const res1 = await hashPassword(password, { iterations: 5000 });
      const res2 = await hashPassword(password, { iterations: 5000 });

      expect(res1.algorithm).toBe('PBKDF2-SHA512');
      expect(res1.hash).toHaveLength(128); // 64 bytes = 128 hex chars
      expect(res1.salt).toHaveLength(32); // 16 bytes = 32 hex chars

      // Distinct salts ensure distinct hashes for the same password
      expect(res1.salt).not.toBe(res2.salt);
      expect(res1.hash).not.toBe(res2.hash);

      // Verify passwords
      const isValid = await verifyPassword(password, res1.hash, res1.salt, res1.iterations, res1.algorithm);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword('WrongPassword', res1.hash, res1.salt, res1.iterations, res1.algorithm);
      expect(isInvalid).toBe(false);
    });

    it('generates cryptographic tokens and SHA-256 hashes', () => {
      const t1 = generateCryptoToken(32);
      const t2 = generateCryptoToken(32);

      expect(t1.token).toHaveLength(64);
      expect(t1.hash).toHaveLength(64);
      expect(t1.token).not.toBe(t2.token);
      expect(t1.hash).not.toBe(t2.hash);
    });
  });

  describe('User Registration (signUp)', () => {
    it('creates a user record and an active session in local SQLite', async () => {
      const { user, session } = await auth.signUp({
        email: 'Alice@LocalLite.dev',
        username: 'alice',
        password: 'Password123!',
        displayName: 'Alice Wonderland',
        metadata: { department: 'Engineering' },
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('alice@locallite.dev'); // normalized lowercase
      expect(user.username).toBe('alice');
      expect(user.displayName).toBe('Alice Wonderland');
      expect(user.role).toBe('user');
      expect(user.metadata).toEqual({ department: 'Engineering' });
      expect(user.status).toBe('active');
      expect((user as any).password_hash).toBeUndefined(); // credentials must be sanitized
      expect((user as any).salt).toBeUndefined();

      // Check session
      expect(session).toBeDefined();
      expect(session?.userId).toBe(user.id);
      expect(session?.isActive).toBe(true);
      expect(session?.provider).toBe('local');

      // Verify user is in SQLite
      const found = await auth.getUserById(user.id);
      expect(found?.email).toBe('alice@locallite.dev');

      // Active user check
      const current = await auth.getCurrentUser();
      expect(current?.id).toBe(user.id);
      expect(await auth.isAuthenticated()).toBe(true);
    });

    it('rejects duplicate email addresses case-insensitively', async () => {
      await auth.signUp({
        email: 'unique@locallite.dev',
        password: 'Password123!',
      });

      await expect(
        auth.signUp({
          email: 'UNIQUE@locallite.dev',
          password: 'Password123!',
        })
      ).rejects.toThrow('An account with this email address already exists.');
    });

    it('rejects duplicate usernames', async () => {
      await auth.signUp({
        email: 'user1@locallite.dev',
        username: 'bob',
        password: 'Password123!',
      });

      await expect(
        auth.signUp({
          email: 'user2@locallite.dev',
          username: 'BOB',
          password: 'Password123!',
        })
      ).rejects.toThrow('This username is already taken.');
    });

    it('enforces minimum password length and custom validation', async () => {
      await expect(
        auth.signUp({
          email: 'short@locallite.dev',
          password: '123',
        })
      ).rejects.toThrow('Password must be at least 8 characters long.');

      const strictAuth = new LocalAuthEngine(db, undefined, events, {
        validatePassword: (pwd) => {
          if (!/[A-Z]/.test(pwd)) return 'Password must contain an uppercase letter.';
          return true;
        },
      });

      await expect(
        strictAuth.signUp({
          email: 'strict@locallite.dev',
          password: 'password123',
        })
      ).rejects.toThrow('Password must contain an uppercase letter.');
    });
  });

  describe('User Authentication (signIn & signOut)', () => {
    beforeEach(async () => {
      await auth.signUp({
        email: 'carol@locallite.dev',
        username: 'carol_dev',
        password: 'ValidPassword123!',
        displayName: 'Carol Danvers',
        setActiveSession: false,
      });
    });

    it('authenticates with email and creates active session', async () => {
      const { user, session } = await auth.signIn({
        identifier: 'carol@locallite.dev',
        password: 'ValidPassword123!',
      });

      expect(user.email).toBe('carol@locallite.dev');
      expect(session?.isActive).toBe(true);
      expect(user.lastLoginAt).toBeGreaterThan(0);
      expect(await auth.isAuthenticated()).toBe(true);
    });

    it('authenticates with username', async () => {
      const { user } = await auth.signIn({
        identifier: 'CAROL_DEV',
        password: 'ValidPassword123!',
      });

      expect(user.username).toBe('carol_dev');
    });

    it('rejects wrong password', async () => {
      await expect(
        auth.signIn({
          identifier: 'carol@locallite.dev',
          password: 'WrongPassword',
        })
      ).rejects.toThrow('Invalid email/username or password.');
    });

    it('rejects non-existent identifier with timing protection', async () => {
      await expect(
        auth.signIn({
          identifier: 'nonexistent@locallite.dev',
          password: 'AnyPassword',
        })
      ).rejects.toThrow('Invalid email/username or password.');
    });

    it('signs out user and clears session', async () => {
      await auth.signIn({
        identifier: 'carol@locallite.dev',
        password: 'ValidPassword123!',
      });
      expect(await auth.isAuthenticated()).toBe(true);

      await auth.signOut();
      expect(await auth.isAuthenticated()).toBe(false);
      expect(await auth.getCurrentUser()).toBeNull();
    });
  });

  describe('Brute-Force Protection & Account Lockout', () => {
    beforeEach(async () => {
      await auth.signUp({
        email: 'target@locallite.dev',
        password: 'TargetPassword123!',
      });
    });

    it('locks account after max failed attempts and blocks subsequent logins', async () => {
      // 1st failed attempt
      await expect(
        auth.signIn({ identifier: 'target@locallite.dev', password: 'Wrong1' })
      ).rejects.toThrow('Invalid email/username or password.');

      // 2nd failed attempt
      await expect(
        auth.signIn({ identifier: 'target@locallite.dev', password: 'Wrong2' })
      ).rejects.toThrow('Invalid email/username or password.');

      // 3rd failed attempt triggers lock (maxFailedAttempts = 3)
      await expect(
        auth.signIn({ identifier: 'target@locallite.dev', password: 'Wrong3' })
      ).rejects.toThrow(/Account has been locked due to 3 failed attempts/);

      // Subsequent login attempt (even with CORRECT password) is blocked while locked
      await expect(
        auth.signIn({ identifier: 'target@locallite.dev', password: 'TargetPassword123!' })
      ).rejects.toThrow(/Account is temporarily locked/);

      // Manual unlock
      const user = await auth.getUserByEmail('target@locallite.dev');
      await auth.unlockAccount(user!.id);

      // Login succeeds now
      const res = await auth.signIn({
        identifier: 'target@locallite.dev',
        password: 'TargetPassword123!',
      });
      expect(res.user.status).toBe('active');
      expect(res.user.failedLoginAttempts).toBe(0);
    });
  });

  describe('Password Management (changePassword & resetTokens)', () => {
    let userId: string;

    beforeEach(async () => {
      const { user } = await auth.signUp({
        email: 'passman@locallite.dev',
        password: 'InitialPassword123!',
      });
      userId = user.id;
    });

    it('changes password when current password is confirmed', async () => {
      await auth.changePassword({
        userId,
        oldPassword: 'InitialPassword123!',
        newPassword: 'BrandNewPassword456!',
      });

      // Old password fails
      await expect(
        auth.signIn({ identifier: 'passman@locallite.dev', password: 'InitialPassword123!' })
      ).rejects.toThrow('Invalid email/username or password.');

      // New password succeeds
      const { user } = await auth.signIn({
        identifier: 'passman@locallite.dev',
        password: 'BrandNewPassword456!',
      });
      expect(user.id).toBe(userId);
    });

    it('generates a password reset token and resets password', async () => {
      const { token, expiresAt } = await auth.createPasswordResetToken('passman@locallite.dev');
      expect(token).toBeDefined();
      expect(expiresAt).toBeGreaterThan(Date.now());

      // Reset password with token
      await auth.resetPasswordWithToken(token, 'ResetPassword789!');

      // Login with reset password
      const { user } = await auth.signIn({
        identifier: 'passman@locallite.dev',
        password: 'ResetPassword789!',
      });
      expect(user.id).toBe(userId);

      // Re-using the same token fails (single use)
      await expect(
        auth.resetPasswordWithToken(token, 'AnotherPassword123!')
      ).rejects.toThrow('Password reset token is invalid or has expired.');
    });
  });

  describe('User Profile & Admin Management', () => {
    it('updates user profile, role, status, and metadata', async () => {
      const { user } = await auth.signUp({
        email: 'dave@locallite.dev',
        password: 'Password123!',
        displayName: 'Dave',
      });

      const updated = await auth.updateUser(user.id, {
        displayName: 'Dave Bowman',
        role: 'admin',
        status: 'active',
        metadata: { clearances: ['top-secret'] },
      });

      expect(updated.displayName).toBe('Dave Bowman');
      expect(updated.role).toBe('admin');
      expect(updated.metadata).toEqual({ clearances: ['top-secret'] });
    });

    it('lists users and deletes users permanently', async () => {
      await auth.signUp({ email: 'user_a@locallite.dev', password: 'Password123!' });
      await auth.signUp({ email: 'user_b@locallite.dev', password: 'Password123!' });

      const all = await auth.listUsers();
      expect(all.length).toBeGreaterThanOrEqual(2);

      const target = all[0];
      await auth.deleteUser(target.id);

      const after = await auth.getUserById(target.id);
      expect(after).toBeNull();
    });
  });

  describe('LocalFirstClient Integration', () => {
    it('initializes client.auth automatically with SQLite', async () => {
      const client = new LocalFirstClient({
        local: db,
        remote: new MemoryDemoRemoteAdapter(0),
        network: new DefaultNetworkStatusProvider(false),
        autoStart: false,
        logger: false,
        localAuth: {
          iterations: 5000,
        },
      });

      await client.initialize();
      expect(client.auth).toBeInstanceOf(LocalAuthEngine);

      const { user } = await client.auth.signUp({
        email: 'integrated@locallite.dev',
        password: 'ClientPassword123!',
        displayName: 'Integrated User',
      });

      expect(user.email).toBe('integrated@locallite.dev');
      expect(await client.auth.isAuthenticated()).toBe(true);

      const current = await client.auth.getCurrentUser();
      expect(current?.displayName).toBe('Integrated User');

      await client.close();
    });
  });

  describe('React Hook (useLocalAuth)', () => {
    it('exports useLocalAuth cleanly', () => {
      expect(typeof useLocalAuth).toBe('function');
    });
  });
});
