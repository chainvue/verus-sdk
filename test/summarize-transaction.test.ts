/**
 * summarizeSignedTransaction — the consumer-facing decode used by wallet
 * ledgers (Peculium E3b): exact consumed outpoints + outputs with addresses.
 */

import { describe, expect, it } from 'vitest';
import { VerusSDK } from '../src/index.js';
import { summarizeSignedTransaction } from '../src/utils/index.js';
import {
  TEST_WIF,
  TEST_ADDRESS,
  TEST_ADDRESS_B,
  makeFundingUtxo,
  NETWORK,
} from './fixtures/index.js';

describe('summarizeSignedTransaction', () => {
  it('reports txid, consumed outpoints and addressed outputs of a transfer', () => {
    const sdk = new VerusSDK({ network: NETWORK });
    const utxoA = makeFundingUtxo('aa', 60_000_000);
    const utxoB = makeFundingUtxo('bb', 70_000_000);
    const result = sdk.transfer({
      wif: TEST_WIF,
      to: TEST_ADDRESS_B,
      amount: 100_000_000, // needs both inputs
      utxos: [utxoA, utxoB],
      changeAddress: TEST_ADDRESS,
    });

    const summary = summarizeSignedTransaction(result.signedTx, NETWORK);

    expect(summary.txid).toBe(result.txid);
    expect(summary.inputs).toHaveLength(result.inputsUsed);
    const outpoints = summary.inputs.map((i) => `${i.txid}:${i.vout}`);
    expect(outpoints).toContain(`${'aa'.repeat(32)}:0`);
    expect(outpoints).toContain(`${'bb'.repeat(32)}:0`);

    const toRecipient = summary.outputs.find((o) => o.address === TEST_ADDRESS_B);
    expect(toRecipient?.valueSat).toBe(100_000_000);
    const change = summary.outputs.find((o) => o.address === TEST_ADDRESS);
    expect(change?.valueSat).toBe(result.nativeChange);
    // Value conservation: inputs = outputs + fee.
    const outSum = summary.outputs.reduce((sum, o) => sum + o.valueSat, 0);
    expect(outSum + result.fee).toBe(130_000_000);
  });
});
