# @chainvue/verus-typescript-sdk

**100% offline Verus transaction signing.** Build and sign Verus
transactions — native transfers, token/currency transfers, conversions,
and the full VerusID lifecycle (name commitment, registration, sub-IDs,
update/revoke/recover, message signing) — with no daemon and no network
access. You bring UTXOs and a WIF; the SDK returns signed transaction hex.

Serialization delegates to VerusCoin's own primitives
(`verus-typescript-primitives`) and a fork of `@bitgo/utxo-lib`, so the
wire format is the daemon's, not a reimplementation.

## Install

```bash
npm install @chainvue/verus-typescript-sdk
```

The published package is a **self-contained bundle**: the VerusCoin forks
(utxo-lib, primitives, bitcoin-ops) are inlined, so there are no `github:`
dependencies or install-time patches in your dependency graph. Regular npm
dependencies (`tiny-secp256k1`, `ecpair`, `bs58check`, `bn.js`,
`create-hash`, `wif`) install normally.

> **TypeScript consumers:** the type declarations reference the fork
> packages' types, so set `"skipLibCheck": true` in your `tsconfig.json`
> until the declarations are rolled up. Runtime is unaffected.

## Usage

```ts
import { VerusSDK } from '@chainvue/verus-typescript-sdk';

const sdk = new VerusSDK({ network: 'testnet' }); // or 'mainnet'

// Native transfer — returns { signedTx, txid, fee, inputsUsed, nativeChange }
const result = sdk.transfer({
  wif: '<WIF>',
  to: 'R...recipient',
  amount: 100_000_000,          // satoshis
  utxos: [/* { txid, outputIndex, satoshis, script } */],
  changeAddress: 'R...change',
});
// broadcast result.signedTx via your own RPC (e.g. verus-rpc sendrawtransaction)

// Decode a signed tx for a wallet ledger:
import { utils } from '@chainvue/verus-typescript-sdk';
const summary = utils.summarizeSignedTransaction(result.signedTx, 'testnet');
// { txid, inputs: [{txid, vout}], outputs: [{valueSat, scriptHex, address}] }
```

Static helpers: `VerusSDK.generateWif()`, `VerusSDK.deriveAddress(wif)`,
`VerusSDK.deriveIdentityAddress(name, parent?)`,
`VerusSDK.validateAddress(addr)`, `VerusSDK.validateWif(wif)`.

Identity lifecycle: `createCommitment`, `registerIdentity`,
`updateIdentity` / `lockIdentity` / `unlockIdentity` / `revokeIdentity` /
`recoverIdentity`, plus `signMessage` / `verifyMessage`.

## Safety

- **Every built transfer is validated** against its unfunded intent
  (utxo-lib's own funded-transfer validator: per-currency value
  conservation, change to the declared address) before the hex is returned
  — a selection/change bug throws instead of producing a bad tx.
- Signing is **offline**: the SDK never opens a socket. Broadcasting,
  UTXO fetching and confirmation tracking are the caller's job.

## Status

Pre-release. The transaction wire format is proven against a live VRSCTEST
daemon (decode round-trip + `sendrawtransaction` acceptance) — see
[RISKS.md](./RISKS.md) for the live-proof harness and open items.

License: Apache-2.0.
