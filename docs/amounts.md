# Amounts — `bigint` satoshis, end to end

Every value in this SDK is an integer number of **satoshis**, carried as a
JavaScript `bigint`. `1 VRSC = 100_000_000n` satoshis (8 decimals,
`AMOUNT_DECIMALS = 8`). A float never touches a value path.

## Why not `number`

A JS `number` is an IEEE-754 float64. It represents integers exactly only up to
`2^53` (`9_007_199_254_740_992`). One satoshi is `1e-8` VRSC, so `2^53`
satoshis is ≈ 90 million coins — a single VRSC balance sits under that line and
survives by luck, but a large-supply PBaaS token routinely sits above it, and
there the rounding is silent. A signing library that builds transactions in
floats will, sooner or later, sign away the wrong amount. This SDK removes the
gamble: amounts are integers the whole way through, and the money is exact at
any supply.

## Convert at the edges

You only deal with the human, decimal form at the boundary — user input and
display. Two helpers do the exact conversion:

```ts
import { parseSats, toCoins, toSatoshis, SATS_PER_COIN } from "@chainvue/verus-sdk";

parseSats("1.5");        // 150_000_000n   — decimal string → satoshis
toSatoshis("1.5");       // 150_000_000n   — alias, coins string → satoshis
toCoins(150_000_000n);   // "1.5"          — satoshis → decimal string
SATS_PER_COIN;           // 100_000_000n
```

`parseSats` / `toSatoshis` take a **string**, not a `number` — passing
`1.5` as a float would already have lost precision before the call. Feed them
the raw user text.

## The one checked crossing

The bundled signing library (`@bitgo/utxo-lib`) still models output values as
float64 internally. Exactly one function crosses a `bigint` into it:

```ts
import { toSafeNumber } from "@chainvue/verus-sdk";

toSafeNumber(90_000_000n);   // 90000000
toSafeNumber(2n ** 60n);     // throws InvalidAmountError — outside [0, 2^53]
```

`toSafeNumber` is the single audited boundary: it throws for any amount outside
`[0, 2^53]` satoshis rather than let a lossy value reach the signer. If you are
building on the SDK internals, this is the only place a satoshi value should
ever become a `number` — never `Number(sats)` or `Math.round(coins * 1e8)`
anywhere else.

## What you pass and get back

Every amount field on a parameter or result object is a `bigint`:

```ts
const { signedTx, txid, fee, nativeChange } = sdk.transfer({
  wif,
  to: "R…",
  amount: 100_000_000n,   // bigint in
  utxos: [{ txid, outputIndex, satoshis: 500_000_000n, script }],
  changeAddress: "R…",
});
// fee, nativeChange: bigint out
```

See [transfers](./transfers.md) for the full send surface and
[signing & wire format](./signing-and-wire.md) for how the bytes are proven.
