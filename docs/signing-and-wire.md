# Signing & wire format

The reason to trust an offline signer is that the bytes it produces are the
bytes the daemon would produce. This SDK gets there two ways: it serializes
with VerusCoin's **own** primitives rather than a reimplementation, and it
**proves** the output round-trips through a real daemon.

## The bytes are the daemon's

Transaction and identity serialization runs through the VerusCoin forks —
`@bitgo/utxo-lib`, `verus-typescript-primitives`, `bitcoin-ops` — the same code
paths `verusd` and the Verus wallets use. There is no hand-rolled wire encoder
to drift out of sync with a consensus change. Those forks are **bundled** into
the published package (see below), so you get the daemon's format without
adding `github:` dependencies or install-time patches to your own tree.

## Self-contained bundle

The published package is a single self-contained bundle (`dist/bundle.js`) with
self-contained TypeScript declarations:

- The VerusCoin forks are **inlined** — no `github:` deps, no `postinstall`
  patches, nothing for your package manager to resolve or fail on. Ordinary npm
  dependencies still install normally.
- The type surface for the bundled forks ships with the package, so consumers
  need **no** `skipLibCheck` and have no fork packages to install.

[`NOTICE`](../NOTICE) credits the bundled forks; it is kept accurate whenever
the bundle changes.

## The float64 boundary

`@bitgo/utxo-lib` models output values as float64 internally. The SDK keeps
every amount a `bigint` and crosses that boundary in exactly one audited place —
`toSafeNumber(sats)`, which throws outside `[0, 2^53)`. See
[amounts](./amounts.md).

## Smart outputs fail closed

Verus outputs can carry CryptoCondition (smart) scripts. When `decodeUtxo`
meets a smart-output script it cannot unpack, it throws `TransactionBuildError`
— it does **not** silently treat it as a plain native output. Reclassifying a
failed smart decode as native-only would risk spending an output under the wrong
assumptions, so that path fails closed by design.

## Proven, not assumed

New or changed serialization is not trusted until it round-trips through a real
daemon. The live-proof harness does this in rings of increasing cost, each
opt-in via an environment flag (see [testing](./testing.md)):

- **Ring 1 — offline golden vectors.** Built bytes match a recorded expected
  hex. Runs everywhere, no network.
- **Ring 2 — public decode** (`SDK_PUBLIC_DECODE=1`). The built hex is sent to a
  public testnet daemon's `decoderawtransaction`; the decoded form must match
  intent. No funds, no broadcast.
- **Ring 3 — funded broadcast** (`VERUS_RPC_URL` + `SDK_ALLOW_SPEND=1`). A real
  transaction is broadcast on VRSCTEST and accepted. Gated behind a funded key;
  spends testnet dust.

The maintainer-facing record of which paths are proven at which ring, and the
residual risks, is kept privately outside the repo (`RISKS.md`, gitignored);
the adopter-facing "what changed" is [`CHANGELOG.md`](../CHANGELOG.md).

## Inspecting what you signed

`utils.summarizeSignedTransaction(hex, network)` decodes a signed transaction
offline — txid, spent outpoints, addressed outputs — so you can verify a build
before broadcasting or record it in your own ledger:

```ts
import { utils } from "@chainvue/verus-sdk";
const { txid, inputs, outputs } = utils.summarizeSignedTransaction(signedTx, "testnet");
```
