# Architecture

Why the SDK is shaped the way it is. The short version: whole **classes** of bug
are made structurally impossible rather than patched one transaction path at a
time. The ~30 bugs fixed while hardening this client clustered into four classes
with two deep roots — a stringly-typed domain and a wide, untyped, `number`-money
fork boundary. The layout below closes the classes at compile time and at a
single runtime chokepoint.

## Layers

```
src/
  core/      brands.ts — branded address types + parse-don't-validate constructors
  fork/      boundary.ts — THE ONLY module that imports the bundled forks
  assemble/  assembler.ts (value-output txs) + fundedIdentityUpdate.ts (identity respends)
  identity/ transfer/ currency/ signing/ utxo/ keys/ message/  — flows + helpers
  VerusSDK.ts — the facade: string params in, parsed at the edge
  index.ts — the curated public surface
```

The dependency arrows point one way: flows build on the assemblers, the
assemblers build on the fork boundary, and nothing reaches around a layer. ESLint
`no-restricted-imports` enforces the important edge (below).

## The fork boundary

Verus smart transactions — CryptoConditions, identities, reserve outputs — can
only be spoken by the VerusCoin forks (`@bitgo/utxo-lib`,
`verus-typescript-primitives`, `bitcoin-ops`). They are the reason the bytes are
the daemon's (see [signing & wire format](./signing-and-wire.md)), but they are a
**hazardous** surface:

- money is modeled as `number` (a float64 — lossy above ~90M coins);
- addresses are version-blind: `KeyID.fromAddress` / `IdentityID.fromAddress` /
  `fromBase58Check` discard the version byte, laundering an R-address into an
  i-address (or the reverse) silently;
- errors are untyped throws;
- the base is a ~2018-era bitcoinjs API, and its absurd-fee guard truncates input
  value `mod 2^32`, so it is blind for inputs over ~42.94 coins.

The fork is a git-pinned VerusCoin fork on that old base — **not replaceable**
(nothing else speaks Verus CC/identity/reserve), so the fix is **containment**.

**`src/fork/boundary.ts` is the only module allowed to import the forks.** An
ESLint `no-restricted-imports` rule fails the build on any raw fork import
outside `src/fork/`. Every other module builds on the controlled re-export. This
means the number-money crossing (`toSafeNumber`, bigint → float64) and the
untyped-throw surface live in exactly one place instead of six, and a dependency
bump has one blast radius to audit.

`verus-typescript-primitives` is the source of truth for the shared CC types
(`OptCCParams`, `TxDestination`, …); `@bitgo/utxo-lib` re-declares some of them,
so only its own transaction/crypto surface is re-exported explicitly to avoid the
ambiguity.

## Branded addresses (class 1: version laundering)

`src/core/brands.ts` defines `RAddress`, `IAddress`, and `P2shAddress` as
structural subtypes of `string` with parse-don't-validate constructors
(`parseRAddress` / `parseIAddress` / `parseAddress`). A raw `string` cannot flow
into a function that expects an `IAddress` — the compiler rejects it — so the
15-plus hand-written `assertAddressVersion` guards that used to stand in for a
version check (and that we kept finding forgotten) become **unnecessary**: a
forgotten version check is now a type error, not a latent burn.

The brands are subtypes of `string`, so they flow into the fork with zero casts.
The facade (`VerusSDK`) still takes plain `string`s and parses them at the edge,
so the **public API is unchanged** by this.

## The assemblers (classes 2 + 3: conservation + duplication)

Seven transaction-building paths each used to hand-roll input adding, output
counting, `extraOutputBytes`, change emission, and value-conservation asserts. A
fix to one drifted from the others — many bugs were literally the same bug copied
N times — and a CRITICAL token burn shipped because two paths forgot the token
side of conservation. Conservation-by-convention doesn't scale.

Every value-moving path now funnels through one of two assemblers, which own
selection, change, and conservation as **postconditions of a single code path**.

### `assemble/assembler.ts` — value-output transactions

Used by: name commitment, VRSC identity registration, sub-ID registration,
`sendCurrency`. The caller declares its inputs and the outputs it wants — each
output's native value and any token value the script *carries* — and the
assembler derives the funding requirement from the outputs, selects UTXOs, emits
change in one place, and checks native + token conservation on the assembled tx.

Consequences that were bug classes:

