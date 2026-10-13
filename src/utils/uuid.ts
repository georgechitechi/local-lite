import { v4 as uuidv4 } from 'uuid';

/**
 * Generates an RFC4122 v4 compliant UUID.
 * Uses native crypto.randomUUID() when supported, with uuid.v4 fallback.
 */
export function generateUUID(): string {
  try {
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.crypto &&
      typeof globalThis.crypto.randomUUID === 'function'
    ) {
      return globalThis.crypto.randomUUID();
    }
    return uuidv4();
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

export { uuidv4 };
