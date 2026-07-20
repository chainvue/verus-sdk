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
 * This module covers SELLING an identity (offer the identity, want a currency).
 * Buying an identity (offer a currency, want an identity) is the mirror and
 * follows.
 */
import { Transaction, Identity, type VerusCLIVerusIDJson } from '../fork/boundary.js';
import { selectUtxos, assertTokenConservation } from '../utxo/index.js';
import { getNetwork, assertNativeConservation } from '../signing/index.js';
import { buildIdentityScript, buildTokenChangeOutput, identityPaymentScript } from '../identity/index.js';
import { signTakerInputs, type TakerInput } from './sign.js';
import { buildOffer, type FundedOutpoint, type BuildOfferResult } from './maker.js';
import { toSafeNumber, addressToScriptPubKey } from '../utils/index.js';
import { parseAddress, parseIAddress } from '../core/brands.js';
import { NETWORK_CONFIG } from '../constants/index.js';
import { TransactionBuildError } from '../errors.js';
import type { Network } from '../constants/index.js';
import type { Utxo } from '../types/index.js';

/** A native payment script to an R-address (P2PKH) or i-address (pay-to-identity). */
function nativePaymentScript(address: string): Buffer {
  return address.startsWith('i')
    ? identityPaymentScript(parseIAddress(address, 'address'))
    : addressToScriptPubKey(address);
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
  const identity = Identity.fromJson(params.identityJson);
  identity.setPrimaryAddresses(params.newPrimaryAddresses);
  const identityScript = buildIdentityScript(identity);
  tx.addOutput(identityScript, 0);

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
