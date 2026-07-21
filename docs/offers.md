# Marketplace offers

A Verus marketplace offer is one half of a fully on-chain **atomic swap**. The
maker spends the output holding the OFFERED asset and, in that one input, signs
with `SIGHASH_SINGLE | SIGHASH_ANYONECANPAY` (`0x83`) — committing to exactly one
output, the WANTED asset paid to the maker. That signature stays valid while a
taker ADDs their own inputs (paying the wanted asset) and outputs (receiving the
offered asset) and signs their side with `SIGHASH_ALL`. The two halves merge into
one transaction; either it settles atomically or it doesn't settle at all.

The SDK builds and signs both halves offline. You broadcast the funding
transaction, the taker's completed swap, and (if you post to the on-chain
orderbook rather than hand the partial to a taker directly) the offer itself —
broadcasting, UTXO fetching, and orderbook indexing are yours.

Amounts are `bigint` satoshis (see [amounts](./amounts.md)). The offer-building
steps take a required `expiryHeight` (funding defaults to `0`) — see
[Transaction expiry](./transfers.md#transaction-expiry-required).

The OFFERED and WANTED assets may each be the native coin, a token, or a VerusID,
in every combination. The methods below are on the `VerusSDK` facade (which
injects the network) and in the `offers` namespace for standalone use.

## Currency ↔ currency

Offering a currency needs a **funding transaction** first: it locks the offered
asset in a commitment output the offer then spends. Broadcast it and read back
its output before building the offer.

```ts
// Maker step 1 — fund the offered asset (native coin or a token).
const funding = sdk.buildOfferFunding({
  wif,
  utxos,                                   // must cover the offered amount (+ fee)
  changeAddress,
  makerAddress,                            // controls & later spends the commitment
  offered: { currency: CHAIN_ID, amount: 5n * 100_000_000n }, // native here
  expiryHeight: tip + 20,
});
// → { fundingTx, txid, fee, commitment }
// broadcast funding.fundingTx, wait for confirmation.

// Maker step 2 — build the half-signed offer.
const offer = sdk.buildOffer({
  wif,
  commitment: funding.commitment,          // the outpoint from step 1
  want: { currency: TOKEN_ID, amount: 10n * 100_000_000n, address: makerReceive },
  expiryHeight: tip + 20,
});
// → { offerTx, txid }  — hand offerTx to a taker, or post it on-chain.
```

The taker pays the wanted asset, receives the offered asset, and signs:

```ts
const swap = sdk.completeOffer({
  offerTx: offer.offerTx,
  offered: { currency: CHAIN_ID, amount: 5n * 100_000_000n },   // what they receive
  want: { currency: TOKEN_ID, amount: 10n * 100_000_000n },     // what they pay
  takerUtxos,                              // hold the wanted currency + native for the fee
  takerAddress,                            // where they receive the offered asset
  changeAddress,
  wif,
});
// → { swapTx, txid }  — broadcast swapTx.
```

`offered.currency` / `want.currency` is the chain id for the native coin or an
i-address for a token; the four native/token combinations are all handled.

## Cancelling an offer

Until a taker completes it, the offered asset sits in the maker's own funding
commitment. If the deal never happens, reclaim it — spend that commitment back to
the maker (signed `SIGHASH_ALL`). It needs only the maker's key and the commitment
outpoint.

```ts
const reclaim = sdk.buildReclaimOffer({
  wif,
  commitment: funding.commitment,          // the outpoint from buildOfferFunding
  offered: { currency: CHAIN_ID, amount: 5n * 100_000_000n },
  makerAddress,                            // where the reclaimed asset is returned
  // feeUtxos: [...],                       // REQUIRED for a token reclaim (see below)
  expiryHeight: tip + 20,
});
// → { reclaimTx, txid }  — broadcast reclaimTx.
```

For a **native** offer the miner fee comes out of the reclaimed value (no extra
inputs). For a **token** offer the commitment carries no native coin, so pass
`feeUtxos` — native UTXOs controlled by the same `wif` — to fund the fee; the
token returns in full. A token-bearing or foreign-key fee UTXO is rejected with a
typed error rather than silently losing value.

This is the maker's unilateral cancel of an SDK-built offer. It is distinct from
the daemon's `closeoffers`, which cancels the daemon's on-chain *posted* offers (a
different commitment the SDK does not create).

## Sell a VerusID for a currency

Selling an identity needs **no funding transaction** — the maker spends the
identity's current on-chain primary output directly. Read that output
(`getidentity` → the txid/vout of its primary output, plus its scriptPubKey hex).

```ts
const offer = sdk.buildSellIdentityOffer({
  wif,                                     // controls the identity's primary address
  identityOutput: { txid, vout, script },  // the identity's current primary output
  want: { currency: CHAIN_ID, amount: 100n * 100_000_000n, address: makerReceive },
  expiryHeight: tip + 20,
});

const swap = sdk.completeSellIdentityOffer({
  offerTx: offer.offerTx,
  identityJson,                            // the `.identity` from getidentity
  newPrimaryAddresses: [takerControl],     // the taker's new control address(es)
  want: { currency: CHAIN_ID, amount: 100n * 100_000_000n },
  takerUtxos,                              // the wanted currency + native for the fee
  changeAddress,
  wif,
});
// → identity transferred to the taker, currency paid to the maker.
```

The transferred identity output is the same identity with only its primary
addresses replaced — revocation/recovery authorities, name, parent, and content
are preserved, byte-identically to the daemon.

## Buy a VerusID with a currency

The mirror: the buyer funds the currency into a commitment (as in
currency↔currency), then offers it wanting the identity transferred to them. The
taker is the identity's owner.

```ts
const offer = sdk.buildBuyIdentityOffer({
  wif,
  commitment: funding.commitment,          // from buildOfferFunding
  identityJson,                            // the identity being bought (getidentity)
  buyerPrimaryAddresses: [buyerControl],
  expiryHeight: tip + 20,
});

const swap = sdk.completeBuyIdentityOffer({
  offerTx: offer.offerTx,
  offered: { currency: CHAIN_ID, amount: 3n * 100_000_000n },
  identityOutput: { txid, vout, script },  // the seller's current identity output
  sellerReceiveAddress,
  takerUtxos,                              // native for the fee (identity carries none)
  changeAddress,
  wif,                                     // the seller controls the identity
});
```

## Swap a VerusID for a VerusID

No currency moves — the taker funds only the miner fee. The maker offers one
identity wanting another transferred to them; the taker owns the wanted identity
and receives the offered one.

```ts
const offer = sdk.buildSwapIdentityOffer({
  wif,                                     // controls the offered identity
  offeredIdentityOutput: { txid, vout, script },
  wantedIdentityJson,                      // the identity the maker wants (getidentity)
  makerPrimaryAddresses: [makerControl],
  expiryHeight: tip + 20,
});

const swap = sdk.completeSwapIdentityOffer({
  offerTx: offer.offerTx,
  offeredIdentityJson,                     // the identity the taker receives (getidentity)
  takerPrimaryAddresses: [takerControl],
  wantedIdentityOutput: { txid, vout, script }, // the taker's identity, spent
  takerUtxos,                              // native for the fee only
  changeAddress,
  wif,                                     // controls the wanted identity AND the fee UTXO
});
// → both identities change control in one atomic transaction.
```

`completeSwapIdentityOffer` signs the taker's identity input and the fee input
with a single `wif`, so the taker's identity key must also hold the native fee
UTXO.

## What the SDK does and doesn't check

The maker half is byte-identical to the daemon's `makeoffer`; the taker half is
not (each wallet selects its own UTXOs), and its correctness rests on value
conservation — native in/out balances to the fee, and token in/out balances
per currency — asserted before the hex is returned. The daemon's `takeoffer`
assembles a swap **without** validating the maker's incoming signature, so a bad
maker signature only surfaces at `sendrawtransaction`; the SDK signs the maker
half deterministically and the whole suite is proven end-to-end on VRSCTEST.
