import { describe, it, expect } from 'vitest';
import { buildAndSign } from '../src/transfer/index.js';
import { addressToScriptPubKey } from '../src/utils/index.js';

const TEST_WIF = 'UusoQWsobQKUkezgBJa22D9G4t9Avo6k8wD5UUxmmfAEoTN8bawc';
const TEST_ADDR = 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX';
const TEST_ADDR_B = 'RPsQDnaxXgrLjcVBh3SpvCpTabWxAdMdzu';

function makeP2PKHScript(address: string): string {
  return addressToScriptPubKey(address).toString('hex');
}

describe('transfer', () => {
  describe('buildAndSign', () => {
    it('should build and sign a simple P2PKH transaction', () => {
      const script = makeP2PKHScript(TEST_ADDR);
      const result = buildAndSign({
        wif: TEST_WIF,
        inputs: [{
          txid: 'a'.repeat(64),
          vout: 0,
          scriptPubKey: script,
          amount: 100_000_000n, // 1 VRSC
        }],
        outputs: [{
          address: TEST_ADDR_B,
          amount: 99_990_000n, // Leave 10000 sat fee (0.0001 VRSC)
        }],
      }, 'testnet');

      expect(result.signedTx).toBeTruthy();
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
      expect(result.fee).toBe(10_000n); // 0.0001 VRSC
    });

    it('should use explicit fee if provided', () => {
      const script = makeP2PKHScript(TEST_ADDR);
      const result = buildAndSign({
        wif: TEST_WIF,
        inputs: [{
          txid: 'b'.repeat(64),
          vout: 0,
          scriptPubKey: script,
          amount: 200_000_000n,
        }],
        outputs: [{
          address: TEST_ADDR_B,
          amount: 199_950_000n,
        }],
        fee: 50_000n,
      }, 'testnet');

      expect(result.fee).toBe(50_000n);
    });

    it('should throw on insufficient funds', () => {
      const script = makeP2PKHScript(TEST_ADDR);
      expect(() =>
        buildAndSign({
          wif: TEST_WIF,
          inputs: [{
            txid: 'c'.repeat(64),
            vout: 0,
            scriptPubKey: script,
            amount: 1_000n,
          }],
          outputs: [{
            address: TEST_ADDR_B,
            amount: 100_000_000n,
          }],
          fee: 10_000n,
        }, 'testnet')
      ).toThrow('Insufficient funds');
    });
  });
});
