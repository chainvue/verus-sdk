import { describe, it, expect } from 'vitest';
import { selectUtxos, assertTokenConservation } from '../src/utxo/index.js';
import { estimateMinerFee } from '../src/fee/index.js';
import { buildTokenChangeOutput, deriveIdentityAddress } from '../src/identity/index.js';
import { parseAddress } from '../src/core/brands.js';
import { NETWORK_CONFIG, DEFAULT_TRANSACTION_FEE } from '../src/constants/index.js';
import { TransactionBuildError } from '../src/errors.js';
import type { Utxo } from '../src/types/index.js';

const SYSTEM_ID = NETWORK_CONFIG.testnet.chainId;
const TOKEN_CURRENCY = deriveIdentityAddress('toktest', SYSTEM_ID);
const R_ADDR = 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX';

/**
 * The miner fee is an INPUT to selectUtxos now, not something it derives: the
 * daemon prices a transaction by its outputs, which the caller knows first (see
 * src/fee/index.ts). These selection tests pass the one-recipient fee; the old
 * call sites passed `numOutputs: 2` here instead.
 */
const FEE = DEFAULT_TRANSACTION_FEE;

/** A reserve-output UTXO carrying `amount` of TOKEN_CURRENCY, zero native. */
function tokenUtxo(amount: bigint, index: number): Utxo {
  const { script } = buildTokenChangeOutput(parseAddress(R_ADDR), new Map([[TOKEN_CURRENCY, amount]]));
  return {
    txid: Buffer.alloc(32, index).toString('hex'),
    outputIndex: 0,
    satoshis: 0n,
    script: script.toString('hex'),
  };
}

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
  describe('the fee no longer depends on the selection', () => {
    // WAS: `should increase with more inputs` — estimateFee(5, 2) > estimateFee(1, 2),
    // i.e. 180 bytes of fee per input. That is a false statement about VerusCoin:
    // the daemon's ONLY input term is max(SpendCount() - 1, 0), and SpendCount()
    // counts SAPLING spends (transaction_builder.h:123-126), which is 0 for every
    // transparent transaction. Measured: VRSC txid 87c5bb69a41d778903b899d8880191\
    // ede6e93e9da5c64bc90170bd8265e97150 (block 4,163,006) is 185,212 bytes with
    // 1,255 inputs and paid exactly 10,000 satoshis.
    it('is identical whether selection takes one input or five', () => {
      const one = selectUtxos([makeUtxo(100_000_000n, 1)], 1_000_000n, new Map(), FEE, SYSTEM_ID);
      const five = selectUtxos(
        // 4 × 250_000 = 1_000_000 < need + fee, so all five are pulled in.
        [1, 2, 3, 4, 5].map((i) => makeUtxo(250_000n, i)),
        1_000_000n,
        new Map(),
        FEE,
        SYSTEM_ID,
      );
      expect(five.selected).toHaveLength(5);
      expect(five.fee).toBe(one.fee);
      expect(five.fee).toBe(10_000n);
    });

    it('rejects a fee below the daemon\'s standard transaction fee (fails closed)', () => {
      // A JS consumer still calling the old positional form passes the old
      // `numOutputs` (a small number) where the fee now goes.
      // An untyped JS caller passing the old `numOutputs` where the fee now goes.
      const asJsCaller = selectUtxos as unknown as (
        u: Utxo[], n: bigint, c: Map<string, bigint>, fee: number, sys: string,
      ) => unknown;
      expect(() => asJsCaller([makeUtxo(100_000_000n, 1)], 1_000n, new Map(), 2, SYSTEM_ID)).toThrow(
        TransactionBuildError,
      );
      expect(() => selectUtxos([makeUtxo(100_000_000n, 1)], 1_000n, new Map(), 9_999n, SYSTEM_ID)).toThrow(
        /fee must be a bigint of at least 10000 satoshis/,
      );
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
      const result = selectUtxos([mixed], 100_000_000n, new Map(), FEE, SYSTEM_ID);
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
      const result = selectUtxos([mixed, pureNative], 100_000_000n, new Map(), FEE, SYSTEM_ID);
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
        selectUtxos([dup, dup], 250_000n, new Map(), FEE, SYSTEM_ID)
      ).toThrow(TransactionBuildError);
      expect(() =>
        selectUtxos([dup, dup], 250_000n, new Map(), FEE, SYSTEM_ID)
      ).toThrow(/Duplicate UTXO/);
    });

    it('should select enough UTXOs to cover amount + fee', () => {
      const utxos = [
        makeUtxo(1_000_000n, 1),
        makeUtxo(5_000_000n, 2),
        makeUtxo(10_000_000n, 3),
      ];

      const result = selectUtxos(utxos, 3_000_000n, new Map(), FEE, SYSTEM_ID);
      expect(result.selected.length).toBeGreaterThan(0);
      const totalIn = result.selected.reduce((s, u) => s + u.satoshis, 0n);
      expect(totalIn).toBeGreaterThanOrEqual(3_000_000n + result.fee);
      expect(result.nativeChange).toBeGreaterThanOrEqual(0n);
    });

    it('should throw when insufficient funds', () => {
      const utxos = [makeUtxo(100n, 1)];
      expect(() =>
        selectUtxos(utxos, 1_000_000n, new Map(), FEE, SYSTEM_ID)
      ).toThrow('Insufficient VRSC balance');
    });

    it('should absorb dust change into fee', () => {
      // Create a UTXO that's just slightly more than needed
      const fee = estimateMinerFee([Buffer.from(makeUtxo(0n, 1).script, 'hex')]);
      const needed = 1_000_000n;
      const dustExtra = 100n; // less than 546 threshold
      const utxos = [makeUtxo(needed + fee + dustExtra, 1)];

      const result = selectUtxos(utxos, needed, new Map(), fee, SYSTEM_ID);
      // Change should be 0 (dust absorbed) or the exact fee slightly differs
      expect(result.nativeChange === 0n || result.nativeChange > 546n).toBe(true);
    });

    it('should select largest UTXOs first for native', () => {
      const utxos = [
        makeUtxo(100_000n, 1),
        makeUtxo(50_000_000n, 2),
        makeUtxo(200_000n, 3),
      ];

      const result = selectUtxos(utxos, 1_000_000n, new Map(), FEE, SYSTEM_ID);
      // Should have selected the largest UTXO (50M)
      expect(result.selected.length).toBe(1);
      expect(result.selected[0]?.satoshis).toBe(50_000_000n);
    });
  });

  describe('systemId in requiredCurrencies (regression)', () => {
    it('throws instead of silently dropping a native-currency requirement', () => {
      const utxos = [makeUtxo(100_000_000n, 1)];
      expect(() =>
        selectUtxos(utxos, 0n, new Map([[SYSTEM_ID, 50_000_000n]]), FEE, SYSTEM_ID),
      ).toThrow(/must not contain the native currency/);
    });
  });

  describe('assertTokenConservation', () => {
    it('passes for native-only inputs with no token outputs', () => {
      expect(() =>
        assertTokenConservation([makeUtxo(1_000_000n, 1)], new Map(), new Map(), SYSTEM_ID, 'native path'),
      ).not.toThrow();
    });

    it('throws when a token-bearing input has no matching output (would be dropped)', () => {
      // native-only path guard: both maps empty ⇒ any token in inputs is a drop.
      expect(() =>
        assertTokenConservation([tokenUtxo(100_000_000n, 1)], new Map(), new Map(), SYSTEM_ID, 'currency definition'),
      ).toThrow(/token conservation failed/);
    });

    it('passes when input tokens equal fee-out + change', () => {
      expect(() =>
        assertTokenConservation(
          [tokenUtxo(150_000_000n, 1)],
          new Map([[TOKEN_CURRENCY, 100_000_000n]]), // paid to the fee output
          new Map([[TOKEN_CURRENCY, 50_000_000n]]), // returned as change
          SYSTEM_ID,
          'sub-ID registration',
        ),
      ).not.toThrow();
    });

    it('throws when fee-out + change do not account for all input tokens', () => {
      expect(() =>
        assertTokenConservation(
          [tokenUtxo(150_000_000n, 1)],
          new Map([[TOKEN_CURRENCY, 100_000_000n]]),
          new Map([[TOKEN_CURRENCY, 40_000_000n]]), // 10M unaccounted → drop
          SYSTEM_ID,
          'sub-ID registration',
        ),
      ).toThrow(/token conservation failed/);
    });
  });
});
