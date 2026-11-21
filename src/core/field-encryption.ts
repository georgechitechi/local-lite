import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { requireSecureRandomBytes } from '../utils/crypto.js';
import type { LocalDBAdapter } from '../adapters/local/index.js';

const ENC_PREFIX = 'enc:v1:';
const IV_LENGTH = 12;

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export interface FieldEncryptorOptions {
  /** Secret key or passphrase (hashed to 256-bit AES key if not a 32-byte Uint8Array). */
  key: string | Uint8Array;
  /** Map of tableName -> array of column names to encrypt/decrypt transparently. */
  encryptedColumns: Record<string, string[]>;
}

/**
 * Transparent AES-256-GCM field-level encryptor for sensitive SQLite columns.
 */
export class FieldEncryptor {
  private encryptedColumns: Record<string, string[]>;
  private rawKeyBytes: Uint8Array;
  private cryptoKeyPromise: Promise<CryptoKey> | null = null;

  constructor(options: FieldEncryptorOptions) {
    this.encryptedColumns = options.encryptedColumns;
    if (options.key instanceof Uint8Array) {
      if (options.key.length !== 32) {
        this.rawKeyBytes = sha256(options.key);
      } else {
        this.rawKeyBytes = options.key;
      }
    } else {
      if (!options.key) {
        throw new Error('A non-empty encryption key is required.');
      }
      this.rawKeyBytes = sha256(utf8ToBytes(options.key));
    }
  }

  private getCryptoKey(): Promise<CryptoKey> {
    if (!this.cryptoKeyPromise) {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) {
        throw new Error(
          'Web Crypto SubtleCrypto is required for field-level encryption.',
        );
      }
      this.cryptoKeyPromise = subtle.importKey(
        'raw',
        this.rawKeyBytes.buffer.slice(
          this.rawKeyBytes.byteOffset,
          this.rawKeyBytes.byteOffset + this.rawKeyBytes.byteLength,
        ) as ArrayBuffer,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt'],
      );
    }
    return this.cryptoKeyPromise;
  }

  async encryptValue(value: unknown): Promise<string | null | undefined> {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string' && value.startsWith(ENC_PREFIX)) {
      return value;
    }
    const key = await this.getCryptoKey();
    const iv = requireSecureRandomBytes(IV_LENGTH);
    const plainBytes = utf8ToBytes(JSON.stringify(value));
    const cipherBuf = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      plainBytes as BufferSource,
    );
    const cipherBytes = new Uint8Array(cipherBuf);
    const combined = new Uint8Array(IV_LENGTH + cipherBytes.length);
    combined.set(iv, 0);
    combined.set(cipherBytes, IV_LENGTH);
    return ENC_PREFIX + toBase64(combined);
  }

  async decryptValue(raw: unknown): Promise<unknown> {
    if (typeof raw !== 'string' || !raw.startsWith(ENC_PREFIX)) {
      return raw;
    }
    const key = await this.getCryptoKey();
    const combined = fromBase64(raw.slice(ENC_PREFIX.length));
    const iv = combined.slice(0, IV_LENGTH);
    const cipherBytes = combined.slice(IV_LENGTH);
    const plainBuf = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      cipherBytes as BufferSource,
    );
    const json = new TextDecoder().decode(plainBuf);
    return JSON.parse(json);
  }

  async encryptPayload<T extends Record<string, unknown>>(
    tableName: string,
    payload: T,
  ): Promise<T> {
    const cols = this.encryptedColumns[tableName];
    if (!cols || cols.length === 0 || !payload) return payload;
    const copy: Record<string, unknown> = { ...payload };
    for (const col of cols) {
      if (col in copy && copy[col] !== null && copy[col] !== undefined) {
        copy[col] = await this.encryptValue(copy[col]);
      }
    }
    return copy as T;
  }

  async decryptRow<T extends Record<string, unknown>>(
    tableName: string,
    row: T,
  ): Promise<T> {
    const cols = this.encryptedColumns[tableName];
    if (!cols || cols.length === 0 || !row) return row;
    const copy: Record<string, unknown> = { ...row };
    for (const col of cols) {
      if (col in copy && typeof copy[col] === 'string') {
        copy[col] = await this.decryptValue(copy[col]);
      }
    }
    return copy as T;
  }
}

/**
 * Configures SQLCipher at-rest encryption key via `PRAGMA key` for compatible SQLite adapters.
 */
export async function applySqlCipherKey(
  db: LocalDBAdapter,
  key: string,
): Promise<void> {
  if (!key) {
    throw new Error('A non-empty SQLCipher key is required.');
  }
  const escaped = key.replace(/'/g, "''");
  await db.execute(`PRAGMA key = '${escaped}'`);
}
