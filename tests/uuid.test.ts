import { describe, it, expect } from 'vitest';
import { generateUUID, uuidv4 } from '../src/utils/uuid.js';

describe('UUID Utilities (RFC4122 v4)', () => {
  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('generates valid RFC4122 v4 UUID strings', () => {
    const id = generateUUID();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it('provides uuidv4 alias identical to generateUUID', () => {
    const id = uuidv4();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it('generates unique identifiers across 1,000 iterations without collisions', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = generateUUID();
      expect(set.has(id)).toBe(false);
      set.add(id);
    }
    expect(set.size).toBe(1000);
  });

  it('falls back gracefully when crypto.randomUUID throws', () => {
    const originalDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          randomUUID: () => {
            throw new Error('Native randomUUID failed');
          },
          getRandomValues: (buf: Uint8Array) => {
            for (let i = 0; i < buf.length; i++) buf[i] = i * 16;
            return buf;
          },
        },
        configurable: true,
        writable: true,
      });

      const id = generateUUID();
      expect(id).toMatch(UUID_V4_REGEX);
    } finally {
      if (originalDesc) {
        Object.defineProperty(globalThis, 'crypto', originalDesc);
      }
    }
  });

  it('falls back to Math.random when crypto is completely undefined (e.g. legacy Hermes/react-native)', () => {
    const originalDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const id = generateUUID();
      expect(id).toMatch(UUID_V4_REGEX);
    } finally {
      if (originalDesc) {
        Object.defineProperty(globalThis, 'crypto', originalDesc);
      }
    }
  });
});
