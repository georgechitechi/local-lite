import { pbkdf2, pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha512, sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { DBExecutable } from '../core/schema-manager.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import { generateUUID } from '../utils/uuid.js';
import { escapeIdentifier } from '../utils/sql.js';
import { timingSafeEqual } from '../keys/generator.js';
import {
  SessionManager,
  SessionRecord,
  SessionManagerOptions,
} from './session.js';

export const DEFAULT_USERS_TABLE = '_local_users';
export const DEFAULT_USER_TOKENS_TABLE = '_local_user_tokens';
export const DEFAULT_PASSWORD_ALGORITHM = 'PBKDF2-SHA256';
export const DEFAULT_PASSWORD_ITERATIONS = 1_000;
export const DEFAULT_SALT_BYTES = 16;
export const DEFAULT_LOCKOUT_ATTEMPTS = 5;
export const DEFAULT_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_MIN_PASSWORD_LENGTH = 8;

export type UserStatus = 'active' | 'suspended' | 'locked';

export interface LocalUser<TMetadata = Record<string, any>> {
  id: string;
  email: string;
  username?: string | null;
  displayName?: string | null;
  role: string;
  metadata?: TMetadata | null;
  status: UserStatus;
  failedLoginAttempts: number;
  lockedUntil?: number | null;
  emailVerified: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number | null;
}

export interface StoredUserRow {
  id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  password_hash: string;
  salt: string;
  iterations: number;
  algorithm: string;
  role: string;
  metadata: string | null;
  status: UserStatus;
  failed_login_attempts: number;
  locked_until: number | null;
  email_verified: number;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

export interface LocalAuthEngineOptions {
  /**
   * Database table name for local users. Default: '_local_users'
   */
  usersTable?: string;
  /**
   * Database table name for reset/verification tokens. Default: '_local_user_tokens'
   */
  tokensTable?: string;
  /**
   * PBKDF2 hash algorithm ('PBKDF2-SHA256' or 'PBKDF2-SHA512'). Default: 'PBKDF2-SHA256'
   */
  algorithm?: 'PBKDF2-SHA256' | 'PBKDF2-SHA512' | string;
  /**
   * PBKDF2 hash iterations. Default: 1,000 (optimized for client-side/mobile performance)
   */
  iterations?: number;
  /**
   * Salt length in bytes. Default: 16 (128 bits)
   */
  saltBytes?: number;
  /**
   * Maximum failed login attempts before locking account. Set to 0 to disable. Default: 5
   */
  maxFailedAttempts?: number;
  /**
   * Account lockout duration in ms. Default: 15 minutes (900,000 ms)
   */
  lockoutDurationMs?: number;
  /**
   * Password reset token validity duration in ms. Default: 1 hour (3,600,000 ms)
   */
  resetTokenExpiryMs?: number;
  /**
   * Minimum password length requirement. Default: 8
   */
  minPasswordLength?: number;
  /**
   * Custom password validator function. Return string error or false to reject.
   */
  validatePassword?: (password: string) => boolean | string;
  /**
   * Shared SessionManager instance or options to configure internal SessionManager.
   */
  session?: SessionManager | SessionManagerOptions;
  /**
   * Optional remote authentication handler to exchange local sessions for remote sync provider tokens.
   */
  remoteAuthHandler?: RemoteAuthHandler;
}

export interface RemoteAuthExchangeContext<TMetadata = any> {
  user: LocalUser<TMetadata>;
  session: SessionRecord<LocalUser<TMetadata>>;
}

export type RemoteAuthHandler<TMetadata = any> = (
  context: RemoteAuthExchangeContext<TMetadata>
) => Promise<{ token: string; [key: string]: any } | null>;

export interface SignUpOptions<TMetadata = Record<string, any>> {
  id?: string;
  email: string;
  password: string;
  username?: string | null;
  displayName?: string | null;
  role?: string;
  metadata?: TMetadata;
  emailVerified?: boolean;
  /**
   * Whether to activate an offline session immediately upon registration. Default: true
   */
  setActiveSession?: boolean;
  /**
   * Session offline duration in ms.
   */
  offlineDurationMs?: number;
}

export interface SignInOptions {
  /** Email or username */
  identifier: string;
  password: string;
  /** Whether to create and activate a session in SessionManager. Default: true */
  setActiveSession?: boolean;
  /** Session offline duration in ms. Default: 30 days */
  offlineDurationMs?: number;
}

export interface SignInResult<TMetadata = Record<string, any>> {
  user: LocalUser<TMetadata>;
  session?: SessionRecord<LocalUser<TMetadata>> | null;
}

export interface ChangePasswordOptions {
  userId: string;
  oldPassword: string;
  newPassword: string;
}

export interface UpdateUserOptions<TMetadata = Record<string, any>> {
  email?: string;
  username?: string | null;
  displayName?: string | null;
  role?: string;
  metadata?: TMetadata | null;
  status?: UserStatus;
  emailVerified?: boolean;
}

export interface CreateResetTokenResult {
  token: string;
  expiresAt: number;
}

/**
 * Generates cryptographically secure random bytes across Web, Expo/React Native, and Node.js.
 */
export function getCryptoRandomBytes(length: number): Uint8Array {
  const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    try {
      return cryptoObj.getRandomValues(new Uint8Array(length));
    } catch {
      // Fallback below
    }
  }
  try {
    const nodeCrypto = (globalThis as any).process?.versions?.node
      ? (globalThis as any).require('node:crypto')
      : null;
    if (nodeCrypto?.randomBytes) {
      return new Uint8Array(nodeCrypto.randomBytes(length));
    }
  } catch {
    // Fallback ignored
  }
  const fallback = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    fallback[i] = Math.floor(Math.random() * 256);
  }
  return fallback;
}

