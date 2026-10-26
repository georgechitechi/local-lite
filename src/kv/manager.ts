import { DBExecutable } from '../core/schema-manager.js';
import { EventEmitter } from '../reactive/event-emitter.js';
import {
  decryptBackupData,
  encryptBackupData,
} from '../backups/encryption.js';
import { base64UrlEncode, base64UrlDecode } from '../keys/signed-token.js';
import { KVRecord, KVSetOptions, KVSetSecretOptions, KVStoreOptions } from './types.js';
import { DEFAULT_KV_TABLE, KVStore } from './store.js';

export class KVManager {
  private tableName: string;
  private events?: EventEmitter;

  constructor(
    private db: DBExecutable,
    eventsOrOptions?: EventEmitter | KVStoreOptions,
    options?: KVStoreOptions
  ) {
    let opts: KVStoreOptions = {};
    if (eventsOrOptions && typeof (eventsOrOptions as any).emit === 'function') {
      this.events = eventsOrOptions as EventEmitter;
      opts = options || {};
    } else if (eventsOrOptions) {
      opts = eventsOrOptions as KVStoreOptions;
    }
    this.tableName = opts.tableName ?? DEFAULT_KV_TABLE;
  }

  async initialize(): Promise<void> {
    await KVStore.ensureSchema(this.db, this.tableName);
  }

  /**
   * Sets a value in the key-value store with optional TTL.
   * Emits an event on the event emitter if configured.
   */
  async set(key: string, value: any, options: KVSetOptions = {}): Promise<void> {
    const now = Date.now();
    const expiresAt =
      options.expiresAt !== undefined
        ? options.expiresAt
        : options.ttlMs !== undefined
          ? now + options.ttlMs
          : null;

    let type: string;
    let valueStr: string;

    if (typeof value === 'string') {
      type = 'string';
      valueStr = value;
    } else if (typeof value === 'number') {
      type = 'number';
      valueStr = String(value);
    } else if (typeof value === 'boolean') {
      type = 'boolean';
      valueStr = value ? '1' : '0';
    } else {
      type = 'json';
      valueStr = JSON.stringify(value ?? null);
    }

    await KVStore.set(this.db, this.tableName, key, valueStr, type, now, expiresAt);
    this.events?.emit(this.tableName, { operation: 'SET', key, value });
  }

  /**
   * Retrieves the value for a key, returning defaultValue if not found or expired.
   */
  async get<T = any>(key: string, defaultValue?: T): Promise<T | undefined> {
    const record = await KVStore.get(this.db, this.tableName, key);
    if (!record) return defaultValue;

    if (record.expiresAt && record.expiresAt <= Date.now()) {
      // Lazy deletion of expired key
      KVStore.delete(this.db, this.tableName, key).catch(() => {});
      return defaultValue;
    }

    return record.value as T;
  }

  /**
   * Retrieves the full KVRecord metadata for a key.
   */
  async getRecord(key: string): Promise<KVRecord | null> {
    const record = await KVStore.get(this.db, this.tableName, key);
    if (!record) return null;

    if (record.expiresAt && record.expiresAt <= Date.now()) {
      KVStore.delete(this.db, this.tableName, key).catch(() => {});
      return null;
    }

    return record;
  }

  /**
   * Checks whether a non-expired key exists in the store.
   */
  async has(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== undefined;
  }

  /**
   * Removes a key from the store.
   * Emits an event on the event emitter if configured.
   */
  async delete(key: string): Promise<void> {
    await KVStore.delete(this.db, this.tableName, key);
    this.events?.emit(this.tableName, { operation: 'DELETE', key });
  }

  /**
   * Lists all non-expired keys, optionally filtered by a prefix.
   */
  async keys(prefix?: string): Promise<string[]> {
    return KVStore.listKeys(this.db, this.tableName, prefix);
  }

  /**
   * Clears all stored key-value pairs.
   */
  async clear(): Promise<void> {
    await KVStore.clear(this.db, this.tableName);
    this.events?.emit(this.tableName, { operation: 'CLEAR' });
  }

  /**
   * Stores an encrypted secret using AES-256-GCM + PBKDF2 passphrase encryption.
   */
  async setSecret(key: string, secretValue: any, options: KVSetSecretOptions): Promise<void> {
    if (!options.passphrase) {
      throw new Error('Passphrase is required to store encrypted secret.');
    }

    const strValue = typeof secretValue === 'string' ? secretValue : JSON.stringify(secretValue);
    const plainBytes = new TextEncoder().encode(strValue);
    const encryptedBytes = await encryptBackupData(plainBytes, options.passphrase);
    const encryptedBase64 = base64UrlEncode(encryptedBytes);

    const now = Date.now();
    const expiresAt =
      options.expiresAt !== undefined
        ? options.expiresAt
        : options.ttlMs !== undefined
          ? now + options.ttlMs
          : null;

    await KVStore.set(this.db, this.tableName, key, encryptedBase64, 'encrypted', now, expiresAt);
    this.events?.emit(this.tableName, { operation: 'SET_SECRET', key });
  }

  /**
   * Decrypts and retrieves a stored secret.
   */
  async getSecret<T = any>(key: string, passphrase: string, defaultValue?: T): Promise<T | undefined> {
    const record = await KVStore.get(this.db, this.tableName, key);
    if (!record) return defaultValue;

    if (record.expiresAt && record.expiresAt <= Date.now()) {
      KVStore.delete(this.db, this.tableName, key).catch(() => {});
      return defaultValue;
    }

    if (record.type !== 'encrypted') {
      return record.value;
    }

    const encryptedBytes = base64UrlDecode(record.value);
    const decryptedBytes = await decryptBackupData(encryptedBytes, passphrase);
    const text = new TextDecoder().decode(decryptedBytes);
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as any;
    }
  }

  /**
   * Purges all expired keys immediately.
   */
  async pruneExpired(): Promise<number> {
    return KVStore.pruneExpired(this.db, this.tableName);
  }
}
