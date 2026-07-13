/**
 * Publish bundle — RISKS.md "supply chain" option C.
 *
 * The three github:-pinned VerusCoin forks (utxo-lib-verus,
 * verus-typescript-primitives, bitcoin-ops + its patched evals.json) cannot
 * survive a consumer install: github: pins plus the pnpm patch +
 * .pnpmfile.cjs hook are workspace-local. This config INLINES the forks
 * (and their transitive fork deps, e.g. blake2b) into one CJS artifact at
 * publish time. Regular npm dependencies — bn.js, bs58check, create-hash,
 * ecpair, tiny-secp256k1 (wasm), wif — stay external and install normally.
 *
 * Layout: `build` (tsc) emits dist/ for development and type declarations;
 * `bundle` (this file) emits dist/bundle.cjs, which package.json `main`
 * points at. Types keep coming from tsc's dist/index.d.ts — note the
 * submodule declarations reference fork types, so consumers currently need
 * `skipLibCheck` (RISKS.md, publish checklist).
 */

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { bundle: 'src/index.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node18',
  outDir: 'dist',
  // No declaration bundling: d.ts of packages with ambient module
  // declarations do not roll up cleanly; tsc's output stays authoritative.
  dts: false,
  sourcemap: false,
  clean: false,
  // Force the fork graph INTO the bundle; esbuild then follows and inlines
  // their transitive (also github-pinned) deps automatically. Everything in
  // "dependencies" not listed here stays external by default.
  noExternal: ['@bitgo/utxo-lib', 'verus-typescript-primitives', 'bitcoin-ops'],
});
