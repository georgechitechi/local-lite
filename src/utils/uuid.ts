/**
 * Generates an RFC4122 version 4 compliant UUID.
 * Works natively across Web, React Native (Hermes), Node.js, and Expo without bare global lookups.
 */
export function generateUUID(): string {
  const gCrypto =
    typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (typeof gCrypto?.randomUUID === 'function') {
    try {
      return gCrypto.randomUUID();
    } catch {
      // Fallback to byte-based generation
    }
  }

  const bytes = new Uint8Array(16);
  if (typeof gCrypto?.getRandomValues === 'function') {
    try {
      gCrypto.getRandomValues(bytes);
    } catch {
      for (let i = 0; i < 16; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC4122 §4.4: Set version to 0100 (v4) and variant to 10xx (RFC4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  let hex = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) {
      hex += '-';
    }
    const b = bytes[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }

  return hex;
}

export const uuidv4 = generateUUID;
