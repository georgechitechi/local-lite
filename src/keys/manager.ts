import { LocalDBAdapter } from '../adapters/local/index.js';
import { generateUUID } from '../utils/uuid.js';
import { generateApiKey, hashApiKey, verifyApiKeyFormat } from './generator.js';
import { createSignedToken, renewSignedToken, verifySignedToken } from './signed-token.js';
import { DEFAULT_KEYS_TABLE, KeyStore } from './store.js';
import {
  ApiKeyManagerOptions,
  ApiKeyRecord,
  CreateSignedTokenOptions,
  GenerateApiKeyOptions,
  RenewSignedTokenOptions,
  VerifySignedTokenResult,
  VerifyStoredKeyResult,
} from './types.js';

export class ApiKeyManager {
  private db: LocalDBAdapter;
  private tableName: string;

  constructor(db: LocalDBAdapter, options: ApiKeyManagerOptions = {}) {
    this.db = db;
    this.tableName = options.tableName || DEFAULT_KEYS_TABLE;
  }

  /**
   * Initializes the API keys database table and indexes.
   */
  async initialize(): Promise<void> {
    await KeyStore.ensureSchema(this.db, this.tableName);
  }

  /**
   * Generates a new cryptographically secure API key and persists its hash to SQLite.
   * Returns the plaintext key (to show to the user once) along with the stored record.
   */
  async create(options: GenerateApiKeyOptions = {}): Promise<{ key: string; record: ApiKeyRecord }> {
    const generated = generateApiKey(options);
    const now = Date.now();

    const expiresAt =
      options.expiresAt !== undefined
        ? options.expiresAt
        : options.expiresInMs !== undefined
          ? now + options.expiresInMs
          : null;

    const record: ApiKeyRecord = {
      id: generateUUID(),
      name: options.name || `${generated.prefix} key`,
      prefix: generated.prefix,
      display: generated.display,
      keyHash: generated.keyHash,
      metadata: options.metadata,
      createdAt: now,
      expiresAt,
      lastUsedAt: null,
      revoked: false,
      revokedAt: null,
    };

    await KeyStore.insertRecord(this.db, this.tableName, record);

    return {
      key: generated.key,
      record,
    };
  }

  /**
   * Verifies an incoming raw API key against stored hashes in SQLite.
   * Checks format, checksum, expiration, and revocation status.
   */
  async verify(
    rawKey: string,
    options: { updateLastUsed?: boolean; expectedPrefix?: string } = {}
  ): Promise<VerifyStoredKeyResult> {
    if (!rawKey || typeof rawKey !== 'string') {
      return { valid: false, status: 'MALFORMED', error: 'API key is missing or not a string' };
    }

    // 1. Instant syntactic & checksum format verification
    if (!verifyApiKeyFormat(rawKey, options.expectedPrefix)) {
      return { valid: false, status: 'MALFORMED', error: 'Invalid API key format or checksum' };
    }

    // 2. Hash and lookup in database
    const computedHash = hashApiKey(rawKey);
    const record = await KeyStore.findByHash(this.db, this.tableName, computedHash);

    if (!record) {
      return { valid: false, status: 'INVALID', error: 'API key not found' };
    }

    // 3. Check revocation
    if (record.revoked) {
      return { valid: false, status: 'REVOKED', record, error: 'API key has been revoked' };
    }

    // 4. Check expiration
    if (record.expiresAt && record.expiresAt <= Date.now()) {
      return { valid: false, status: 'EXPIRED', record, error: 'API key has expired' };
    }

    // 5. Update last_used_at timestamp
    if (options.updateLastUsed !== false) {
      const now = Date.now();
      record.lastUsedAt = now;
      KeyStore.updateLastUsed(this.db, this.tableName, record.id, now).catch(() => {});
    }

    return {
      valid: true,
      status: 'VALID',
      record,
    };
  }

  /**
   * Revokes an existing API key by ID.
   */
  async revoke(id: string): Promise<boolean> {
    return KeyStore.revoke(this.db, this.tableName, id);
  }

  /**
   * Lists stored API key records with optional filters.
   */
  async list(filter?: { revoked?: boolean; prefix?: string }): Promise<ApiKeyRecord[]> {
    return KeyStore.list(this.db, this.tableName, filter);
  }

  /**
   * Prunes revoked or expired key records.
   */
  async prune(options?: { revokedOlderThanMs?: number; expiredOlderThanMs?: number }): Promise<number> {
    return KeyStore.prune(this.db, this.tableName, options);
  }

  /**
   * Helper to create a signed, tamper-evident token with expiration.
   */
  createSignedToken<T = Record<string, any>>(options: CreateSignedTokenOptions<T>): string {
    return createSignedToken<T>(options);
  }

  /**
   * Helper to verify a signed token's signature and expiration.
   */
  verifySignedToken<T = Record<string, any>>(
    token: string,
    secret: string,
    options?: { clockSkewSeconds?: number }
  ): VerifySignedTokenResult<T> {
    return verifySignedToken<T>(token, secret, options);
  }

  /**
   * Helper to renew an existing signed token by extending its expiration.
   */
  renewSignedToken<T = Record<string, any>>(
    token: string,
    secret: string,
    options?: RenewSignedTokenOptions
  ): string {
    return renewSignedToken<T>(token, secret, options);
  }
}
