<!--
Title MUST be a Conventional Commit — it drives semantic-release + the changelog.
  feat: …  (minor)   fix: …  (patch)   perf: …  (patch)
  feat!: … or a `BREAKING CHANGE:` footer  (major)
  docs|test|refactor|chore|ci|build: …  (no release)
Do NOT bump `version` or edit `CHANGELOG.md` by hand — the release pipeline owns both.
-->

## What & why

<!-- One or two sentences: what this changes and the motivation. -->

## Money & correctness (load-bearing)

- [ ] All satoshi amounts stay `bigint` end to end. No `number` for money, no `Math.round(coins * 1e8)`. Human amounts convert via `parseSats` / `toCoins`.
- [ ] The only checked crossing into float64 is `toSafeNumber(sats)` (`src/utils/index.ts`) — not reintroduced anywhere else.
- [ ] `decodeUtxo` never silently reclassifies a failed smart-output decode as native-only (a failed CryptoCondition unpack throws `TransactionBuildError`).
- [ ] Boundary errors are typed `VerusError` subclasses (`src/errors.ts`) — no raw `Error` / bare bs58check throw.
- [ ] This SDK stays 100% offline (no network / daemon calls); it builds and signs bytes only.

## Signing-path changes

<!-- Delete if N/A. -->
- [ ] Wire bytes are proven, not assumed — new/changed serialization has a golden vector or daemon-decode evidence (see the liveproof harness / `RISKS.md`).
- [ ] Residual `any` at the `@bitgo/utxo-lib` boundary is justified inline (`eslint-disable … -- <reason>`); the fork shape in `src/types/bitgo-utxo-lib.d.ts` stays honest.
- [ ] `NOTICE` still accurately credits the bundled VerusCoin forks (update if the bundle changed).

## Checklist

- [ ] Gate green in order: `pnpm build` (tsc) → `pnpm typecheck` → `pnpm lint` → `pnpm test`.
- [ ] `pnpm bundle` (tsup) still produces a working `dist/bundle.js`; self-contained `.d.ts` (no `skipLibCheck` required by consumers).
- [ ] **Consumer proof under plain `node`**, not only vitest — vitest's resolver has masked real consumer-breaking bugs before (primitives split-brain).
- [ ] Conventional-Commit PR title; no manual `version`/`CHANGELOG.md` edits.

## Notes for reviewers

<!-- Risks, follow-ups, live/funded-key-gated paths, deliberate scope limits. -->
