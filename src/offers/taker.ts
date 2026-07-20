/**
 * Completing (taking) a marketplace offer, offline.
 *
 * The taker receives the maker's half-signed offer (`buildOffer` output): input 0
 * spends the offered asset's commitment and output 0 is the WANTED asset paid to
 * the maker, both committed under the maker's SIGHASH_SINGLE|ANYONECANPAY. The
 * taker adds their side and signs it, and the two halves become one atomic swap:
 *
 *   - keep the maker's input 0 and output 0 untouched (index 0);
 *   - append output 1: the OFFERED asset paid to the taker;
 *   - append the taker's inputs (the wanted currency to pay output 0, plus native
 *     for the miner fee) and output 2: the taker's change;
 *   - sign only the taker's inputs (SIGHASH_ALL) — the maker's 0x83 stays valid.
 *
 * The taker tx does NOT byte-match the daemon (each wallet selects its own UTXOs);
 * correctness is enforced by value conservation and proven by the live round-trip.
 *
 * This covers all four currency combinations: the offered and wanted assets may
 * each be the native coin or a token. The offered asset flows self-contained from
 * input 0 (the commitment) to output 1 (the taker); the taker's own UTXOs fund
 * only the wanted asset (paid to output 0) plus the miner fee.
 */
import { Transaction } from '../fork/boundary.js';
import { selectUtxos, assertTokenConservation } from '../utxo/index.js';
import { getNetwork, assertNativeConservation } from '../signing/index.js';
import { buildTokenChangeOutput, identityPaymentScript } from '../identity/index.js';
import { signTakerInputs, type TakerInput } from './sign.js';
import { toSafeNumber, addressToScriptPubKey } from '../utils/index.js';
import { parseAddress, parseIAddress } from '../core/brands.js';
import { NETWORK_CONFIG } from '../constants/index.js';
import { TransactionBuildError } from '../errors.js';
import type { Network } from '../constants/index.js';
import type { Utxo } from '../types/index.js';

export interface CompleteOfferParams {
  /** The maker's half-signed offer transaction (from buildOffer). */
  offerTx: string;
  /** What the maker offers (the value in the commitment input 0), native or token. */
  offered: { currency: string; amount: bigint };
  /** What the taker must pay (the maker's wanted output 0), native or token. */
  want: { currency: string; amount: bigint };
  /** The taker's UTXOs — must hold the wanted currency + native for the fee. */
  takerUtxos: Utxo[];
  /** Where the taker receives the offered asset. */
  takerAddress: string;
  changeAddress: string;
  wif: string;
}

export interface CompleteOfferResult {
  swapTx: string;
  txid: string;
}

/** A native payment script to an R-address (P2PKH) or i-address (pay-to-identity). */
function nativePaymentScript(address: string): Buffer {
  return address.startsWith('i')
    ? identityPaymentScript(parseIAddress(address, 'address'))
    : addressToScriptPubKey(address);
}

/**
 * Complete an offer: take the maker's half-signed offer, pay the wanted asset,
 * receive the offered asset, and sign the taker's side. The offered and wanted
 * assets may each be the native coin or a token (all four combinations).
 */
export function completeOffer(params: CompleteOfferParams, network: Network): CompleteOfferResult {
  const verusNetwork = getNetwork(network === 'testnet');
  const systemId = NETWORK_CONFIG[network].chainId;
  const offeringNative = params.offered.currency === systemId;
  const wantingNative = params.want.currency === systemId;

  if (params.offered.amount <= 0n || params.want.amount <= 0n) {
    throw new TransactionBuildError('completeOffer: offered.amount and want.amount must be positive');
  }

  const tx = Transaction.fromHex(params.offerTx, verusNetwork);
  if (tx.ins.length !== 1 || tx.outs.length !== 1) {
    throw new TransactionBuildError('completeOffer: expected a maker offer partial (1 input, 1 output)');
  }

  // The native value on the maker's commitment input (input 0): the offered
  // amount if the offer is native, else 0 (a token commitment carries 0 native).
  const commitmentNative = offeringNative ? params.offered.amount : 0n;

  // Output 1: the OFFERED asset paid to the taker — a plain payment for the
  // native coin, a reserve output (0 native) for a token. The offered asset
  // flows from input 0 to here, self-contained.
  if (offeringNative) {
    tx.addOutput(nativePaymentScript(params.takerAddress), toSafeNumber(params.offered.amount));
  } else {
    const offeredOut = buildTokenChangeOutput(
      parseAddress(params.takerAddress, 'takerAddress'),
      new Map([[params.offered.currency, params.offered.amount]]),
    );
    tx.addOutput(offeredOut.script, 0);
  }

  // The taker's own UTXOs fund only the WANTED asset (paid to output 0) plus the
  // miner fee. When the wanted asset is a token it is a required currency; when
  // native it is required native on top of the fee. numOutputs=3 (wanted, offered,
  // change); +150 bytes accounts for the maker's input, which selectUtxos can't see.
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

  // Output 2: taker change — the wanted-currency change (with native change
  // bundled onto the reserve output), or plain native change if no token remains.
  const hasTokenChange = selection.currencyChanges.size > 0;
  if (hasTokenChange || selection.nativeChange > 0n) {
    if (hasTokenChange) {
      const change = buildTokenChangeOutput(parseAddress(params.changeAddress, 'changeAddress'), selection.currencyChanges);
      tx.addOutput(change.script, toSafeNumber(selection.nativeChange));
    } else {
      tx.addOutput(nativePaymentScript(params.changeAddress), toSafeNumber(selection.nativeChange));
    }
  }

  // Token conservation over the taker's own inputs: they provide the wanted token
  // (paid to output 0) plus change. The offered token (input 0 → output 1) does
  // not pass through taker inputs, so it is not asserted here — it is balanced by
  // construction (the commitment carries exactly `offered.amount`).
  assertTokenConservation(
    selection.selected,
    wantedTokenReq,
    selection.currencyChanges,
    systemId,
    'takeOffer',
  );

  // Native conservation across the whole swap. allNativeIn = the commitment's
  // native (funds the offered-native output when offering native, else 0) + the
  // taker's native inputs (fund the wanted-native output when wanting native, the
  // fee, and native change). This identity reduces to exactly `fee` in every
  // combination.
  const takerNativeIn = selection.selected.reduce((s, u) => s + u.satoshis, 0n);
  const allInputsNative = commitmentNative + takerNativeIn;
  assertNativeConservation([{ satoshis: allInputsNative }], tx.outs, selection.fee, 'takeOffer');

  const { signedTx, txid } = signTakerInputs(tx.toHex(), takerInputs, params.wif, network);
  return { swapTx: signedTx, txid };
}
