import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  type RemoteAutomationJob,
  type RemoteBackupArchive,
} from '../src/index.js';
import { SelfHostedRemoteAdapter } from '../src/adapters/remote/self-hosted.js';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { resolveUnifiedUserId } from '../src/auth/identity.js';
import { LocalAuthEngine } from '../src/auth/local.js';
import {
  createAuthEndpoint,
  SQLiteServerAuthStorage,
  verifyAuthToken,
} from '../src/server/index.js';

describe('local-lite remote auth, 6-digit OTP & server auth endpoint', () => {
  it('passes mode and password to remoteAuthHandler and supports otp6 reset tokens', async () => {
    const db = new NodeSQLiteAdapter(new DatabaseSync(':memory:'));
    const seenContexts: Array<{ mode?: string; hasPassword: boolean }> = [];

    const auth = new LocalAuthEngine(db, {
      remoteAuthHandler: async (ctx) => {
        seenContexts.push({
          mode: ctx.mode,
          hasPassword: Boolean(ctx.password),
        });
        return { token: `tok-${ctx.mode}-${ctx.user.id}` };
      },
    });
    await auth.initialize();

    const signedUp = await auth.signUp({
      email: 'alice@example.com',
      password: 'Password123',
      displayName: 'Alice',
    });
    expect(signedUp.session?.token).toBe(`tok-signup-${signedUp.user.id}`);

    const signedIn = await auth.signIn({
      identifier: 'alice@example.com',
      password: 'Password123',
    });
    expect(signedIn.session?.token).toBe(`tok-signin-${signedIn.user.id}`);

    const refreshed = await auth.exchangeRemoteAuth();
    expect(refreshed?.token).toBe(`tok-refresh-${signedIn.user.id}`);
    expect(seenContexts).toEqual([
      { mode: 'signup', hasPassword: true },
      { mode: 'signin', hasPassword: true },
      { mode: 'refresh', hasPassword: false },
    ]);

    // 6-digit OTP reset with attempt limit
    const { token: otp } = await auth.createPasswordResetToken(
      'alice@example.com',
      { format: 'otp6', maxAttempts: 2 },
    );
    expect(otp).toMatch(/^\d{6}$/);

    await expect(
      auth.resetPasswordWithToken('000000', 'NewPassword123', {
        identifier: 'alice@example.com',
      }),
    ).rejects.toThrow();

    await auth.resetPasswordWithToken(otp, 'NewPassword123', {
      identifier: 'alice@example.com',
    });

    const afterReset = await auth.signIn({
      identifier: 'alice@example.com',
      password: 'NewPassword123',
    });
    expect(afterReset.user.email).toBe('alice@example.com');
  });

  it('handles signup, lockout, refresh, and email OTP reset in createAuthEndpoint', async () => {
    const db = new NodeSQLiteAdapter(new DatabaseSync(':memory:'));
    const storage = new SQLiteServerAuthStorage(db);
    const sentEmails: Array<{ to: string; otp: string }> = [];
    const secret = 'test-super-secret-key';

    const handler = createAuthEndpoint({
      storage,
      secret,
      maxFailedAttempts: 2,
      lockoutDurationMs: 60_000,
      otp: { maxAttempts: 2 },
      sendResetOtpEmail: async ({ to, otp }) => {
        sentEmails.push({ to, otp });
      },
    });

    // 1. Signup
    const signupRes = await handler(
      new Request('https://api.example.com/auth/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'signup',
          email: 'bob@example.com',
          password: 'Password123',
          displayName: 'Bob',
        }),
      }),
    );
    expect(signupRes.status).toBe(200);
    const signupData = (await signupRes.json()) as any;
    expect(signupData.token).toBeTruthy();

    // Verify local ID does NOT collide with verified Google ID
    const verifiedGoogleId = resolveUnifiedUserId(
      { id: 'g-1', email: 'bob@example.com', emailVerified: true },
      'google',
    );
    expect(signupData.user.id).not.toBe(verifiedGoogleId);

    // Verify token helper
    const verified = verifyAuthToken(`Bearer ${signupData.token}`, secret);
    const verifiedFromReq = verifyAuthToken(
      new Request('https://api.example.com/sync', {
        headers: { Authorization: `Bearer ${signupData.token}` },
      }),
      secret,
    );
    expect(verified?.id).toBe(signupData.user.id);
    expect(verifiedFromReq?.email).toBe('bob@example.com');

    // 2. Duplicate signup -> 409
    const dupRes = await handler(
      new Request('https://api.example.com/auth/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'signup',
          email: 'bob@example.com',
          password: 'Password123',
        }),
      }),
    );
    expect(dupRes.status).toBe(409);

    // 3. Brute-force lockout after 2 failed attempts
    for (let i = 0; i < 2; i += 1) {
      const badRes = await handler(
        new Request('https://api.example.com/auth/local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'signin',
            email: 'bob@example.com',
            password: 'WrongPassword',
          }),
        }),
      );
      expect(badRes.status).toBe(401);
    }
    const lockedRes = await handler(
      new Request('https://api.example.com/auth/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'signin',
          email: 'bob@example.com',
          password: 'Password123',
        }),
      }),
    );
    expect(lockedRes.status).toBe(429);

    // 4. Refresh
    const refreshRes = await handler(
      new Request('https://api.example.com/auth/local/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${signupData.token}` },
      }),
    );
    expect(refreshRes.status).toBe(200);
    const refreshData = (await refreshRes.json()) as any;
    expect(refreshData.token).toBeTruthy();

    // 5. Forgot password (no enumeration for unknown email)
    const unknownRes = await handler(
      new Request('https://api.example.com/auth/local/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com' }),
      }),
    );
    expect(unknownRes.status).toBe(200);
    expect(sentEmails).toHaveLength(0);

    const forgotRes = await handler(
      new Request('https://api.example.com/auth/local/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bob@example.com' }),
      }),
    );
    expect(forgotRes.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].otp).toMatch(/^\d{6}$/);

    // 6. Reset password with OTP (clears lockout too)
    const resetRes = await handler(
      new Request('https://api.example.com/auth/local/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'bob@example.com',
          otp: sentEmails[0].otp,
          newPassword: 'UpdatedPassword123',
        }),
      }),
    );
    expect(resetRes.status).toBe(200);

    const okLogin = await handler(
      new Request('https://api.example.com/auth/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'signin',
          email: 'bob@example.com',
          password: 'UpdatedPassword123',
        }),
      }),
    );
    expect(okLogin.status).toBe(200);
  });

  it('exports SelfHostedRemoteAdapter and remote types cleanly', () => {
    const adapter = new SelfHostedRemoteAdapter({
      url: 'https://sync.example.com',
      tables: ['properties'],
    });
    const job: RemoteAutomationJob | null = null;
    const backup: RemoteBackupArchive | null = null;
    expect(adapter).toBeDefined();
    expect(job).toBeNull();
    expect(backup).toBeNull();
  });
});
