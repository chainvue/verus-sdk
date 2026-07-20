/**
 * Marketplace offers that trade a VerusID, offline (currency ↔ identity).
 *
 * An identity is offered by spending its current on-chain primary output (an
 * EVAL_IDENTITY_PRIMARY CC) — there is no separate funding transaction, unlike a
 * currency offer. The maker signs that identity input with
 * SIGHASH_SINGLE|ANYONECANPAY (0x83) committing to a single wanted output (the
 * currency paid to the maker); the taker completes the swap by appending the
 * TRANSFERRED identity output — the same identity with its primary addresses
 * replaced by the taker's — plus the payment for the wanted currency.
 *
 * The transferred identity output is built byte-identically to the daemon's
 * `takeoffer`: `Identity.fromJson(getidentity)` with `setPrimaryAddresses`, then
 * `buildIdentityScript` (verified on VRSCTEST).
 *
 * Both directions are covered and live-proven on VRSCTEST:
 *   - SELL (offer the identity, want a currency): the maker spends the identity's
 *     current primary output with 0x83; the taker appends the transferred identity
 *     and pays. No funding tx.
 *   - BUY (offer a currency, want an identity): the maker funds the currency into a
 *     commitment and offers it, wanting the identity transferred to the buyer; the
 *     taker (the identity's owner) spends the identity's current output and takes
 *     the currency.
 */
import { Transaction, TransactionBuilder, Identity, type VerusCLIVerusIDJson } from '../fork/boundary.js';
import { selectUtxos, assertTokenConservation } from '../utxo/index.js';
import { getNetwork, assertNativeConservation, resolveExpiryHeight } from '../signing/index.js';
import { buildIdentityScript, buildTokenChangeOutput, identityPaymentScript } from '../identity/index.js';
import { signOfferInput, signTakerInputs, type TakerInput } from './sign.js';
import { buildOffer, type FundedOutpoint, type BuildOfferResult } from './maker.js';
import { toSafeNumber, addressToScriptPubKey } from '../utils/index.js';
import { parseAddress, parseIAddress } from '../core/brands.js';
import { NETWORK_CONFIG, VERSION_GROUP_ID } from '../constants/index.js';
import { TransactionBuildError } from '../errors.js';
import type { Network } from '../constants/index.js';
import type { Utxo } from '../types/index.js';

/** A native payment script to an R-address (P2PKH) or i-address (pay-to-identity). */
function nativePaymentScript(address: string): Buffer {
  return address.startsWith('i')
    ? identityPaymentScript(parseIAddress(address, 'address'))
    : addressToScriptPubKey(address);
}

/**
 * Build the TRANSFERRED identity output: the given identity with its primary
 * addresses replaced by `newPrimaryAddresses`, everything else preserved. Built
 * byte-identically to the daemon's makeoffer/takeoffer identity transfer.
 */
function buildTransferredIdentity(identityJson: VerusCLIVerusIDJson, newPrimaryAddresses: string[]): Buffer {
  const identity = Identity.fromJson(identityJson);
  identity.setPrimaryAddresses(newPrimaryAddresses);
  return buildIdentityScript(identity);
}

/** An offer MUST expire at a real future height; the daemon rejects 0 as expired. */
function assertExpiryHeight(expiryHeight: number): void {
  if (!Number.isInteger(expiryHeight) || expiryHeight <= 0) {
    throw new TransactionBuildError(
      'expiryHeight (a positive future block height) is required for an offer; the daemon rejects a 0/never-expiring offer as expired.',
    );
  }
}

export interface BuildSellIdentityOfferParams {
  wif: string;
  /**
   * The identity's current on-chain primary output being offered, read from the
   * chain: `txid`/`vout` locate it, `script` is its scriptPubKey hex. The `wif`
   * must control one of the identity's primary addresses (m-of-n with m=1).
   */
  identityOutput: { txid: string; vout: number; script: string };
  /** What the maker wants in return: a currency paid to the maker's address. */
  want: { currency: string; amount: bigint; address: string };
  /** A real future block height; the daemon rejects a 0/never-expiring offer. */
  expiryHeight: number;
}

