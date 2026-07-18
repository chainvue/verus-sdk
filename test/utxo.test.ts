import { describe, it, expect } from 'vitest';
import { selectUtxos, estimateFee } from '../src/utxo/index.js';
import { NETWORK_CONFIG } from '../src/constants/index.js';
import { TransactionBuildError } from '../src/errors.js';
import type { Utxo } from '../src/types/index.js';

const SYSTEM_ID = NETWORK_CONFIG.testnet.chainId;

function makeUtxo(satoshis: bigint, index: number = 0): Utxo {
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
      expect(estimateFee(1, 1)).toBeGreaterThanOrEqual(10000n);
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

    it('scales the fee with pre-built output bytes (large identity outputs)', () => {
      const base = estimateFee(2, 2, undefined, true);
      // e.g. an identity output carrying a ~5 KB contentMultimap
      const withLargeOutput = estimateFee(2, 2, undefined, true, 5000);
      expect(withLargeOutput).toBeGreaterThan(base);
      // ~5000 bytes at the default 10000 sat/KB ≈ +50000 sat
      expect(withLargeOutput - base).toBeGreaterThanOrEqual(45_000n);
    });
  });

  describe('selectUtxos', () => {
    // A real VRSCTEST reserve-output script (ownora-collection token
    // i4At2tf5…, 5.0). decodeUtxo parses its currency values from the script;
    // the native `satoshis` is supplied separately, as a mixed/conversion
    // output carries both.
    const TOKEN = 'i4At2tf5ChLPV9pQgt7RiRQSSEdiRouRva';
    const TOKEN_SCRIPT =
      '1b0403000101150407a1d5aeb8f5202aba353a0c24a1aac2b04c3146cc360403090101150407a1d5aeb8f5202aba353a0c24a1aac2b04c31461a0107a1d5aeb8f5202aba353a0c24a1aac2b04c314680edb4c90075';

    it('emits token change instead of burning it when a mixed UTXO covers native (regression)', () => {
      // Phase-2 selection used to treat a token-carrying UTXO as native-only and
      // drop its currency — spending the token with no output (silent burn).
      const mixed: Utxo = {
        txid: 'bd0cfac4603ca7e9f0a317de8046fedff419a5cf4e6e635e9e466a611d1fb401',
        outputIndex: 2,
        satoshis: 500_000_000n, // 5 VRSC native + 5.0 token on the same output
        script: TOKEN_SCRIPT,
      };
      const result = selectUtxos([mixed], 100_000_000n, new Map(), 2, SYSTEM_ID);
      expect(result.selected.length).toBe(1);
      // The 5.0 token must be returned as change, not silently spent.
      expect(result.currencyChanges.get(TOKEN)).toBe(500_000_000n);
    });

    it('prefers a pure-native UTXO over a token-carrying one when either covers native', () => {
      const pureNative = makeUtxo(500_000_000n, 7);
      const mixed: Utxo = {
        txid: 'bd0cfac4603ca7e9f0a317de8046fedff419a5cf4e6e635e9e466a611d1fb401',
        outputIndex: 2,
        satoshis: 500_000_000n,
        script: TOKEN_SCRIPT,
      };
      const result = selectUtxos([mixed, pureNative], 100_000_000n, new Map(), 2, SYSTEM_ID);
      // Only the pure-native UTXO is spent; the token UTXO is left untouched.
      expect(result.selected).toHaveLength(1);
      expect(result.selected[0]?.txid).toBe(pureNative.txid);
      expect(result.currencyChanges.size).toBe(0);
    });

    it('rejects a duplicate outpoint with a typed error (no double-count)', () => {
      // makeUtxo(_, index) keys txid on index and uses outputIndex 0, so the
      // same index twice is the same outpoint. Without the guard its value is
      // double-counted and the failure surfaces late as an untyped builder
      // "Duplicate TxOut".
      const dup = makeUtxo(200_000n, 1);
      expect(() =>
        selectUtxos([dup, dup], 250_000n, new Map(), 2, SYSTEM_ID)
      ).toThrow(TransactionBuildError);
      expect(() =>
        selectUtxos([dup, dup], 250_000n, new Map(), 2, SYSTEM_ID)
      ).toThrow(/Duplicate UTXO/);
    });

    it('should select enough UTXOs to cover amount + fee', () => {
      const utxos = [
        makeUtxo(1_000_000n, 1),
        makeUtxo(5_000_000n, 2),
        makeUtxo(10_000_000n, 3),
      ];

      const result = selectUtxos(utxos, 3_000_000n, new Map(), 2, SYSTEM_ID);
      expect(result.selected.length).toBeGreaterThan(0);
      const totalIn = result.selected.reduce((s, u) => s + u.satoshis, 0n);
      expect(totalIn).toBeGreaterThanOrEqual(3_000_000n + result.fee);
      expect(result.nativeChange).toBeGreaterThanOrEqual(0n);
    });

    it('should throw when insufficient funds', () => {
      const utxos = [makeUtxo(100n, 1)];
      expect(() =>
        selectUtxos(utxos, 1_000_000n, new Map(), 2, SYSTEM_ID)
      ).toThrow('Insufficient VRSC balance');
    });

    it('should absorb dust change into fee', () => {
      // Create a UTXO that's just slightly more than needed
      const fee = estimateFee(1, 3, undefined, false);
      const needed = 1_000_000n;
      const dustExtra = 100n; // less than 546 threshold
      const utxos = [makeUtxo(needed + fee + dustExtra, 1)];

      const result = selectUtxos(utxos, needed, new Map(), 2, SYSTEM_ID);
      // Change should be 0 (dust absorbed) or the exact fee slightly differs
      expect(result.nativeChange === 0n || result.nativeChange > 546n).toBe(true);
    });

    it('should select largest UTXOs first for native', () => {
      const utxos = [
        makeUtxo(100_000n, 1),
        makeUtxo(50_000_000n, 2),
        makeUtxo(200_000n, 3),
      ];

      const result = selectUtxos(utxos, 1_000_000n, new Map(), 2, SYSTEM_ID);
      // Should have selected the largest UTXO (50M)
      expect(result.selected.length).toBe(1);
      expect(result.selected[0]?.satoshis).toBe(50_000_000n);
    });
  });
});
