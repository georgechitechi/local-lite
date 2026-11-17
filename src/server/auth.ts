import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { LocalDBAdapter } from '../adapters/local/index.js';
import { resolveUnifiedUserId } from '../auth/identity.js';
import {
  getCryptoRandomBytes,
  hashPassword,
  verifyPassword,
} from '../auth/local.js';
import { timingSafeEqual } from '../keys/generator.js';
import { createSignedToken, verifySignedToken } from '../keys/signed-token.js';
import { generateUUID } from '../utils/uuid.js';

export interface ServerAuthUserRecord {
  id: string;
  email: string;
  displayName?: string | null;
  passwordHash: string;
  salt: string;
  iterations: number;
  algorithm: string;
  failedLoginAttempts: number;
  lockedUntil?: number | null;
  tokenVersion?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ServerAuthOtpRecord {
  id: string;
  userId: string;
  email: string;
  otpHash: string;
  attempts: number;
  expiresAt: number;
  usedAt?: number | null;
  createdAt: number;
}

export interface ServerAuthStorage {
  initialize?(): Promise<void>;
  findUserByEmail(email: string): Promise<ServerAuthUserRecord | null>;
  createUser(record: ServerAuthUserRecord): Promise<void>;
  recordFailedAttempt(
    userId: string,
    attempts: number,
    lockedUntil: number | null,
    updatedAt: number,
  ): Promise<void>;
  updatePasswordAndResetLockout(
    userId: string,
    patch: {
      passwordHash: string;
      salt: string;
      iterations: number;
      algorithm: string;
      updatedAt: number;
    },
  ): Promise<void>;
  invalidateActiveOtps(email: string, usedAt: number): Promise<void>;
  createResetOtp(record: ServerAuthOtpRecord): Promise<void>;
  findLatestActiveOtp(email: string): Promise<ServerAuthOtpRecord | null>;
  incrementOtpAttempts(
    id: string,
    attempts: number,
    usedAt: number | null,
  ): Promise<void>;
  markOtpUsed(id: string, usedAt: number): Promise<void>;
}

/**
 * Persistent SQLite-backed ServerAuthStorage using any LocalDBAdapter.
 */
export class SQLiteServerAuthStorage implements ServerAuthStorage {
  private db: LocalDBAdapter;
  private initialized = false;

  constructor(db: LocalDBAdapter) {
    this.db = db;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS _local_auth_accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        iterations INTEGER NOT NULL,
        algorithm TEXT NOT NULL,
        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER,
        token_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    try {
      await this.db.execute(
        `ALTER TABLE _local_auth_accounts ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;`,
      );
    } catch {
      // Column already exists
    }
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS _local_auth_reset_otps (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        otp_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      );
    `);
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_local_auth_otps_email
      ON _local_auth_reset_otps (email, created_at);
    `);
    this.initialized = true;
  }

