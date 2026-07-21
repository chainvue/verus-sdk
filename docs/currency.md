# Currencies

The SDK builds Verus currency-definition transactions **entirely offline**,
byte-for-byte identical to what the daemon's `definecurrency` produces, and signs
them from a WIF — the node never holds a key. It also builds the reserve-transfer
output used to pre-convert ("invest") into a launching currency.

## Building the definition output

`buildCurrencyDefinitionScript(input)` returns the `EVAL_CURRENCY_DEFINITION`
CryptoCondition output script for a token, a fractional basket, or an NFT.

```ts
import { VerusSDK, CURRENCY_OPTION } from '@chainvue/verus-sdk';

const sdk = new VerusSDK({ network: 'testnet' });

// A simple centralized token.
const tokenScript = sdk.buildCurrencyDefinitionScript({
  name: 'MYTOKEN',
  parent: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq', // chain root
  options: CURRENCY_OPTION.TOKEN,               // 0x20
  proofProtocol: 2,                             // CHAINID — centralized mint/burn
  preAllocations: [{ address: 'iMyIdentityAddress...', amount: 200_00000000n }],
});

// A fractional reserve basket (two reserves, 50/50).
const basketScript = sdk.buildCurrencyDefinitionScript({
  name: 'MYBASKET',
  parent: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
  options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL, // 0x21
  proofProtocol: 1,
  currencies: ['iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq', 'iDMAoXEjZLkpofokBGsVwen7YEwo1iujMQ'],
  weights: [50_000000n, 50_000000n], // relative weights, normalized to sum to 1e8
  initialSupply: 1_000_00000000n,    // required and positive for a fractional currency
});
```

Amounts are `bigint` satoshis. Reserve currencies and pre-allocation recipients
are i-addresses. Weights are relative and normalized to sum to `1e8` exactly as
the daemon does. Omitted per-reserve vectors follow the daemon's own defaults
(`conversions` zero-filled to the reserve count; `minPreconversion` /
`maxPreconversion` left empty). `serializeCurrencyDefinition(input)` returns just
the `CCurrencyDefinition` `AsVector()` bytes without the CC wrapper.

### NFTs (tokenized ID control)

An NFT is a single-satoshi token the daemon maps to the native currency. Set the
`NFT_TOKEN` bit and pre-allocate exactly one satoshi; the SDK auto-maps the system
currency, fixes `maxPreconversion` to `[0]`, and rejects a centralized proof
protocol (the daemon rejects an NFT with `proofProtocol: 2`):

```ts
const nftScript = sdk.buildCurrencyDefinitionScript({
  name: 'MYNFT',
  parent: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
  options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.SINGLECURRENCY | CURRENCY_OPTION.NFT_TOKEN, // 0x860
  proofProtocol: 1,
  preAllocations: [{ address: 'iMyIdentityAddress...', amount: 1n }], // the single token
});
```

## Launching a currency (full, broadcastable, offline)

