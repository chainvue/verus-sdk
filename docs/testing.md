# Testing

The suite is offline by default: unit tests, golden wire vectors, and money
boundary checks all run with no daemon and no funds. Anything that touches a
real node is gated behind an environment flag and skips silently when it's
unset — so `pnpm test` is green on a laptop and in CI with nothing configured.

## The gate

Run in this order (CI runs the same, on Node 20 / 22 / 26):

```bash
pnpm build       # tsc
pnpm typecheck   # tsc --noEmit -p tsconfig.eslint.json
pnpm lint        # eslint .
pnpm test        # vitest run
```

Coverage floors live in `vitest.config.ts` and are enforced by:

```bash
pnpm test:coverage   # what CI runs
```

## Prove it under plain `node`, too

A green vitest run is necessary but **not sufficient** for consumer-facing
changes. Vitest's resolver has masked real consumer-breaking bugs (a primitives
"split-brain" where two copies of a fork loaded at once, 2026-07-13). Always
also exercise the change under plain `node` against the built bundle:

```bash
pnpm build && pnpm bundle
node examples/transfer.cjs        # or any example in examples/
```

The release workflow enforces the same idea from the other end: after publish,
it installs the tarball into a fresh project and runs a keygen → offline
transfer → summarize probe under plain `node`.

## The live-proof rings

Wire correctness is proven against a real daemon in rings of increasing cost,
each opt-in. Copy `.env.example` to `.env` (gitignored) and set what a ring
needs:

| Ring | Flag(s) | What it does | Cost |
|---|---|---|---|
| 1 | *(none)* | Offline golden vectors — built hex matches recorded expected bytes | free, always on |
| 2 | `SDK_PUBLIC_DECODE=1` | Built hex → a public testnet daemon's `decoderawtransaction`; decoded form must match intent | network, no funds |
| 3 | `VERUS_RPC_URL` + `VERUS_RPC_USER`/`PASS` + `SDK_ALLOW_SPEND=1` | Broadcasts a real tx on VRSCTEST and asserts acceptance | funded key, spends dust |

```bash
# Ring 2 — decode against a public node, no funds:
SDK_PUBLIC_DECODE=1 pnpm test

# Ring 3 — funded broadcast on your own testnet node:
VERUS_RPC_URL=http://127.0.0.1:18843 VERUS_RPC_USER=… VERUS_RPC_PASS=… \
  SDK_ALLOW_SPEND=1 pnpm test
```

Rings 2 and 3 `describe.skipIf(...)` themselves off when their flags are absent,
so they never run in CI. **Never commit a real funded key** — the harness reads
it from the environment at run time.

## Writing tests

- Use `VerusSDK.generateWif()` and synthetic UTXOs — offline, no funds, no
  secrets to redact.
- New or changed serialization needs a ring-1 golden vector at minimum; a
  consensus-relevant change should be proven at ring 2 or 3 before you trust it.
- Assert on `bigint` amounts directly; never round through a `number` to compare.
