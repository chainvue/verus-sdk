# Fees

Verus does **not** price a transaction by its size. There is no satoshi-per-byte
rate anywhere on the acceptance path. The fee is a function of the transaction's
**outputs**, and nothing else.

## The rule

```
fee = 10_000 × (identityFeeFactor or 1)                  // base
    + 10_000 × (non-change outputs beyond the first)     // per output
    + 10_000 per output script over 2_000 bytes          // large-script
      (+10_000 more over 4_000 bytes)
```

`10_000` satoshis is `DEFAULT_TRANSACTION_FEE` (VerusCoin `src/wallet/wallet.h:51`)
— a constant, not a rate.

`identityFeeFactor` applies to identity outputs and is summed over them
(`src/main.cpp:2216-2233`):

```
factor += ceil(contentMultiMap serialized bytes / 128)
factor += contentMap entries
factor += max(primary addresses − 1, 0)
factor += max(private addresses − 1, 0)
```

So an identity's **content** costs 10,000 satoshis per 128 bytes — about
78 sat/byte — while the transaction that carries it costs nothing per byte.

## What it costs, in practice

| Transaction | Fee |
|---|---|
| one recipient (native or token) | 10,000 |
| three recipients | 30,000 |
| five recipients | 50,000 |
| name commitment | 10,000 |
| identity update, no content change | 10,000 |
| identity update, 1.6 KB `contentMultiMap` | 130,000 |
| identity update of a 2-primary identity with one `contentMap` key | 20,000 |
| currency definition (identity + definition output) | 20,000 |

## What it does *not* cost

- **Transaction size.** VRSC mainnet txid
  `87c5bb69a41d778903b899d8880191ede6e93e9da5c64bc90170bd8265e97150` (block
  4,163,006) is 185,212 bytes with 1,255 inputs and one output. It paid exactly
  10,000 satoshis — 54 sat/kB, *below* the 100 sat/kB `minRelayTxFee` — and was
  mined. That `CFeeRate` is only the dust threshold, the absurd-fee ceiling, and
  the miner's block-template sort; it is never an acceptance floor.
- **Inputs.** The daemon's only input term is `max(SpendCount() − 1, 0)`, and
  `SpendCount()` counts *Sapling* spends — always 0 for the transparent
  transactions this SDK builds.
- **Change.** The builder's fee is computed before change is added, and the
  mempool's floor allows three outputs where the sender rule allows one.
- **Whether an output is a CryptoCondition script.** Below 2,000 bytes the
  daemon counts outputs, not kinds. Two mainnet 2-output transactions of 416 and
  2,625 bytes — one a `reservetransfer`, one a `reserveoutput` — both paid 10,000.

## Quoting a fee before you build

```ts
import { estimateMinerFee, utils } from "@chainvue/verus-sdk";

// The scripts of the outputs you intend to declare — change excluded.
const fee = estimateMinerFee([
  utils.addressToScriptPubKey("R…alice"),
  utils.addressToScriptPubKey("R…bob"),
  utils.addressToScriptPubKey("R…carol"),
]);
// 30_000n
```

`relayMinimumFee(scripts)` is the looser mempool floor over the **final** vout
set (change included), and `computeIdentityFeeFactor(scripts)` returns the
identity factor those scripts carry. Every builder in this SDK computes its fee
with `estimateMinerFee` and then asserts, offline, that the fee clears
`relayMinimumFee` for the transaction it actually built — throwing
`TransactionBuildError` rather than handing you a transaction that may not relay.

## Why this matters

A transaction whose fee is below the mempool minimum is not cleanly rejected. It
falls into the daemon's free-transaction path (`src/main.cpp:2296-2317`), where
acceptance depends on the node's decaying free-relay counter at that moment — and
is an outright reject above 15,000 bytes. That is the failure mode this rule
exists to avoid, and it is why the fee is asserted rather than assumed.

## Two deliberate deviations from the daemon, both in the safe direction

1. **No `idExtraLimit` allowance.** A transaction carrying an identity
   *reservation* output gets an extra free-output allowance worth
   `parentCurrency.IDReferralLevels() + 2` outputs. Reading that needs a
   `getcurrency` call this offline SDK cannot make, and a guessed allowance could
   only *under*pay — so it takes none. A registration therefore pays up to
   0.0003 VRSC more than the daemon would, on top of a 100 VRSC registration.
2. **The 2,000-byte threshold is the post-PBaaS one.** It is
   `MAX_SCRIPT_ELEMENT_SIZE / 3`, and `MAX_SCRIPT_ELEMENT_SIZE` is 6,000 only
   once PBaaS has activated — which is the case on both live chains. A
   pre-PBaaS chain would use a smaller threshold, i.e. charge the surcharge
   sooner.

## The reserve-transfer fee is separate

A conversion's `CReserveTransfer` carries its own `nFees`
(`RESERVE_TRANSFER_FEE`, 20,000 satoshis — `src/pbaas/reserves.cpp:24-31`) inside
the transfer output's value. That is a protocol fee paid *in addition to* the
miner fee above, not instead of it.