/**
 * Build the maker's half of a sell-identity offer: spend the identity's current
 * primary output with 0x83 into the single wanted-currency output. This is
 * exactly a `buildOffer` whose "commitment" is the identity output (0 native).
 */
export function buildSellIdentityOffer(
  params: BuildSellIdentityOfferParams,
  network: Network,
): BuildOfferResult {
  const commitment: FundedOutpoint = {
    txid: params.identityOutput.txid,
    vout: params.identityOutput.vout,
    value: 0n, // an identity primary output carries 0 native
    script: params.identityOutput.script,
  };
  return buildOffer({ wif: params.wif, commitment, want: params.want, expiryHeight: params.expiryHeight }, network);
}

export interface CompleteSellIdentityOfferParams {
  /** The maker's half-signed sell-identity offer (from buildSellIdentityOffer). */
  offerTx: string;
  /** The identity being bought, as returned by the daemon's `getidentity` (its `.identity`). */
  identityJson: VerusCLIVerusIDJson;
  /** The taker's new primary (control) addresses for the acquired identity. */
  newPrimaryAddresses: string[];
  /** What the taker must pay (the maker's wanted output 0), native or token. */
  want: { currency: string; amount: bigint };
  /** The taker's UTXOs — must hold the wanted currency + native for the fee. */
  takerUtxos: Utxo[];
  changeAddress: string;
  wif: string;
}

export interface CompleteSellIdentityOfferResult {
  swapTx: string;
  txid: string;
}

/**
 * Complete a sell-identity offer: pay the wanted currency, receive the identity
 * (transferred to `newPrimaryAddresses`), and sign the taker's side.
 */
export function completeSellIdentityOffer(
  params: CompleteSellIdentityOfferParams,
  network: Network,
): CompleteSellIdentityOfferResult {
  const verusNetwork = getNetwork(network === 'testnet');
  const systemId = NETWORK_CONFIG[network].chainId;
  const wantingNative = params.want.currency === systemId;

  if (params.want.amount <= 0n) {
    throw new TransactionBuildError('completeSellIdentityOffer: want.amount must be positive');
  }
  if (params.newPrimaryAddresses.length === 0) {
    throw new TransactionBuildError('completeSellIdentityOffer: newPrimaryAddresses must not be empty');
  }

  const tx = Transaction.fromHex(params.offerTx, verusNetwork);
  if (tx.ins.length !== 1 || tx.outs.length !== 1) {
    throw new TransactionBuildError('completeSellIdentityOffer: expected a maker offer partial (1 input, 1 output)');
  }

  // Output 1: the TRANSFERRED identity — the same identity with its primary
  // addresses replaced by the taker's. Everything else (revocation/recovery,
  // name, parent, contentmap, flags) is preserved, byte-identical to the daemon.
  tx.addOutput(buildTransferredIdentity(params.identityJson, params.newPrimaryAddresses), 0);

  // The taker's own UTXOs fund the wanted currency (paid to output 0) + the fee.
  const wantedTokenReq = wantingNative
    ? new Map<string, bigint>()
    : new Map([[params.want.currency, params.want.amount]]);
  const requiredNative = wantingNative ? params.want.amount : 0n;
  const selection = selectUtxos(
    params.takerUtxos,
    requiredNative,
    wantedTokenReq,
    3,
    systemId,
    undefined,
    true,
    150,
  );

  const takerInputs: TakerInput[] = [];
  for (const u of selection.selected) {
    const idx = tx.addInput(Buffer.from(u.txid, 'hex').reverse(), u.outputIndex, 0xffffffff);
    takerInputs.push({ index: idx, prevOutScript: Buffer.from(u.script, 'hex'), value: u.satoshis });
  }

  // Output 2: taker change (bundled token+native reserve output, or plain native).
  const hasTokenChange = selection.currencyChanges.size > 0;
  if (hasTokenChange || selection.nativeChange > 0n) {
    if (hasTokenChange) {
      const change = buildTokenChangeOutput(parseAddress(params.changeAddress, 'changeAddress'), selection.currencyChanges);
      tx.addOutput(change.script, toSafeNumber(selection.nativeChange));
    } else {
      tx.addOutput(nativePaymentScript(params.changeAddress), toSafeNumber(selection.nativeChange));
    }
  }

  // Token conservation over the taker's own inputs (wanted token → output 0 + change).
  assertTokenConservation(selection.selected, wantedTokenReq, selection.currencyChanges, systemId, 'takeSellIdentityOffer');

  // Native conservation: the identity input carries 0 native, so the taker's
  // native inputs must equal the wanted-native output (if any) + change + fee.
  const takerNativeIn = selection.selected.reduce((s, u) => s + u.satoshis, 0n);
  assertNativeConservation([{ satoshis: takerNativeIn }], tx.outs, selection.fee, 'takeSellIdentityOffer');

  const { signedTx, txid } = signTakerInputs(tx.toHex(), takerInputs, params.wif, network);
  return { swapTx: signedTx, txid };
}

