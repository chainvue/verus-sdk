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

/** Default fee per KB in satoshis (0.0001 VRSC) */
export const DEFAULT_FEE_PER_KB = 10000;

/** Minimum output value (dust threshold) */
export const DUST_THRESHOLD = 546;

/** Default registration fee: 100 VRSC in satoshis */
export const DEFAULT_REGISTRATION_FEE = 10_000_000_000;

/** Default referral levels for identity registration */
export const DEFAULT_REFERRAL_LEVELS = 3;

/** CReserveTransfer VRSC fee (20000 sat = 0.0002 VRSC) */
export const RESERVE_TRANSFER_FEE = 20000;

/** Canonical eval pubkey address for EVAL_RESERVE_TRANSFER */
export const RESERVE_TRANSFER_EVAL_PKH = 'RTqQe58LSj2yr5CrwYFwcsAQ1edQwmrkUU';

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
