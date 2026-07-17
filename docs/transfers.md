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
});
```

See `CurrencyOutput` in the type surface for every optional field (cross-chain
`exportTo`, `bridgeId`, `feeCurrency` / `feeSatoshis`, `preconvert`).

## It re-validates before handing you bytes

Every built transfer is checked against its intent **before** the hex is
returned: per-currency value conservation (inputs = outputs + change + fee, per
currency) and change going to the address you declared. A selection or change
bug throws a `TransactionBuildError` — the SDK never returns a transaction that
doesn't reconcile. On not enough funds you get an `InsufficientFundsError` with
`required` / `available` / `currency`. All boundary errors are typed
`VerusError` subclasses (`src/errors.ts`).

## Inspecting the result

`utils.summarizeSignedTransaction(hex, network)` decodes a signed transaction —
its txid, the outpoints it spends, and its addressed outputs — for your own
ledger or a pre-broadcast sanity check:

```ts
import { utils } from "@chainvue/verus-sdk";
const summary = utils.summarizeSignedTransaction(signedTx, "testnet");
// { txid, inputs: [...spent outpoints], outputs: [...addressed] }
```
