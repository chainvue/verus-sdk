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
 * This covers taking an offer of the NATIVE coin for a token (offered = native,
 * wanted = token) — the maker flow's mirror. Other combinations follow.
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
  /** What the maker offers (the value in the commitment input 0). Native only here. */
  offered: { currency: string; amount: bigint };
  /** What the taker must pay (the maker's wanted output 0). A token here. */
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

/**
 * Complete a native-for-token offer: take the maker's offer, pay the wanted token,
 * receive the offered native coin, and sign the taker's side.
 */
export function completeOffer(params: CompleteOfferParams, network: Network): CompleteOfferResult {
  const verusNetwork = getNetwork(network === 'testnet');
  const systemId = NETWORK_CONFIG[network].chainId;

  if (params.offered.currency !== systemId) {
    throw new TransactionBuildError('completeOffer currently supports a native-coin offer (offered.currency must be the chain id)');
  }
  if (params.want.currency === systemId) {
    throw new TransactionBuildError('completeOffer currently supports wanting a token (want.currency must not be the chain id)');
  }

  const tx = Transaction.fromHex(params.offerTx, verusNetwork);
  if (tx.ins.length !== 1 || tx.outs.length !== 1) {
    throw new TransactionBuildError('completeOffer: expected a maker offer partial (1 input, 1 output)');
  }

  // Output 1: the offered NATIVE coin paid to the taker.
  const offeredScript = params.takerAddress.startsWith('i')
    ? identityPaymentScript(parseIAddress(params.takerAddress, 'takerAddress'))
    : addressToScriptPubKey(params.takerAddress);
  tx.addOutput(offeredScript, toSafeNumber(params.offered.amount));

  // Select the taker's UTXOs: cover the wanted token (paid to output 0) + the
  // miner fee (native). The offered native (input 0 → output 1) cancels out, so
  // the taker funds only the fee on the native side. numOutputs=3 (wanted, offered,
  // change); +150 bytes accounts for the maker's input, which selectUtxos can't see.
  const selection = selectUtxos(
    params.takerUtxos,
    0n,
    new Map([[params.want.currency, params.want.amount]]),
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
    } else if (params.changeAddress.startsWith('i')) {
      tx.addOutput(identityPaymentScript(parseIAddress(params.changeAddress, 'changeAddress')), toSafeNumber(selection.nativeChange));
    } else {
      tx.addOutput(addressToScriptPubKey(params.changeAddress), toSafeNumber(selection.nativeChange));
    }
  }

  // Token conservation: taker's wanted-currency inputs == paid to the maker + change.
  assertTokenConservation(
    selection.selected,
    new Map([[params.want.currency, params.want.amount]]),
    selection.currencyChanges,
    systemId,
    'takeOffer',
  );

  // Native conservation across the whole swap: the offered native (input 0) funds
  // output 1, so it cancels; the taker's native inputs must equal the native
  // change + the miner fee.
  const takerNativeIn = selection.selected.reduce((s, u) => s + u.satoshis, 0n);
  const allInputsNative = params.offered.amount + takerNativeIn;
  assertNativeConservation([{ satoshis: allInputsNative }], tx.outs, selection.fee, 'takeOffer');

  const { signedTx, txid } = signTakerInputs(tx.toHex(), takerInputs, params.wif, network);
  return { swapTx: signedTx, txid };
}
