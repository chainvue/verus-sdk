/**
 * VerusSDK — Facade class for all offline Verus transaction signing operations
 *
 * Holds network configuration; all methods delegate to core modules.
 * Power users can import core modules directly for more control.
 */

import type { Network } from './constants/index.js';
import type {
  VerusSDKConfig,
  TransferParams,
  TransferTokenParams,
  ConvertParams,
  SendCurrencyParams,
  SendCurrencyResult,
  BuildAndSignParams,
  SignedTxResult,
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
} from './types/index.js';

import type {
  BuildOfferFundingParams,
  BuildOfferFundingResult,
  BuildOfferParams,
  BuildOfferResult,
  CompleteOfferParams,
  CompleteOfferResult,
  ReclaimOfferParams,
  ReclaimOfferResult,
  BuildSellIdentityOfferParams,
  CompleteSellIdentityOfferParams,
  CompleteSellIdentityOfferResult,
  BuildBuyIdentityOfferParams,
  CompleteBuyIdentityOfferParams,
  CompleteBuyIdentityOfferResult,
  BuildSwapIdentityOfferParams,
  CompleteSwapIdentityOfferParams,
  CompleteSwapIdentityOfferResult,
} from './offers/public.js';

import * as transferModule from './transfer/index.js';
import * as identityModule from './identity/index.js';
import * as messageModule from './message/index.js';
import * as currencyModule from './currency/index.js';
import * as keysModule from './keys/index.js';
import * as offersModule from './offers/public.js';

export class VerusSDK {
  readonly network: Network;

  constructor(config: VerusSDKConfig) {
    this.network = config.network;
  }

  // ─── Transfers ─────────────────────────────────────

  /** Simple native VRSC transfer to an R-address */
  transfer(params: TransferParams): SendCurrencyResult {
    return transferModule.transfer(params, this.network);
  }

  /** Token/currency transfer */
  transferToken(params: TransferTokenParams): SendCurrencyResult {
    return transferModule.transferToken(params, this.network);
  }

  /** Currency conversion */
  convert(params: ConvertParams): SendCurrencyResult {
    return transferModule.convert(params, this.network);
  }

  /** Full-control currency transfer (supports all output types) */
  sendCurrency(params: SendCurrencyParams): SendCurrencyResult {
    return transferModule.sendCurrency(params, this.network);
  }

  /** Build and sign a simple P2PKH transaction */
  buildAndSign(params: BuildAndSignParams): SignedTxResult {
    return transferModule.buildAndSign(params, this.network);
  }

  // ─── Identity ──────────────────────────────────────

  /** Step 1 of identity creation: create a name commitment */
  createCommitment(params: CreateCommitmentParams): CreateCommitmentResult {
    return identityModule.buildAndSignCommitment(params, this.network);
  }

  /** Step 2 of identity creation: register the identity */
  registerIdentity(params: RegisterIdentityParams): RegisterIdentityResult {
    return identityModule.buildAndSignRegistration(params, this.network);
  }

  /** Update an existing identity (change primary addresses, authorities, content) */
  updateIdentity(params: UpdateIdentityParams): UpdateIdentityResult {
    return identityModule.buildAndSignIdentityUpdate(params, this.network, 'update');
  }

  /**
   * Lock an identity for a RELATIVE delay of `unlockDelayBlocks` blocks (NOT an
   * absolute block height — passing a height locks the identity for years).
   */
  lockIdentity(params: LockIdentityParams): UpdateIdentityResult {
    return identityModule.buildAndSignIdentityUpdate(
      {
        wif: params.wif,
        identityHex: params.identityHex,
        identityUtxo: params.identityUtxo,
        utxos: params.utxos,
        changeAddress: params.changeAddress,
        expiryHeight: params.expiryHeight,
      },
      this.network,
      'lock',
      { unlockDelayBlocks: params.unlockDelayBlocks, sanityOverride: params.sanityOverride ?? false },
    );
  }

  /** Initiate identity unlock */
  unlockIdentity(params: UnlockIdentityParams): UpdateIdentityResult {
    return identityModule.buildAndSignIdentityUpdate(
      {
        wif: params.wif,
        identityHex: params.identityHex,
        identityUtxo: params.identityUtxo,
        utxos: params.utxos,
        changeAddress: params.changeAddress,
        expiryHeight: params.expiryHeight,
      },
      this.network,
      'unlock',
    );
  }

  /** Revoke an identity (requires revocation authority key) */
  revokeIdentity(params: RevokeIdentityParams): UpdateIdentityResult {
    return identityModule.buildAndSignIdentityUpdate(
      {
        wif: params.wif,
        identityHex: params.identityHex,
        identityUtxo: params.identityUtxo,
        utxos: params.utxos,
        changeAddress: params.changeAddress,
        expiryHeight: params.expiryHeight,
      },
      this.network,
      'revoke',
    );
  }