  async findUserByEmail(email: string): Promise<ServerAuthUserRecord | null> {
    await this.initialize();
    const rows = await this.db.execute(
      `SELECT * FROM _local_auth_accounts WHERE email = ? LIMIT 1;`,
      [email],
    );
    const r = rows?.[0];
    if (!r) return null;
    return {
      id: String(r.id),
      email: String(r.email),
      displayName: r.display_name ?? null,
      passwordHash: String(r.password_hash),
      salt: String(r.salt),
      iterations: Number(r.iterations),
      algorithm: String(r.algorithm),
      failedLoginAttempts: Number(r.failed_login_attempts ?? 0),
      lockedUntil: r.locked_until != null ? Number(r.locked_until) : null,
      tokenVersion: r.token_version != null ? Number(r.token_version) : 1,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  async createUser(record: ServerAuthUserRecord): Promise<void> {
    await this.initialize();
    await this.db.execute(
      `INSERT INTO _local_auth_accounts
        (id, email, display_name, password_hash, salt, iterations, algorithm, failed_login_attempts, locked_until, token_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.email,
        record.displayName ?? null,
        record.passwordHash,
        record.salt,
        record.iterations,
        record.algorithm,
        record.failedLoginAttempts,
        record.lockedUntil ?? null,
        record.tokenVersion ?? 1,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async recordFailedAttempt(
    userId: string,
    attempts: number,
    lockedUntil: number | null,
    updatedAt: number,
  ): Promise<void> {
    await this.initialize();
    await this.db.execute(
      `UPDATE _local_auth_accounts SET failed_login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?;`,
      [attempts, lockedUntil, updatedAt, userId],
    );
  }

  async updatePasswordAndResetLockout(
    userId: string,
    patch: {
      passwordHash: string;
      salt: string;
      iterations: number;
      algorithm: string;
      updatedAt: number;
    },
  ): Promise<void> {
    await this.initialize();
    await this.db.execute(
      `UPDATE _local_auth_accounts
       SET password_hash = ?, salt = ?, iterations = ?, algorithm = ?, failed_login_attempts = 0, locked_until = NULL, token_version = COALESCE(token_version, 1) + 1, updated_at = ?
       WHERE id = ?;`,
      [
        patch.passwordHash,
        patch.salt,
        patch.iterations,
        patch.algorithm,
        patch.updatedAt,
        userId,
      ],
    );
  }

  async invalidateActiveOtps(email: string, usedAt: number): Promise<void> {
    await this.initialize();
    await this.db.execute(
      `UPDATE _local_auth_reset_otps SET used_at = ? WHERE email = ? AND used_at IS NULL;`,
      [usedAt, email],
    );
  }

  async createResetOtp(record: ServerAuthOtpRecord): Promise<void> {
    await this.initialize();
    await this.db.execute(
      `INSERT INTO _local_auth_reset_otps
        (id, user_id, email, otp_hash, attempts, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.userId,
        record.email,
        record.otpHash,
        record.attempts,
        record.expiresAt,
        record.usedAt ?? null,
        record.createdAt,
      ],
    );
  }

  async findLatestActiveOtp(email: string): Promise<ServerAuthOtpRecord | null> {
    await this.initialize();
    const rows = await this.db.execute(
      `SELECT * FROM _local_auth_reset_otps WHERE email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1;`,
      [email],
    );
    const r = rows?.[0];
    if (!r) return null;
    return {
      id: String(r.id),
      userId: String(r.user_id),
      email: String(r.email),
      otpHash: String(r.otp_hash),
      attempts: Number(r.attempts ?? 0),
      expiresAt: Number(r.expires_at),
      usedAt: r.used_at != null ? Number(r.used_at) : null,
      createdAt: Number(r.created_at),
    };
  }

  async incrementOtpAttempts(
    id: string,
    attempts: number,
    usedAt: number | null,
  ): Promise<void> {
    await this.initialize();
    await this.db.execute(
      `UPDATE _local_auth_reset_otps SET attempts = ?, used_at = ? WHERE id = ?;`,
      [attempts, usedAt, id],
    );
  }

  async markOtpUsed(id: string, usedAt: number): Promise<void> {
    await this.initialize();
    await this.db.execute(
      `UPDATE _local_auth_reset_otps SET used_at = ? WHERE id = ?;`,
      [usedAt, id],
    );
  }
}

export interface ServerAuthTokenPayload {
  purpose: 'sync-auth';
  sub: string;
  email: string;
  name?: string | null;
  tv?: number;
}

export interface VerifiedServerAuthUser {
  id: string;
  email: string;
  name: string | null;
  provider: 'local';
  tokenVersion: number;
}

export interface CreateAuthEndpointOptions {
  storage: ServerAuthStorage;
  secret: string;
  tokenTtlMs?: number;
  passwordIterations?: number;
  minPasswordLength?: number;
  maxFailedAttempts?: number;
  lockoutDurationMs?: number;
  otp?: {
    ttlMs?: number;
    maxAttempts?: number;
  };
  sendResetOtpEmail?: (params: {
    to: string;
    otp: string;
    expiresMinutes: number;
  }) => Promise<void>;
}

const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_SERVER_PASSWORD_ITERATIONS = 100_000;
const DEFAULT_OTP_TTL_MS = 15 * 60 * 1000;

function deriveSubSecret(secret: string, scope: string): string {
  return bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(scope)));
}

function hashServerOtp(secret: string, email: string, otp: string): string {
  const key = deriveSubSecret(secret, 'local-sync-otp-v1');
  return bytesToHex(
    hmac(
      sha256,
      utf8ToBytes(key),
      utf8ToBytes(`otp:${email.trim().toLowerCase()}:${otp.trim()}`),
    ),
  );
}

/**
 * Verifies a Bearer token or Request issued by `createAuthEndpoint()`.
 */
export function verifyAuthToken(
  requestOrToken: Request | string,
  secret: string,
): VerifiedServerAuthUser | null {
  if (!secret) return null;
  let token = '';
  if (typeof requestOrToken === 'string') {
    const trimmed = requestOrToken.trim();
    token = trimmed.startsWith('Bearer ') ? trimmed.slice(7).trim() : trimmed;
  } else {
    const authHeader = requestOrToken.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    }
  }
  if (!token) return null;

  const signingSecret = deriveSubSecret(secret, 'local-sync-auth-v1');
  const result = verifySignedToken<ServerAuthTokenPayload>(
    token,
    signingSecret,
  );
  if (
    !result.valid ||
    !result.payload ||
    result.payload.purpose !== 'sync-auth' ||
    !result.payload.sub ||
    !result.payload.email
  ) {
    return null;
  }

  return {
    id: result.payload.sub,
    email: result.payload.email,
    name: result.payload.name ?? null,
    provider: 'local',
    tokenVersion: typeof result.payload.tv === 'number' ? result.payload.tv : 1,
  };
}

