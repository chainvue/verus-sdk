/**
 * The single transaction assembler.
 *
 * Every value-moving path funnels through here as a thin `TxIntent`: the caller
 * declares its inputs and the outputs it wants (with each output's native value
 * and any token value the script carries); the assembler derives the funding
 * requirements, selects UTXOs, emits change, and enforces native + token value
 * conservation on the assembled transaction BY CONSTRUCTION. A path can no
 * longer forget a conservation assert, drop token change, or hand-roll a
 * change-emission block that drifts from the others — those were whole classes
 * of bug. Fees are either estimated (selectUtxos) or DECLARED with an intent
 * (registration's implicit burn); an unnamed implicit fee is unrepresentable.
 *
 * Ported flows must stay byte-identical to the Phase-0 golden snapshots.
 */
import { TransactionBuilder } from '../fork/boundary.js';
import { selectUtxos, assertTokenConservation } from '../utxo/index.js';
import { signTransactionSmart, resolveExpiryHeight, assertNativeConservation, getNetwork } from '../signing/index.js';
import { toSafeNumber } from '../utils/index.js';
import { NETWORK_CONFIG, VERSION_GROUP_ID } from '../constants/index.js';
import { buildTokenChangeOutput, identityPaymentScript } from '../identity/index.js';
import { parseAddress, parseIAddress } from '../core/brands.js';
import type { Network } from '../constants/index.js';
import type { Utxo } from '../types/index.js';

/** One output the caller declares. */
export interface IntentOutput {
  /** Pre-built output scriptPubKey (identity, reservation, fee, payment, …). */
  script: Buffer;
  /** Native satoshis carried on the output. */
  nativeSat: bigint;
  /** Non-native currencies the script pays out (e.g. a reserve fee output) — used
   *  to derive the token funding requirement and the token-conservation check. */
  carries?: Map<string, bigint>;
}

export interface TxIntent {
  network: Network;
  /** WIF signing every input (single-key paths only). */
  wif: string;
  expiryHeight: number;
  funding: Utxo[];
  /** Inputs added before the funding inputs (e.g. a name-commitment UTXO). They
   *  carry 0 token value; their native value folds into the fee. */
  leadingInputs?: Utxo[];
  /** Declared outputs, emitted in order before change. */
  outputs: IntentOutput[];
  changeAddress: string;
  /** Whether the outputs are CryptoCondition (smart) outputs — drives fee sizing. */
  hasSmartOutputs?: boolean;
  /** Extra bytes for fee sizing when a pre-built output dwarfs the fixed estimate. */
  extraOutputBytes?: number;
  /** Output count fed to the fee estimator; defaults to the declared outputs.
   *  Override only to reproduce a legacy per-path estimate byte-for-byte. */
  feeOutputCount?: number;
  /** `estimate` sizes the fee from the tx. `declared` names an intentional
   *  implicit burn — native that leaves BEYOND the outputs and the miner fee
   *  (e.g. the registration fee): it is added to the funding requirement and
   *  bounds the signing-time fee-rate cap, so it can never be an accident. */
  fee: { policy: 'estimate' } | { policy: 'declared'; burnSat: bigint; reason: string };
  /** Label used in conservation error messages. */
  label: string;
}

export interface AssembledTx {
  signedTx: string;
  txid: string;
  fee: bigint;
  nativeChange: bigint;
  currencyChanges: Map<string, bigint>;
  selected: Utxo[];
  inputsUsed: number;
}

export function assembleAndSign(intent: TxIntent): AssembledTx {
  const verusNetwork = getNetwork(intent.network === 'testnet');
  const systemId = NETWORK_CONFIG[intent.network].chainId;

  // Funding requirements are DERIVED from the declared outputs — never restated
  // by the caller (the token-burn class came from a path building these by hand).
  // A declared implicit burn (registration fee) is native that must be funded
  // but leaves as fee rather than to an output, so it adds to the native need.
  const burnSat = intent.fee.policy === 'declared' ? intent.fee.burnSat : 0n;
  let requiredNative = burnSat;
  const requiredCurrencies = new Map<string, bigint>();
  for (const o of intent.outputs) {
    requiredNative += o.nativeSat;
    if (o.carries) {
      for (const [c, v] of o.carries) requiredCurrencies.set(c, (requiredCurrencies.get(c) ?? 0n) + v);
    }
  }

  const selection = selectUtxos(
    intent.funding,
    requiredNative,
    requiredCurrencies,
    intent.feeOutputCount ?? intent.outputs.length,
    systemId,
    undefined,
    intent.hasSmartOutputs ?? true,
    intent.extraOutputBytes ?? 0,
  );

  const txb = new TransactionBuilder(verusNetwork);
  txb.setVersion(4);
  txb.setExpiryHeight(resolveExpiryHeight(intent.expiryHeight));
  txb.setVersionGroupId(VERSION_GROUP_ID);

  const leading = intent.leadingInputs ?? [];
  const allUtxos: Utxo[] = [...leading, ...selection.selected];
  for (const utxo of allUtxos) {
    txb.addInput(
      Buffer.from(utxo.txid, 'hex').reverse(),
      utxo.outputIndex,
      0xffffffff,
      Buffer.from(utxo.script, 'hex'),
    );
  }

  for (const o of intent.outputs) {
    txb.addOutput(o.script, toSafeNumber(o.nativeSat));
  }

  // Change: token change (with native piggyback) or plain native, emitted in one
  // place. A token-dropping transaction is unrepresentable — the assembler either
  // emits the reserve-output change or the conservation check below throws.
  const hasTokenChange = selection.currencyChanges.size > 0;
  if (hasTokenChange || selection.nativeChange > 0n) {
    if (hasTokenChange) {
      const tokenChange = buildTokenChangeOutput(parseAddress(intent.changeAddress, 'changeAddress'), selection.currencyChanges);
      txb.addOutput(tokenChange.script, toSafeNumber(selection.nativeChange));
    } else if (intent.changeAddress.startsWith('i')) {
      // utxo-lib's addOutput only resolves base58 R-addresses; an i-address needs
      // the explicit P2ID script or it throws an untyped "no matching Script".
      txb.addOutput(identityPaymentScript(parseIAddress(intent.changeAddress, 'changeAddress')), toSafeNumber(selection.nativeChange));
    } else {
      txb.addOutput(intent.changeAddress, toSafeNumber(selection.nativeChange));
    }
  }

  const unsignedTx = txb.buildIncomplete();

  // Conservation postconditions on the assembled transaction.
  assertTokenConservation(selection.selected, requiredCurrencies, selection.currencyChanges, systemId, intent.label);
  // The native fee that must leave = the miner fee + any declared burn + the
  // leading inputs' native (they carry value but fund no output of their own).
  const leadingNative = leading.reduce((sum, u) => sum + u.satoshis, 0n);
  const expectedFee = selection.fee + burnSat + leadingNative;
  assertNativeConservation(allUtxos, unsignedTx.outs, expectedFee, intent.label);

  // A declared burn tells the fork's absurd-fee-rate cap the intended absolute
  // fee, or build() rejects the (legitimately large) registration burn.
  const maxFeeSats = intent.fee.policy === 'declared' ? expectedFee : undefined;
  const { signedTx, txid } = signTransactionSmart(unsignedTx.toHex(), intent.wif, allUtxos, verusNetwork, maxFeeSats);

  return {
    signedTx,
    txid,
    fee: selection.fee,
    nativeChange: selection.nativeChange,
    currencyChanges: selection.currencyChanges,
    selected: selection.selected,
    inputsUsed: allUtxos.length,
  };
}
