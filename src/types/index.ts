/**
 * Public type definitions for @chainvue/verus-sdk
 */

import type { Network } from '../constants/index.js';

/** UTXO as provided by an external data source (getaddressutxos) */
export interface Utxo {
  txid: string;
  outputIndex: number;
  satoshis: bigint;
  script: string;
  /** Height where this UTXO was created (0 = mempool) */
  height?: number;
}

/** Decoded currency values on a UTXO */
export interface DecodedUtxo extends Utxo {
  /** Currency i-address → satoshi amount */
  currencyValues: Map<string, bigint>;
}

/** Result of UTXO selection */
export interface SelectionResult {
  /** Selected UTXOs */
  selected: Utxo[];
  /** Native (VRSC) change in satoshis */
  nativeChange: bigint;
  /** Currency changes: i-address → satoshi amount */
  currencyChanges: Map<string, bigint>;
  /** Estimated fee in satoshis */
  fee: bigint;
}

/** SDK configuration */
export interface VerusSDKConfig {
  network: Network;
}

/** Common result fields for signed transactions */
export interface SignedTxResult {
  signedTx: string;
  txid: string;
  fee: bigint;
}

/** Transfer parameters */
export interface TransferParams {
  wif: string;
  /** Recipient address (R-address) */
  to: string;
  /** Amount in satoshis */
  amount: bigint;
  utxos: Utxo[];
  changeAddress: string;
  expiryHeight: number;
}

/** Token transfer parameters */
export interface TransferTokenParams {
  wif: string;
  /** Recipient address (R-address or i-address) */
  to: string;
  /** Amount in satoshis */
  amount: bigint;
  /** Currency i-address */
  currency: string;
  /** Address type: 'PKH' (R-address) or 'ID' (i-address) */
  addressType?: 'PKH' | 'ID';
  utxos: Utxo[];
  changeAddress: string;
  expiryHeight: number;
}

/** Currency conversion parameters */
export interface ConvertParams {
  wif: string;
  /** Amount in satoshis */
  amount: bigint;
  /** Source currency i-address */
  currency: string;
  /** Target currency i-address */
  convertTo: string;
  /** Intermediary currency for reserve-to-reserve (optional) */
  via?: string;
  utxos: Utxo[];
  changeAddress: string;
  expiryHeight: number;
}

/** Full send_currency output specification */
export interface CurrencyOutput {
  /** Currency i-address (use system ID for native VRSC) */
  currency: string;
  /** Amount in satoshis */
  satoshis: bigint;
  /** Recipient address */
  address: string;
  /** Address type: 'PKH' (R-address), 'ID' (i-address), 'ETH' (Ethereum) */
  addressType?: 'PKH' | 'ID' | 'ETH';
  /** Currency i-address to convert to */
  convertTo?: string;
  /** System i-address to export to (cross-chain) */
  exportTo?: string;
  /** Intermediary currency for reserve-to-reserve */
  via?: string;
  /** Bridge currency ID */
  bridgeId?: string;
  /** Fee currency i-address */
  feeCurrency?: string;
  /** Fee amount in satoshis */
  feeSatoshis?: bigint;
  /** Pre-conversion flag */
  preconvert?: boolean;
}

/** Full send_currency parameters */
export interface SendCurrencyParams {
  wif: string;
  outputs: CurrencyOutput[];
  utxos: Utxo[];
  changeAddress: string;
  expiryHeight: number;
}

/** Send currency result */
export interface SendCurrencyResult extends SignedTxResult {
  inputsUsed: number;
  nativeChange: bigint;
}

/** Simple P2PKH build+sign parameters */
export interface BuildAndSignParams {
  wif: string;
  inputs: Array<{
    txid: string;
    vout: number;
    scriptPubKey: string;
    amount: bigint;
  }>;
  outputs: Array<{
    address: string;
    amount: bigint;
  }>;
  fee?: bigint;
  expiryHeight: number;
}

/** Commitment data returned from createCommitment */
export interface CommitmentData {
  name: string;
  salt: string;
  referral: string | null;
  parent: string | null;
  namereservationHex: string;
  commitmentHash: string;
}

/** Create commitment parameters */
export interface CreateCommitmentParams {
  wif: string;
  name: string;
  utxos: Utxo[];
  changeAddress: string;
  referral?: string;
  parent?: string;
  expiryHeight: number;
  /**
   * Explicit 32-byte commitment salt. Omit in production for a fresh random
   * salt; set it only to make the commitment deterministic in golden/diff tests
   * — reusing a salt on a real registration leaks privacy.
   */
  salt?: Buffer;
}

/** Create commitment result */
export interface CreateCommitmentResult extends SignedTxResult {
  identityAddress: string;
  commitmentData: CommitmentData;
}

/** Register identity parameters */
export interface RegisterIdentityParams {
  wif: string;
  commitmentUtxo: Utxo;
  commitmentData: CommitmentData;
  primaryAddresses: string[];
  utxos: Utxo[];
  changeAddress: string;
  minSigs?: number;
  revocationAuthority?: string;
  recoveryAuthority?: string;
  /** Referral chain: i-addresses tracing referral levels (up to 3) */
  referralChain?: string[];
  /** Registration fee in VRSC satoshis (default: 10000000000n = 100 VRSC) */
  registrationFee?: bigint;
  /** Registration fee in parent currency satoshis (for sub-IDs) */
  registrationFeeAmount?: bigint;
  /** Native import fee in VRSC satoshis (for sub-IDs on fractional currencies) */
  nativeImportFee?: bigint;
  /** Number of referral levels (default: 3) */
  referralLevels?: number;
  expiryHeight: number;
}

