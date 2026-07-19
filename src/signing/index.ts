/**
 * Transaction signing using @bitgo/utxo-lib
 *
 * Wraps the Verus fork of utxo-lib's TransactionBuilder to handle:
 * - Standard P2PKH signing
 * - Smart transaction signing (CryptoConditions/OptCCParams)
 * - Mixed transactions (P2PKH inputs + smart tx inputs)
 */

import {
  ECPair,
  Transaction,
  TransactionBuilder,
  networks,
  smarttxs,
} from '@bitgo/utxo-lib';
import type { Utxo } from '../types/index.js';
import { VERSION_GROUP_ID } from '../constants/index.js';
import { toSafeNumber } from '../utils/index.js';
import { TransactionBuildError } from '../errors.js';

const { getFundedTxBuilder, validateFundedCurrencyTransfer } = smarttxs;

/** Network to use for signing */
export type VerusNetwork = typeof networks.verus;

/**
 * Resolve the transaction expiry height, requiring an explicit choice.
 *
 * A Sapling-format transaction with nExpiryHeight 0 never expires. Silently
 * defaulting to 0 produced never-expiring transactions — a replay / stuck-tx
 * footgun in the Verus model, where the daemon itself always sets an expiry.
 * This SDK is offline and cannot read the chain tip, so the caller must decide:
 * pass `currentBlockHeight + DEFAULT_EXPIRY_DELTA` to bound the transaction, or
 * an explicit `0` to opt into never-expiring.
 */
export function resolveExpiryHeight(expiryHeight: number | undefined): number {
  if (expiryHeight === undefined) {
    throw new TransactionBuildError(
      'expiryHeight is required: pass currentBlockHeight + DEFAULT_EXPIRY_DELTA to bound the ' +
        'transaction (this SDK is offline and cannot read the chain tip), or expiryHeight: 0 to ' +
        'explicitly never expire.',
    );
  }
  if (!Number.isInteger(expiryHeight) || expiryHeight < 0) {
    throw new TransactionBuildError(
      `Invalid expiryHeight: must be a non-negative integer (got ${expiryHeight})`,
    );
  }
  // Sapling consensus caps nExpiryHeight below TX_EXPIRY_HEIGHT_THRESHOLD
  // (500,000,000). A value at/above it — e.g. a UNIX timestamp passed by
  // mistake — produces a transaction the daemon will never mine.
  if (expiryHeight >= 500_000_000) {
    throw new TransactionBuildError(
      `Invalid expiryHeight: must be below 500000000 (got ${expiryHeight}); this looks like a timestamp, not a block height`,
    );
  }
  return expiryHeight;
}

/**
 * Assert that a fully-assembled transaction's native value is conserved: the
 * sum of input values minus the sum of output values must equal the fee the
 * builder intends to pay. Catches a selection/accounting slip (or a
 * value-bearing input that would otherwise be burned) before signing — the same
 * guard buildAndSign and VRSC registration already use.
 */
export function assertNativeConservation(
  inputUtxos: ReadonlyArray<{ satoshis: bigint }>,
  txOuts: ReadonlyArray<{ value: number }>,
  expectedFeeSats: bigint,
  label: string,
): void {
  const totalIn = inputUtxos.reduce((sum, u) => sum + u.satoshis, 0n);
  const totalOut = txOuts.reduce((sum, o) => sum + BigInt(o.value), 0n);
  const assembled = totalIn - totalOut;
  if (assembled !== expectedFeeSats) {
    throw new TransactionBuildError(
      `${label} value conservation failed: assembled native fee ${assembled} sat != intended ${expectedFeeSats} sat`,
    );
  }
}

/**
 * Get the Verus network config
 */
export function getNetwork(testnet: boolean = false): VerusNetwork {
  return testnet ? networks.verustest : networks.verus;
}

