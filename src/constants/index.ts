/**
 * Verus protocol constants and network configuration
 */

export type Network = 'mainnet' | 'testnet';

export const NETWORK_CONFIG = {
  mainnet: {
    chainId: 'i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV',
    pubKeyHash: 0x3c,
    scriptHash: 0x55,
    wif: 0xbc,
  },
  testnet: {
    chainId: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
    pubKeyHash: 0x3c,
    scriptHash: 0x55,
    wif: 0xbc,
  },
} as const;

/** Sapling consensus branch ID */
export const CONSENSUS_BRANCH_ID = 0x76b809bb;

/** Sapling version group ID */
export const VERSION_GROUP_ID = 0x892f2085;

/** Default transaction version */
export const TX_VERSION = 4;

/**
 * The daemon's standard transaction fee unit: 10000 sat = 0.0001 VRSC. A
 * CONSTANT, not a rate — VerusCoin charges it once per output, never per byte
 * (wallet.h:51 `static const CAmount DEFAULT_TRANSACTION_FEE = 0.0001 * COIN;`
 * with COIN = 100000000, amount.h:16). See `src/fee/index.ts` for the rule it
 * feeds.
 */
export const DEFAULT_TRANSACTION_FEE = 10_000n;

/** Minimum output value (dust threshold) */
export const DUST_THRESHOLD = 546n;

/** Default registration fee: 100 VRSC in satoshis */
export const DEFAULT_REGISTRATION_FEE = 10_000_000_000n;

/** Default referral levels for identity registration */
export const DEFAULT_REFERRAL_LEVELS = 3;

/**
 * The SAME-CHAIN `CReserveTransfer` fee floor: 20,000 sat = 0.0002 VRSC.
 *
 * `CReserveTransfer::CalculateTransferFee` (`src/pbaas/reserves.cpp:24-31`) is
 * `(DEFAULT_PER_STEP_FEE << 1) + (DEFAULT_PER_STEP_FEE << 1) * (destSize /
 * DESTINATION_BYTE_DIVISOR)` with `DEFAULT_PER_STEP_FEE = 10000` and
 * `DESTINATION_BYTE_DIVISOR = 128`. Every destination this SDK builds is 20
 * bytes, so the size term is 0 and the fee is a flat 20,000. The same-chain
 * consensus check (`src/pbaas/pbaas.cpp`) rejects strictly *below* this, so
 * exactly 20,000 is accepted.
 *
 * NOT a universal transfer fee:
 * - It is a floor, not a promise of the exact charge — the daemon re-denominates
 *   the fee into the conversion's currency, so a live conversion can settle at
 *   e.g. 20,010 (see `test/currency-reserve-transfer.test.ts`). Chain state
 *   decides; 20,000 is what the SDK guards.
 * - It does NOT apply cross-chain. An `exportTo` transfer is priced by the
 *   destination system's `GetTransactionImportFee()` (order of 1,000,000 sat for
 *   the ETH gateway), which an offline SDK cannot read — `sendCurrency` requires
 *   an explicit `feeSatoshis` there instead of defaulting.
 * - A destination of 128 bytes or more (a gateway leg) adds another 20,000 per
 *   128-byte step. This SDK builds no such destination.
 */
export const RESERVE_TRANSFER_FEE = 20_000n;

/** Canonical eval pubkey address for EVAL_RESERVE_TRANSFER */
export const RESERVE_TRANSFER_EVAL_PKH = 'RTqQe58LSj2yr5CrwYFwcsAQ1edQwmrkUU';

/**
 * Default number of blocks after the chain tip at which a transaction expires,
 * matching the daemon's own wallet convention. Compute an expiryHeight as
 * `currentBlockHeight + DEFAULT_EXPIRY_DELTA`. (This SDK is offline and cannot
 * read the tip, so the caller supplies the height.)
 */
export const DEFAULT_EXPIRY_DELTA = 20;

/** Identity version byte for i-addresses */
export const I_ADDR_VERSION = 102; // 0x66

/** PubKeyHash prefix for R-addresses */
export const PUBKEY_HASH_PREFIX = 0x3c;

/** ScriptHash prefix */
export const SCRIPT_HASH_PREFIX = 0x55;

/** WIF prefix for Verus keys */
export const WIF_PREFIX = 0xbc;

/** Identity flag: active currency defined */
export const IDENTITY_FLAG_ACTIVECURRENCY = 0x1;

/** Identity flag: locked */
export const IDENTITY_FLAG_LOCKED = 0x2;

/** Hash type for IdentitySignature */
export const HASH_SHA256 = 5;
