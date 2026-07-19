/**
 * The assembler for identity-input-respending transactions.
 *
 * A distinct shape from the value-output assembler (`assembler.ts`): these flows
 * (identity update / revoke / recover / lock / unlock, and currency definition)
 * respend the identity's own UTXO and RECREATE its definition output, which the
 * fork must re-sign LAST via `completeFundedIdentityUpdate`. So the tx is built
 * with the funding inputs + pre-built outputs, THEN the identity input is grafted
 * on and the whole thing completed — the value-output assembler's leading-input
 * model doesn't fit.
 *
 * Both callers previously hand-rolled this identical dance (select → build →
 * native change → complete → dual-conservation → sign); it lived in two places
 * and drifted. Centralising it here removes the duplication and makes the
 * value-conservation checks postconditions of the one code path.
 *
 * These paths pay only native (fee + any output value) and emit no token change,
 * so a token-bearing funding UTXO would be silently dropped — the token check
 * fails closed if one is selected. Ported flows stay byte-identical to the
 * Phase-0 goldens.
 */
import { TransactionBuilder, Transaction, smarttxs } from '../fork/boundary.js';
import { selectUtxos, assertTokenConservation, decodeUtxo } from '../utxo/index.js';
import { signTransactionSmart, resolveExpiryHeight, assertNativeConservation, getNetwork } from '../signing/index.js';
import { toSafeNumber } from '../utils/index.js';
import { NETWORK_CONFIG, VERSION_GROUP_ID } from '../constants/index.js';
import { identityPaymentScript } from '../identity/index.js';
import { parseIAddress } from '../core/brands.js';
import { TransactionBuildError } from '../errors.js';
import type { Network } from '../constants/index.js';
import type { Utxo } from '../types/index.js';

const { completeFundedIdentityUpdate } = smarttxs;

/** One pre-built output, added before change. */
export interface FundedUpdateOutput {
  script: Buffer;
  nativeSat: bigint;
}

export interface FundedIdentityUpdateIntent {
  network: Network;
  wif: string;
  expiryHeight: number;
  funding: Utxo[];
  /** The identity UTXO — respent, its definition output recreated at value 0,
   *  and re-signed last by the fork. Must carry 0 native (else it burns to fee). */
  identityUtxo: Utxo;
  /** Pre-built outputs (the recreated identity output, plus e.g. a currency
   *  definition), emitted before change. Native funding is derived from them. */
  outputs: FundedUpdateOutput[];
  changeAddress: string;
  /** Extra output bytes for fee sizing — the identity/definition scripts are
   *  large, so the caller passes their real byte length. */
  extraOutputBytes: number;
  /** Label used in conservation error messages. */
  label: string;
}

export interface FundedIdentityUpdateResult {
  signedTx: string;
  txid: string;
  fee: bigint;
  nativeChange: bigint;
  selected: Utxo[];
  inputsUsed: number;
}

export function assembleFundedIdentityUpdate(
  intent: FundedIdentityUpdateIntent,
): FundedIdentityUpdateResult {
  const verusNetwork = getNetwork(intent.network === 'testnet');
  const systemId = NETWORK_CONFIG[intent.network].chainId;

  const requiredNative = intent.outputs.reduce((sum, o) => sum + o.nativeSat, 0n);

  const selection = selectUtxos(
    intent.funding,
    requiredNative,
    new Map(),
    intent.outputs.length,
    systemId,
    undefined,
    true,
    intent.extraOutputBytes,
  );

  // These paths emit no token-change output, so a token-bearing funding UTXO
  // would be silently dropped; fail closed if one entered (both maps empty ⇒
  // assert no token value is present).
  assertTokenConservation(selection.selected, new Map(), new Map(), systemId, intent.label);

  const txb = new TransactionBuilder(verusNetwork);
  txb.setVersion(4);
  txb.setExpiryHeight(resolveExpiryHeight(intent.expiryHeight));
  txb.setVersionGroupId(VERSION_GROUP_ID);

  for (const utxo of selection.selected) {
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

  if (selection.nativeChange > 0n) {
    // utxo-lib's addOutput only resolves base58 R-addresses; an i-address
    // changeAddress needs the explicit P2ID script or it throws "no matching Script".
    if (intent.changeAddress.startsWith('i')) {
      txb.addOutput(identityPaymentScript(parseIAddress(intent.changeAddress, 'changeAddress')), toSafeNumber(selection.nativeChange));
    } else {
      txb.addOutput(intent.changeAddress, toSafeNumber(selection.nativeChange));
    }
  }

  const fundedHex = txb.buildIncomplete().toHex();

  const prevOutScripts = selection.selected.map((u) => Buffer.from(u.script, 'hex'));
  const idUtxo = intent.identityUtxo;
  // The identity input is spent and its definition output recreated with value 0,
  // so any native value on idUtxo would be silently burned to miner fee.
  if (idUtxo.satoshis !== 0n) {
    throw new TransactionBuildError(
      `identityUtxo carries ${idUtxo.satoshis} native satoshis, which would be burned to miner fee ` +
        `(the recreated identity output is value 0). Spend that value separately before this operation.`,
    );
  }
  // The identity input is grafted on AFTER assertTokenConservation ran over
  // selection.selected, so any token value it carries sits outside conservation
  // accounting entirely and would be silently dropped. Mirrors the value-output
  // assembler's leading-input guard: enforce the assumption this module's doc
  // comment states rather than trusting it.
  let idCurrencyValues: Map<string, bigint>;
  try {
    ({ currencyValues: idCurrencyValues } = decodeUtxo(idUtxo, systemId));
  } catch {
    // An identity output is an EVAL_IDENTITY_PRIMARY CC that decodeUtxo does not
    // model as a value-bearing output, so a failed decode is the NORMAL path
    // here. A token-bearing UTXO is a reserve output (eval 8/9), which decodes
    // cleanly and is still caught below.
    idCurrencyValues = new Map();
  }
  for (const [currency, amount] of idCurrencyValues) {
    if (currency !== systemId && amount > 0n) {
      throw new TransactionBuildError(
        `${intent.label}: identityUtxo carries ${amount} of ${currency}, which is outside token ` +
          `conservation and would be burned. An identity output must not carry reserve value.`,
      );
    }
  }
  const completedHex = completeFundedIdentityUpdate(
    fundedHex,
    verusNetwork,
    prevOutScripts,
    {
      hash: Buffer.from(idUtxo.txid, 'hex').reverse(),
      index: idUtxo.outputIndex,
      sequence: 0xffffffff,
      script: Buffer.from(idUtxo.script, 'hex'),
    },
  );

  const allUtxos: Utxo[] = [...selection.selected, idUtxo];
  // The identity input and its recreated output are both value 0, so the
  // assembled native fee must equal selection.fee. Fail loudly on any slip.
  assertNativeConservation(
    allUtxos,
    Transaction.fromHex(completedHex, verusNetwork).outs,
    selection.fee,
    intent.label,
  );

  const { signedTx, txid } = signTransactionSmart(completedHex, intent.wif, allUtxos, verusNetwork);

  return {
    signedTx,
    txid,
    fee: selection.fee,
    nativeChange: selection.nativeChange,
    selected: selection.selected,
    inputsUsed: allUtxos.length,
  };
}
