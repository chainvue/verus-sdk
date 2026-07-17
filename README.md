# @chainvue/verus-sdk

Offline Verus transaction signing. Bring UTXOs and a WIF; get back signed
transaction hex — no daemon, no network. Native transfers, token/currency
transfers, conversions, and the full VerusID lifecycle. Serialization uses
VerusCoin's own primitives, so the wire format is the daemon's, not a reimpl.

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
  (full control over multi-output / cross-chain sends).
- **VerusID** — `createCommitment` → `registerIdentity` (incl. sub-IDs), then
  `updateIdentity` / `lockIdentity` / `unlockIdentity` / `revokeIdentity` /
  `recoverIdentity`, plus `signMessage` / `verifyMessage`.
- **Helpers** — `VerusSDK.generateWif()`, `deriveAddress(wif)`,
  `deriveIdentityAddress(name, parent?)`, `validateAddress`, `validateWif`;
  `utils.summarizeSignedTransaction(hex)` decodes a signed tx (txid, spent
  outpoints, addressed outputs) for your ledger.

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
| [transfers](./docs/transfers.md) | `transfer` / `transferToken` / `convert` / `sendCurrency`, UTXOs, change, re-validation |
| [VerusID lifecycle](./docs/identity.md) | commit → register, update, lock/unlock, revoke/recover, sign/verify messages |
| [signing & wire format](./docs/signing-and-wire.md) | why the bytes are the daemon's, the self-contained bundle, the proof rings |
| [testing](./docs/testing.md) | the gate, the plain-`node` rule, the live-proof ring model |

## Contributing

Issues and PRs welcome — start with [CONTRIBUTING.md](./CONTRIBUTING.md) for the
setup, the gate, and the two invariants that keep it trustworthy: amounts stay
`bigint`, and the wire bytes are proven against a real daemon. Security issues
(wrong bytes, amount precision, key handling): [SECURITY.md](./SECURITY.md).

Apache-2.0 · see [NOTICE](./NOTICE) for the bundled forks.
