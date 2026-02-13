import { describe, it, expect } from 'vitest';
import { selectUtxos, estimateFee, decodeUtxo } from '../src/utxo/index.js';
import { NETWORK_CONFIG } from '../src/constants/index.js';
import type { Utxo } from '../src/types/index.js';

const SYSTEM_ID = NETWORK_CONFIG.testnet.chainId;

function makeUtxo(satoshis: number, index: number = 0): Utxo {
  // Simple P2PKH scriptPubKey (OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG)
  const hash = Buffer.alloc(20, index);
  const script = Buffer.concat([
    Buffer.from([0x76, 0xa9, 0x14]),
    hash,
    Buffer.from([0x88, 0xac]),
  ]);
  return {
    txid: Buffer.alloc(32, index).toString('hex'),
    outputIndex: 0,
    satoshis,
    script: script.toString('hex'),
  };
}

describe('utxo', () => {
  describe('estimateFee', () => {
    it('should return minimum 10000 for small transactions', () => {
      expect(estimateFee(1, 1)).toBeGreaterThanOrEqual(10000);
    });

    it('should increase with more inputs', () => {
      const fee1 = estimateFee(1, 2);
      const fee5 = estimateFee(5, 2);
      expect(fee5).toBeGreaterThan(fee1);
    });

    it('should use larger output size for smart outputs', () => {
      // With many outputs, the difference exceeds the 10000 minimum floor
      const feeP2PKH = estimateFee(5, 5, undefined, false);
      const feeSmart = estimateFee(5, 5, undefined, true);
      expect(feeSmart).toBeGreaterThan(feeP2PKH);
    });
  });

  describe('selectUtxos', () => {
    it('should select enough UTXOs to cover amount + fee', () => {
      const utxos = [
        makeUtxo(1_000_000, 1),
        makeUtxo(5_000_000, 2),
        makeUtxo(10_000_000, 3),
      ];

      const result = selectUtxos(utxos, 3_000_000, new Map(), 2, SYSTEM_ID);
      expect(result.selected.length).toBeGreaterThan(0);
      const totalIn = result.selected.reduce((s, u) => s + u.satoshis, 0);
      expect(totalIn).toBeGreaterThanOrEqual(3_000_000 + result.fee);
      expect(result.nativeChange).toBeGreaterThanOrEqual(0);
    });

    it('should throw when insufficient funds', () => {
      const utxos = [makeUtxo(100, 1)];
      expect(() =>
        selectUtxos(utxos, 1_000_000, new Map(), 2, SYSTEM_ID)
      ).toThrow('Insufficient VRSC balance');
    });

    it('should absorb dust change into fee', () => {
      // Create a UTXO that's just slightly more than needed
      const fee = estimateFee(1, 3, undefined, false);
      const needed = 1_000_000;
      const dustExtra = 100; // less than 546 threshold
      const utxos = [makeUtxo(needed + fee + dustExtra, 1)];

      const result = selectUtxos(utxos, needed, new Map(), 2, SYSTEM_ID);
      // Change should be 0 (dust absorbed) or the exact fee slightly differs
      expect(result.nativeChange === 0 || result.nativeChange > 546).toBe(true);
    });

    it('should select largest UTXOs first for native', () => {
      const utxos = [
        makeUtxo(100_000, 1),
        makeUtxo(50_000_000, 2),
        makeUtxo(200_000, 3),
      ];

      const result = selectUtxos(utxos, 1_000_000, new Map(), 2, SYSTEM_ID);
      // Should have selected the largest UTXO (50M)
      expect(result.selected.length).toBe(1);
      expect(result.selected[0].satoshis).toBe(50_000_000);
    });
  });
});
