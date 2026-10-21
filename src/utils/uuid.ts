import { v4 as uuidv4 } from 'uuid';

// Detect once at module load — avoids 3 typeof checks per UUID call
const nativeRandomUUID: (() => string) | null =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as any).crypto?.randomUUID === 'function'
    ? () => (globalThis as any).crypto.randomUUID()
    : null;

/**
 * Generates an RFC4122 v4 compliant UUID.
 * Uses native crypto.randomUUID() when available (detected once at import), with uuid.v4 fallback.
 */
export function generateUUID(): string {
  return nativeRandomUUID ? nativeRandomUUID() : uuidv4();
}

export { uuidv4 };
