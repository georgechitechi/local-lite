export interface GenerateApiKeyOptions {
  /**
   * Prefix for the API key (e.g. 'prop', 'sk_live', 'pk_test').
   * Default: 'key'
   */
  prefix?: string;

  /**
   * Number of random entropy bytes (higher is more secure).
   * Default: 24 bytes (192 bits of entropy)
   */
  byteLength?: number;

  /**
   * Whether to embed a 4-byte checksum at the end of the key for instant validation.
   * Default: true
   */
  withChecksum?: boolean;

  /**
   * Human-readable label or description for this key.
   */
  name?: string;

  /**
   * Arbitrary metadata (e.g. { businessId, scopes, ownerId }).
   */
  metadata?: Record<string, any>;

  /**
   * Expiration window in milliseconds from creation time.
   */
  expiresInMs?: number;

  /**
   * Explicit expiration timestamp in milliseconds.
   */
  expiresAt?: number;
}

export interface GeneratedApiKey {
  /**
   * The raw plaintext key string to return to the user (only shown once!).
   * e.g. "prop_a7F9x..._c4b2"
   */
  key: string;

  /**
   * Cryptographic SHA-256 hash of the key for secure database storage.
   */
  keyHash: string;

  /**
   * Key prefix.
   */
  prefix: string;

  /**
   * Masked display string safe to show in UI (e.g. "prop_...c4b2").
   */
  display: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  display: string;
  keyHash: string;
  metadata?: Record<string, any>;
  createdAt: number;
  expiresAt?: number | null;
  lastUsedAt?: number | null;
  revoked: boolean;
  revokedAt?: number | null;
}

export type KeyVerificationStatus = 'VALID' | 'INVALID' | 'EXPIRED' | 'REVOKED' | 'MALFORMED';

export interface VerifyStoredKeyResult {
  valid: boolean;
  status: KeyVerificationStatus;
  record?: ApiKeyRecord;
  error?: string;
}

export interface CreateSignedTokenOptions<T = Record<string, any>> {
  payload: T;
  secret: string;
  expiresInMs?: number;
  expiresAt?: number;
  tokenId?: string;
}

export interface VerifySignedTokenResult<T = Record<string, any>> {
  valid: boolean;
  expired?: boolean;
  payload?: T;
  expiresAt?: number | null;
  tokenId?: string;
  error?: string;
}

export interface RenewSignedTokenOptions {
  extendMs?: number;
  newExpiresAt?: number;
  secret?: string;
}

export interface ApiKeyManagerOptions {
  tableName?: string;
}
