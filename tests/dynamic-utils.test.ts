import { describe, it, expect } from 'vitest';
import { safeDynamicRequire, safeDynamicImport } from '../src/utils/dynamic.js';

describe('Dynamic Utilities', () => {
  describe('safeDynamicRequire', () => {
    it('returns undefined for non-existent modules without crashing', () => {
      const result = safeDynamicRequire('non_existent_module_xyz_123');
      expect(result).toBeUndefined();
    });

    it('returns undefined when Metro bundler environment (__r) is active', () => {
      (globalThis as any).__r = () => {};
      try {
        const result = safeDynamicRequire('some-pkg');
        expect(result).toBeUndefined();
      } finally {
        delete (globalThis as any).__r;
      }
    });
  });

  describe('safeDynamicImport', () => {
    it('returns undefined gracefully for non-existent packages', async () => {
      const result = await safeDynamicImport('non_existent_package_foo_bar_999');
      expect(result).toBeUndefined();
    });

    it('returns undefined when Metro runtime (__r) is active', async () => {
      (globalThis as any).__r = () => {};
      try {
        const result = await safeDynamicImport('some-pkg');
        expect(result).toBeUndefined();
      } finally {
        delete (globalThis as any).__r;
      }
    });
  });
});

