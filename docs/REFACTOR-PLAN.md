# @chainvue/verus-sdk — Structural refactor plan

Goal: make whole **classes** of bug structurally impossible rather than patching the
same bug in each of the 7 hand-rolled transaction-building paths. Pre-1.0, no external
adopters — the cheapest time to do this, and the window closes at 1.0.

## Why (root causes, verified against the code)

The ~30 bugs fixed to date cluster into four classes with two deeper roots:

1. **Address-version laundering.** `KeyID/IdentityID.fromAddress` and `fromBase58Check`
   discard the version byte; the SDK defends with `assertAddressVersion` at each of 15+
   call sites, and we keep finding forgotten ones (still live: `buildReferralPaymentScript`
   has no guard; six `startsWith('i')` string-sniffs stand in for a version parse).
2. **Value conservation by convention, not construction.** Native/token conservation is
   enforced by "remember to call `assertX`". A CRITICAL token-burn shipped because 2 of the
   paths forgot the token side. Conservation asserts also cannot catch a *wrong intent*
   (the sub-ID fee bug was a perfectly balanced tx with the wrong output structure).
3. **Per-path duplication.** 7 building sites each hand-roll input adding, `numOutputs`
   magic numbers, `extraOutputBytes`, change emission, and conservation asserts. A fix to
   one drifts from the others — many bugs are literally the same bug copied N times.
4. **"Green under test, broken live" (fixture unrealism).** Unit tests prove
   *self-consistency*; only the daemon proves *correctness*. RISKS.md documents this three
   times (primitives split-brain, `>>> 0` fee truncation, sub-ID fee structure).

Deeper roots: (A) a **stringly-typed domain** (addresses, WIF, script-hex, tx-hex all
`string`); (B) a **wide, untyped, duplicated fork boundary** (`@bitgo/utxo-lib` /
`verus-typescript-primitives` imported from 6 modules; money modeled as `number`; version-
blind; fails open on its fee check; untyped throws). The fork is a VerusCoin fork pinned to
a git commit (Feb 2026) on a ~2018-era bitcoinjs base — **not replaceable** (nothing else
speaks Verus CC/identity/reserve), so the fix is **containment**, not replacement.

## Target architecture

```
src/
  core/     brands.ts (branded types + parse-don't-validate), amount.ts, errors.ts, constants.ts
  fork/     boundary.ts — THE ONLY module allowed to import the fork; toSafeNumber lives here
  script/   output-script constructors: (brands) -> TxOut value objects (script + carried value)
  assemble/ assembler.ts (the single tx assembler), select.ts (selectUtxos, now internal)
  flows/    thin TxIntent descriptors: commitment, registration, subid, update, define, sendCurrency, buildAndSign
  sign/, keys/, VerusSDK.ts (facade — keeps string params, parses at the edge)
```

- **Branded types** (`RAddress`/`IAddress`/`Wif`/`HexScript`/`TxHex`): one `IAddress` brand
  for identities AND currency ids (offline-indistinguishable; `CurrencyId = IAddress` alias
  only). No branded amounts (`bigint` is already the money firewall). Brands are subtypes of
  `string` → flow into the fork with zero casts; `fork/boundary.ts` wrappers accept only
  brands so a raw string can't reach a laundering constructor. The 15+ `assertAddressVersion`
  sites get **deleted** — the compiler enforces them; a forgotten site is a type error.
- **Single assembler**: flows provide `inputs + intended outputs + change + fee policy`; the
  assembler derives funding requirements from the outputs, sizes the fee from real script
  bytes, emits ALL change in one place, and checks conservation as a **postcondition on the
  completed tx**. Implicit fee burns are unrepresentable — registrations must *name* their
  burn (`fee: {policy:'declared', reason}`). A `SignRequest` binds inputs to prevouts so
  `signTransactionSmart(hex, wif, utxos)` can't be mis-paired.
- **Differential tests vs the daemon** (see Phase 0): a `canonicalize(txHex)` compares SDK
  output against daemon-built `returntx`, catching *wrong intent* that no type can.

Enforced mechanically: ESLint `no-restricted-imports` forbids the fork outside `src/fork/`
and forbids `fork/`+`assemble/select` imports from `flows/`.

## Unrepresentable vs merely checked

| Invariant | Mechanism |
|---|---|
| R-address where i-address required (& vice versa) | **Unrepresentable** — brands (compile time) |
| Unbalanced / dropped-token / missing-change tx | **Unrepresentable** — assembler owns outputs+change |
| Implicit fee burn | **Unrepresentable** — must be a named `declared` fee |
| Sign call with mismatched prevouts | **Unrepresentable** — `SignRequest` binds them |
| WIF not a primary address of the identity | **Checked** (`assertWifIsPrimary`, needs identity data) |
| Wrong output structure for the daemon | **Tested** — differential harness |
| Never-expiring tx / genesis-pinned signature | **Checked**, explicit opt-in |

