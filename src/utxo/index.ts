/**
 * Client-side UTXO selection for Verus transactions
 *
 * Selects UTXOs to cover required native + currency amounts,
 * calculates fees, and determines change outputs.
 *
 * All amounts are bigint satoshis — exact integer arithmetic only.
 */

import { smarttxs, script as bscript, opcodes } from '@bitgo/utxo-lib';
import { NETWORK_CONFIG, DEFAULT_FEE_PER_KB, DUST_THRESHOLD } from '../constants/index.js';
import { InsufficientFundsError, TransactionBuildError } from '../errors.js';
import { toSafeNumber } from '../utils/index.js';
import type { Utxo, DecodedUtxo, SelectionResult } from '../types/index.js';

const { unpackOutput } = smarttxs;

// Re-export types for convenience
export type { Utxo, DecodedUtxo, SelectionResult };

// Transaction size estimation constants
const INPUT_SIZE = 180;
const P2PKH_OUTPUT_SIZE = 34;
const SMART_OUTPUT_SIZE = 200;
const TX_OVERHEAD = 60;

/** Absolute fee floor in satoshis */
const MIN_FEE = 10_000n;

/**
 * True when the script is a Verus smart (CryptoCondition) output. Used to
 * separate "plain script that unpackOutput doesn't model" (fine — native
 * only) from "smart output that failed to decode" (dangerous — the UTXO may
 * carry token value we cannot see).
 */
function isSmartTransactionScript(script: Buffer): boolean {
  try {
    const chunks = bscript.decompile(script);
    if (chunks === null) return false;
    return chunks.some(
      (chunk) => typeof chunk === 'number' && chunk === opcodes.OP_CHECKCRYPTOCONDITION,
    );
  } catch {
    return false;
  }
}

/**
 * Decode a UTXO's script to extract currency values
 *
 * Throws TransactionBuildError if a smart output fails to decode — a failed
 * token decode must never be silently reclassified as native-only, because
 * selection would then spend token value it did not account for.
 */
export function decodeUtxo(utxo: Utxo, systemId: string): DecodedUtxo {
  const currencyValues = new Map<string, bigint>();
  const script = Buffer.from(utxo.script, 'hex');
  const nativeValue = toSafeNumber(utxo.satoshis);

  try {
    const unpacked = unpackOutput({ value: nativeValue, script }, systemId, true);

    for (const [currency, value] of Object.entries(unpacked.values)) {
      const amount = BigInt(value.toString(10));
      if (amount > 0n) {
        currencyValues.set(currency, amount);
      }
    }
  } catch (err) {
    if (isSmartTransactionScript(script)) {
      throw new TransactionBuildError(
        `cannot decode smart output ${utxo.txid}:${utxo.outputIndex}: ${(err as Error).message}`,
      );
    }
    // Plain script that unpackOutput doesn't model (e.g. P2SH) — native-only
    if (utxo.satoshis > 0n) {
      currencyValues.set(systemId, utxo.satoshis);
    }
  }

  return { ...utxo, currencyValues };
}

/**
 * Estimate transaction fee based on input/output counts
 */
export function estimateFee(
  numInputs: number,
  numOutputs: number,
  feePerKb: bigint = DEFAULT_FEE_PER_KB,
  hasSmartOutputs: boolean = false
): bigint {
  const outputSize = hasSmartOutputs ? SMART_OUTPUT_SIZE : P2PKH_OUTPUT_SIZE;
  const txSize = TX_OVERHEAD + numInputs * INPUT_SIZE + numOutputs * outputSize;
  const fee = (BigInt(txSize) * feePerKb + 999n) / 1000n; // ceil(txSize * feePerKb / 1000)
  return fee > MIN_FEE ? fee : MIN_FEE;
}

/**
 * Select UTXOs to cover required amounts
 */
