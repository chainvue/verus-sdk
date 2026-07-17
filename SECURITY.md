# Security Policy

## Supported versions

`@chainvue/verus-sdk` is pre-1.0. Only the latest published minor receives
security fixes; there are no backports to earlier lines.

| Version | Supported |
| --- | --- |
| latest `0.x` minor | ✅ |
| anything older | ❌ — upgrade |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately via GitHub's
[Report a vulnerability](https://github.com/chainvue/verus-sdk/security/advisories/new)
form, which opens a private advisory visible only to the maintainers.

Please include: the version, what an attacker (or a bug) can achieve, and a
reproduction. This SDK is **100% offline** — it needs no daemon, no network,
and no funds — so almost any issue can be reproduced with a generated key
(`VerusSDK.generateWif()`) and a synthetic UTXO. **Never paste a real WIF,
spending key, or any key that controls funds** into a report; a generated
throwaway key reproduces the same code path.

You can expect an acknowledgement within **7 days** and an assessment within
**30 days**. If a fix ships, the advisory is published with credit unless you
ask otherwise.

## What is in scope

This SDK holds key material in memory to sign transactions, and it serializes
the bytes a daemon will accept as-is. That makes three classes of bug a
security matter, not a nicety:

- **Wrong bytes on the wire.** Anything that makes a built transaction spend
  the wrong output, pay the wrong address, send the wrong amount, or serialize
  to a form the daemon misinterprets. Serialization uses VerusCoin's own
  primitives specifically so the wire format is the daemon's, not a reimpl — a
  divergence here is treated as a vulnerability. Every built transfer is also
  re-validated against its intent (per-currency value conservation, change to
  the declared address) before the hex is returned; a hole in that check is in
  scope.
- **Amount precision.** Satoshi amounts are `bigint` end to end; the only
  checked crossing into the float64-modelled signing library is
  `toSafeNumber(sats)` (`src/utils/index.ts`), which throws outside
  `[0, 2^53]`. Anything that routes a value through a JS `number`, rounds via
  `Math.round(coins * 1e8)`, or otherwise loses satoshis is in scope — it is
  the core promise of the package.
- **Key-material handling.** A WIF, a private key, or a signature nonce
  appearing anywhere the library writes (an error message, a thrown value, a
  returned object it shouldn't be in), or a signing routine that leaks or
  reuses entropy. Note: the SDK does not log; if you find it emitting key
  bytes, that is a vulnerability.
- **Supply chain.** Anything in the published tarball that is not built from
  this repository at the tagged commit. Releases publish with npm provenance
  via OIDC trusted publishing; the attestation is verifiable on npm. The
  bundled VerusCoin forks (utxo-lib, primitives, bitcoin-ops) are inlined and
  credited in [`NOTICE`](./NOTICE) — a bundle that diverges from what `NOTICE`
  claims is in scope.

## What is out of scope

- **Broadcasting, key storage, and RNG at the application layer.** The SDK
  signs bytes; it does not broadcast, persist keys, or manage a wallet. How you
  store a WIF, seed your RNG, and reach a daemon is your deployment's
  responsibility. `VerusSDK.generateWif()` uses the platform CSPRNG — running it
  in an environment without one is a deployment concern.
- **Vulnerabilities in `verusd` or the bundled VerusCoin forks themselves.**
  Report daemon issues to
  [VerusCoin/VerusCoin](https://github.com/VerusCoin/VerusCoin). Where the
  daemon or a fork misbehaves in a way this SDK must work around, we document
  the quirk next to the affected code.
- **Trusting inputs you supply.** Feeding the SDK UTXOs from an untrusted
  source, or signing a transaction you didn't construct, is an application
  concern — though a bug that lets crafted *input* corrupt an *unrelated* output
  is in scope.