/**
 * Sign a pre-built transaction hex with a single WIF key
 *
 * `maxFeeSats`: utxo-lib's TransactionBuilder enforces a last-resort fee-RATE
 * cap (default 2500 sat/vbyte) at build() and throws "Transaction has absurd
 * fees" above it. An identity registration intentionally burns the protocol
 * fee (~100 native) as an implicit miner fee — far above any sane rate cap —
 * so callers that KNOW their intended absolute fee pass it here. It is
 * converted into a rate bound using the unsigned hex size as a lower bound of
 * the final vsize (signatures only grow a tx).
 *
 * WARNING — do NOT rely on this as a value-conservation backstop. The fork's
 * `__overMaximumFees` sums input values with `x.value >>> 0`, truncating each
 * input mod 2^32; for any input above ~42.94 VRSC (2^32 sats) the computed fee
 * wraps and the guard is effectively blind. Every money path therefore enforces
 * bigint conservation itself (assertNativeConservation) BEFORE calling this;
 * this cap is only a coarse secondary sanity bound on small-input transactions.
 */
export function signTransactionSmart(
  txHex: string,
  wif: string,
  utxos: Utxo[],
  network: VerusNetwork = networks.verus,
  maxFeeSats?: bigint
): { signedTx: string; txid: string } {
  const keyPair = ECPair.fromWIF(wif, network);
  const prevOutScripts = utxos.map((u) => Buffer.from(u.script, 'hex'));

  const txb = getFundedTxBuilder(txHex, network, prevOutScripts);
  if (maxFeeSats !== undefined) {
    // The fork's .d.ts omits maximumFeeRate, but it exists at runtime
    // (transaction_builder.js: `this.maximumFeeRate = maximumFeeRate || 2500`).
    (txb as { maximumFeeRate?: number }).maximumFeeRate = Math.ceil(
      toSafeNumber(maxFeeSats) / (txHex.length / 2),
    );
  }

  for (let i = 0; i < utxos.length; i++) {
    const utxo = utxos[i];
    if (!utxo) continue;
    txb.sign(i, keyPair, null, Transaction.SIGHASH_ALL, toSafeNumber(utxo.satoshis));
  }

  const signedTx = txb.build();
  return {
    signedTx: signedTx.toHex(),
    txid: signedTx.getId(),
  };
}

/**
 * Sign a transaction with multiple keys (for multi-signature or mixed-authority inputs)
 */
export function signTransactionMultiKey(
  txHex: string,
  keys: string[][],
  utxos: Utxo[],
  network: VerusNetwork = networks.verus
): { signedTx: string; txid: string } {
  const prevOutScripts = utxos.map((u) => Buffer.from(u.script, 'hex'));
  const txb = getFundedTxBuilder(txHex, network, prevOutScripts);

  for (let i = 0; i < keys.length; i++) {
    const inputKeys = keys[i];
    const utxo = utxos[i];
    if (!inputKeys || inputKeys.length === 0 || !utxo) continue;
    for (const wif of inputKeys) {
      if (!wif) continue;
      const keyPair = ECPair.fromWIF(wif, network);
      txb.sign(i, keyPair, null, Transaction.SIGHASH_ALL, toSafeNumber(utxo.satoshis));
    }
  }

  const signedTx = txb.build();
  return {
    signedTx: signedTx.toHex(),
    txid: signedTx.getId(),
  };
}

/**
 * Create a new TransactionBuilder for manual transaction construction
 */
export function createTransactionBuilder(
  network: VerusNetwork = networks.verus,
  expiryHeight: number = 0,
  version: number = 4,
  versionGroupId: number = VERSION_GROUP_ID
): InstanceType<typeof TransactionBuilder> {
  const txb = new TransactionBuilder(network);
  txb.setVersion(version);
  txb.setExpiryHeight(expiryHeight);
  txb.setVersionGroupId(versionGroupId);
  return txb;
}

/**
 * Validate a funded transaction against its unfunded version
 */
export function validateFundedTransaction(
  systemId: string,
  fundedTxHex: string,
  unfundedTxHex: string,
  changeAddress: string,
  network: VerusNetwork,
  utxoList: Utxo[]
): {
  valid: boolean;
  message?: string;
  fees?: Record<string, number>;
  sent?: Record<string, number>;
} {
  const result = validateFundedCurrencyTransfer(
    systemId,
    fundedTxHex,
    unfundedTxHex,
    changeAddress,
    network,
    utxoList.map((u) => ({
      txid: u.txid,
      outputIndex: u.outputIndex,
      satoshis: toSafeNumber(u.satoshis),
      script: u.script,
      height: u.height || 0,
    }))
  );

  return result;
}
