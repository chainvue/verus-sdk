/**
 * summarizeSignedTransaction — the consumer-facing decode used by wallet
 * ledgers (Peculium E3b): exact consumed outpoints + outputs with addresses.
 */

import { describe, expect, it } from 'vitest';
import { TransactionBuilder, networks } from '@bitgo/utxo-lib';
import { VerusSDK } from '../src/index.js';
import { summarizeSignedTransaction } from '../src/utils/index.js';
import { buildReferralPaymentScript, prepareNameCommitment } from '../src/identity/index.js';
import { VERSION_GROUP_ID } from '../src/constants/index.js';
import {
  TEST_WIF,
  TEST_ADDRESS,
  TEST_ADDRESS_B,
  makeFundingUtxo,
  NETWORK,
} from './fixtures/index.js';

/** Build an UNSIGNED tx with the given output scripts (summarize only parses). */
function unsignedTxWithOutputs(outputs: Array<{ script: Buffer; value: number }>): string {
  const txb = new TransactionBuilder(networks.verustest);
  txb.setVersion(4);
  txb.setExpiryHeight(0);
  txb.setVersionGroupId(VERSION_GROUP_ID);
  txb.addInput(Buffer.from('ab'.repeat(32), 'hex'), 0);
  for (const out of outputs) {
    txb.addOutput(out.script, out.value);
  }
  return txb.buildIncomplete().toHex();
}

describe('summarizeSignedTransaction', () => {
  it('reports txid, consumed outpoints and addressed outputs of a transfer', () => {
    const sdk = new VerusSDK({ network: NETWORK });
    const utxoA = makeFundingUtxo('aa', 60_000_000n);
    const utxoB = makeFundingUtxo('bb', 70_000_000n);
    const result = sdk.transfer({
      wif: TEST_WIF,
      to: TEST_ADDRESS_B,
      amount: 100_000_000n, // needs both inputs
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
    expect(toRecipient?.valueSat).toBe(100_000_000n);
    const change = summary.outputs.find((o) => o.address === TEST_ADDRESS);
    expect(change?.valueSat).toBe(result.nativeChange);
    // Value conservation: inputs = outputs + fee.
    const outSum = summary.outputs.reduce((sum, o) => sum + o.valueSat, 0n);
    expect(outSum + result.fee).toBe(130_000_000n);
  });

  it('decodes a P2ID payment output to its i-address (identity change, ring 4)', () => {
    // The persistent P2ID ring identity — any registered i-address works.
    const iAddress = 'i5Ej7Bec8AYqxBbFEEd3UCKKhhpqAAm1rh';
    const hex = unsignedTxWithOutputs([
      { script: buildReferralPaymentScript(iAddress), value: 4_000_000 },
    ]);

    const summary = summarizeSignedTransaction(hex, NETWORK);
    expect(summary.outputs).toHaveLength(1);
    expect(summary.outputs[0]?.address).toBe(iAddress);
    expect(summary.outputs[0]?.valueSat).toBe(4_000_000n);
  });

  it('keeps STRUCTURAL smart outputs at address null (commitment locator contract)', () => {
    // The registration flow locates the commitment output by address === null
    // — a name commitment must never decode to an address.
    const commitment = prepareNameCommitment('sumnulltest', TEST_ADDRESS, undefined, undefined, NETWORK);
    const hex = unsignedTxWithOutputs([
      { script: commitment.commitmentScript, value: 0 },
    ]);

    const summary = summarizeSignedTransaction(hex, NETWORK);
    expect(summary.outputs).toHaveLength(1);
    expect(summary.outputs[0]?.address).toBeNull();
  });
});