/** Register identity result */
export interface RegisterIdentityResult extends SignedTxResult {
  identityAddress: string;
  registrationFee: bigint;
  referralPayments: number;
  referralAmountEach: bigint;
  inputsUsed: number;
  nativeChange: bigint;
}

/** Update identity parameters */
export interface UpdateIdentityParams {
  wif: string;
  identityHex: string;
  identityUtxo: Utxo;
  utxos: Utxo[];
  changeAddress: string;
  primaryAddresses?: string[];
  minSigs?: number;
  revocationAuthority?: string;
  recoveryAuthority?: string;
  contentMap?: Record<string, string>;
  contentMultimap?: Record<string, string | string[]>;
  expiryHeight: number;
}

/** Update identity result */
export interface UpdateIdentityResult extends SignedTxResult {
  identityAddress: string;
  operation: string;
  inputsUsed: number;
  nativeChange: bigint;
}

/** Lock identity parameters */
export interface LockIdentityParams {
  wif: string;
  identityHex: string;
  identityUtxo: Utxo;
  unlockAfter: number;
  utxos: Utxo[];
  changeAddress: string;
  expiryHeight: number;
}

/** Unlock identity parameters */
export interface UnlockIdentityParams {
  wif: string;
  identityHex: string;
  identityUtxo: Utxo;
  utxos: Utxo[];
  changeAddress: string;
  expiryHeight: number;
}

/** Revoke identity parameters */
export interface RevokeIdentityParams {
  wif: string;
  identityHex: string;
  identityUtxo: Utxo;
  utxos: Utxo[];
  changeAddress: string;
  expiryHeight: number;
}

/** Recover identity parameters */
export interface RecoverIdentityParams {
  wif: string;
  identityHex: string;
  identityUtxo: Utxo;
  utxos: Utxo[];
  changeAddress: string;
  primaryAddresses?: string[];
  revocationAuthority?: string;
  recoveryAuthority?: string;
  expiryHeight: number;
}

/** Define currency parameters (manual mode only) */
export interface DefineCurrencyParams {
  wif: string;
  identityHex: string;
  identityUtxo: Utxo;
  currencyDefScript: string;
  currencyDefValue?: bigint;
  utxos: Utxo[];
  changeAddress: string;
  expiryHeight: number;
}

/** Define currency result */
export interface DefineCurrencyResult extends SignedTxResult {
  identityAddress: string;
  inputsUsed: number;
  nativeChange: bigint;
}

/** Sign message parameters */
export interface SignMessageParams {
  wif: string;
  message: string;
  identityAddress: string;
  chainId?: string;
  blockHeight?: number;
  version?: 1 | 2;
}

/** Sign message result */
export interface SignMessageResult {
  signature: string;
  identitySignatureHex: string;
  message: string;
  identityAddress: string;
  chainId: string;
  blockHeight: number;
  version: number;
  signingAddress: string;
}

/** Verify message parameters */
export interface VerifyMessageParams {
  message: string;
  signature: string;
  signingAddress: string;
  identityAddress: string;
  chainId?: string;
  blockHeight?: number;
  version?: 1 | 2;
}

/** Verify message result */
export interface VerifyMessageResult {
  valid: boolean;
  message: string;
  identityAddress: string;
  signingAddress: string;
  chainId: string;
  blockHeight: number;
  version: number;
}

// ─── Shared Domain Types ─────────────────────────────

/** Re-export CurrencyType from currency/classify */
export type { CurrencyType } from '../currency/classify.js';

/** Balance for a single currency on an address */
export interface CurrencyBalance {
  currencyId: string;
  currencyName: string;
  ticker: string;
  confirmed: number;
  unconfirmed: number;
  total: number;
  type: import('../currency/classify.js').CurrencyType;
}

/** Direction of a transaction relative to the queried address */
export type TransactionDirection = 'received' | 'sent';

/** A single transaction in history */
export interface Transaction {
  txid: string;
  direction: TransactionDirection;
  /** Amount in coin units (not satoshis) */
  amount: number;
  confirmations: number;
  /** Unix timestamp in seconds */
  timestamp: number;
  blockHeight: number;
}

/** Parsed VerusID identity */
export interface VerusIdentity {
  /** i-address */
  id: string;
  name: string;
  fullyQualifiedName: string;
  primaryAddresses: string[];
  minSignatures: number;
  revocationAuthority: string;
  recoveryAuthority: string;
  status: 'active' | 'revoked' | 'locked' | 'pending';
  contentMap: Record<string, string>;
  blockHeight: number;
}

/** Conversion estimate result */
export interface ConversionQuote {
  fromCurrency: string;
  toCurrency: string;
  fromAmount: number;
  toAmount: number;
  estimatedOutput: number;
  fee: number;
  via?: string;
}
