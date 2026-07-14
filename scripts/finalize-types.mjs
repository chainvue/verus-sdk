#!/usr/bin/env node
// Post-build: make the published .d.ts self-contained.
//
// tsc emits declarations that `import` from the bundled VerusCoin forks
// (@bitgo/utxo-lib, verus-typescript-primitives). Those forks are inlined into
// dist/bundle.js and are not installable, so a consumer's `tsc` would report
// "Cannot find module" without `skipLibCheck`. We ship a minimal ambient shim
// (src/fork-shims.d.ts) alongside the declarations and reference it from the
// types entry so those imports resolve. Idempotent.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shimSrc = resolve(root, "src/fork-shims.d.ts");
const shimDist = resolve(root, "dist/fork-shims.d.ts");
const typesEntry = resolve(root, "dist/index.d.ts");
const reference = '/// <reference path="./fork-shims.d.ts" />';

copyFileSync(shimSrc, shimDist);

const contents = readFileSync(typesEntry, "utf8");
if (!contents.includes(reference)) {
  writeFileSync(typesEntry, `${reference}\n${contents}`);
}

console.log("finalize-types: shipped fork-shims.d.ts + referenced it from dist/index.d.ts");
