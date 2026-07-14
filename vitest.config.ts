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
      // (vitest 4, AST-aware v8: stmts 87.5 / branch 73.8 / funcs 86.8 /
      // lines 88.0) so the gate is stable but still catches a real
      // regression. Ratchet upward over time.
      thresholds: {
        statements: 83,
        branches: 69,
        functions: 82,
        lines: 83,
      },
    },
  },
});