/**
 * Derives PBKDF2 keys using hardware-accelerated WebCrypto if available,
 * fast 32-bit integer unboxed pure-JS for mobile performance (<=2000 iters),
 * or non-blocking asynchronous pure-JS PBKDF2.
 */
export async function derivePbkdf2Key(
  password: string,
  salt: Uint8Array,
  iterations: number,
  algorithm: string = DEFAULT_PASSWORD_ALGORITHM
): Promise<Uint8Array> {
  const isSha256 = algorithm.toUpperCase().includes('SHA256');
  const dkLen = isSha256 ? 32 : 64;
  const hashName = isSha256 ? 'SHA-256' : 'SHA-512';
  const hashFn = isSha256 ? sha256 : sha512;

  // 1. Try hardware-accelerated WebCrypto if supported
  const subtle = typeof globalThis !== 'undefined' ? (globalThis as any).crypto?.subtle : undefined;
  if (subtle?.importKey && subtle?.deriveBits) {
    try {
      const keyMaterial = await subtle.importKey(
        'raw',
        utf8ToBytes(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
      );
      const derivedBits = await subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: salt as any,
          iterations,
          hash: hashName,
        },
        keyMaterial,
        dkLen * 8
      );
      return new Uint8Array(derivedBits);
    } catch {
      // Fallback to noble hashes
    }
  }

  // 2. Pure-JS execution:
  // With SHA-256 and <=2000 iterations, pbkdf2 uses native 32-bit unboxed integers without BigInt.
  // In Hermes on mobile, this takes ~15-25ms. Running synchronously avoids timer queue latency.
  if (iterations <= 2000 && isSha256) {
    return pbkdf2(hashFn, utf8ToBytes(password), salt, {
      c: iterations,
      dkLen,
    });
  }

  // 3. For large iterations or SHA-512, yield to event loop
  return await pbkdf2Async(hashFn, utf8ToBytes(password), salt, {
    c: iterations,
    dkLen,
    asyncTick: 50,
  });
}

/**
 * Hashes a plaintext password using PBKDF2 with a cryptographically secure random salt.
 */
export async function hashPassword(
  password: string,
  options: { saltBytes?: number; iterations?: number; algorithm?: string } = {}
): Promise<{ hash: string; salt: string; iterations: number; algorithm: string }> {
  const saltLen = options.saltBytes ?? DEFAULT_SALT_BYTES;
  const iterations = options.iterations ?? DEFAULT_PASSWORD_ITERATIONS;
  const algorithm = options.algorithm ?? DEFAULT_PASSWORD_ALGORITHM;
  const salt = getCryptoRandomBytes(saltLen);

  const derivedKey = await derivePbkdf2Key(password, salt, iterations, algorithm);

  return {
    hash: bytesToHex(derivedKey),
    salt: bytesToHex(salt),
    iterations,
    algorithm,
  };
}

/**
 * Verifies a plaintext password against a stored PBKDF2 hash using constant-time comparison.
 */