/**
 * Verifies a Bearer token and checks that its tokenVersion matches the stored user record
 * (revoking tokens issued before a password reset).
 */
export async function verifyAuthTokenWithStorage(
  requestOrToken: Request | string,
  secret: string,
  storage: ServerAuthStorage,
): Promise<VerifiedServerAuthUser | null> {
  const verified = verifyAuthToken(requestOrToken, secret);
  if (!verified) return null;
  const user = await storage.findUserByEmail(verified.email);
  if (!user || user.id !== verified.id) return null;
  if ((user.tokenVersion ?? 1) !== verified.tokenVersion) return null;
  return verified;
}

/**
 * Creates a turnkey Web Request/Response handler for local email/password auth,
 * token refresh, and 6-digit email OTP password resets.
 */
export function createAuthEndpoint(options: CreateAuthEndpointOptions) {
  const {
    storage,
    secret,
    tokenTtlMs = DEFAULT_TOKEN_TTL_MS,
    passwordIterations = DEFAULT_SERVER_PASSWORD_ITERATIONS,
    minPasswordLength = 8,
    maxFailedAttempts = 5,
    lockoutDurationMs = 15 * 60 * 1000,
    sendResetOtpEmail,
  } = options;
  const otpTtlMs = options.otp?.ttlMs ?? DEFAULT_OTP_TTL_MS;
  const maxOtpAttempts = options.otp?.maxAttempts ?? 5;

  if (!secret || !secret.trim()) {
    throw new Error('A non-empty signing secret is required.');
  }

  const signingSecret = deriveSubSecret(secret, 'local-sync-auth-v1');

  const issueToken = (user: {
    id: string;
    email: string;
    displayName?: string | null;
    tokenVersion?: number;
  }): string =>
    createSignedToken<ServerAuthTokenPayload>({
      secret: signingSecret,
      expiresInMs: tokenTtlMs,
      payload: {
        purpose: 'sync-auth',
        sub: user.id,
        email: user.email,
        name: user.displayName ?? null,
        tv: user.tokenVersion ?? 1,
      },
    });

  return async function handleAuthRequest(
    request: Request,
  ): Promise<Response> {
    if (request.method.toUpperCase() === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }
    if (request.method.toUpperCase() !== 'POST') {
      return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
    }

    const pathname = new URL(request.url).pathname.replace(/\/+$/, '');

    // 1. Refresh
    if (pathname.endsWith('/refresh')) {
      const verified = await verifyAuthTokenWithStorage(
        request,
        secret,
        storage,
      );
      if (!verified) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const token = issueToken({
        id: verified.id,
        email: verified.email,
        displayName: verified.name,
        tokenVersion: verified.tokenVersion,
      });
      return Response.json({ token });
    }

    let body: Record<string, any>;
    try {
      body = (await request.json()) as Record<string, any>;
    } catch {
      return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // 2. Forgot Password (6-digit Email OTP)
    if (pathname.endsWith('/forgot-password')) {
      const email =
        typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email || !email.includes('@')) {
        return Response.json(
          { error: 'Please enter a valid email address.' },
          { status: 400 },
        );
      }

      const existing = await storage.findUserByEmail(email);
      if (existing) {
        const limit = 4_294_800_000;
        let num = limit;
        while (num >= limit) {
          const randomVal = getCryptoRandomBytes(4);
          num =
            ((randomVal[0] << 24) |
              (randomVal[1] << 16) |
              (randomVal[2] << 8) |
              randomVal[3]) >>>
            0;
        }
        const otp = String(100000 + (num % 900000));
        const now = Date.now();
        await storage.invalidateActiveOtps(email, now);
        await storage.createResetOtp({
          id: generateUUID(),
          userId: existing.id,
          email,
          otpHash: hashServerOtp(secret, email, otp),
          attempts: 0,
          expiresAt: now + otpTtlMs,
          usedAt: null,
          createdAt: now,
        });
        if (sendResetOtpEmail) {
          await sendResetOtpEmail({
            to: email,
            otp,
            expiresMinutes: Math.max(1, Math.round(otpTtlMs / 60000)),
          });
        }
      }

      return Response.json({
        success: true,
        message:
          'If an account exists for that email, a verification code has been sent.',
      });
    }

    // 3. Reset Password with OTP
    if (pathname.endsWith('/reset-password')) {
      const email =
        typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
      const newPassword =
        typeof body.newPassword === 'string' ? body.newPassword : '';

      if (!email || !email.includes('@') || !/^\d{6}$/.test(otp)) {
        return Response.json(
          { error: 'Valid email and 6-digit verification code are required.' },
          { status: 400 },
        );
      }
      if (newPassword.length < minPasswordLength) {
        return Response.json(
          {
            error: `New password must be at least ${minPasswordLength} characters.`,
          },
          { status: 400 },
        );
      }

      const now = Date.now();
      const otpRow = await storage.findLatestActiveOtp(email);
      if (!otpRow || otpRow.expiresAt <= now) {
        return Response.json(
          { error: 'Invalid or expired verification code.' },
          { status: 400 },
        );
      }
      if (otpRow.attempts >= maxOtpAttempts) {
        await storage.markOtpUsed(otpRow.id, now);
        return Response.json(
          { error: 'Too many invalid attempts. Please request a new code.' },
          { status: 429 },
        );
      }

      const actualHash = hashServerOtp(secret, email, otp);
      if (!timingSafeEqual(actualHash, otpRow.otpHash)) {
        const nextAttempts = otpRow.attempts + 1;
        await storage.incrementOtpAttempts(
          otpRow.id,
          nextAttempts,
          nextAttempts >= maxOtpAttempts ? now : null,
        );
        return Response.json(
          { error: 'Invalid or expired verification code.' },
          { status: 400 },
        );
      }

      const hashed = await hashPassword(newPassword, {
        iterations: passwordIterations,
      });
      await storage.updatePasswordAndResetLockout(otpRow.userId, {
        passwordHash: hashed.hash,
        salt: hashed.salt,
        iterations: hashed.iterations,
        algorithm: hashed.algorithm,
        updatedAt: now,
      });
      await storage.markOtpUsed(otpRow.id, now);
      return Response.json({ success: true });
    }

    // 4. Sign In / Sign Up
    const mode = body.mode === 'signup' ? 'signup' : 'signin';
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const displayName =
      typeof body.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim()
        : null;

    if (!email || !email.includes('@') || !password) {
      return Response.json(
        { error: 'Valid email and password are required.' },
        { status: 400 },
      );
    }

    const existing = await storage.findUserByEmail(email);

    if (mode === 'signup') {
      if (existing) {
        return Response.json(
          { error: 'An account with this email already exists.' },
          { status: 409 },
        );
      }
      if (password.length < minPasswordLength) {
        return Response.json(
          {
            error: `Password must be at least ${minPasswordLength} characters.`,
          },
          { status: 400 },
        );
      }

      const id = resolveUnifiedUserId(
        { id: email, email, emailVerified: false },
        'local',
      );
      const hashed = await hashPassword(password, {
        iterations: passwordIterations,
      });
      const now = Date.now();
      await storage.createUser({
        id,
        email,
        displayName,
        passwordHash: hashed.hash,
        salt: hashed.salt,
        iterations: hashed.iterations,
        algorithm: hashed.algorithm,
        failedLoginAttempts: 0,
        lockedUntil: null,
        tokenVersion: 1,
        createdAt: now,
        updatedAt: now,
      });

      const token = issueToken({ id, email, displayName, tokenVersion: 1 });
      return Response.json({
        token,
        user: { id, email, displayName },
      });
    }

    if (!existing) {
      // Constant-time dummy verification mitigates timing-based email enumeration.
      await verifyPassword(
        'dummy_password',
        '0'.repeat(64),
        '0'.repeat(32),
        Math.min(passwordIterations, 5_000),
      );
      return Response.json(
        { error: 'Invalid email or password.' },
        { status: 401 },
      );
    }

    const now = Date.now();
    if (existing.lockedUntil && existing.lockedUntil > now) {
      return Response.json(
        { error: 'Account temporarily locked due to too many failed attempts.' },
        { status: 429 },
      );
    }

    const valid = await verifyPassword(
      password,
      existing.passwordHash,
      existing.salt,
      existing.iterations,
      existing.algorithm,
    );

    if (!valid) {
      const nextAttempts = existing.failedLoginAttempts + 1;
      const lockedUntil =
        maxFailedAttempts > 0 && nextAttempts >= maxFailedAttempts
          ? now + lockoutDurationMs
          : null;
      await storage.recordFailedAttempt(
        existing.id,
        nextAttempts,
        lockedUntil,
        now,
      );
      return Response.json(
        { error: 'Invalid email or password.' },
        { status: 401 },
      );
    }

    if (existing.failedLoginAttempts > 0 || existing.lockedUntil) {
      await storage.recordFailedAttempt(existing.id, 0, null, now);
    }

    const token = issueToken({
      id: existing.id,
      email: existing.email,
      displayName: existing.displayName ?? null,
      tokenVersion: existing.tokenVersion ?? 1,
    });
    return Response.json({
      token,
      user: {
        id: existing.id,
        email: existing.email,
        displayName: existing.displayName ?? null,
      },
    });
  };
}
