# Seed phrases — Verus Mobile / Verus Desktop compatibility

A seed phrase from Verus Mobile or Verus Desktop can be used directly with this
SDK: it derives the same key, and therefore the same R-address, that the wallet
shows you.

```ts
import { keys, VerusSDK } from "@chainvue/verus-sdk";

const address = await VerusSDK.deriveAddressFromSeed(phrase); // compare this to your wallet
const wif = VerusSDK.seedToWif(phrase);                       // hand to any signing call
```

Also available as `keys.seedToPrivateKey` / `keys.seedToWif` / `keys.seedToAddress`.

The derivation was confirmed against a live Verus Mobile wallet on 2026-07-27:
a phrase generated in the app derives the same R-address the app displays. The
test suite locks it in with known-answer vectors and a differential run through
`@bitgo/utxo-lib` — the same fork Verus Mobile itself derives with.

**Still check your own address before you rely on it.** Derive it, compare it to
the receiving address your wallet displays, and only then move funds. That takes
ten seconds and is the only proof that your phrase, your wallet version, and
this SDK agree.

The network is irrelevant here: `networks.verus` and `networks.verustest` carry
the same version bytes (`pubKeyHash` 0x3c, `wif` 0xbc), so one phrase gives the
same R-address on VRSC and VRSCTEST. These functions take no network argument.
The network only matters when you build transactions, where the `chainId`
differs.

## One seed is one key — Verus is not HD

Verus wallets are **not** hierarchical-deterministic. There is no account, no
change chain, no address index, and no BIP32/BIP39/BIP44 derivation anywhere in
the ecosystem. A phrase maps to exactly one key, and that key is the same on
every Verus-family chain.

The convention comes from Agama/Iguana and lives in `agama-wallet-lib/keys.js`
(`seedToWif`), shared by Verus Mobile and Verus Desktop:

```
bytes = sha256(utf8(phrase))
bytes[0]  &= 248
bytes[31] &= 127
bytes[31] |= 64          // the "iguana" clamp — always applied
key = compressed secp256k1 key from bytes
```

Verus Mobile passes `iguana = true` from every call site, in both derivation
versions (`deriveKeyPairV1` → `deriveElectrumKeypair`, and the legacy
`deriveKeypairV0`), so for a phrase input both versions agree. This SDK applies
the clamp unconditionally for the same reason: an unclamped key is one no Verus
wallet would ever show a user.

A consequence worth internalizing: **a BIP39 phrase is hashed as text**. The
words are not run through BIP39/BIP32 — the same twelve words produce a
different address in a Bitcoin-style HD wallet than they do here and in Verus
Mobile. Do not cross-import between the two.

## Exact input handling

The phrase is hashed **verbatim**, matching the wallets:

- no trimming, no case folding, no Unicode normalization
- no BIP39 word-list validation — any non-WIF string is a legal seed
- whitespace is significant: `"my seed"` and `"my  seed"` are different keys

Two deliberate deviations from the wallets, both fail-closed:

| Input | Wallets | This SDK |
|---|---|---|
| a WIF private key | routed to `wifToWif` (treated as a key) | throws `InvalidSeedError` — use `keys.wifToAddress` |
| empty / whitespace-only | hashed happily | throws `InvalidSeedError` |

Hashing a WIF or an unset config value would derive a valid-looking address the
user does not control. The empty-seed address in particular is a well-known
constant that anyone can watch.

## Security — read this before generating anything

The derivation is a **single unsalted SHA-256** over the phrase text: no
PBKDF2, no salt, no key stretching. All of the security rests on the entropy of
the phrase itself, and a guessable phrase is cheap to brute-force offline.

That is the ecosystem's format, not a choice this SDK makes; it is implemented
so that keys users already hold keep working. Accordingly, this SDK will import
a phrase but never generate one:

- **Do not invent a passphrase.** Use a phrase a Verus wallet generated.
- To create a fresh key for a new wallet, use `VerusSDK.generateWif()` — it
  draws 32 bytes straight from the platform CSPRNG, with no phrase in the
  middle.
- The iguana clamp fixes 5 bits of the key, so a derived key carries at most
  251 bits of entropy. Irrelevant next to phrase entropy; noted for
  completeness.

## Multiple keys from one seed — don't

The obvious next step from "seed" is "derive key 0, key 1, key 2…". Resist it:

- There is no Verus HD convention to be compatible with, and no SLIP-44 coin
  type is registered for Verus, so any derivation path is invented.
- `verusd` has no transparent HD wallet (Zcash lineage — t-keys are a random
  keypool). No daemon can recover such keys; recovery would depend on this
  SDK's code existing forever.
- The one Verus use case that genuinely needs several keys — a VerusID's
  primary, revocation, and recovery addresses — is the case where a shared
  master seed is actively wrong. Those roles exist to be held in separate
  custody.

Keys can be kept separate the ordinary way: one WIF per role, backed up
separately.