export function selectUtxos(
  utxos: Utxo[],
  requiredNative: bigint,
  requiredCurrencies: Map<string, bigint> = new Map(),
  numOutputs: number = 2,
  systemId: string = NETWORK_CONFIG.mainnet.chainId,
  feePerKb: bigint = DEFAULT_FEE_PER_KB,
  hasSmartOutputs: boolean = false
): SelectionResult {
  // Reject duplicate outpoints up front. An outpoint can only be spent once, so
  // the same (txid, outputIndex) twice is always a caller error. Left unchecked
  // its value is double-counted here (corrupting the funds accounting) and the
  // failure only surfaces later as an untyped low-level "Duplicate TxOut" from
  // the builder. Fail closed early with a typed error instead.
  const seenOutpoints = new Set<string>();
  for (const u of utxos) {
    const outpoint = `${u.txid}:${u.outputIndex}`;
    if (seenOutpoints.has(outpoint)) {
      throw new TransactionBuildError(`Duplicate UTXO in inputs: ${outpoint} appears more than once`);
    }
    seenOutpoints.add(outpoint);
  }

  const decoded = utxos.map((u) => decodeUtxo(u, systemId));

  const remaining = new Map<string, bigint>(requiredCurrencies);
  let remainingNative = requiredNative;

  const selected: DecodedUtxo[] = [];

  // Phase 1: Select UTXOs that have required non-native currencies
  if (remaining.size > 0) {
    for (const utxo of decoded) {
      if (selected.includes(utxo)) continue;

      let hasNeededCurrency = false;
      for (const [currency, needed] of remaining) {
        if (currency === systemId) continue;
        const utxoAmount = utxo.currencyValues.get(currency) || 0n;
        if (utxoAmount > 0n && needed > 0n) {
          hasNeededCurrency = true;
          break;
        }
      }

      if (hasNeededCurrency) {
        selected.push(utxo);
        for (const [currency, amount] of utxo.currencyValues) {
          // The UTXO's native value is credited once below via utxo.satoshis;
          // unpackOutput also reports it under systemId in currencyValues, so
          // skipping it here avoids double-counting.
          if (currency === systemId) continue;
          const needed = remaining.get(currency) || 0n;
          remaining.set(currency, needed - amount);
        }
        remainingNative -= utxo.satoshis;
      }
    }

    for (const [currency, needed] of remaining) {
      if (currency !== systemId && needed > 0n) {
        const totalAvailable = decoded.reduce(
          (sum, u) => sum + (u.currencyValues.get(currency) || 0n),
          0n,
        );
        throw new InsufficientFundsError(
          needed + totalAvailable, totalAvailable, currency,
        );
      }
    }
  }

  // Phase 2: Select UTXOs for native amount + fee
  const nativeOnly = decoded
    .filter((u) => !selected.includes(u))
    .sort((a, b) => (b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0));

  let changeOutputCount = 0;
  for (const [currency, needed] of remaining) {
    if (currency !== systemId && needed < 0n) {
      changeOutputCount++;
    }
  }

  let fee = estimateFee(
    selected.length + 1,
    numOutputs + 1 + changeOutputCount,
    feePerKb,
    hasSmartOutputs
  );

  while (remainingNative + fee > 0n) {
    const next = nativeOnly.shift();
    if (!next) {
      const totalAvailable = decoded.reduce((sum, u) => sum + u.satoshis, 0n);
      throw new InsufficientFundsError(
        requiredNative + fee, totalAvailable, 'VRSC',
      );
    }

    selected.push(next);
    remainingNative -= next.satoshis;

    fee = estimateFee(
      selected.length,
      numOutputs + 1 + changeOutputCount,
      feePerKb,
      hasSmartOutputs
    );
  }

  // Calculate change
  const totalNativeIn = selected.reduce((sum, u) => sum + u.satoshis, 0n);
  const actualNativeChange = totalNativeIn - requiredNative - fee;

  const currencyChanges = new Map<string, bigint>();
  for (const [currency, needed] of remaining) {
    if (currency !== systemId && needed < 0n) {
      currencyChanges.set(currency, -needed);
    }
  }

  const finalNativeChange =
    actualNativeChange > DUST_THRESHOLD ? actualNativeChange : 0n;
  const finalFee =
    actualNativeChange > DUST_THRESHOLD ? fee : fee + actualNativeChange;

  return {
    selected: selected.map(({ currencyValues: _currencyValues, ...utxo }) => utxo),
    nativeChange: finalNativeChange,
    currencyChanges,
    fee: finalFee,
  };
}
