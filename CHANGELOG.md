# Changelog

# [0.6.0](https://github.com/chainvue/verus-sdk/compare/v0.5.1...v0.6.0) (2026-07-18)


* feat!: require an explicit expiryHeight (0 = never expires) ([77f792b](https://github.com/chainvue/verus-sdk/commit/77f792bc901626f086b849f828193e335d4ec7bb))


### Bug Fixes

* assert value conservation on the identity registration path ([d066b5e](https://github.com/chainvue/verus-sdk/commit/d066b5e8cc6e347f30fa0e0b6ca1ea393287a25d))
* reject address/type mismatch in parseAddress (prevents i-address fund burn) ([1f91d79](https://github.com/chainvue/verus-sdk/commit/1f91d799b9ab10930cc6eac12e167ec4f9f68d6d))
* reject duplicate UTXO outpoints early with a typed error ([bbef70e](https://github.com/chainvue/verus-sdk/commit/bbef70ee727d9a463c1f50eca580dba2de12208b))
* reject malformed hex in identity contentMap instead of corrupting it ([fbc2431](https://github.com/chainvue/verus-sdk/commit/fbc2431cf4c9d82bb4b025fdfd66a9cb18f24c75))
* validateWif no longer accepts the Bitcoin-mainnet prefix (0x80) ([35f6286](https://github.com/chainvue/verus-sdk/commit/35f6286aba6ffabec538e0491b21abd71f587e52))


### BREAKING CHANGES

* `expiryHeight` is now required on transfer, transferToken,
convert, sendCurrency, buildAndSign, createCommitment, registerIdentity,
updateIdentity, lockIdentity, unlockIdentity, revokeIdentity, recoverIdentity,
and defineCurrency. Pass `currentBlockHeight + DEFAULT_EXPIRY_DELTA`, or 0 to
keep the previous never-expiring behavior.


## [0.5.1](https://github.com/chainvue/verus-sdk/compare/v0.5.0...v0.5.1) (2026-07-14)


### Bug Fixes

* **types:** ship self-contained declarations, drop skipLibCheck requirement ([2c6a428](https://github.com/chainvue/verus-sdk/commit/2c6a42864c3ba3e4d4fc0a96278fdb194dd8380d))

## [0.5.0](https://github.com/chainvue/verus-sdk/compare/v0.4.1...v0.5.0) (2026-07-14)

Exact-integer money: all satoshi amounts are now `bigint` end-to-end
(**BREAKING** — `CurrencyOutput.satoshis` takes bigint; `toSatoshis`/`toCoins`
are exact decimal-string ↔ bigint). `decodeUtxo` no longer silently
reclassifies a failed smart-output decode as native-only; `selectUtxos` fixes
the native double-subtraction. Adds boundary validation + typed errors, an
eslint flat config + stricter tsconfig, and Apache-2.0 licensing (+ NOTICE for
the bundled VerusCoin forks). See RISKS.md for the full migration log.

## 0.4.1 (2026-07-14) — packaging fix

- The inlined VerusCoin forks (@bitgo/utxo-lib, verus-typescript-primitives,
  bitcoin-ops) moved from `dependencies` to `devDependencies`: they are
  compiled INTO dist/bundle.js at build time and must not be installed by
  consumers. 0.4.0 still listed them as runtime deps, so strict installers
  (pnpm blockExoticSubdeps) rejected the transitive git dependency. Runtime
  `dependencies` are now exactly the six external npm packages the bundle
  keeps external (bn.js, bs58check, create-hash, ecpair, tiny-secp256k1, wif).
- Test fixture flake fixed (all-zeros coinbase txid in createCommitment).


## 0.4.0 (2026-07-14) — first public npm release (as @chainvue/verus-sdk)

Renamed from the working title @chainvue/verus-typescript-sdk to the
shorter @chainvue/verus-sdk before the first npmjs publish.

100% offline Verus transaction signing, live-proven against VRSCTEST.

- Self-contained publish bundle: the VerusCoin forks (utxo-lib, primitives,
  bitcoin-ops) are inlined — no `github:` dependencies in consumer installs.
- Mandatory funded-transfer validation in `sendCurrency` (utxo-lib's own
  validator; a selection/change bug throws instead of producing a bad tx).
- Identity lifecycle proven on-chain: daemon-free name commitment and
  registration (registration fee as implicit miner fee, exempt from the
  daemon's absurd-fee check), P2ID (identity-held funds) spending — ring 4
  live proof via the public gateway.
- `identityPaymentScript` (canonical pay-to-identity script, byte-identical
  to on-chain outputs), i-address change support in `sendCurrency`,
  `summarizeSignedTransaction` (txid, consumed outpoints, addressed outputs
  incl. P2ID payment outputs; structural outputs stay address:null).
- Registration no longer trips utxo-lib's client-side fee-rate cap
  (declared-fee bound; red/green regression with the live UTXO shape).

Known consumer caveat: submodule type declarations reference the inlined
forks' types — set `"skipLibCheck": true` until the declarations are rolled
up. Runtime is unaffected. See RISKS.md for the live-proof harness.