// ─── Buying an identity (offer a currency, want an identity) ─────────

export interface BuildBuyIdentityOfferParams {
  wif: string;
  /** The currency commitment from buildOfferFunding (after broadcast). */
  commitment: FundedOutpoint;
  /** The identity to acquire, as returned by the daemon's `getidentity` (its `.identity`). */
  identityJson: VerusCLIVerusIDJson;
  /** The buyer's new primary (control) addresses for the acquired identity. */
  buyerPrimaryAddresses: string[];
  /** A real future block height; the daemon rejects a 0/never-expiring offer. */
  expiryHeight: number;
}

/**
 * Build the maker's half of a buy-identity offer: spend the currency commitment
 * with 0x83 into the single WANTED output — the identity transferred to the
 * buyer's control. A taker who owns the identity completes the swap by spending
 * the identity's current output and taking the offered currency.
 */
export function buildBuyIdentityOffer(
  params: BuildBuyIdentityOfferParams,
  network: Network,
): BuildOfferResult {
  assertExpiryHeight(params.expiryHeight);
  if (params.buyerPrimaryAddresses.length === 0) {
    throw new TransactionBuildError('buildBuyIdentityOffer: buyerPrimaryAddresses must not be empty');
  }
  const verusNetwork = getNetwork(network === 'testnet');

  // The single wanted output: the identity transferred to the buyer.
  const wantedScript = buildTransferredIdentity(params.identityJson, params.buyerPrimaryAddresses);

  const txb = new TransactionBuilder(verusNetwork);
  txb.setVersion(4);
  txb.setExpiryHeight(resolveExpiryHeight(params.expiryHeight));
  txb.setVersionGroupId(VERSION_GROUP_ID);
  txb.addInput(
    Buffer.from(params.commitment.txid, 'hex').reverse(),
    params.commitment.vout,
    0xffffffff,
    Buffer.from(params.commitment.script, 'hex'),
  );
  txb.addOutput(wantedScript, 0);

  const { signedTx, txid } = signOfferInput(
    txb.buildIncomplete().toHex(),
    0,
    Buffer.from(params.commitment.script, 'hex'),
    params.commitment.value,
    params.wif,
    network,
  );
  return { offerTx: signedTx, txid };
}

