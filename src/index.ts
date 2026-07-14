/**
 * @chainvue/verus-sdk
 *
 * 100% offline, fully typed TypeScript SDK for Verus transaction signing.
 */

// Main facade
export { VerusSDK } from './VerusSDK.js';

// All public types
export type {
  Utxo,
  DecodedUtxo,
  SelectionResult,
  VerusSDKConfig,
  SignedTxResult,
  TransferParams,
  TransferTokenParams,
  ConvertParams,
  CurrencyOutput,
  SendCurrencyParams,
  SendCurrencyResult,
  BuildAndSignParams,
  CommitmentData,
  CreateCommitmentParams,
  CreateCommitmentResult,
  RegisterIdentityParams,
  RegisterIdentityResult,
  UpdateIdentityParams,
  UpdateIdentityResult,
  LockIdentityParams,
  UnlockIdentityParams,
  RevokeIdentityParams,
  RecoverIdentityParams,
  DefineCurrencyParams,
  DefineCurrencyResult,
  SignMessageParams,
  SignMessageResult,
  VerifyMessageParams,
  VerifyMessageResult,
  // Shared domain types
  CurrencyBalance,
  TransactionDirection,
  Transaction,
  VerusIdentity,
  ConversionQuote,
} from './types/index.js';

// Currency classification (also available via currency namespace)
export { classifyCurrency, CURRENCY_TYPE_ORDER } from './currency/classify.js';
export type { CurrencyType } from './currency/classify.js';

// Address utilities (also available via address namespace)
export {
  BASE58_RE,
  isRAddress,
  isIAddress,
  isVerusAddress,
  isIdentityName,
} from './address/index.js';

// Unit conversions (also available via utils namespace)
export {
  parseSats,
  toSatoshis,
  toCoins,
  toSafeNumber,
  SATS_PER_COIN,
  AMOUNT_DECIMALS,
} from './utils/index.js';

// Typed errors
export {
  VerusError,
  InsufficientFundsError,
  InvalidWifError,
  InvalidAddressError,
  InvalidNameError,
  TransactionBuildError,
  InvalidAmountError,
} from './errors.js';

// Constants
export {
  NETWORK_CONFIG,
  VERSION_GROUP_ID,
  CONSENSUS_BRANCH_ID,
  TX_VERSION,
  DEFAULT_FEE_PER_KB,
  DUST_THRESHOLD,
  DEFAULT_REGISTRATION_FEE,
  DEFAULT_REFERRAL_LEVELS,
  RESERVE_TRANSFER_FEE,
  PUBKEY_HASH_PREFIX,
  SCRIPT_HASH_PREFIX,
  WIF_PREFIX,
  I_ADDR_VERSION,
  IDENTITY_FLAG_ACTIVECURRENCY,
  IDENTITY_FLAG_LOCKED,
  HASH_SHA256,
} from './constants/index.js';
export type { Network } from './constants/index.js';

// Submodules for power users
export * as address from './address/index.js';
export * as keys from './keys/index.js';
export * as signing from './signing/index.js';
export * as utxo from './utxo/index.js';
export * as identity from './identity/index.js';
export * as transfer from './transfer/index.js';
export * as message from './message/index.js';
export * as currency from './currency/index.js';
export * as utils from './utils/index.js';
