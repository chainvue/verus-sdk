# Transfers

Four methods build and sign a spend, from the one-liner to full multi-output
control. All take a WIF, the UTXOs to spend from, and a change address; all
return a `SendCurrencyResult` — `{ signedTx, txid, fee, inputsUsed,
nativeChange }`. You broadcast `signedTx` yourself (e.g. with
[`@chainvue/verus-rpc`](https://www.npmjs.com/package/@chainvue/verus-rpc)'s
`sendRawTransaction`).

Amounts are `bigint` satoshis throughout — see [amounts](./amounts.md).

## UTXOs in, signed hex out

Every method needs the outputs it may spend. A `Utxo` is what a data source
like `getaddressutxos` gives you:

```ts
interface Utxo {
  txid: string;
  outputIndex: number;
  satoshis: bigint;
  script: string;      // hex scriptPubKey
  height?: number;     // 0 = mempool
}
```

The SDK selects inputs, computes the fee, and returns change to your
`changeAddress`. It does **not** fetch UTXOs — that is the daemon's job.

## Transaction expiry (required)

Every build takes an `expiryHeight` — the block height past which the daemon
will drop the transaction (Sapling `nExpiryHeight`). It is **required**: this
SDK is offline and cannot read the chain tip, so you must decide.

- Bound the transaction like the daemon does: `expiryHeight = currentBlockHeight
  + DEFAULT_EXPIRY_DELTA` (exported; 20 blocks). You already know the tip — it's
  where you fetched the UTXOs.
- Opt into never-expiring explicitly with `expiryHeight: 0`.

Omitting it throws — that's deliberate: a silently never-expiring signed
transaction can confirm long after you thought it failed.

```ts
import { DEFAULT_EXPIRY_DELTA } from "@chainvue/verus-sdk";
const expiryHeight = tipHeight + DEFAULT_EXPIRY_DELTA;
```

## `transfer` — native VRSC to an R-address

```ts
const sdk = new VerusSDK({ network: "testnet" });

const { signedTx, txid, fee } = sdk.transfer({
  wif: "<WIF>",
  to: "R…recipient",
  amount: 100_000_000n,        // 1 VRSC
  utxos,
  changeAddress: "R…change",
  expiryHeight: tipHeight + 20, // required — see "Transaction expiry" below
});
```

## `transferToken` — a token / currency amount

```ts
sdk.transferToken({
  wif,
  to: "R…or i…",
  amount: 5_000_000n,
  currency: "i…currencyIAddress",
  addressType: "PKH",          // "PKH" (R-address) | "ID" (i-address); default PKH
  utxos,
  changeAddress,
  expiryHeight: tipHeight + 20,
});
```

## `convert` — currency conversion

```ts
sdk.convert({
  wif,
  amount: 1_000_000_000n,
  currency: "i…source",
  convertTo: "i…target",
  via: "i…bridge",             // optional, for reserve-to-reserve
  utxos,
  changeAddress,
  expiryHeight: tipHeight + 20,
});
```

## `sendCurrency` — full control

The general form: one or more outputs, each with its own currency, address
type, conversion, cross-chain export, and fee currency. `transfer`,
`transferToken`, and `convert` are ergonomic wrappers over this.

```ts
sdk.sendCurrency({
  wif,
  outputs: [
    {
      currency: "i…systemId",   // system ID for native VRSC
      satoshis: 100_000_000n,
      address: "R…",
      addressType: "PKH",       // "PKH" | "ID" | "ETH"
      // convertTo / exportTo / via / feeCurrency / feeSatoshis / preconvert …
    },
  ],
  utxos,
  changeAddress,
  expiryHeight: tipHeight + 20,
});
```

A cross-chain send exports to another system — add `exportTo` (and `bridgeId`
when routing through a bridge converter), paying the export fee in `feeCurrency`:

```ts
sdk.sendCurrency({
  wif,
  outputs: [{
    currency: "i…token",
    satoshis: 5_00000000n,
    convertTo: "i…bridgeCurrency",
    exportTo: "i…destinationSystem",
    bridgeId: "i…bridgeConverter",
    feeCurrency: "i…destinationSystem",
    address: "0x…",             // an ETH address for an ETH gateway
    addressType: "ETH",
  }],
  utxos,
  changeAddress,
  expiryHeight: tipHeight + 20,
});
```

See `CurrencyOutput` in the type surface for every optional field (cross-chain
`exportTo`, `bridgeId`, `feeCurrency` / `feeSatoshis`, `preconvert`, and the
`mintnew` / `burn` / `burnweight` flags below).

## Pre-convert — invest in a launching currency

Before a fractional currency's start block you can *pre-convert* a reserve into
it: send the reserve with `preconvert: true` and `convertTo` the launching
currency. You receive its fractional currency when it launches.

```ts
sdk.sendCurrency({
  wif,
  outputs: [{
    currency: "i…systemId",     // the reserve you send (e.g. native VRSC)
    satoshis: 10_00000000n,
    convertTo: "i…launchingCurrency",
    preconvert: true,
    address: "i…recipient",
    addressType: "ID",
  }],
  utxos,
  changeAddress,
  expiryHeight: tipHeight + 20,
});
```

## Mint / burn a centralized currency

A centralized currency (`proofProtocol: 2`) can mint new supply or burn existing
supply — both are `sendCurrency` outputs with a flag.

**Mint** (`mintnew: true`) creates new supply. It must be authorized by the
currency's own controlling identity: fund the transaction from that identity's
native UTXOs and sign with its primary key — the daemon rejects a mint that isn't
sourced from the currency id. The minted currency is *created*, so no token input
is required.

```ts
sdk.sendCurrency({
  wif,                          // the currency identity's primary key
  outputs: [{
    currency: "i…theCurrency",  // equals the controlling identity's i-address
    satoshis: 1_000_00000000n,  // amount to mint
    address: "i…recipient",
    addressType: "ID",
    mintnew: true,
  }],
  utxos,                        // native UTXOs held by the currency identity
  changeAddress,
  expiryHeight: tipHeight + 20,
});
```

**Burn** (`burn: true`) reduces supply by burning your own holdings;
`burnweight: true` burns to change a fractional currency's reserve weight.

A mint or burn takes effect when the currency's import thread processes the
transfer (a block or two after confirmation), not instantly — the same
export → import cycle as any reserve transfer.

## `buildAndSign` — explicit inputs and outputs

The lowest-level primitive: you name the exact inputs and outputs, the SDK signs.
No coin selection, no change — what you pass is what gets built. Use it when you
have already selected UTXOs or need a non-standard output layout.

```ts
sdk.buildAndSign({
  wif,
  inputs: [{ txid, vout, scriptPubKey: "76a914…88ac", amount: 100_000_000n }],
  outputs: [{ address: "R…", amount: 99_990_000n }], // inputs − outputs = fee
  expiryHeight: tipHeight + 20,
  // fee?: bigint — optional explicit fee assertion
});
```

## It re-validates before handing you bytes

Every built transfer is checked against its intent **before** the hex is
returned: per-currency value conservation (inputs = outputs + change + fee, per
currency) and change going to the address you declared. A selection or change
bug throws a `TransactionBuildError` — the SDK never returns a transaction that
doesn't reconcile.

Every boundary failure is a typed `VerusError` subclass, so you branch on the
type rather than parse a message:

```ts
import { InsufficientFundsError, InvalidWifError } from "@chainvue/verus-sdk";

try {
  sdk.transfer({ /* … */ });
} catch (e) {
  if (e instanceof InsufficientFundsError) {
    // e.required / e.available / e.currency
  } else if (e instanceof InvalidWifError) {
    // bad key
  }
}
```

The subclasses: `InsufficientFundsError`, `InvalidWifError`,
`InvalidAddressError`, `InvalidNameError`, `InvalidAmountError`,
`TransactionBuildError` — all extend `VerusError` (`src/errors.ts`).

## Inspecting the result

`utils.summarizeSignedTransaction(hex, network)` decodes a signed transaction —
its txid, the outpoints it spends, and its addressed outputs — for your own
ledger or a pre-broadcast sanity check:

```ts
import { utils } from "@chainvue/verus-sdk";
const summary = utils.summarizeSignedTransaction(signedTx, "testnet");
// { txid, inputs: [...spent outpoints], outputs: [...addressed] }
```

An output's `address` is `null` for a smart / CryptoCondition output (a reserve
transfer, an identity, a currency definition) — those aren't a plain payment to
one address. Match your change by address; treat `null` outputs as "not mine".
