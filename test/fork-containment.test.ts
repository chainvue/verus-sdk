import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

// Fork containment is a load-bearing claim in docs/architecture.md: only
// src/fork/ may touch the raw forks, so the number-money crossing and the
// untyped-throw surface live in exactly one auditable place.
//
// ESLint enforces it, but only for the import forms its rules model — a
// `require('@bitgo/utxo-lib')` in src/utils/index.ts slipped past
// no-restricted-imports because that rule matches ES ImportDeclaration nodes
// only, and the line's other rule was disabled inline. This test re-asserts the
// invariant textually, so it cannot be silenced by an eslint-disable comment or
// a lint-config regression.
const FORKS = ['@bitgo/utxo-lib', 'verus-typescript-primitives'];
// vitest runs with the repo root as cwd.
const SRC = resolve(process.cwd(), 'src');
const BOUNDARY_DIR = join(SRC, 'fork');

/**
 * Match the specifier only where it is actually imported — `from '<fork>'`
 * (static import / export-from / type-only import), `require('<fork>')`, and
 * dynamic `import('<fork>')`. Prose mentions of the fork in doc comments are
 * legitimate and must not trip this.
 */
function importFormOf(fork: string): RegExp {
  const escaped = fork.replace(/[/\\^$*+?.()|[\]{}]/g, String.raw`\$&`);
  return new RegExp(
    String.raw`(?:\bfrom|\brequire\s*\(|\bimport\s*\(|\bimport)\s*['"]${escaped}['"]`,
  );
}

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectTsFiles(full);
    // src/fork/ IS the boundary; ambient .d.ts files declare the fork's own
    // types and must reference them.
    if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) return [];
    if (full.startsWith(BOUNDARY_DIR)) return [];
    return [full];
  });
}

describe('fork containment', () => {
  const files = collectTsFiles(SRC);

  it('finds source files to check (guards against a broken walker)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('detects a raw fork import when one is present (guards against a dead regex)', () => {
    // The boundary itself is the positive control: it MUST match, or the matcher
    // has stopped detecting anything and every assertion below is vacuous.
    const boundary = readFileSync(join(BOUNDARY_DIR, 'boundary.ts'), 'utf8');
    for (const fork of FORKS) {
      expect(importFormOf(fork).test(boundary)).toBe(true);
    }
  });

  for (const fork of FORKS) {
    it(`no module outside src/fork/ imports ${fork} in any form`, () => {
      const matcher = importFormOf(fork);
      const offenders = files.filter((file) => matcher.test(readFileSync(file, 'utf8')));
      expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
    });
  }
});
