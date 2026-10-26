import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { generateUUID } from '../utils/uuid.js';
import { timingSafeEqual } from './generator.js';
import {
  CreateSignedTokenOptions,
  RenewSignedTokenOptions,
  VerifySignedTokenResult,
} from './types.js';

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const B64URL_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64URL_ALPHABET.length; i++) {
  B64URL_LOOKUP[B64URL_ALPHABET.charCodeAt(i)] = i;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i];
    const second = bytes[i + 1];
    const third = bytes[i + 2];
    result += B64URL_ALPHABET[first >> 2];
    result += B64URL_ALPHABET[((first & 3) << 4) | (second === undefined ? 0 : second >> 4)];
    if (second !== undefined) {
      result += B64URL_ALPHABET[((second & 15) << 2) | (third === undefined ? 0 : third >> 6)];
    }
    if (third !== undefined) {
      result += B64URL_ALPHABET[third & 63];
    }
  }
  return result;
}

export function base64UrlDecode(str: string): Uint8Array {
  // Normalize base64url padding
  let clean = str.replace(/[^A-Za-z0-9\-_]/g, '');
  const remainder = clean.length % 4;
  if (remainder === 2) clean += '==';
  else if (remainder === 3) clean += '=';

  const len = clean.length;
  let byteLen = (len * 3) / 4;
  if (clean.endsWith('==')) byteLen -= 2;
  else if (clean.endsWith('=')) byteLen -= 1;

  const bytes = new Uint8Array(byteLen);
  let byteIndex = 0;

  for (let i = 0; i < len; i += 4) {
    const c0 = B64URL_LOOKUP[clean.charCodeAt(i)];
    const c1 = B64URL_LOOKUP[clean.charCodeAt(i + 1)];
    const c2 = clean[i + 2] === '=' ? 0 : B64URL_LOOKUP[clean.charCodeAt(i + 2)];
    const c3 = clean[i + 3] === '=' ? 0 : B64URL_LOOKUP[clean.charCodeAt(i + 3)];

    bytes[byteIndex++] = (c0 << 2) | (c1 >> 4);
    if (clean[i + 2] !== '=' && byteIndex < byteLen) {
      bytes[byteIndex++] = ((c1 & 15) << 4) | (c2 >> 2);
    }
    if (clean[i + 3] !== '=' && byteIndex < byteLen) {
      bytes[byteIndex++] = ((c2 & 3) << 6) | c3;
    }
  }

  return bytes;
}

function computeHmacSignature(content: string, secret: string): string {
  const sigBytes = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(content));
  return base64UrlEncode(sigBytes);
}

/**
 * Creates a signed, tamper-evident token with optional expiration and token ID.
 * Format: [base64urlHeader].[base64urlPayload].[signature]
 */
export function createSignedToken<T = Record<string, any>>(
  options: CreateSignedTokenOptions<T>
): string {
  if (!options.secret) {
    throw new Error('Signing secret is required to create a signed token.');
  }

  const now = Date.now();
  const expiresAt =
    options.expiresAt !== undefined
      ? options.expiresAt
      : options.expiresInMs !== undefined
        ? now + options.expiresInMs
        : null;

  const header = {
    alg: 'HS256',
    typ: 'LLT',
  };

  const payload = {
    data: options.payload,
    iat: now,
    exp: expiresAt,
    jti: options.tokenId || generateUUID(),
  };

  const headerB64 = base64UrlEncode(utf8ToBytes(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(utf8ToBytes(JSON.stringify(payload)));
  const content = `${headerB64}.${payloadB64}`;
  const signature = computeHmacSignature(content, options.secret);

  return `${content}.${signature}`;
}

/**
 * Verifies a signed token's cryptographic HMAC signature and expiration timestamp.
 */
export function verifySignedToken<T = Record<string, any>>(
  token: string,
  secret: string,
  options: { clockSkewSeconds?: number } = {}
): VerifySignedTokenResult<T> {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token is missing or empty' };
  }
  if (!secret) {
    return { valid: false, error: 'Verification secret is required' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token structure: expected 3 parts' };
  }

  const [headerB64, payloadB64, signature] = parts;
  const content = `${headerB64}.${payloadB64}`;

  // 1. Verify HMAC Signature
  const expectedSignature = computeHmacSignature(content, secret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return { valid: false, error: 'Invalid token signature' };
  }

  // 2. Decode Payload
  let parsedPayload: any;
  try {
    const jsonStr = new TextDecoder().decode(base64UrlDecode(payloadB64));
    parsedPayload = JSON.parse(jsonStr);
  } catch (err: any) {
    return { valid: false, error: `Failed to decode token payload: ${err?.message || err}` };
  }

  // 3. Verify Expiration
  const clockSkewMs = (options.clockSkewSeconds ?? 60) * 1000;
  const now = Date.now();
  const exp = parsedPayload.exp;

  if (exp != null && typeof exp === 'number') {
    if (now > exp + clockSkewMs) {
      return {
        valid: false,
        expired: true,
        expiresAt: exp,
        tokenId: parsedPayload.jti,
        payload: parsedPayload.data as T,
        error: `Token expired at ${new Date(exp).toISOString()}`,
      };
    }
  }

  return {
    valid: true,
    expired: false,
    payload: parsedPayload.data as T,
    expiresAt: exp ?? null,
    tokenId: parsedPayload.jti,
  };
}

/**
 * Renews an existing valid signed token by extending its expiration time with a fresh signature.
 */
export function renewSignedToken<T = Record<string, any>>(
  token: string,
  secret: string,
  options: RenewSignedTokenOptions = {}
): string {
  const verification = verifySignedToken<T>(token, secret);
  if (!verification.valid && !verification.expired) {
    throw new Error(`Cannot renew token: ${verification.error}`);
  }

  const extendMs = options.extendMs ?? 7 * 24 * 60 * 60 * 1000; // default 7 days
  const newSecret = options.secret || secret;

  return createSignedToken<T>({
    payload: verification.payload as T,
    secret: newSecret,
    expiresAt: options.newExpiresAt,
    expiresInMs: options.newExpiresAt ? undefined : extendMs,
    tokenId: verification.tokenId,
  });
}
