# CLAUDE.md — @chainvue/verus-sdk

100% offline TypeScript SDK for signing raw Verus transactions (transfers,
currency ops, VerusID lifecycle). No network, no daemon — it builds and signs
bytes; consumers broadcast. peculium-wallet is the primary consumer.

## Money — the load-bearing invariant
- **All satoshi amounts are `bigint`, end to end.** Never reintroduce `number`
  for money. `toSafeNumber(sats)` in `src/utils/index.ts` is the ONLY checked
  crossing into `@bitgo/utxo-lib` (which still models values as float64); it
  throws outside `[0, 2^53]`.
- Convert human amounts with `parseSats` / `toCoins` (exact decimal-string ↔
  bigint). No `Math.round(coins * 1e8)`.
- `decodeUtxo` must never silently reclassify a failed smart-output decode as
  native-only — a smart (CryptoCondition) script that fails to unpack throws
  `TransactionBuildError`. Only genuinely non-smart scripts get the native
  fallback.

## Conventions
- License **Apache-2.0**; `NOTICE` credits the bundled VerusCoin forks. Keep it
  accurate if the bundle changes.
- Errors at boundaries are typed `VerusError` subclasses (`src/errors.ts`) —
  never raw `Error` or a bare bs58check throw.
- The `@bitgo/utxo-lib` shape lives in `src/types/bitgo-utxo-lib.d.ts`. Type the
  fork honestly; justify any residual `any` with an inline `eslint-disable … --
  <reason>`.

## Gate (run before claiming done, in order)
`pnpm build` (tsc) → `pnpm typecheck` → `pnpm lint` → `pnpm test` (vitest).
`pnpm bundle` (tsup) produces the published `dist/bundle.js`.
**Consumer proofs must run under plain `node`, not only vitest** — vitest's
resolver has masked real consumer-breaking bugs (primitives split-brain,
2026-07-13). See `RISKS.md`.

## Releases — automated, do not hand-roll
Conventional Commits drive **semantic-release**: `feat:` → minor, `fix:` →
patch, `feat!:`/`BREAKING CHANGE:` → major. **Never hand-edit `CHANGELOG.md`
or bump `version` in `package.json`** — the release pipeline owns both. Do not
`git push`, tag, or publish without an explicit ask.

## Decision log
`RISKS.md` is the running decision/risk log (maintainer-facing "why").
`CHANGELOG.md` is adopter-facing "what changed". Keep them distinct.