`buildCurrencyLaunchTransaction` assembles and signs the complete
currency-definition transaction — all seven outputs (identity update, definition,
cross-chain import, notarization with currency state, cross-chain export, reserve
deposit, change) — byte-equivalent to `definecurrency`. Hand the signed hex to any
node to broadcast. A currency is defined under an identity of the same name, so
you supply that identity (from a lite node's `getidentity`), its controlling UTXO,
funding UTXOs, the current tip height, and the chain's currency launch fee.

```ts
const { signedTx, txid } = sdk.buildCurrencyLaunchTransaction({
  wif,                                  // the identity's primary key
  definition: { /* as above */ },
  identity,                             // getidentity result for the defining ID
  identityUtxo,                         // its current identity output (value 0)
  fundingUtxos,                         // cover the reserve deposit + miner fee
  changeAddress,
  height,                               // current chain tip
  launchFeeSats: 20_000_000_000n,       // getcurrency <parent>.currencyregistrationfee
                                        // (NFTs use idImportFees instead)
});
```

Only the change output differs from the daemon's own transaction, and it must:
the change value depends on which UTXOs fund the transaction, so no builder — nor
the daemon — produces a byte-identical whole transaction. The six consensus-checked
outputs (which the daemon validates against chain state) are byte-identical.

To build the seven output scripts without funding/signing (e.g. to inspect or to
feed a custom assembler), use `buildCurrencyLaunchOutputs`.

> **Fee note.** The launch pays a standard size-based miner fee and locks the
> import share (half the launch fee, rounded up) in the reserve deposit — the
> economics a same-chain definition is validated against today. The daemon
> additionally pays the *export* share (~100 native) as miner fee; this SDK does
> not, and same-chain consensus does not require it. Accepted on VRSCTEST, but a
> future consensus tightening could begin to expect it.

## Investing in a launching currency (pre-convert)

`buildReserveTransferOutput` builds the `EVAL_RESERVE_TRANSFER` output that
converts — or, before a currency's start block, *pre*-converts — a native reserve
into that currency. Drop it into a funded transaction to invest at launch.

```ts
import { buildReserveTransferOutput } from '@chainvue/verus-sdk';

const rt = buildReserveTransferOutput({
  sourceCurrency: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq', // native (VRSCTEST)
  amount: 10_00000000n,                                 // 10 native
  destCurrency: 'iLaunchingBasket...',                  // the currency to invest in
  recipient: 'iMyIdentity...',                          // receives the fractional currency
  feeAmount: 20_000n,                                   // conversion fee (node estimate)
  preconvert: true,                                     // before the start block
});
// rt.script is the output; rt.value (amount + fee) is its native value.
```

All addresses must be i-addresses (the destination is encoded as `DEST_ID`; an
R-address would misroute the funds to a nonexistent identity), so they are
validated fail-closed.

## Constraints the daemon enforces (checked offline, fail-closed)

The builder rejects a definition the network would reject, so you find out before
you fund and sign, not after broadcast:

- **Fractional baskets** must include the chain's native currency among the
  reserves, carry one positive weight per reserve (normalized to sum to 1e8), keep
  every normalized weight ≥ 5%, have a positive `initialSupply`, and use ≤ 10
  reserves. (Carve-out, discount, and pre-allocation dilute weights further *at
  launch* — leave headroom above 5%.)
- **NFTs** pre-allocate exactly one satoshi and use a non-centralized proof
  protocol; `currencies`/`weights`/`min`·`maxPreconversion` are set automatically.
- **Tokens** take no `initialSupply`/`preLaunchDiscount` (fractional-only fields).
- **Same-chain only**: `parent`/`systemId` must be the chain id; the launch's
  `startBlock` must be in the future; `idReferralLevels ≤ 5`; an identity may
  define a currency only once.

Amounts that would overflow, go negative, or fall outside the daemon's ranges are
rejected with a typed `TransactionBuildError`.

## Scope

Tokens (`OPTION_TOKEN`), fractional reserve baskets
(`OPTION_TOKEN | OPTION_FRACTIONAL`), and NFTs (`OPTION_NFT_TOKEN`) are supported.
Gateways (`OPTION_GATEWAY`) and PBaaS chains (`OPTION_PBAAS`) are rejected
fail-closed — their serialization carries extra trailing fields this builder does
not emit. For those, supply a pre-built script to `defineCurrency` via
`currencyDefScript`.

Every output is byte-locked in the `test/currency-*.test.ts` suites against live
VRSCTEST `definecurrency` / `sendcurrency` output, and the full pipeline
(WIF → identity → launch → pre-convert) has been proven end-to-end on VRSCTEST for
tokens, 1/2/3-reserve baskets, discount, carve-out, min/max preconversion, and
NFTs.

## Classifying a currency

`classifyCurrency(info)` sorts a `getcurrency` result into a `CurrencyType` —
`'native' | 'gateway' | 'bridge' | 'liquidity_pool' | 'token' | 'nft'` — handy for
labelling or ordering currencies in a UI (`CURRENCY_TYPE_ORDER` gives the sort
priority).

```ts
import { classifyCurrency } from "@chainvue/verus-sdk";
classifyCurrency({ systemid, currencyid, options, currencies }); // e.g. "token"
```
