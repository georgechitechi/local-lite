export interface KVSetOptions {
  /**
   * Time-to-live in milliseconds from current time.
   */
  ttlMs?: number;

  /**
   * Explicit Unix timestamp in milliseconds when this key expires.
   */
  expiresAt?: number;
}

export interface KVSetSecretOptions extends KVSetOptions {
  /**
   * Passphrase used to encrypt the value using AES-256-GCM.
   */
  passphrase: string;
}

export interface KVRecord<T = any> {
  key: string;
  value: T;
  type: 'string' | 'number' | 'boolean' | 'json' | 'encrypted';
  createdAt: number;
  updatedAt: number;
  expiresAt?: number | null;
}

export interface KVStoreOptions {
  tableName?: string;
}