## Phases (each independently shippable + green: build → typecheck → lint → test)

- **Phase 0 — Freeze behavior + safety net.** Deterministic building (salt param, additive),
  golden-byte snapshots of all 7 paths, `canonicalize()`, recorded Tier-0 daemon fixtures +
  CI diff test. *Locks: any refactor changing emitted bytes/structure fails CI.* No breaking
  change. **Prerequisite for everything after.**
- **Phase 1 — Brands at the core.** `core/brands.ts` + parsers; convert internal signatures
  module-by-module, deleting `assertAddressVersion` and the `startsWith('i')` sniffs; fix the
  `buildReferralPaymentScript` hole. Facade keeps `string` → **public API unchanged**.
  *Locks: version laundering is a compile error (class 1 closed).*
- **Phase 2 — Fork containment.** `src/fork/boundary.ts`; move all fork imports behind it;
  merge the two `.d.ts` into one (+ generate the consumer shim); ESLint fences. *Locks: one
  module touches the untyped/number fork.*
- **Phase 3 — Assembler, one flow per PR.** Order: commitment → buildAndSign → sendCurrency
  → update(×5) → defineCurrency → VRSC registration → **sub-ID last**. Each port keeps
  Phase-0 goldens byte-identical, then deletes its hand-rolled duplication + per-path asserts.
  *Locks per port: unbalanced/token-dropping/implicit-burn tx unrepresentable (classes 2+3
  close when the last flow ports).*
- **Phase 4 — Public-surface hygiene (breaking, one `feat!`).** Delete dead `number`-money
  types (`CurrencyBalance`, `Transaction`, `ConversionQuote`, `VerusIdentity`); optionally
  export brands+parsers; prune power-user submodule exports.
- **Phase 5 — Live differential + docs.** Env-gated `returntx` diff runner; document the
  fork-boundary contract + the unrepresentability table; close the RISKS.md "hand-rolled
  selectUtxos" WATCH item.

Rough effort ~2 weeks focused; Phase 0's fixture recording is the long pole.

### Deliberately NOT doing
No fp-ts/Effect/zod (hand parsers, zero new deps — the lean dep posture is a security
feature). No branded amounts, no separate `CurrencyId` brand. No rewrite of the (daemon-
proven) UTXO-selection algorithm — relocation only. No vendoring/forking of utxo-lib, no
in-tree fix of the upstream `>>> 0` truncation (belongs upstream). No dependency-pin bump
until Phase 0's differential harness makes it safely verifiable.

## Status

- [x] **Phase 0** — landed in PR #41 (`refactor/phase-0-golden-net`)
  - [x] PR 0.1: deterministic salt param + golden-byte snapshots (`test/golden.test.ts`)
  - [x] PR 0.2: `canonicalize()` (`test/support/canonicalize.ts`) + recorded Tier-0 daemon
        shapes (`test/fixtures/daemon-shapes.json`, recorder `scripts/record-diff-fixtures.mjs`)
        + hermetic diff test (`test/differential.test.ts`). Current SDK output confirmed
        daemon-shaped (sub-ID fee = EVAL_RESERVE_OUTPUT/1 currency/0 native; VRSC reg =
        no reserve outputs).
