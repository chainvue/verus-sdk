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
    ignores: ["dist/", "node_modules/", "coverage/"],
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
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["*.config.ts"],
  })),
);
