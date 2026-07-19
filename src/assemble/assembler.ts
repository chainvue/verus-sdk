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
import { selectUtxos, assertTokenConservation, decodeUtxo } from '../utxo/index.js';
import { signTransactionSmart, resolveExpiryHeight, assertNativeConservation, getNetwork } from '../signing/index.js';
import { toSafeNumber } from '../utils/index.js';
import { NETWORK_CONFIG, VERSION_GROUP_ID } from '../constants/index.js';
import { buildTokenChangeOutput, identityPaymentScript } from '../identity/index.js';
import { parseAddress, parseIAddress } from '../core/brands.js';
import { TransactionBuildError } from '../errors.js';
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
  /** Token funding requirement, when the outputs are pre-built by the fork
   *  (createUnfundedCurrencyTransfer) and their carried token value can't be read
   *  back off the opaque scripts. When set, it REPLACES the per-output `carries`
   *  derivation. Drives both selection and the token-conservation check. */
  requiredCurrencies?: Map<string, bigint>;
  /** How change is emitted. `bundled` (default) rides the native change on the
   *  token-change reserve output (the identity/registration convention). `separate`
   *  emits the token change with only its structural native value plus a distinct
   *  native-change output (the fork's currency-transfer convention). */
  changeStrategy?: 'bundled' | 'separate';
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

  // Leading inputs sit OUTSIDE the token-conservation check below (which only
  // sees the funding selection), so a leading input carrying token value would be
  // silently burned. Fail closed. Today the only leading input is the SDK-built
  // name-commitment UTXO, which carries none — this enforces the assumption the
  // TxIntent doc states instead of trusting it.
  for (const u of intent.leadingInputs ?? []) {
    // Native on a leading input folds into the fee (burned to miner), so reject it
    // — matching the identity-respend assembler, which fails closed on a nonzero
    // identity UTXO. A name-commitment output is value 0.
    if (u.satoshis !== 0n) {
      throw new TransactionBuildError(
        `${intent.label}: leading input ${u.txid}:${u.outputIndex} carries ${u.satoshis} native satoshis, ` +
          `which would be burned to miner fee. Spend that value separately first.`,
      );
    }
    let currencyValues: Map<string, bigint>;
    try {
      ({ currencyValues } = decodeUtxo(u, systemId));
    } catch {
      // Undecodable smart output — e.g. the name-commitment's eval-17 CC, which
      // unpackOutput doesn't model. It is not a reserve output, so it carries no
      // token value. A token-bearing leading input IS a reserve output (eval 8/9)
      // and decodes cleanly, so it is still caught below.
      continue;
    }
    for (const [currency, amount] of currencyValues) {
      if (currency !== systemId && amount > 0n) {
        throw new TransactionBuildError(
          `${intent.label}: leading input ${u.txid}:${u.outputIndex} carries ${amount} of ${currency}, ` +
            `which is outside token conservation and would be burned. Fund token-bearing inputs through the funding path.`,
        );
      }
    }
  }

  // Funding requirements are DERIVED from the declared outputs — never restated
  // by the caller (the token-burn class came from a path building these by hand).
  // A declared implicit burn (registration fee) is native that must be funded
  // but leaves as fee rather than to an output, so it adds to the native need.
  const burnSat = intent.fee.policy === 'declared' ? intent.fee.burnSat : 0n;
  let requiredNative = burnSat;
  // Token requirement: an explicit override (fork-built outputs) replaces the
  // per-output carries; otherwise it is summed from the outputs' declared carries.
  const requiredCurrencies = new Map<string, bigint>(intent.requiredCurrencies ?? []);
  for (const o of intent.outputs) {
    requiredNative += o.nativeSat;
    if (!intent.requiredCurrencies && o.carries) {
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

  // Change, emitted in one place. A token-dropping transaction is
  // unrepresentable — the assembler either emits the reserve-output change or the
  // conservation check below throws. utxo-lib's addOutput only resolves base58
  // R-addresses, so an i-address change needs the explicit P2ID script.
  const hasTokenChange = selection.currencyChanges.size > 0;
  const emitNativeChange = (value: bigint): void => {
    if (intent.changeAddress.startsWith('i')) {
      txb.addOutput(identityPaymentScript(parseIAddress(intent.changeAddress, 'changeAddress')), toSafeNumber(value));
    } else {
      txb.addOutput(intent.changeAddress, toSafeNumber(value));
    }
  };
  if ((intent.changeStrategy ?? 'bundled') === 'separate') {
    // Token change carries only its own structural native value; the native change
    // is a distinct output (the fork's currency-transfer convention).
    if (hasTokenChange) {
      const tokenChange = buildTokenChangeOutput(parseAddress(intent.changeAddress, 'changeAddress'), selection.currencyChanges);
      txb.addOutput(tokenChange.script, toSafeNumber(tokenChange.nativeValue));
    }
    if (selection.nativeChange > 0n) emitNativeChange(selection.nativeChange);
  } else if (hasTokenChange || selection.nativeChange > 0n) {
    // Bundled: the native change rides on the token-change reserve output.
    if (hasTokenChange) {
      const tokenChange = buildTokenChangeOutput(parseAddress(intent.changeAddress, 'changeAddress'), selection.currencyChanges);
      txb.addOutput(tokenChange.script, toSafeNumber(selection.nativeChange));
    } else {
      emitNativeChange(selection.nativeChange);
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