export interface CompleteBuyIdentityOfferParams {
  /** The maker's half-signed buy-identity offer (from buildBuyIdentityOffer). */
  offerTx: string;
  /** What the maker offers (the value in the commitment input 0), native or token. */
  offered: { currency: string; amount: bigint };
  /** The seller's identity output being sold (read from chain): txid/vout/script hex. */
  identityOutput: { txid: string; vout: number; script: string };
  /** Where the seller receives the offered currency. */
  sellerReceiveAddress: string;
  /** The seller's native UTXOs to cover the miner fee (the identity input carries none). */
  takerUtxos: Utxo[];
  changeAddress: string;
  wif: string;
}

export interface CompleteBuyIdentityOfferResult {
  swapTx: string;
  txid: string;
}

/**
 * Complete a buy-identity offer: give up the identity (spend its current output),
 * receive the offered currency, and sign the seller's side. The identity flows to
 * the buyer via the maker's already-committed output 0; the seller adds the
 * identity input, the currency-to-seller output, native for the fee, and change.
 */
export function completeBuyIdentityOffer(
  params: CompleteBuyIdentityOfferParams,
  network: Network,
): CompleteBuyIdentityOfferResult {
  const verusNetwork = getNetwork(network === 'testnet');
  const systemId = NETWORK_CONFIG[network].chainId;
  const offeringNative = params.offered.currency === systemId;

  if (params.offered.amount <= 0n) {
    throw new TransactionBuildError('completeBuyIdentityOffer: offered.amount must be positive');
  }

  const tx = Transaction.fromHex(params.offerTx, verusNetwork);
  if (tx.ins.length !== 1 || tx.outs.length !== 1) {
    throw new TransactionBuildError('completeBuyIdentityOffer: expected a maker offer partial (1 input, 1 output)');
  }

  // The native value on the maker's currency commitment (input 0): the offered
  // amount if native, else 0 (a token commitment carries 0 native).
  const commitmentNative = offeringNative ? params.offered.amount : 0n;

  // Input 1: the seller's identity output (spent, transferring the identity away).
  const idIdx = tx.addInput(
    Buffer.from(params.identityOutput.txid, 'hex').reverse(),
    params.identityOutput.vout,
    0xffffffff,
  );
  const takerInputs: TakerInput[] = [
    { index: idIdx, prevOutScript: Buffer.from(params.identityOutput.script, 'hex'), value: 0n },
  ];

  // Output 1: the offered currency paid to the seller — plain payment for the
  // native coin, a reserve output for a token.
  if (offeringNative) {
    tx.addOutput(nativePaymentScript(params.sellerReceiveAddress), toSafeNumber(params.offered.amount));
  } else {
    const out = buildTokenChangeOutput(
      parseAddress(params.sellerReceiveAddress, 'sellerReceiveAddress'),
      new Map([[params.offered.currency, params.offered.amount]]),
    );
    tx.addOutput(out.script, 0);
  }

  // The seller funds only the miner fee (native), from their own UTXOs.
  const selection = selectUtxos(params.takerUtxos, 0n, new Map(), 3, systemId, undefined, true, 300);
  for (const u of selection.selected) {
    const idx = tx.addInput(Buffer.from(u.txid, 'hex').reverse(), u.outputIndex, 0xffffffff);
    takerInputs.push({ index: idx, prevOutScript: Buffer.from(u.script, 'hex'), value: u.satoshis });
  }

  // Output 2: the seller's native change, if any.
  if (selection.nativeChange > 0n) {
    tx.addOutput(nativePaymentScript(params.changeAddress), toSafeNumber(selection.nativeChange));
  }

  // Native conservation: the commitment's native (funds the offered-native output
  // when offering native, else 0) + the seller's native inputs = outputs + fee.
  const sellerNativeIn = selection.selected.reduce((s, u) => s + u.satoshis, 0n);
  assertNativeConservation([{ satoshis: commitmentNative + sellerNativeIn }], tx.outs, selection.fee, 'takeBuyIdentityOffer');

  const { signedTx, txid } = signTakerInputs(tx.toHex(), takerInputs, params.wif, network);
  return { swapTx: signedTx, txid };
}
