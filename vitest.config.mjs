import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    isolate: false,
    silent: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 74,
        branches: 60,
        functions: 75,
        lines: 75,
      },
    },
  },
});
