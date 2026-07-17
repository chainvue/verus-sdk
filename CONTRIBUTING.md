# Contributing to `@chainvue/verus-sdk`

Thanks for helping. This SDK builds and signs **raw Verus transaction bytes,
100% offline** — no daemon, no network. Two things are load-bearing and most of
the rules below exist to protect them:

1. **Amounts are `bigint` satoshis end to end** — never a float.
2. **The bytes are the daemon's, not a reimpl** — serialization goes through
   VerusCoin's own primitives, and every built transaction is proven against a
   real daemon before we trust it.

Read [`docs/amounts.md`](./docs/amounts.md) and
[`docs/signing-and-wire.md`](./docs/signing-and-wire.md) first — they are the
two models the whole library is built around.

## Getting set up

- **Node ≥ 18** at runtime; the **test toolchain needs ≥ 20.19** (vitest 4), so
  develop on Node 20, 22, or 26 (the CI matrix).
- **pnpm** — the repo pins the version in `package.json`'s `packageManager`
  field (`corepack enable` picks it up automatically).

```bash
pnpm install
pnpm build
```

## The gate — run it before every push

CI runs exactly this, in order. Green locally means green in CI:

```bash
pnpm build       # tsc — type-driven compile to dist/
pnpm typecheck   # tsc --noEmit -p tsconfig.eslint.json
pnpm lint        # eslint .
pnpm test        # vitest run
```

Also relevant:

```bash
pnpm test:coverage   # enforces the coverage floors in vitest.config.ts (CI uses this)
pnpm bundle          # tsup — produces the published, self-contained dist/bundle.js
```

### The plain-`node` rule (do not skip this)

**Prove consumer-facing changes under plain `node`, not only under vitest.**
Vitest's module resolver has masked real consumer-breaking bugs before (a
primitives "split-brain" where two copies of a fork loaded at once, 2026-07-13).
A green vitest run is necessary but not sufficient. The runnable
[`examples/`](./examples) load the built bundle under plain `node` for exactly
this reason — after `pnpm build && pnpm bundle`, run one:

```bash
node examples/transfer.cjs
```

## The money invariant (non-negotiable)

- **No `number` for any amount.** Satoshi amounts are `bigint`, full stop. No
  `Math.round(coins * 1e8)`, no `parseFloat` on a value path.
- **One checked crossing into float64.** `@bitgo/utxo-lib` still models values
  as float64; `toSafeNumber(sats)` (`src/utils/index.ts`) is the **only** place a
  `bigint` becomes a `number`, and it throws outside `[0, 2^53]`. Do not
  reintroduce the crossing anywhere else.
- **Convert at the edges** with `parseSats` / `toCoins` (exact decimal-string ↔
  `bigint`). See [`docs/amounts.md`](./docs/amounts.md).

## The wire-bytes rule

- **Bytes are proven, not assumed.** New or changed serialization needs
  evidence it round-trips through a real daemon — a golden vector, or a
  `decoderawtransaction` / broadcast proof from the live-proof harness. See
  [`docs/signing-and-wire.md`](./docs/signing-and-wire.md) and
  [`docs/testing.md`](./docs/testing.md) for the ring model
  (`SDK_PUBLIC_DECODE=1`, `SDK_ALLOW_SPEND=1`).
- **`decodeUtxo` fails closed.** A smart-output (CryptoCondition) script that
  fails to unpack throws `TransactionBuildError` — it is **never** silently
  reclassified as native-only. Only genuinely non-smart scripts get the native
  fallback.
- **Typed errors at boundaries.** Throw a `VerusError` subclass
  (`src/errors.ts`) — never a raw `Error` or a bare bs58check throw.
- **Type the fork honestly.** The `@bitgo/utxo-lib` shape lives in
  `src/types/bitgo-utxo-lib.d.ts`. Any residual `any` at that boundary must be
  justified inline (`eslint-disable … -- <reason>`).
- **Keep `NOTICE` accurate.** It credits the bundled VerusCoin forks; update it
  if the bundle changes.

## Never commit key material

Generate throwaway keys in tests (`VerusSDK.generateWif()`) — **never** commit a
real WIF, spending key, or any key controlling funds. `.env` is gitignored
(`.env.example` documents the harness variables). A test that needs a funded key
reads it from the environment at run time; it is never checked in.

## Commits and releases

Releases are **fully automated** by [semantic-release](https://semantic-release.gitbook.io/).
Your **PR title** (and the squashed commit) must be a
[Conventional Commit](https://www.conventionalcommits.org/):

| Prefix | Effect (this is a `0.x` project) |
|---|---|
| `feat:` | minor bump |
| `fix:` / `perf:` | patch bump |
| `feat!:` or a `BREAKING CHANGE:` footer | still a **minor** on `0.x` (the breaking channel) |
| `docs:` `test:` `refactor:` `chore:` `ci:` `build:` | no release |

**Do not** edit `version` in `package.json` or touch `CHANGELOG.md` by hand —
the release workflow owns both. Don't `git push` tags or publish manually. On
publish, `release.yml` runs a plain-`node` smoke consumer probe against the
freshly published tarball; keep that path working.

## Pull request flow

1. Branch off `main` (short, prefixed: `feat/…`, `fix/…`, `docs/…`).
2. Make the **smallest reviewable change** — don't mix a refactor with a
   feature, and don't touch unrelated files.
3. Run the gate **and** a plain-`node` consumer check. Update the README/docs
   when you change user-facing behavior.
4. Open the PR — the [PR template](./.github/PULL_REQUEST_TEMPLATE.md) is a
   checklist that mirrors the rules above. Fill it in honestly; CI must be green.

## Reporting issues

Use the issue templates (bug report, feature request). For a **security
vulnerability** — anything touching key material, wrong wire bytes, or amount
precision — do **not** open a public issue; follow [`SECURITY.md`](./SECURITY.md).

## License

By contributing you agree your work is licensed under **Apache-2.0** (see
[`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE)).