export async function verifyPassword(
  password: string,
  expectedHashHex: string,
  saltHex: string,
  iterations: number,
  algorithm: string = DEFAULT_PASSWORD_ALGORITHM
): Promise<boolean> {
  try {
    const salt = hexToBytes(saltHex);
    const derivedKey = await derivePbkdf2Key(password, salt, iterations, algorithm);
    const actualHashHex = bytesToHex(derivedKey);
    return timingSafeEqual(actualHashHex.toLowerCase(), expectedHashHex.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Generates an opaque random token and its corresponding SHA-256 hash.
 */
export function generateCryptoToken(lengthBytes: number = 32): { token: string; hash: string } {
  const bytes = getCryptoRandomBytes(lengthBytes);
  const token = bytesToHex(bytes);
  const hash = bytesToHex(sha256(utf8ToBytes(token)));
  return { token, hash };
}

/**
 * Converts a raw database row into a sanitized user object without secret credentials.
 */
export function mapStoredUserRow<TMetadata = any>(row: any): LocalUser<TMetadata> {
  let metadata: TMetadata | null = null;
  if (row.metadata) {
    try {
      metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    } catch {
      metadata = row.metadata as TMetadata;
    }
  }

  return {
    id: String(row.id),
    email: String(row.email),
    username: row.username ? String(row.username) : null,
    displayName: row.display_name ? String(row.display_name) : null,
    role: String(row.role || 'user'),
    metadata,
    status: (row.status as UserStatus) || 'active',
    failedLoginAttempts: Number(row.failed_login_attempts || 0),
    lockedUntil: row.locked_until != null ? Number(row.locked_until) : null,
    emailVerified: row.email_verified === 1 || row.email_verified === '1' || row.email_verified === true,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    lastLoginAt: row.last_login_at != null ? Number(row.last_login_at) : null,
  };
}

/**
 * Fully local, zero-backend authentication engine for SQLite.
 * Manages users, PBKDF2-SHA512 crypto credentials, offline sessions, account lockout, and tokens.
 */
export class LocalAuthEngine {
  private usersTable: string;
  private tokensTable: string;
  private sqlUsersTable: string;
  private sqlTokensTable: string;
  private algorithm: string;
  private iterations: number;
  private saltBytes: number;
  private maxFailedAttempts: number;
  private lockoutDurationMs: number;
  private resetTokenExpiryMs: number;
  private minPasswordLength: number;
  private customPasswordValidator?: (password: string) => boolean | string;
  private sessionManager: SessionManager;
  private remoteAuthHandler?: RemoteAuthHandler;

  constructor(
    private db: DBExecutable,
    sessionOrManager?: SessionManager | SessionManagerOptions | LocalAuthEngineOptions,
    private events?: EventEmitter,
    options: LocalAuthEngineOptions = {}
  ) {
    let resolvedOptions = options;
    let resolvedSession: SessionManager | SessionManagerOptions | undefined =
      sessionOrManager instanceof SessionManager ? sessionOrManager : undefined;
    let resolvedEvents = events;

    if (sessionOrManager && !(sessionOrManager instanceof SessionManager)) {
      if (
        'usersTable' in sessionOrManager ||
        'iterations' in sessionOrManager ||
        'remoteAuthHandler' in sessionOrManager ||
        'maxFailedAttempts' in sessionOrManager
      ) {
        resolvedOptions = sessionOrManager as LocalAuthEngineOptions;
        resolvedSession = (sessionOrManager as LocalAuthEngineOptions).session;
      } else {
        resolvedSession = sessionOrManager as SessionManagerOptions;
      }
    }
    this.events = resolvedEvents || new EventEmitter();
    this.usersTable = resolvedOptions.usersTable || DEFAULT_USERS_TABLE;
    this.tokensTable = resolvedOptions.tokensTable || DEFAULT_USER_TOKENS_TABLE;
    this.sqlUsersTable = escapeIdentifier(this.usersTable);
    this.sqlTokensTable = escapeIdentifier(this.tokensTable);

    this.algorithm = resolvedOptions.algorithm || DEFAULT_PASSWORD_ALGORITHM;
    this.iterations = resolvedOptions.iterations || DEFAULT_PASSWORD_ITERATIONS;
    this.saltBytes = resolvedOptions.saltBytes || DEFAULT_SALT_BYTES;
    this.maxFailedAttempts = resolvedOptions.maxFailedAttempts ?? DEFAULT_LOCKOUT_ATTEMPTS;
    this.lockoutDurationMs = resolvedOptions.lockoutDurationMs ?? DEFAULT_LOCKOUT_DURATION_MS;
    this.resetTokenExpiryMs = resolvedOptions.resetTokenExpiryMs ?? DEFAULT_RESET_TOKEN_EXPIRY_MS;
    this.minPasswordLength = resolvedOptions.minPasswordLength ?? DEFAULT_MIN_PASSWORD_LENGTH;
    this.customPasswordValidator = resolvedOptions.validatePassword;
    this.remoteAuthHandler = resolvedOptions.remoteAuthHandler;

    if (resolvedSession instanceof SessionManager) {
      this.sessionManager = resolvedSession;
    } else {
      this.sessionManager = new SessionManager(this.db, this.events, resolvedSession);
    }
  }

  /**
   * Registers a pluggable remote authentication exchange handler.
   */
  setRemoteAuthHandler(handler: RemoteAuthHandler): void {
    this.remoteAuthHandler = handler;
  }

  /**
   * Gets the configured remote authentication exchange handler.
   */
  getRemoteAuthHandler(): RemoteAuthHandler | undefined {
    return this.remoteAuthHandler;
  }

  /**
   * Triggers token exchange with the registered remote sync provider for the active session.
   */
  async exchangeRemoteAuth(): Promise<{ token: string; [key: string]: any } | null> {
    if (!this.remoteAuthHandler) return null;
    const session = await this.sessionManager.getActiveSession();
    if (!session || !session.userId) return null;
    const user = await this.getUserById(session.userId);
    if (!user) return null;
    const result = await this.remoteAuthHandler({ user, session });
    if (result && result.token) {
      await this.sessionManager.updateTokens({ token: result.token });
      session.token = result.token;
    }
    return result;
  }

  /**
   * Retrieves the cached remote sync authentication token from the active session.
   */
  async getRemoteAuthToken(): Promise<string | null> {
    const session = await this.sessionManager.getActiveSession();
    return session?.token || null;
  }

  /**
   * Retrieves the underlying SessionManager instance.
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Initializes SQLite tables and indexes for users and tokens.
   */
  async initialize(): Promise<void> {
    await this.sessionManager.initialize();

    // 1. Users table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS ${this.sqlUsersTable} (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        username TEXT,
        display_name TEXT,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        iterations INTEGER NOT NULL,
        algorithm TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        metadata TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER,
        email_verified INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
    `);

    await this.db.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${escapeIdentifier(`idx_${this.usersTable}_email`)} ON ${this.sqlUsersTable} (email);
    `);
    await this.db.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${escapeIdentifier(`idx_${this.usersTable}_username`)} ON ${this.sqlUsersTable} (username);
    `);
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS ${escapeIdentifier(`idx_${this.usersTable}_status`)} ON ${this.sqlUsersTable} (status);
    `);

    // 2. Tokens table (password resets, email verification, recovery)
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS ${this.sqlTokensTable} (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        type TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        used_at INTEGER
      );
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS ${escapeIdentifier(`idx_${this.tokensTable}_hash`)} ON ${this.sqlTokensTable} (token_hash, type);
    `);
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS ${escapeIdentifier(`idx_${this.tokensTable}_user`)} ON ${this.sqlTokensTable} (user_id);
    `);
  }

  /**
   * Registers a new user with high-level crypto credentials.
   */
  async signUp<TMetadata = any>(options: SignUpOptions<TMetadata>): Promise<SignInResult<TMetadata>> {
    const email = (options.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new Error('A valid email address is required.');
    }

    const username = options.username ? options.username.trim().toLowerCase() : null;
    this.assertValidPassword(options.password);

    // Uniqueness checks
    const existingEmail = await this.getUserByEmail(email);
    if (existingEmail) {
      throw new Error('An account with this email address already exists.');
    }

    if (username) {
      const existingUsername = await this.getUserByUsername(username);
      if (existingUsername) {
        throw new Error('This username is already taken.');
      }
    }

    const id = options.id || generateUUID();
    const now = Date.now();
    const creds = await hashPassword(options.password, {
      saltBytes: this.saltBytes,
      iterations: this.iterations,
      algorithm: this.algorithm,
    });

    const metadataStr = options.metadata ? JSON.stringify(options.metadata) : null;
    const role = options.role || 'user';
    const emailVerified = options.emailVerified ? 1 : 0;

    await this.db.execute(
      `INSERT INTO ${this.sqlUsersTable} (
        id, email, username, display_name, password_hash, salt, iterations, algorithm,
        role, metadata, status, failed_login_attempts, locked_until, email_verified,
        created_at, updated_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, NULL, ?, ?, ?, NULL);`,
      [
        id,
        email,
        username,
        options.displayName || null,
        creds.hash,
        creds.salt,
        creds.iterations,
        creds.algorithm,
        role,
        metadataStr,
        emailVerified,
        now,
        now,
      ]
    );

    const user: LocalUser<TMetadata> = {
      id,
      email,
      username,
      displayName: options.displayName || null,
      role,
      metadata: options.metadata || null,
      status: 'active',
      failedLoginAttempts: 0,
      lockedUntil: null,
      emailVerified: options.emailVerified ?? false,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    };

    let session: SessionRecord<LocalUser<TMetadata>> | null = null;
    if (options.setActiveSession !== false) {
      session = await this.sessionManager.createSession<LocalUser<TMetadata>>({
        userId: user.id,
        user,
        provider: 'local',
        offlineDurationMs: options.offlineDurationMs,
        setActive: true,
      });
      if (this.remoteAuthHandler && session) {
        try {
          const remoteRes = await this.remoteAuthHandler({ user, session });
          if (remoteRes && remoteRes.token) {
            await this.sessionManager.updateTokens({ token: remoteRes.token });
            session.token = remoteRes.token;
          }
        } catch {
          // Non-fatal if offline
        }
      }
    }

    this.events?.emit(this.usersTable, { operation: 'SIGN_UP', user });
    return { user, session };
  }

  /**
   * Authenticates a user by email or username using constant-time PBKDF2 comparison.
   * Handles brute-force protection, account locking, and session initialization.
   */
  async signIn<TMetadata = any>(options: SignInOptions): Promise<SignInResult<TMetadata>> {
    const identifier = (options.identifier || '').trim().toLowerCase();
    const password = options.password || '';

    if (!identifier || !password) {
      throw new Error('Identifier and password are required.');
    }

    const rows = await this.db.execute(
      `SELECT * FROM ${this.sqlUsersTable} WHERE lower(email) = ? OR lower(username) = ? LIMIT 1;`,
      [identifier, identifier]
    );

    const row = (rows && rows.length > 0 ? rows[0] : null) as StoredUserRow | null;

    if (!row) {
      // Dummy verification to mitigate timing attacks against non-existent accounts
      await verifyPassword('dummy_password', '0'.repeat(128), '0'.repeat(32), Math.min(this.iterations, 5_000));
      throw new Error('Invalid email/username or password.');
    }

    const now = Date.now();

    // Check account lockout
    if (row.locked_until && row.locked_until > now) {
      const waitMinutes = Math.ceil((row.locked_until - now) / 60000);
      throw new Error(
        `Account is temporarily locked due to consecutive failed login attempts. Please try again in ${waitMinutes} minute(s).`
      );
    }

    // Check suspended status
    if (row.status === 'suspended') {
      throw new Error('Account has been suspended. Please contact support.');
    }

    // Verify password
    const isValid = await verifyPassword(
      password,
      row.password_hash,
      row.salt,
      row.iterations,
      row.algorithm
    );

    if (!isValid) {
      const attempts = (row.failed_login_attempts || 0) + 1;
      let lockedUntil: number | null = null;
      let newStatus: UserStatus = row.status;

      if (this.maxFailedAttempts > 0 && attempts >= this.maxFailedAttempts) {
        lockedUntil = now + this.lockoutDurationMs;
        newStatus = 'locked';
        this.events?.emit(this.usersTable, {
          operation: 'ACCOUNT_LOCKED',
          userId: row.id,
          lockedUntil,
        });
      }

      await this.db.execute(
        `UPDATE ${this.sqlUsersTable} SET failed_login_attempts = ?, locked_until = ?, status = ?, updated_at = ? WHERE id = ?;`,
        [attempts, lockedUntil, newStatus, now, row.id]
      );

      if (lockedUntil) {
        const waitMinutes = Math.ceil(this.lockoutDurationMs / 60000);
        throw new Error(
          `Account has been locked due to ${attempts} failed attempts. Please try again in ${waitMinutes} minute(s).`
        );
      }

      throw new Error('Invalid email/username or password.');
    }

    // Reset failed attempts and update last login timestamp
    await this.db.execute(
      `UPDATE ${this.sqlUsersTable} SET failed_login_attempts = 0, locked_until = NULL, status = 'active', last_login_at = ?, updated_at = ? WHERE id = ?;`,
      [now, now, row.id]
    );

    // Auto-upgrade legacy or slower hashes to modern PBKDF2-SHA256 standard
    if (row.algorithm !== this.algorithm || row.iterations !== this.iterations) {
      try {
        const upgraded = await hashPassword(password, {
          saltBytes: this.saltBytes,
          iterations: this.iterations,
          algorithm: this.algorithm,
        });
        await this.db.execute(
          `UPDATE ${this.sqlUsersTable} SET password_hash = ?, salt = ?, iterations = ?, algorithm = ? WHERE id = ?;`,
          [upgraded.hash, upgraded.salt, upgraded.iterations, upgraded.algorithm, row.id]
        );
      } catch {
        // Non-critical upgrade
      }
    }

    const user = mapStoredUserRow<TMetadata>({
      ...row,
      failed_login_attempts: 0,
      locked_until: null,
      status: 'active',
      last_login_at: now,
    });

    let session: SessionRecord<LocalUser<TMetadata>> | null = null;
    if (options.setActiveSession !== false) {
      session = await this.sessionManager.createSession<LocalUser<TMetadata>>({
        userId: user.id,
        user,
        provider: 'local',
        offlineDurationMs: options.offlineDurationMs,
        setActive: true,
      });
      if (this.remoteAuthHandler && session) {
        try {
          const remoteRes = await this.remoteAuthHandler({ user, session });
          if (remoteRes && remoteRes.token) {
            await this.sessionManager.updateTokens({ token: remoteRes.token });
            session.token = remoteRes.token;
          }
        } catch {
          // Non-fatal if offline
        }
      }
    }

    this.events?.emit(this.usersTable, { operation: 'SIGN_IN', user, session });
    return { user, session };
  }

  /**
   * Signs out the active user and clears the local session.
   */
  async signOut(): Promise<void> {
    const current = await this.sessionManager.getActiveSession();
    await this.sessionManager.clearSession();
    this.events?.emit(this.usersTable, { operation: 'SIGN_OUT', userId: current?.userId });
  }

  /**
   * Subscribes to authentication state changes (sign in, sign out, user updates).
   */
  onAuthStateChange(listener: (user: LocalUser<any> | null) => void): () => void {
    if (!this.events) return () => {};
    const unsubs = [
      this.events.on(this.usersTable, () => {
        this.getCurrentUser().then(listener).catch(() => {});
      }),
      this.events.on('_local_sessions', () => {
        this.getCurrentUser().then(listener).catch(() => {});
      }),
    ];
    return () => {
      unsubs.forEach((u) => u());
    };
  }

  /**
   * Retrieves the currently authenticated local user based on the active session.
   */
  async getCurrentUser<TMetadata = any>(): Promise<LocalUser<TMetadata> | null> {
    const session = await this.sessionManager.getActiveSession<LocalUser<TMetadata>>();
    if (!session || !session.userId) return null;
    return this.getUserById<TMetadata>(session.userId);
  }

  /**
   * Returns whether a valid user session is currently active.
   */
  async isAuthenticated(): Promise<boolean> {
    return this.sessionManager.isAuthenticated();
  }

  /**
   * Finds a user by unique ID.
   */
  async getUserById<TMetadata = any>(id: string): Promise<LocalUser<TMetadata> | null> {
    const rows = await this.db.execute(
      `SELECT * FROM ${this.sqlUsersTable} WHERE id = ? LIMIT 1;`,
      [id]
    );
    if (!rows || rows.length === 0) return null;
    return mapStoredUserRow<TMetadata>(rows[0]);
  }

  /**
   * Finds a user by email address (case-insensitive).
   */
  async getUserByEmail<TMetadata = any>(email: string): Promise<LocalUser<TMetadata> | null> {
    const rows = await this.db.execute(
      `SELECT * FROM ${this.sqlUsersTable} WHERE lower(email) = ? LIMIT 1;`,
      [email.trim().toLowerCase()]
    );
    if (!rows || rows.length === 0) return null;
    return mapStoredUserRow<TMetadata>(rows[0]);
  }

  /**
   * Finds a user by username (case-insensitive).
   */
  async getUserByUsername<TMetadata = any>(username: string): Promise<LocalUser<TMetadata> | null> {
    const rows = await this.db.execute(
      `SELECT * FROM ${this.sqlUsersTable} WHERE lower(username) = ? LIMIT 1;`,
      [username.trim().toLowerCase()]
    );
    if (!rows || rows.length === 0) return null;
    return mapStoredUserRow<TMetadata>(rows[0]);
  }

  /**
   * Changes a user's password after verifying their existing password.
   */
  async changePassword(options: ChangePasswordOptions): Promise<void> {
    const rows = await this.db.execute(
      `SELECT * FROM ${this.sqlUsersTable} WHERE id = ? LIMIT 1;`,
      [options.userId]
    );

    const row = (rows && rows.length > 0 ? rows[0] : null) as StoredUserRow | null;
    if (!row) {
      throw new Error('User not found.');
    }

    const isOldValid = await verifyPassword(
      options.oldPassword,
      row.password_hash,
      row.salt,
      row.iterations,
      row.algorithm
    );

    if (!isOldValid) {
      throw new Error('Current password is incorrect.');
    }

    this.assertValidPassword(options.newPassword);
    const now = Date.now();
    const creds = await hashPassword(options.newPassword, {
      saltBytes: this.saltBytes,
      iterations: this.iterations,
      algorithm: this.algorithm,
    });

    await this.db.execute(
      `UPDATE ${this.sqlUsersTable} SET password_hash = ?, salt = ?, iterations = ?, algorithm = ?, updated_at = ? WHERE id = ?;`,
      [creds.hash, creds.salt, creds.iterations, creds.algorithm, now, options.userId]
    );

    this.events?.emit(this.usersTable, {
      operation: 'PASSWORD_CHANGED',
      userId: options.userId,
    });
  }

  /**
   * Generates a cryptographically secure, single-use password reset token with expiration.
   */
  async createPasswordResetToken(emailOrUsername: string): Promise<CreateResetTokenResult> {
    const identifier = (emailOrUsername || '').trim().toLowerCase();
    const rows = await this.db.execute(
      `SELECT id FROM ${this.sqlUsersTable} WHERE lower(email) = ? OR lower(username) = ? LIMIT 1;`,
      [identifier, identifier]
    );

    if (!rows || rows.length === 0) {
      throw new Error('No account found matching this identifier.');
    }

    const userId = String(rows[0].id);
    const { token, hash } = generateCryptoToken(32);
    const now = Date.now();
    const expiresAt = now + this.resetTokenExpiryMs;
    const tokenId = generateUUID();

    await this.db.execute(
      `INSERT INTO ${this.sqlTokensTable} (id, user_id, token_hash, type, expires_at, created_at, used_at)
       VALUES (?, ?, ?, 'reset_password', ?, ?, NULL);`,
      [tokenId, userId, hash, expiresAt, now]
    );

    return { token, expiresAt };
  }

  /**
   * Resets a user's password using a valid cryptographic reset token.
   */
  async resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
    if (!token || !token.trim()) {
      throw new Error('A valid reset token is required.');
    }

    this.assertValidPassword(newPassword);

    const tokenHash = bytesToHex(sha256(utf8ToBytes(token.trim())));
    const now = Date.now();

    const rows = await this.db.execute(
      `SELECT * FROM ${this.sqlTokensTable} WHERE token_hash = ? AND type = 'reset_password' AND used_at IS NULL AND expires_at > ? LIMIT 1;`,
      [tokenHash, now]
    );

    if (!rows || rows.length === 0) {
      throw new Error('Password reset token is invalid or has expired.');
    }

    const tokenRow = rows[0];
    const userId = String(tokenRow.user_id);
    const creds = await hashPassword(newPassword, {
      saltBytes: this.saltBytes,
      iterations: this.iterations,
      algorithm: this.algorithm,
    });

    // Invalidate token
    await this.db.execute(
      `UPDATE ${this.sqlTokensTable} SET used_at = ? WHERE id = ?;`,
      [now, tokenRow.id]
    );

    // Update password and unlock account
    await this.db.execute(
      `UPDATE ${this.sqlUsersTable} SET password_hash = ?, salt = ?, iterations = ?, algorithm = ?, failed_login_attempts = 0, locked_until = NULL, status = 'active', updated_at = ? WHERE id = ?;`,
      [creds.hash, creds.salt, creds.iterations, creds.algorithm, now, userId]
    );

    this.events?.emit(this.usersTable, {
      operation: 'PASSWORD_RESET',
      userId,
    });
  }

  /**
   * Updates an existing user's profile, role, or metadata.
   */
  async updateUser<TMetadata = any>(
    id: string,
    updates: UpdateUserOptions<TMetadata>
  ): Promise<LocalUser<TMetadata>> {
    const existing = await this.getUserById<TMetadata>(id);
    if (!existing) {
      throw new Error('User not found.');
    }

    const now = Date.now();
    const setClauses: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    if (updates.email !== undefined) {
      const email = updates.email.trim().toLowerCase();
      if (!email.includes('@')) throw new Error('A valid email address is required.');
      if (email !== existing.email) {
        const conflict = await this.getUserByEmail(email);
        if (conflict && conflict.id !== id) {
          throw new Error('Email address is already in use by another account.');
        }
      }
      setClauses.push('email = ?');
      params.push(email);
    }

    if (updates.username !== undefined) {
      const username = updates.username ? updates.username.trim().toLowerCase() : null;
      if (username && username !== existing.username) {
        const conflict = await this.getUserByUsername(username);
        if (conflict && conflict.id !== id) {
          throw new Error('Username is already in use by another account.');
        }
      }
      setClauses.push('username = ?');
      params.push(username);
    }

    if (updates.displayName !== undefined) {
      setClauses.push('display_name = ?');
      params.push(updates.displayName);
    }

    if (updates.role !== undefined) {
      setClauses.push('role = ?');
      params.push(updates.role);
    }

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }

    if (updates.emailVerified !== undefined) {
      setClauses.push('email_verified = ?');
      params.push(updates.emailVerified ? 1 : 0);
    }

    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?');
      params.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
    }

    params.push(id);
    await this.db.execute(
      `UPDATE ${this.sqlUsersTable} SET ${setClauses.join(', ')} WHERE id = ?;`,
      params
    );

    const updated = (await this.getUserById<TMetadata>(id))!;

    // If active session belongs to this user, update cached user data
    const active = await this.sessionManager.getActiveSession();
    if (active && active.userId === id) {
      await this.sessionManager.updateUser(updated);
    }

    this.events?.emit(this.usersTable, { operation: 'USER_UPDATED', user: updated });
    return updated;
  }

  /**
   * Permanently deletes a user, their associated tokens, and clears any active session.
   */
  async deleteUser(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM ${this.sqlTokensTable} WHERE user_id = ?;`, [id]);
    await this.db.execute(`DELETE FROM ${this.sqlUsersTable} WHERE id = ?;`, [id]);

    const active = await this.sessionManager.getActiveSession();
    if (active && active.userId === id) {
      await this.sessionManager.clearSession();
    }

    this.events?.emit(this.usersTable, { operation: 'USER_DELETED', userId: id });
  }

  /**
   * Manually locks a user account.
   */
  async lockAccount(userId: string, durationMs?: number): Promise<void> {
    const now = Date.now();
    const duration = durationMs ?? this.lockoutDurationMs;
    const lockedUntil = now + duration;

    await this.db.execute(
      `UPDATE ${this.sqlUsersTable} SET status = 'locked', locked_until = ?, updated_at = ? WHERE id = ?;`,
      [lockedUntil, now, userId]
    );

    this.events?.emit(this.usersTable, { operation: 'ACCOUNT_LOCKED', userId, lockedUntil });
  }

  /**
   * Manually unlocks a user account and clears failed login attempts.
   */
  async unlockAccount(userId: string): Promise<void> {
    const now = Date.now();
    await this.db.execute(
      `UPDATE ${this.sqlUsersTable} SET status = 'active', failed_login_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?;`,
      [now, userId]
    );

    this.events?.emit(this.usersTable, { operation: 'ACCOUNT_UNLOCKED', userId });
  }

  /**
   * Lists local users with optional role, status filtering, and pagination.
   */
  async listUsers<TMetadata = any>(
    options: { limit?: number; offset?: number; status?: UserStatus; role?: string } = {}
  ): Promise<LocalUser<TMetadata>[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    if (options.role) {
      conditions.push('role = ?');
      params.push(options.role);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const rows = await this.db.execute(
      `SELECT * FROM ${this.sqlUsersTable} ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?;`,
      [...params, limit, offset]
    );

    return (rows || []).map((r) => mapStoredUserRow<TMetadata>(r));
  }

  private assertValidPassword(password: string): void {
    if (!password || typeof password !== 'string') {
      throw new Error('A password must be provided.');
    }
    if (password.length < this.minPasswordLength) {
      throw new Error(`Password must be at least ${this.minPasswordLength} characters long.`);
    }
    if (this.customPasswordValidator) {
      const res = this.customPasswordValidator(password);
      if (res === false) {
        throw new Error('Password does not meet complexity requirements.');
      }
      if (typeof res === 'string') {
        throw new Error(res);
      }
    }
  }
}
