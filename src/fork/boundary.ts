/**
 * The single boundary to the bundled Verus forks (@bitgo/utxo-lib +
 * verus-typescript-primitives).
 *
 * These forks are the only way to speak Verus smart transactions, but they are a
 * hazardous surface: money is modeled as `number`, addresses are version-blind
 * (fromAddress launders the version byte), errors are untyped, and the base is a
 * ~2018-era bitcoinjs API. Containing every import here means the rest of the SDK
 * builds on a controlled re-export instead of touching the raw fork in six
 * places. An ESLint `no-restricted-imports` rule forbids importing the forks
 * anywhere outside this directory, so a new direct import is a lint failure.
 *
 * This module deliberately re-exports the fork surface verbatim (no wrapping) for
 * now; typed adapters (toSafeNumber crossing, error wrapping) can be added here
 * incrementally without touching call sites.
 */
// verus-typescript-primitives is the source of truth for the shared CC types
// (OptCCParams, TxDestination, …); @bitgo/utxo-lib re-declares some of them, so
// only its own transaction/crypto surface is re-exported explicitly to avoid the
// ambiguity.
export * from 'verus-typescript-primitives';
export {
  TransactionBuilder,
  Transaction,
  smarttxs,
  ECPair,
  IdentitySignature,
  networks,
  script,
  opcodes,
  address,
  // CryptoCondition signature fulfillments — needed to sign an offer input with
  // SIGHASH_SINGLE|ANYONECANPAY, which the fork's txb.sign hardcodes to
  // SIGHASH_ALL (so the offer fulfillment is built explicitly, see src/offers).
  SmartTransactionSignatures,
  SmartTransactionSignature,
} from '@bitgo/utxo-lib';
