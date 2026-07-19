// ESLint flat config — same conventions as peculium-wallet/v402.
//
// src/ and test/ get TYPE-CHECKED linting (projectService resolves
// tsconfig.eslint.json, which includes test/); root config files get the
// syntactic recommended set only. This is a signing SDK: no-floating-promises
// and no-explicit-any are errors — every `any` at the fork boundary must be
// justified inline with an eslint-disable comment.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // fork-shims.d.ts is a hand-written ambient declaration shipped to
    // consumers; it is intentionally excluded from the typed project (it would
    // collide with the real bitgo-utxo-lib.d.ts), so typed linting can't parse it.
    ignores: ["dist/", "node_modules/", "coverage/", "src/fork-shims.d.ts"],
  },
  {
    files: ["**/*.ts", "**/*.js", "**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: { globals: globals.node },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.ts", "test/**/*.ts"],
  })),
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "no-console": "error",
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Fork containment: only src/fork/ may import the raw forks. Everywhere else
    // in src/ must go through src/fork/boundary.ts. A new direct import here is a
    // lint failure, not a hazard that spreads. (Tests may import the fork freely.)
    files: ["src/**/*.ts"],
    // src/fork/ IS the boundary; ambient .d.ts files declare the fork's own types
    // and must reference them.
    ignores: ["src/fork/**", "**/*.d.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@bitgo/utxo-lib", message: "Import the fork only via src/fork/boundary.ts." },
            { name: "verus-typescript-primitives", message: "Import the fork only via src/fork/boundary.ts." },
          ],
        },
      ],
      // no-restricted-imports only matches ES import/export-from declarations —
      // a `require('@bitgo/utxo-lib')` or `import('@bitgo/utxo-lib')` slips
      // straight past it. These selectors close that hole so the containment
      // claim holds for EVERY import form, not just the static ES one.
      "no-restricted-syntax": [
        "error",
        ...["@bitgo/utxo-lib", "verus-typescript-primitives"].flatMap((name) => [
          {
            selector: `CallExpression[callee.name='require'] > Literal[value='${name}']`,
            message: `Import ${name} only via src/fork/boundary.ts (no require() of the raw fork).`,
          },
          {
            selector: `ImportExpression > Literal[value='${name}']`,
            message: `Import ${name} only via src/fork/boundary.ts (no dynamic import() of the raw fork).`,
          },
        ]),
      ],
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["*.config.ts"],
  })),
);
