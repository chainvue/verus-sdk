import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      // Product source only. Exclude type-only files (ambient shims, the types
      // barrel) and the root re-export barrel — nothing to execute there.
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts', 'src/index.ts', 'src/types/**'],
      reporter: ['text-summary', 'html', 'lcov'],
      // Floors set a few points below the 2026-07-14 measured coverage
      // (stmts 91.7 / branch 78.4 / funcs 84.5 / lines 91.7) so the gate is
      // stable but still catches a real regression. Ratchet upward over time.
      thresholds: {
        statements: 86,
        branches: 73,
        functions: 80,
        lines: 86,
      },
    },
  },
});
