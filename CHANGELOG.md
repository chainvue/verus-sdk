# Changelog

## 0.4.0 (2026-07-14) — first public npm release

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
