# @chainvue/verus-sdk

Offline Verus transaction signing. Bring UTXOs and a WIF; get back signed
transaction hex — no daemon, no network. Native transfers, token/currency
transfers, conversions, currency creation (token / basket / NFT), and the full
VerusID lifecycle. Serialization uses VerusCoin's own primitives, so the wire
format is the daemon's, not a reimpl.

```bash
npm i @chainvue/verus-sdk
```

```ts
import { VerusSDK } from "@chainvue/verus-sdk";

const sdk = new VerusSDK({ network: "testnet" }); // or "mainnet"

const { signedTx, txid, fee } = sdk.transfer({
  wif: "<WIF>",
  to: "R…recipient",
  amount: 100_000_000n, // satoshis (bigint)
  utxos: [{ txid, outputIndex, satoshis: 500_000_000n, script }],
  changeAddress: "R…change",
  expiryHeight: currentBlockHeight + 20, // required; 0 = never expires
});
// broadcast signedTx yourself, e.g. @chainvue/verus-rpc `sendrawtransaction`
```

**Money is `bigint` satoshis end to end — never a float.** Convert at the edges:
`parseSats("1.5") → 150000000n`, `toCoins(150000000n) → "1.5"`.

## What it does

- **Transfers** — `transfer`, `transferToken`, `convert`, and `sendCurrency`
  (multi-output / cross-chain sends, conversions, pre-convert, and mint / burn of
  a centralized currency).
- **VerusID** — `createCommitment` → `registerIdentity` (incl. sub-IDs), then
  `updateIdentity` / `lockIdentity` / `unlockIdentity` / `revokeIdentity` /
  `recoverIdentity`, plus `signMessage` / `verifyMessage`. Multisig (m-of-n)
  identities update via `buildMultisigIdentityUpdate` + `addIdentitySignature`.
- **Marketplace offers** — build and complete fully on-chain atomic swaps:
  currency↔currency (`buildOfferFunding` → `buildOffer` → `completeOffer`), and
  VerusID sell / buy / swap (`build*IdentityOffer` / `complete*IdentityOffer`).
  Native coin, tokens, and identities, in every combination — plus
  `buildReclaimOffer` to cancel an unaccepted offer and reclaim the funds.
- **Currencies** — build and sign a full currency launch offline:
  `buildCurrencyDefinitionScript` for the definition output (token,
  fractional basket, or NFT), `buildCurrencyLaunchTransaction` for the complete
  broadcastable transaction (all seven outputs, byte-equivalent to the daemon's
  `definecurrency`), and `buildReserveTransferOutput` to pre-convert / invest in
  a launching currency. See [docs/currency.md](./docs/currency.md).
- **Helpers** — `VerusSDK.generateWif()`, `await deriveAddress(wif)` (async),
  `deriveIdentityAddress(name, parent?)`, `validateAddress` / `validateWif`
  (→ `{ valid, error? }`); `utils.summarizeSignedTransaction(hex, network)`
  decodes a signed tx (txid, spent outpoints, addressed outputs) for your ledger.
- **Typed errors** — every boundary failure is a `VerusError` subclass
  (`InsufficientFundsError`, `InvalidWifError`, `InvalidAddressError`,
  `InvalidNameError`, `InvalidAmountError`, `TransactionBuildError`), so you can
  branch on the error type instead of parsing messages.

Every built transfer is re-validated against its intent — per-currency value
conservation, change to the declared address — before the hex is returned. A
selection or change bug throws; it never hands you a bad transaction.

## Good to know

- **Self-contained bundle**: the VerusCoin forks (utxo-lib, primitives,
  bitcoin-ops) are inlined — no `github:` deps or install-time patches in your
  tree. Regular npm deps install normally.
- **TypeScript**: self-contained declarations — no `skipLibCheck` needed and no
  fork packages to install; the type surface for the bundled forks ships with the
  package.
- **Signing only**: broadcasting, UTXO fetching, and confirmation tracking are
  yours (see [`@chainvue/verus-rpc`](https://www.npmjs.com/package/@chainvue/verus-rpc)).
- Node ≥ 18. Wire format proven against a live VRSCTEST daemon.

## Docs

Per-area guides, plus runnable offline examples in [`examples/`](./examples):

| Guide | What's in it |
|---|---|
| [amounts](./docs/amounts.md) | the money model — `bigint` satoshis, `parseSats`/`toCoins`, the one float64 boundary |
| [transfers](./docs/transfers.md) | `transfer` / `transferToken` / `convert` / `sendCurrency`, conversions, pre-convert, mint / burn, UTXOs, change, re-validation |
| [VerusID lifecycle](./docs/identity.md) | commit → register, update, lock/unlock, revoke/recover, sign/verify messages |
| [marketplace offers](./docs/offers.md) | atomic-swap model, the maker/taker halves, currency↔currency and VerusID sell/buy/swap |
| [currencies](./docs/currency.md) | define + launch a currency offline (token / fractional basket / NFT), the full seven-output launch transaction, and pre-converting into a launching currency |
| [signing & wire format](./docs/signing-and-wire.md) | why the bytes are the daemon's, the self-contained bundle, the proof rings |
| [architecture](./docs/architecture.md) | the fork boundary, the two assemblers, what's unrepresentable vs checked, the differential harness |
| [testing](./docs/testing.md) | the gate, the plain-`node` rule, the live-proof ring model |

## Contributing

Issues and PRs welcome — start with [CONTRIBUTING.md](./CONTRIBUTING.md) for the
setup, the gate, and the two invariants that keep it trustworthy: amounts stay
`bigint`, and the wire bytes are proven against a real daemon. Security issues
(wrong bytes, amount precision, key handling): [SECURITY.md](./SECURITY.md).

Apache-2.0 · see [NOTICE](./NOTICE) for the bundled forks.
