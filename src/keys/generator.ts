import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { GenerateApiKeyOptions, GeneratedApiKey } from './types.js';

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generates cryptographically secure random bytes across Web, Expo/React Native, and Node.js.
 */
export function getRandomBytes(length: number): Uint8Array {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    return cryptoObj.getRandomValues(new Uint8Array(length));
  }
  try {
    // Dynamic fallback for Node.js environments without globalThis.crypto
    const nodeCrypto = (globalThis as any).process?.versions?.node
      ? (globalThis as any).require('node:crypto')
      : null;
    if (nodeCrypto?.randomBytes) {
      return new Uint8Array(nodeCrypto.randomBytes(length));
    }
  } catch {
    // Fallback ignored
  }
  throw new Error('Cryptographically secure random number generator is unavailable.');
}

/**
 * Encodes raw bytes into a base62 string.
 */
export function bytesToBase62(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += BASE62_ALPHABET[bytes[i] % 62];
  }
  return result;
}

/**
 * Calculates a 4-byte (8-char hex) checksum over the prefix and random entropy.
 */
export function calculateKeyChecksum(content: string): string {
  const hash = sha256(utf8ToBytes(content));
  return bytesToHex(hash.slice(0, 4));
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Hashes an API key using SHA-256 for secure storage.
 */
export function hashApiKey(key: string): string {
  return bytesToHex(sha256(utf8ToBytes(key.trim())));
}

/**
 * Generates an industry-standard, cryptographically secure API key.
 * Format: [prefix]_[entropy]_[checksum]
 *
 * Example:
 * prop_a7F9x2K1m8P0qW4z_c4f910e2
 */
export function generateApiKey(options: GenerateApiKeyOptions = {}): GeneratedApiKey {
  const prefix = (options.prefix || 'key').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const byteLength = options.byteLength ?? 24;
  const withChecksum = options.withChecksum ?? true;

  const entropyBytes = getRandomBytes(byteLength);
  const entropy = bytesToBase62(entropyBytes);

  let key: string;
  let checksum = '';

  if (withChecksum) {
    checksum = calculateKeyChecksum(`${prefix}_${entropy}`);
    key = `${prefix}_${entropy}_${checksum}`;
  } else {
    key = `${prefix}_${entropy}`;
  }

  const keyHash = hashApiKey(key);

  // Masked display representation (e.g. prop_...c4f910e2)
  const suffix = key.slice(-6);
  const display = `${prefix}_...${suffix}`;

  return {
    key,
    keyHash,
    prefix,
    display,
  };
}

/**
 * Verifies whether a key string is syntactically valid and has an authentic checksum.
 * Does not require a database lookup.
 */
export function verifyApiKeyFormat(key: string, expectedPrefix?: string): boolean {
  if (!key || typeof key !== 'string') return false;

  const parts = key.trim().split('_');
  if (parts.length < 2) return false;

  const prefix = parts[0];
  if (expectedPrefix && prefix !== expectedPrefix) return false;

  // Checksummed format: [prefix]_[entropy]_[checksum]
  if (parts.length >= 3) {
    const checksum = parts[parts.length - 1];
    const content = parts.slice(0, parts.length - 1).join('_');
    const expectedChecksum = calculateKeyChecksum(content);
    return timingSafeEqual(checksum, expectedChecksum);
  }

  return true;
}

/**
 * Validates a raw API key against a stored SHA-256 hash in constant time.
 */
export function verifyApiKey(rawKey: string, storedHash: string, expectedPrefix?: string): boolean {
  if (!verifyApiKeyFormat(rawKey, expectedPrefix)) {
    return false;
  }
  const computedHash = hashApiKey(rawKey);
  return timingSafeEqual(computedHash, storedHash);
}