- **A dropped-token or unbalanced tx is unrepresentable.** Token change is
  emitted by the assembler or the token-conservation check throws; the funding
  requirement is *derived* from the outputs, never restated by a caller.
- **An implicit fee burn is unrepresentable.** A registration that burns its fee
  as an implicit miner fee must *name* it: `fee: { policy: 'declared', burnSat,
  reason }`. The burn is funded, bounds the fork's fee-rate cap, and can't be an
  accident. The alternative is `fee: { policy: 'estimate' }`.

Knobs exist only to reproduce a flow's exact legacy bytes: `leadingInputs` (e.g.
the commitment UTXO spent as input 0), `feeOutputCount` (a legacy fee-estimate
output count), `requiredCurrencies` (when the fork builds the opaque output
scripts, as `sendCurrency` does, and their carried token value can't be read
back), and `changeStrategy` (`bundled` reserve-output change vs the currency
transfer's `separate` token + native outputs).

### `assemble/fundedIdentityUpdate.ts` — identity respends

Used by: identity update / revoke / recover / lock / unlock, and
`defineCurrency`. These respend the identity's own UTXO and **recreate** its
definition output, which the fork must re-sign *last* via
`completeFundedIdentityUpdate` — a different shape from the leading-input model,
so it is a focused second assembler, not a mode flag on the first. Both callers
were hand-rolling the identical select → build → change → complete →
dual-conservation → sign dance; it lives here once.

### Deliberately not an assembler

`buildAndSign` is a low-level primitive: explicit inputs and outputs, no
selection, no change, its own `fee === impliedFee` conservation. The selecting
assembler would add nothing, so it is left as-is.

## What is unrepresentable vs merely checked

| Invariant | Mechanism |
|---|---|
| R-address where an i-address is required (and vice versa) | **Unrepresentable** — brands (compile time) |
| Unbalanced / dropped-token / missing-change transaction | **Unrepresentable** — the assembler owns outputs + change |
| Implicit fee burn | **Unrepresentable** — must be a named `declared` fee |
| Money routed through float64 | **Contained** — one `toSafeNumber` crossing in the fork boundary |
| Raw fork import outside the boundary | **Prevented** — ESLint `no-restricted-imports` |
| WIF not a primary of the identity | **Checked** — `assertWifIsPrimary` (needs identity data) |
| `min_sigs > 1` identity (SDK can't multi-sign a CC input) | **Checked** — fail closed |
| Wrong output structure the daemon dictates | **Tested** — the differential harness (below) |
| Never-expiring tx / genesis-pinned signature | **Checked**, explicit opt-in |

"Checked" invariants need runtime data a type can't carry; they fail closed with
a typed error rather than emitting a tx the daemon rejects only at broadcast.

## Proving correctness: goldens + differential

Types and unit tests prove *self-consistency*; only the daemon proves
*correctness*. Two rings back that up:

- **Golden byte snapshots** (`test/golden.test.ts`) pin the exact signed hex of
  every building path with fixed inputs. Every assembler port in the refactor was
  required to keep these **byte-identical** — the snapshots are the proof that a
  structural refactor changed no emitted byte.
- **Differential shape tests** reduce a transaction to its *shape* — CC eval
  codes per output, distinct reserve-currency count, native-zero — via
  `test/support/canonicalize.ts`, and compare it against the daemon's own build
  of the same operation. Shape, not bytes, because the daemon picks its own
  UTXOs, change, and amounts.
  - **Tier-0 (hermetic):** `test/differential.test.ts` compares against shapes
    recorded once from the daemon (`test/fixtures/daemon-shapes.json`). This is
    the check that would have auto-caught the two worst bugs of the hardening
    campaign (sub-ID fee as reserve-transfer instead of reserve-output; the token
    burn). Runs in CI, no daemon needed.
  - **Tier-1 (live):** a maintainer records fresh daemon shapes against a running
    VRSCTEST node — read-only, via each RPC's `returntx` flag, which builds the
    transaction and returns its hex **without** broadcasting, spending, or
    signing. See `scripts/live-differential.mjs` for the runner and the recipe.
    This is where a *wrong intent* no type can catch surfaces.

The SDK is offline and ships no RPC transport, so Tier-1 is a deliberate
maintainer step (`ssh <node> 'verus … returntx'` piped into the runner), not a
CI job — consistent with the offline posture.
