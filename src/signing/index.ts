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

const { getFundedTxBuilder, validateFundedCurrencyTransfer } = smarttxs;

/** Network to use for signing */
export type VerusNetwork = typeof networks.verus | typeof networks.verustest;

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
 * the final vsize (signatures only grow a tx), so the guard still trips if
 * the actual fee materially exceeds the declared one.
 */
export function signTransactionSmart(
  txHex: string,
  wif: string,
  utxos: Utxo[],
  network: VerusNetwork = networks.verus,
  maxFeeSats?: number
): { signedTx: string; txid: string } {
  const keyPair = ECPair.fromWIF(wif, network);
  const prevOutScripts = utxos.map((u) => Buffer.from(u.script, 'hex'));

  const txb = getFundedTxBuilder(txHex, network, prevOutScripts);
  if (maxFeeSats !== undefined) {
    // The fork's .d.ts omits maximumFeeRate, but it exists at runtime
    // (transaction_builder.js: `this.maximumFeeRate = maximumFeeRate || 2500`).
    (txb as { maximumFeeRate?: number }).maximumFeeRate = Math.ceil(
      maxFeeSats / (txHex.length / 2),
    );
  }

  for (let i = 0; i < utxos.length; i++) {
    txb.sign(i, keyPair, null, Transaction.SIGHASH_ALL, utxos[i].satoshis);
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
    if (!keys[i] || keys[i].length === 0) continue;
    for (const wif of keys[i]) {
      if (!wif) continue;
      const keyPair = ECPair.fromWIF(wif, network);
      txb.sign(i, keyPair, null, Transaction.SIGHASH_ALL, utxos[i].satoshis);
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
      satoshis: u.satoshis,
      script: u.script,
      height: u.height || 0,
    }))
  );

  return result;
}
