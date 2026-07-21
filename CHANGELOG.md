# Changelog

# [0.14.0](https://github.com/chainvue/verus-sdk/compare/v0.13.0...v0.14.0) (2026-07-21)


### Bug Fixes

* **currency:** enforce the daemon's consensus limits offline ([4dd42b3](https://github.com/chainvue/verus-sdk/commit/4dd42b32b6dc32213d21e339f7f555ca45f0e34b))
* **currency:** harden input validation (review pass) ([5ba050e](https://github.com/chainvue/verus-sdk/commit/5ba050ec1c31434085ac5e73e0f3d4737da70691))
* **transfer:** reject mintnew combined with convert/preconvert/burn ([5152712](https://github.com/chainvue/verus-sdk/commit/5152712515402924ed01f613009a125ee4196362))


### Features

* **currency:** offline currency creation — definition, launch tx, preconvert, NFT ([a5553ea](https://github.com/chainvue/verus-sdk/commit/a5553eaf545529125261e62db2765b7d06fd7066))
* **transfer:** mint and burn a centralized currency via sendCurrency ([c36e532](https://github.com/chainvue/verus-sdk/commit/c36e532de5e28976da359497298e26d6a5a2394e))

# [0.13.0](https://github.com/chainvue/verus-sdk/compare/v0.12.0...v0.13.0) (2026-07-20)


### Bug Fixes

* **identity:** drop non-authority signatures when merging a multisig update ([999513a](https://github.com/chainvue/verus-sdk/commit/999513abcf2456e6a9a0d7a0bf6b3c75a6237c51))


### Features

* **identity:** m-of-n multisig VerusID updates (offline partial signing) ([a84c1c9](https://github.com/chainvue/verus-sdk/commit/a84c1c900766d94e7606aac77974347fe838ba8c)), closes [hi#level](https://github.com/hi/issues/level)

# [0.12.0](https://github.com/chainvue/verus-sdk/compare/v0.11.0...v0.12.0) (2026-07-20)


### Bug Fixes

* **offers:** reject non-P2PKH fee UTXOs across all taker fee funding ([3b16e1a](https://github.com/chainvue/verus-sdk/commit/3b16e1aa35ab904b18571ef288cae22cb2be1d4a))


### Features

* **offers:** reclaim an unaccepted offer (buildReclaimOffer) ([5816935](https://github.com/chainvue/verus-sdk/commit/58169351f43a0907ce61c07afaed967579140418))

# [0.11.0](https://github.com/chainvue/verus-sdk/compare/v0.10.0...v0.11.0) (2026-07-20)


### Bug Fixes

* **offers:** harden identity-offer taker; address review findings ([01e0955](https://github.com/chainvue/verus-sdk/commit/01e0955357371b3f33ae5b586b774d7ffeeda117))
* **offers:** require a real future expiryHeight on an offer (live finding) ([0ee5382](https://github.com/chainvue/verus-sdk/commit/0ee5382d73549c9177d4431aa3ff009eb32389d0))


### Features

* **offers:** add the SIGHASH_SINGLE|ANYONECANPAY offer-input signer (Phase 3, brick 1) ([44aec56](https://github.com/chainvue/verus-sdk/commit/44aec56cd4ed77a60644327515f2851c1b413dd8))
* **offers:** buy a VerusID with currency (5b, brick 2) ([734ceeb](https://github.com/chainvue/verus-sdk/commit/734ceeba955de30d05c2527bcff802c08140fbc4))
* **offers:** expose the offers suite on the public API ([b12a307](https://github.com/chainvue/verus-sdk/commit/b12a307db228a6abf32de2e2bd1952dd3cd18c39))
* **offers:** generalize the taker to all four currency combos (5a, brick 2) ([633f8cf](https://github.com/chainvue/verus-sdk/commit/633f8cf48103de22c332646538c10bbe1776da2d))
* **offers:** native-coin maker flow — funding + offer tx (Phase 3, brick 2) ([5b07acb](https://github.com/chainvue/verus-sdk/commit/5b07acb5dbf71c29ffeb81f35f218285cced2444))
* **offers:** native-for-token taker flow — completeOffer (Phase 4, brick 2) ([7eed2cc](https://github.com/chainvue/verus-sdk/commit/7eed2ccc106380fc92beda6d793ac4d2cff1ebee))
* **offers:** offer a token — token-commitment funding (5a, brick 1) ([b904cf9](https://github.com/chainvue/verus-sdk/commit/b904cf9b90e4c08a55de2ed6f037a5d35c5d298d))
* **offers:** selective taker-input signer (Phase 4, brick 1) ([74ae6e6](https://github.com/chainvue/verus-sdk/commit/74ae6e61a0956f92beac8bd8875ee5dffa1c6983))
* **offers:** sell a VerusID for currency (5b, brick 1) ([33356ad](https://github.com/chainvue/verus-sdk/commit/33356adc98cfbd8e1c4496c199c89adc2f92017e))
* **offers:** swap a VerusID for a VerusID (5c) ([c22652e](https://github.com/chainvue/verus-sdk/commit/c22652ebb2d9a1b7e7e460c7ecc90cfe7159efa1))

# [0.10.0](https://github.com/chainvue/verus-sdk/compare/v0.9.0...v0.10.0) (2026-07-19)


* feat!: curate the identity power-user namespace (Phase 4) ([ee50536](https://github.com/chainvue/verus-sdk/commit/ee505365c7f62df0ac9b28a13e9dc720fa1509f5))
* feat!: drop the dead number-money domain types (Phase 4) ([877549d](https://github.com/chainvue/verus-sdk/commit/877549daef75770fc3c366b555463c74668fd848))


### Bug Fixes

* **assemble:** fail closed on a leading input carrying native value (Phase 5 hardening) ([76e3a44](https://github.com/chainvue/verus-sdk/commit/76e3a443d847d29b4b7fc760291d9de0abe6c02e)), closes [#4](https://github.com/chainvue/verus-sdk/issues/4)
* **assemble:** fail closed on a leading input carrying token value (Phase 5 hardening) ([a0f5013](https://github.com/chainvue/verus-sdk/commit/a0f5013d077ef8929b9118f95bbdea4dbea88a62))
* **assemble:** guard identityUtxo against token value (Phase 5 hardening) ([950a127](https://github.com/chainvue/verus-sdk/commit/950a1270779ff37e8818d5277207b28b873748b3))
* **fork:** close the require() hole in fork containment ([9f8aa95](https://github.com/chainvue/verus-sdk/commit/9f8aa95ff288104d0bc5dd4851976f30451c9b74))


### BREAKING CHANGES

* the `identity` namespace no longer exposes the internal script
builders / serializers / asserts (buildCommitmentScript, buildReservationScript,
buildIdentityScript, buildP2IDScript, identityPaymentScript,
buildReferralPaymentScript, buildRegistrationFeeOutput, buildTokenChangeOutput,
createIdentityObject, calculateCommitmentHash, serializeCommitmentHash,
serializeNameReservation, serializeAdvancedNameReservation, assertAddressVersion,
assertWifIsPrimary). Use the VerusSDK facade or the curated namespace.

Gate green (301 passed), goldens unchanged.
* the CurrencyBalance, Transaction, TransactionDirection,
VerusIdentity, and ConversionQuote type exports are removed. They were never
populated by any SDK function; nothing that signs a transaction is affected.

Gate green (301 passed), all golden snapshots unchanged (type-only change).

# [0.9.0](https://github.com/chainvue/verus-sdk/compare/v0.8.0...v0.9.0) (2026-07-19)


* feat(identity)!: lockIdentity takes a relative unlockDelayBlocks, not an absolute height ([647a621](https://github.com/chainvue/verus-sdk/commit/647a621c11d45d6d6d50aff956d82b8d347827c7))


### Bug Fixes

* **identity:** contentMap update replaces the whole map instead of merging ([3e8335d](https://github.com/chainvue/verus-sdk/commit/3e8335ddb65fae9dab863f16725256960bd22b7b))
* **identity:** enforce min_sigs on identity update/recover (fail closed) ([5b03b12](https://github.com/chainvue/verus-sdk/commit/5b03b128d64b58fa424b9f36482c6506f4694b90))
* **identity:** reject referrals on sub-ID name commitments (fail closed) ([93240b4](https://github.com/chainvue/verus-sdk/commit/93240b4fd3d8370b375240d0b949bd597bffeff0))
* **identity:** require nativeImportFee for sub-ID registration (no silent 0 default) ([91117aa](https://github.com/chainvue/verus-sdk/commit/91117aa65718e9bf40a56258d90f0729e543ced4))
* **identity:** sub-ID fee output structure depends on the parent's proofprotocol ([a23e3c7](https://github.com/chainvue/verus-sdk/commit/a23e3c70e6ea6c746a76f46dbd12ff49f34e98c6))
* **identity:** validate contentMap keys/values; forward minSigs on recoverIdentity ([8f12c6f](https://github.com/chainvue/verus-sdk/commit/8f12c6fb7ddfe850f859cbbce5219ca94b2f7002))
* **identity:** verify the WIF controls the name commitment before step-2 registration ([1cac42d](https://github.com/chainvue/verus-sdk/commit/1cac42decd9caf9a72e7c5347d851abd3d51cdfe))
* **keys:** validate WIF prefix in wifToPrivateKey / isCompressedWif ([8d1e122](https://github.com/chainvue/verus-sdk/commit/8d1e1222c3b79559af03c91ac61a146a03f31362))
* **signing:** createTransactionBuilder requires an explicit, validated expiryHeight ([241f435](https://github.com/chainvue/verus-sdk/commit/241f435be03243600086185a2af2b9756ffdd08d))
* **transfer:** enforce native value conservation on sendCurrency and name commitment ([a609322](https://github.com/chainvue/verus-sdk/commit/a609322cdc5d5346871a1e936bb21bc14f3a637e))
* **utxo:** reject a native-currency (systemId) entry in requiredCurrencies ([cfd45ed](https://github.com/chainvue/verus-sdk/commit/cfd45ed3ec870cf8e02b7e6bd524e0faeb9faa7d))


### BREAKING CHANGES

* **identity:** sub-ID registration now requires params.parentProofProtocol.

Regression tests: pp-2 fee is a reserve output (0 native); pp-1 fee is a
CReserveTransfer (0.0002 native) byte-matching the fum on-chain output.

Found by the Fable veteran review (identity:498); verified live against fum (pp 1).
* **signing:** createTransactionBuilder's network and expiryHeight parameters
are now required (no defaults).

Regression tests: explicit height / explicit 0 build; a timestamp-sized or
negative height throws. Also adds first coverage for resolveExpiryHeight.

Found by the Fable veteran review (signing:170).
* LockIdentityParams.unlockAfter is renamed to unlockDelayBlocks
and is a relative delay in blocks, not an absolute block height.

Regression tests: a normal delay locks; a missing delay throws; a block-height-
sized delay throws without sanityOverride and builds with it.

Found by the Fable veteran review (lockIdentity absolute-vs-relative).

# [0.8.0](https://github.com/chainvue/verus-sdk/compare/v0.7.0...v0.8.0) (2026-07-19)


### Bug Fixes

* **identity:** make buildP2IDScript emit the chain-valid CC script, not an invalid template ([f7b6d5c](https://github.com/chainvue/verus-sdk/commit/f7b6d5c8ab07412e48ee5833e81d517680f9f897))
* **identity:** reject R-address parent in deriveIdentityAddress / name commitment ([cf58cd1](https://github.com/chainvue/verus-sdk/commit/cf58cd18cf8f49cb42432425d0d0859ac3fdd6b0))
* **identity:** size sub-ID registration fee from real output bytes ([838755c](https://github.com/chainvue/verus-sdk/commit/838755cfba749c7bfdc7b55d1094cf94fe3bab21))
* **identity:** stop burning token value on commitment and VRSC registration funding ([b46fc86](https://github.com/chainvue/verus-sdk/commit/b46fc86e3f722468c9831b9ca848968bfbc2dec4)), closes [#5](https://github.com/chainvue/verus-sdk/issues/5)
* **identity:** validate parent and systemId are i-addresses in createIdentityObject ([392a896](https://github.com/chainvue/verus-sdk/commit/392a896881ba8ea2d4d3bf2bf255876b8179a9dd))
* **utxo:** add independent token conservation guard to identity/currency/sub-ID paths ([7323c6f](https://github.com/chainvue/verus-sdk/commit/7323c6f9ea37d619dacdb49a1211a55769526897))


### Features

* **core:** add branded address types + parse-don't-validate constructors (Phase 1.1) ([ab6184d](https://github.com/chainvue/verus-sdk/commit/ab6184dedd9cfbcd92b0060f04b68ddef24085b4))

# [0.7.0](https://github.com/chainvue/verus-sdk/compare/v0.6.3...v0.7.0) (2026-07-18)


* feat(message)!: accept daemon-format signatures, require explicit blockHeight, validate identity address ([82bfb94](https://github.com/chainvue/verus-sdk/commit/82bfb94643a2b157f3ff7d4ec0f5344a4bc7e3a9)), closes [#3](https://github.com/chainvue/verus-sdk/issues/3) [#8](https://github.com/chainvue/verus-sdk/issues/8)


### Bug Fixes

* assert native value conservation on sub-ID registration ([64f12ad](https://github.com/chainvue/verus-sdk/commit/64f12ada8b071db937964bedc3826fedca33f339))
* **identity:** build sub-ID registration fee as a reserve output, not a reserve transfer ([c655b9f](https://github.com/chainvue/verus-sdk/commit/c655b9f892778e27f4fa457e8d81da7726bb8e6d)), closes [#1](https://github.com/chainvue/verus-sdk/issues/1)
* **identity:** validate signer controls identity and referrals are i-addresses ([a55137c](https://github.com/chainvue/verus-sdk/commit/a55137c1f8efa4ea96cd28bf69b1bc0393acaa38)), closes [#4](https://github.com/chainvue/verus-sdk/issues/4) [#5](https://github.com/chainvue/verus-sdk/issues/5)
* **keys:** reject malformed WIF compression flag and non-20-byte address payloads ([298b455](https://github.com/chainvue/verus-sdk/commit/298b455408d452d4aa3d407b18c79b1084bc5240)), closes [#6](https://github.com/chainvue/verus-sdk/issues/6) [#7](https://github.com/chainvue/verus-sdk/issues/7)


### BREAKING CHANGES

* signMessage now throws if blockHeight is omitted; pass the
current chain height (or an explicit 0 for a signature never verified on-chain).


## [0.6.3](https://github.com/chainvue/verus-sdk/compare/v0.6.2...v0.6.3) (2026-07-18)


### Bug Fixes

* assert native value conservation on identity update and currency define ([2ee0199](https://github.com/chainvue/verus-sdk/commit/2ee019954dcbb846d75387963a9b6cf25bbbf17b))

## [0.6.2](https://github.com/chainvue/verus-sdk/compare/v0.6.1...v0.6.2) (2026-07-18)


### Bug Fixes

* build native change to an i-address via P2ID in all identity/currency flows ([14f5434](https://github.com/chainvue/verus-sdk/commit/14f543464a5d0f5351238a6fd68d533033fce0d7))
* control the name commitment with the WIF, not changeAddress ([b914e9c](https://github.com/chainvue/verus-sdk/commit/b914e9cef8c9b41fcf6c960b8c68c64921d128a7))
* validate contentMultimap keys and defineCurrency inputs at the boundary ([4278a3d](https://github.com/chainvue/verus-sdk/commit/4278a3d75e8cc8d634724ba1159a8e7dfa51a11e))
* verify WIF control for self-authority revoke/recover ([c8e240a](https://github.com/chainvue/verus-sdk/commit/c8e240aeeaa620c92bf7bd46288ca86fc82061af))

## [0.6.1](https://github.com/chainvue/verus-sdk/compare/v0.6.0...v0.6.1) (2026-07-18)


### Bug Fixes

* fund a non-native feeCurrency in sendCurrency selection ([8c55df0](https://github.com/chainvue/verus-sdk/commit/8c55df003f8c4f729f23fa0a32918bba9f9e31be))
* fund the discounted issuer fee for a referred registration (stop overpaying) ([8ecfe6b](https://github.com/chainvue/verus-sdk/commit/8ecfe6b757460e5d19e2c5d4f3abb55c2327c3d1))
* reject a value-bearing identityUtxo instead of burning it to fee ([7c63a7f](https://github.com/chainvue/verus-sdk/commit/7c63a7f4c0a87c7478ef062bc7d46c4d051ab75d))
* reject out-of-range identity/transaction parameters at the boundary ([80f027f](https://github.com/chainvue/verus-sdk/commit/80f027f46e30a4a489d40382f9c06a3c83ae715d))
* require a non-zero expiryHeight for identity unlock ([452b48e](https://github.com/chainvue/verus-sdk/commit/452b48e5854b728f1c4b424536866c0bff2ea157))
* return token change from mixed UTXOs spent for native value ([96e7901](https://github.com/chainvue/verus-sdk/commit/96e7901582c09ac6e2915f3d7ab59ebacd307441))
* size the fee from real output bytes for large identity/currency outputs ([b8d3e0b](https://github.com/chainvue/verus-sdk/commit/b8d3e0bb26c83afe9959a2db11cf90bc969883e7))
* validate contentMultimap hex like contentMap (prevents silent corruption) ([08f51bf](https://github.com/chainvue/verus-sdk/commit/08f51bf147469058ce4a715ea0846247d49e1a51)), closes [#4](https://github.com/chainvue/verus-sdk/issues/4)
* validate ETH destination hex explicitly (no silent truncation) ([f0dd177](https://github.com/chainvue/verus-sdk/commit/f0dd1770ab67b0bfa3c475f049f42b95eca0e20a))
* validate identity address kinds and route i-address token change correctly ([29d5f06](https://github.com/chainvue/verus-sdk/commit/29d5f067e6ef956833f23285b5ba1d3a39e9e0af))
* verify the WIF controls the identity before signing an update/lock/unlock ([b84bee8](https://github.com/chainvue/verus-sdk/commit/b84bee850e172145b4b74199507c4f30ad1b09c6))

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
