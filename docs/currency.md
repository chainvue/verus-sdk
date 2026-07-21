# Currency definitions

The SDK serializes a Verus **currency definition** to its
`EVAL_CURRENCY_DEFINITION` CryptoCondition output script, entirely offline and
byte-for-byte identical to what the daemon's `definecurrency` produces for the
same parameters.

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
  weights: [50_000000n, 50_000000n],
  initialSupply: 1_000_00000000n,
});
```

Amounts are `bigint` satoshis. Reserve currencies and pre-allocation recipients
are i-addresses. Omitted per-reserve vectors follow the daemon's own defaults
(`conversions` / `initialContributions` zero-filled to the reserve count;
`minPreconversion` / `maxPreconversion` left empty).

`serializeCurrencyDefinition(input)` returns just the `CCurrencyDefinition`
`AsVector()` bytes if you want to inspect or diff the payload without the CC
wrapper.

## What this is for

- Building a definition script to hand to a signing/assembly pipeline.
- Inspecting or verifying a definition — decode a daemon-produced definition and
  confirm it byte-matches the parameters you expect before you sign or broadcast.

## What this is *not*

**It does not launch a currency.** A valid currency-definition transaction is not
just the identity spend plus the definition output — it also carries
currency-state, notarization, and finalization outputs whose contents are checked
against **live chain state** (`GetCurrencyState(height - 1)`) in the daemon's
`PrecheckCurrencyDefinition`. Those cannot be produced offline, by this SDK or any
other. To actually create a currency on-chain, use the daemon's `definecurrency`
RPC.

`defineCurrency` (SDK) reflects this: it assembles only the identity spend, the
currency-definition output, and change — enough to inspect or to feed a larger
assembly, but **not a broadcastable launch**.

## Scope

The builder covers **tokens** (`OPTION_TOKEN`) and **fractional reserve baskets**
(`OPTION_TOKEN | OPTION_FRACTIONAL`). Gateways (`OPTION_GATEWAY`) and PBaaS chains
(`OPTION_PBAAS`) are rejected fail-closed — their serialization carries extra
trailing fields (launch fees, issuance schedule, gateway converter) that this
builder deliberately does not emit. For those, supply a pre-built script to
`defineCurrency` via `currencyDefScript`.

The field layout is byte-locked in `test/currency-definition.test.ts` against two
real VRSCTEST definitions (the `TST` token and the `bankroll` 4-reserve basket)
and was verified equivalent to the live daemon's `definecurrency` output for both
a token and a basket.
