/**
 * Client-side UTXO selection for Verus transactions
 *
 * Selects UTXOs to cover required native + currency amounts,
 * calculates fees, and determines change outputs.
 */

import { smarttxs } from '@bitgo/utxo-lib';
import { NETWORK_CONFIG, DEFAULT_FEE_PER_KB, DUST_THRESHOLD } from '../constants/index.js';
import { InsufficientFundsError } from '../errors.js';
import type { Utxo, DecodedUtxo, SelectionResult } from '../types/index.js';

const { unpackOutput } = smarttxs;

// Re-export types for convenience
export type { Utxo, DecodedUtxo, SelectionResult };

// Transaction size estimation constants
const INPUT_SIZE = 180;
const P2PKH_OUTPUT_SIZE = 34;
const SMART_OUTPUT_SIZE = 200;
const TX_OVERHEAD = 60;

/**
 * Decode a UTXO's script to extract currency values
 */
export function decodeUtxo(utxo: Utxo, systemId: string): DecodedUtxo {
  const currencyValues = new Map<string, number>();

  try {
    const output = {
      value: utxo.satoshis,
      script: Buffer.from(utxo.script, 'hex'),
    };
    const unpacked = unpackOutput(output, systemId, true);

    for (const [currency, value] of Object.entries(unpacked.values)) {
      const amount = typeof value === 'number' ? value : (value as any).toNumber();
      if (amount > 0) {
        currencyValues.set(currency, amount);
      }
    }
  } catch {
    // If unpacking fails, treat as native-only
    if (utxo.satoshis > 0) {
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
  feePerKb: number = DEFAULT_FEE_PER_KB,
  hasSmartOutputs: boolean = false
): number {
  const outputSize = hasSmartOutputs ? SMART_OUTPUT_SIZE : P2PKH_OUTPUT_SIZE;
  const txSize = TX_OVERHEAD + numInputs * INPUT_SIZE + numOutputs * outputSize;
  const fee = Math.ceil((txSize / 1000) * feePerKb);
  return Math.max(fee, 10000);
}

/**
 * Select UTXOs to cover required amounts
 */
export function selectUtxos(
  utxos: Utxo[],
  requiredNative: number,
  requiredCurrencies: Map<string, number> = new Map(),
  numOutputs: number = 2,
  systemId: string = NETWORK_CONFIG.mainnet.chainId,
  feePerKb: number = DEFAULT_FEE_PER_KB,
  hasSmartOutputs: boolean = false
): SelectionResult {
  const decoded = utxos.map((u) => decodeUtxo(u, systemId));

  const remaining = new Map<string, number>(requiredCurrencies);
  let remainingNative = requiredNative;

  const selected: DecodedUtxo[] = [];

  // Phase 1: Select UTXOs that have required non-native currencies
  if (remaining.size > 0) {
    for (const utxo of decoded) {
      if (selected.includes(utxo)) continue;

      let hasNeededCurrency = false;
      for (const [currency, needed] of remaining) {
        if (currency === systemId) continue;
        const utxoAmount = utxo.currencyValues.get(currency) || 0;
        if (utxoAmount > 0 && needed > 0) {
          hasNeededCurrency = true;
          break;
        }
      }

      if (hasNeededCurrency) {
        selected.push(utxo);
        for (const [currency, amount] of utxo.currencyValues) {
          if (currency === systemId) {
            remainingNative -= amount;
          } else {
            const needed = remaining.get(currency) || 0;
            remaining.set(currency, needed - amount);
          }
        }
        remainingNative -= utxo.satoshis;
      }
    }

    for (const [currency, needed] of remaining) {
      if (currency !== systemId && needed > 0) {
        const totalAvailable = decoded.reduce((sum, u) => sum + (u.currencyValues.get(currency) || 0), 0);
        throw new InsufficientFundsError(
          needed + totalAvailable, totalAvailable, currency,
        );
      }
    }
  }

  // Phase 2: Select UTXOs for native amount + fee
  const nativeOnly = decoded
    .filter((u) => !selected.includes(u))
    .sort((a, b) => b.satoshis - a.satoshis);

  let changeOutputCount = 0;
  for (const [currency, needed] of remaining) {
    if (currency !== systemId && needed < 0) {
      changeOutputCount++;
    }
  }

  let fee = estimateFee(
    selected.length + 1,
    numOutputs + 1 + changeOutputCount,
    feePerKb,
    hasSmartOutputs
  );

  while (remainingNative + fee > 0) {
    const next = nativeOnly.shift();
    if (!next) {
      const totalAvailable = decoded.reduce((sum, u) => sum + u.satoshis, 0);
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
  const totalNativeIn = selected.reduce((sum, u) => sum + u.satoshis, 0);
  const actualNativeChange = totalNativeIn - requiredNative - fee;

  const currencyChanges = new Map<string, number>();
  for (const [currency, needed] of remaining) {
    if (currency !== systemId && needed < 0) {
      currencyChanges.set(currency, -needed);
    }
  }

  const finalNativeChange =
    actualNativeChange > DUST_THRESHOLD ? actualNativeChange : 0;
  const finalFee =
    actualNativeChange > DUST_THRESHOLD ? fee : fee + actualNativeChange;

  return {
    selected: selected.map(({ currencyValues, ...utxo }) => utxo),
    nativeChange: finalNativeChange,
    currencyChanges,
    fee: finalFee,
  };
}