  /** Recover an identity (requires recovery authority key) */
  recoverIdentity(params: RecoverIdentityParams): UpdateIdentityResult {
    return identityModule.buildAndSignIdentityUpdate(
      {
        wif: params.wif,
        identityHex: params.identityHex,
        identityUtxo: params.identityUtxo,
        utxos: params.utxos,
        changeAddress: params.changeAddress,
        ...(params.primaryAddresses !== undefined ? { primaryAddresses: params.primaryAddresses } : {}),
        ...(params.minSigs !== undefined ? { minSigs: params.minSigs } : {}),
        ...(params.revocationAuthority !== undefined ? { revocationAuthority: params.revocationAuthority } : {}),
        ...(params.recoveryAuthority !== undefined ? { recoveryAuthority: params.recoveryAuthority } : {}),
        expiryHeight: params.expiryHeight,
      },
      this.network,
      'recover',
    );
  }

  // ─── Currency ──────────────────────────────────────

  /** Define a new currency (manual mode — pre-built script) */
  defineCurrency(params: DefineCurrencyParams): DefineCurrencyResult {
    return currencyModule.defineCurrency(params, this.network);
  }

  // ─── Message Signing ───────────────────────────────

  /** Sign a message with a VerusID identity signature */
  signMessage(params: SignMessageParams): SignMessageResult {
    return messageModule.signMessage(params, this.network);
  }

  /** Verify a VerusID message signature */
  verifyMessage(params: VerifyMessageParams): VerifyMessageResult {
    return messageModule.verifyMessage(params, this.network);
  }

  // ─── Marketplace Offers (atomic swaps) ─────────────

  /**
   * Maker step 1 (currency offers only): fund the OFFERED asset into a commitment
   * output. Broadcast the returned tx, then pass `commitment` to `buildOffer`.
   */
  buildOfferFunding(params: BuildOfferFundingParams): BuildOfferFundingResult {
    return offersModule.buildOfferFunding(params, this.network);
  }

  /**
   * Maker step 2 (currency offers): build the half-signed offer — spend the funded
   * commitment with 0x83, committing to the single WANTED output paid to the maker.
   */
  buildOffer(params: BuildOfferParams): BuildOfferResult {
    return offersModule.buildOffer(params, this.network);
  }

  /**
   * Taker (currency offers): complete the maker's offer — pay the wanted asset,
   * receive the offered asset, and sign the taker's side into an atomic swap.
   */
  completeOffer(params: CompleteOfferParams): CompleteOfferResult {
    return offersModule.completeOffer(params, this.network);
  }

  /**
   * Maker: cancel an unaccepted offer — spend the funding commitment back to the
   * maker (SIGHASH_ALL). Native: the fee comes out of the reclaimed value; token:
   * pass native `feeUtxos` controlled by the same key.
   */
  buildReclaimOffer(params: ReclaimOfferParams): ReclaimOfferResult {
    return offersModule.buildReclaimOffer(params, this.network);
  }

  /** Maker: offer a VerusID for a currency (spends the identity's on-chain output). */
  buildSellIdentityOffer(params: BuildSellIdentityOfferParams): BuildOfferResult {
    return offersModule.buildSellIdentityOffer(params, this.network);
  }

  /** Taker: complete a sell-identity offer — pay the currency, receive the identity. */
  completeSellIdentityOffer(params: CompleteSellIdentityOfferParams): CompleteSellIdentityOfferResult {
    return offersModule.completeSellIdentityOffer(params, this.network);
  }

  /** Maker: offer a currency for a VerusID (funds the currency into a commitment). */
  buildBuyIdentityOffer(params: BuildBuyIdentityOfferParams): BuildOfferResult {
    return offersModule.buildBuyIdentityOffer(params, this.network);
  }

  /** Taker (identity owner): complete a buy-identity offer — give up the identity, take the currency. */
  completeBuyIdentityOffer(params: CompleteBuyIdentityOfferParams): CompleteBuyIdentityOfferResult {
    return offersModule.completeBuyIdentityOffer(params, this.network);
  }

  /** Maker: offer a VerusID for another VerusID (no currency moves). */
  buildSwapIdentityOffer(params: BuildSwapIdentityOfferParams): BuildOfferResult {
    return offersModule.buildSwapIdentityOffer(params, this.network);
  }

  /** Taker (owns the wanted identity): complete an identity swap — funds only the miner fee. */
  completeSwapIdentityOffer(params: CompleteSwapIdentityOfferParams): CompleteSwapIdentityOfferResult {
    return offersModule.completeSwapIdentityOffer(params, this.network);
  }

  // ─── Static Utilities ─────────────────────────────

  /** Derive R-address from WIF private key */
  static async deriveAddress(wif: string): Promise<string> {
    return keysModule.wifToAddress(wif);
  }

  /** Derive identity i-address from a name and optional parent */
  static deriveIdentityAddress(name: string, parentIAddress?: string): string {
    return identityModule.deriveIdentityAddress(name, parentIAddress);
  }

  /** Generate a new random WIF private key */
  static generateWif(): string {
    return keysModule.generateWif();
  }

  /** Validate a Verus R-address */
  static validateAddress(address: string): { valid: boolean; error?: string } {
    return keysModule.validateAddress(address);
  }

  /** Validate a WIF private key */
  static validateWif(wif: string): { valid: boolean; error?: string } {
    return keysModule.validateWif(wif);
  }
}
