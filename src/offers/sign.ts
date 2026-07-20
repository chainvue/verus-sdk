/**
 * Signing an offer input.
 *
 * A Verus marketplace offer is one half of an atomic swap: the maker spends the
 * output holding the OFFERED asset and, in the same input, commits with
 * SIGHASH_SINGLE | SIGHASH_ANYONECANPAY (0x83) to exactly one output — the WANTED
 * asset paid to the maker. That sighash lets a taker later ADD their own inputs
 * (the wanted asset) and outputs (receiving the offered asset) and sign their
 * side, without invalidating the maker's signature. The two halves merge into one
 * atomic transaction.
 *
 * The offered asset sits in a CryptoCondition output, so the fulfillment is a
 * smart-transaction signature. The fork's `TransactionBuilder.sign` can sign a CC
 * input but HARDCODES the fulfillment's embedded hashType to SIGHASH_ALL, so it
 * can't emit an offer fulfillment. We build the fulfillment explicitly from the
 * fork's exported primitives instead — byte-identical to the daemon's `makeoffer`
 * (verified: `SmartTransactionSignatures(1, 0x83, …).toChunk()` → `018301…`).
 */
import {
  Transaction,
  ECPair,
  SmartTransactionSignatures,
  SmartTransactionSignature,
  script as bscript,
} from '../fork/boundary.js';
import { getNetwork } from '../signing/index.js';
import { toSafeNumber } from '../utils/index.js';
import { TransactionBuildError } from '../errors.js';
import type { Network } from '../constants/index.js';

const SIGHASH_SINGLE = 0x03;
const SIGHASH_ANYONECANPAY = 0x80;
/** The sighash every offer input is signed with: single output, others open. */
export const SIGHASH_OFFER = SIGHASH_SINGLE | SIGHASH_ANYONECANPAY; // 0x83

/**
 * Sign one input of an offer transaction with SIGHASH_SINGLE|ANYONECANPAY and
 * install the CryptoCondition fulfillment, leaving the rest of the tx open for a
 * taker to complete.
 *
 * @param unsignedHex   the offer tx (input spending the offered CC output, plus
 *                      the single wanted output at the same index) with an empty
 *                      scriptSig on `inputIndex`
 * @param prevOutScript the funding output's scriptPubKey (the CC holding the offered asset)
 * @param prevOutValue  the funding output's native satoshis (for the sighash)
 */
export function signOfferInput(
  unsignedHex: string,
  inputIndex: number,
  prevOutScript: Buffer,
  prevOutValue: bigint,
  wif: string,
  network: Network,
): { signedTx: string; txid: string } {
  const verusNetwork = getNetwork(network === 'testnet');
  const tx = Transaction.fromHex(unsignedHex, verusNetwork);
  const input = tx.ins[inputIndex];
  if (!input) {
    throw new TransactionBuildError(`signOfferInput: no input at index ${inputIndex}`);
  }

  const keyPair = ECPair.fromWIF(wif, verusNetwork);
  // isWitness = false: Verus CC inputs are not segwit.
  const sighash = tx.hashForSignatureByNetwork(
    inputIndex,
    prevOutScript,
    toSafeNumber(prevOutValue),
    SIGHASH_OFFER,
    false,
  );
  const signature = keyPair.sign(sighash);

  // The compact signature is [recovery-byte, r(32), s(32)]; the CC fulfillment
  // carries the 64-byte r||s (the recovery byte is dropped).
  const fulfillment = new SmartTransactionSignatures(1, SIGHASH_OFFER, [
    new SmartTransactionSignature(1, 1, keyPair.getPublicKeyBuffer(), signature.toCompact().slice(1)),
  ]).toChunk();

  // The scriptSig pushes the fulfillment as one data element (OP_PUSHDATA1 …),
  // matching the daemon's `4c67 0183…` — toChunk() is the raw bytes, not the push.
  input.script = bscript.compile([fulfillment]);
  return { signedTx: tx.toHex(), txid: tx.getId() };
}