- [~] **Phase 1 — Brands** (in progress; each slice merged, behavior-identical — golden snapshots unchanged)
  - [x] 1.1 `src/core/brands.ts` (RAddress/IAddress/P2shAddress + parsers) — PR #42
  - [x] 1.2 `identityPaymentScript` / `buildReferralPaymentScript` → `IAddress` (closed the review's hole) — PR #42
  - [x] 1.3 `createIdentityObject` → brands, **5 assertAddressVersion deleted** — PR #43
  - [x] 1.4 `buildCommitmentScript` → `RAddress` — PR #44
  - [x] 1.5 `buildTokenChangeOutput` → `Address` (dropped hand-rolled version dispatch) — PR #45
  - [ ] remaining chokepoints: `addressToScriptPubKey` (utils), `validateUpdateAddressParams`,
        the `prepareNameCommitment`/`deriveIdentityAddress` referral+parent guards, and the
        `transfer` address path → then delete the last `assertAddressVersion` sites.
- [x] **Phase 2 — Fork containment** (done)
  - [x] 2a: `src/fork/boundary.ts` (single re-export of both forks); all six src
        modules migrated to import from it; ESLint `no-restricted-imports` fence
        forbids the raw forks outside `src/fork/`. Behavior-identical (goldens
        unchanged). primitives is the source of truth for shared CC types;
        utxo-lib's own tx/crypto surface is re-exported explicitly.
  - [x] 2b (re-scoped): the two `.d.ts` are NOT merged — the split is intentional
        (`bitgo-utxo-lib.d.ts` is the rich internal ambient type importing
        bn.js+primitives; `fork-shims.d.ts` is the dependency-free consumer subset
        shipped to adopters — one file can't be both). Cross-referenced both with
        a keep-in-sync note to mitigate drift. Moving the `toSafeNumber` crossing +
        fork-error wrapping into the boundary is folded into Phase 3, where the
        assembler owns every boundary crossing (a bigint-in/number-out surface).
- [x] **Phase 3 — Assemblers** (every selecting/building flow now funnels through one)
  - [x] 3.1 `src/assemble/assembler.ts` (the value-output assembler) + commitment port — PR #65
  - [x] 3.2 VRSC identity registration → assembler; added `fee:{policy:'declared',burnSat}`
        (named implicit burn), `leadingInputs`, `feeOutputCount` — PR #66
  - [x] 3.3 sub-ID registration → assembler; proved the token side (`carries` on the fee
        output drives token funding + conservation) — PR #67
  - [x] 3.4 sendCurrency → assembler; golden added first, then `requiredCurrencies` override
        (fork-built outputs) + `changeStrategy:'separate'` — PR #68
  - [x] 3.5 `src/assemble/fundedIdentityUpdate.ts` (the identity-respend assembler) —
        deduped update/revoke/recover/lock/unlock + defineCurrency into one path — PR #69
  - Deliberately NOT ported: `buildAndSign` is an explicit-inputs/outputs leaf primitive
    (no selection, no change) with its own `fee === impliedFee` conservation — the
    selecting assembler would add nothing. Left as-is.
  - Every port kept the Phase-0 goldens byte-identical; per-path conservation asserts and
    change-emission duplication are gone → **classes 2 + 3 (unbalanced/token-dropping/
    implicit-burn + per-path duplication) structurally closed** for all building flows.
  - Not yet done (optional follow-ups): the boundary hasn't grown bigint-accepting
    wrappers (`addOutputSats`/`forkCall`); the assembler still calls `toSafeNumber` at
    each `addOutput`. Cheap to add later, no behavior change.
- [x] **Phase 4 — Public-surface hygiene** (two breaking `feat!`)
  - [x] 4.1 dropped the dead number-money types (CurrencyBalance, Transaction,
        TransactionDirection, VerusIdentity, ConversionQuote) — PR #71
  - [x] 4.2 curated the `identity` power-user namespace via `src/identity/public.ts`
        (8 intentional exports; the ~15 internal builders left the public surface but
        stay module-exported for cross-file use); `transfer`/`currency` already clean — PR #72
  - Deliberately NOT done: exporting the brands+parsers (the facade takes strings; the
    lean public surface is intentional).
- [x] **Phase 5 — Live differential + docs**
  - [x] `docs/architecture.md` — the fork-boundary contract, the two assemblers, the
        unrepresentability table, and the Tier-0/Tier-1 differential strategy; linked from README.
  - [x] `scripts/live-differential.mjs` — the Tier-1 runner: reduces an SDK hex and a
        daemon `returntx` hex each to their structural (CC/reserve) output multiset and
        diffs them. Verified positive (sub-ID vs sub-ID) and negative (sub-ID vs VRSC-reg
        → correctly fails on the reserve-output difference).
  - Note: the private RISKS.md "hand-rolled selectUtxos" WATCH item is addressed by the
    Phase-3 relocation (selection now lives inside the two assemblers, not per-path); the
    private doc update is the maintainer's. Recording Tier-0 fixtures for the remaining
    flows (update/revoke/recover, defineCurrency, sendCurrency) via the runner remains an
    open coverage item — the mechanism is now in place.

Phase 3 note (follow-up): the boundary should grow bigint-accepting wrappers (e.g.
`addOutputSats(txb, script, sats)` doing `toSafeNumber` internally, `forkCall(fn)`
wrapping untyped throws) as a cleanup — the two assemblers are now the single home
for that crossing, so it is a localized change when picked up.

**Coverage gaps to add fixtures for later:** update/revoke/recover, defineCurrency, sendCurrency
daemon shapes (only sub-ID + VRSC-reg pinned so far).

Update this section as phases land.
