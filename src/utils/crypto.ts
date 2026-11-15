const B64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encodes raw bytes into unpadded URL-safe Base64 (RFC 4648 §5).
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i];
    const second = bytes[i + 1];
    const third = bytes[i + 2];
    result += B64URL_ALPHABET[first >> 2];
    result +=
      B64URL_ALPHABET[
        ((first & 3) << 4) | (second === undefined ? 0 : second >> 4)
      ];
    if (second !== undefined) {
      result +=
        B64URL_ALPHABET[
          ((second & 15) << 2) | (third === undefined ? 0 : third >> 6)
        ];
    }
    if (third !== undefined) {
      result += B64URL_ALPHABET[third & 63];
    }
  }
  return result;
}

/**
 * Generates cryptographically secure random bytes across Web, Expo/React Native, and Node.js.
 * Falls back to Math.random() only when no CSPRNG is available.
 */
export function getRandomBytes(length: number): Uint8Array {
  const cryptoObj =
    typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    try {
      return cryptoObj.getRandomValues(new Uint8Array(length));
    } catch {
      // Fallback below
    }
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
  const fallback = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    fallback[i] = Math.floor(Math.random() * 256);
  }
  return fallback;
}

/**
 * Generates cryptographically secure random bytes, throwing if Web Crypto CSPRNG is unavailable.
 */
export function requireSecureRandomBytes(
  length: number,
  errorMessage = 'Secure random number generation is unavailable.',
): Uint8Array {
  const cryptoObj =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (!cryptoObj?.getRandomValues) {
    throw new Error(errorMessage);
  }
  return cryptoObj.getRandomValues(new Uint8Array(length));
}
