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

import * as transferModule from './transfer/index.js';
import * as identityModule from './identity/index.js';
import * as messageModule from './message/index.js';
import * as currencyModule from './currency/index.js';
import * as keysModule from './keys/index.js';

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

  /** Lock an identity until a specified block height */
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
      { unlockAfter: params.unlockAfter },
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
        primaryAddresses: params.primaryAddresses,
        revocationAuthority: params.revocationAuthority,
        recoveryAuthority: params.recoveryAuthority,
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
