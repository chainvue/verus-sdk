/**
 * Boundary hardening tests for the bigint money refactor (RISKS: money type).
 *
 * Covers the exact-integer conversion guards, the narrowed decodeUtxo catch
 * (a failed smart-output decode must throw, never silently reclassify to
 * native-only), large former-overflow amounts, per-currency conservation in
 * selectUtxos, and the typed errors at the address/amount boundaries.
 */
import { describe, it, expect } from 'vitest';
import bs58check from 'bs58check';
import { opcodes } from '@bitgo/utxo-lib';
import { parseSats, toSatoshis, toCoins, toSafeNumber, addressToScriptPubKey } from '../src/utils/index.js';
import { selectUtxos, decodeUtxo, estimateFee } from '../src/utxo/index.js';
import { buildTokenChangeOutput } from '../src/identity/index.js';
import { InvalidAmountError, InvalidAddressError, TransactionBuildError } from '../src/errors.js';
import { NETWORK_CONFIG } from '../src/constants/index.js';
import type { Utxo } from '../src/types/index.js';

const SYSTEM_ID = NETWORK_CONFIG.testnet.chainId;
/** An arbitrary token i-address (VRSC-Bridge on testnet) for conservation tests. */
const TOKEN_ID = 'i5Ej7Bec8AYqxBbFEEd3UCKKhhpqAAm1rh';
const CHANGE_ADDR = 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX';

function p2pkhUtxo(satoshis: bigint, index = 0): Utxo {
  const script = Buffer.concat([
    Buffer.from([0x76, 0xa9, 0x14]),
    Buffer.alloc(20, index),
    Buffer.from([0x88, 0xac]),
  ]);
  return {
    txid: Buffer.alloc(32, index).toString('hex'),
    outputIndex: 0,
    satoshis,
    script: script.toString('hex'),
  };
}

/** A real EVAL_RESERVE_OUTPUT token UTXO carrying `tokenSats` of TOKEN_ID plus `nativeSats`. */
function tokenUtxo(tokenSats: bigint, nativeSats: bigint, index = 9): Utxo {
  const { script } = buildTokenChangeOutput(CHANGE_ADDR, new Map([[TOKEN_ID, tokenSats]]));
  return {
    txid: Buffer.alloc(32, index).toString('hex'),
    outputIndex: 0,
    satoshis: nativeSats,
    script: script.toString('hex'),
  };
}

describe('parseSats — grammar enforcement', () => {
  it('accepts well-formed non-negative decimals', () => {
    expect(parseSats('0')).toBe(0n);
    expect(parseSats('1')).toBe(100_000_000n);
    expect(parseSats('0.00000001')).toBe(1n);
    expect(parseSats('21000000')).toBe(2_100_000_000_000_000n);
  });

  it.each([
    ['negative', '-1'],
    ['exponent notation', '1.5e9'],
    ['more than 8 fraction digits', '0.000000001'],
    ['leading zero integer', '01'],
    ['trailing dot', '1.'],
    ['leading dot', '.5'],
    ['empty string', ''],
    ['whitespace', ' 1 '],
    ['NaN', 'NaN'],
    ['comma decimal', '1,5'],
    ['hex', '0x10'],
    ['plus sign', '+1'],
  ])('rejects %s with a typed InvalidAmountError', (_label, value) => {
    expect(() => parseSats(value)).toThrow(InvalidAmountError);
  });

  it('toSatoshis is the same guarded conversion', () => {
    expect(() => toSatoshis('1.999999999')).toThrow(InvalidAmountError);
    expect(toSatoshis('1.99999999')).toBe(199_999_999n);
  });
});

describe('toSafeNumber — utxo-lib boundary guard', () => {
  it('passes values within the safe-integer range', () => {
    expect(toSafeNumber(0n)).toBe(0);
    expect(toSafeNumber(100_000_000n)).toBe(100_000_000);
    expect(toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('throws rather than silently losing precision above 2^53', () => {
    expect(() => toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(InvalidAmountError);
  });

  it('rejects negative satoshis', () => {
    expect(() => toSafeNumber(-1n)).toThrow(InvalidAmountError);
  });
});

describe('large amounts flow through selection as exact bigint', () => {
  it('handles amounts above 2^53 that once overflowed float math (round-trip)', () => {
    // 90,000,000 VRSC = 9e15 sat > Number.MAX_SAFE_INTEGER (~9.007e15 is close;
    // pick a clearly-over value). Values this large are exact as bigint sums.
    const huge = 9_500_000_000_000_000n; // > 2^53
    const coins = toCoins(huge);
    expect(coins).toBe('95000000');
    expect(parseSats(coins)).toBe(huge);
  });

  it('sums many large UTXOs without precision loss', () => {
    const each = 5_000_000_000_000_000n; // 5e15 sat
    const utxos = [each, each, each].map((v, i) => p2pkhUtxo(v, i + 1));
    const need = 12_000_000_000_000_000n; // needs all three
    const result = selectUtxos(utxos, need, new Map(), 2, SYSTEM_ID);
    const totalIn = result.selected.reduce((s, u) => s + u.satoshis, 0n);
    expect(result.selected.length).toBe(3);
    expect(totalIn).toBe(15_000_000_000_000_000n);
    expect(totalIn - need - result.fee).toBe(result.nativeChange);
  });
});

describe('decodeUtxo — narrowed catch (no silent reclassification)', () => {
  it('decodes a real token output into its currency values', () => {
    const decoded = decodeUtxo(tokenUtxo(1_234_000n, 0n), SYSTEM_ID);
    expect(decoded.currencyValues.get(TOKEN_ID)).toBe(1_234_000n);
  });

  it('treats a plain (non-smart) unmodelled script as native-only', () => {
    // P2SH is not a smart CC output; unpackOutput may not model it → native-only fallback is legitimate.
    const p2sh = Buffer.concat([Buffer.from([0xa9, 0x14]), Buffer.alloc(20, 7), Buffer.from([0x87])]);
    const decoded = decodeUtxo(
      { txid: 'ab'.repeat(32), outputIndex: 0, satoshis: 4242n, script: p2sh.toString('hex') },
      SYSTEM_ID,
    );
    expect(decoded.currencyValues.get(SYSTEM_ID)).toBe(4242n);
  });

  it('THROWS typed on a smart (CC) output that fails to decode — never native-only', () => {
    // A script carrying the CryptoCondition opcode but no valid OptCCParams:
    // isSmartTransactionScript → true, unpackOutput → throws. The old empty
    // catch would have silently booked this as native VRSC of utxo.satoshis.
    const malformedSmart = Buffer.from([opcodes.OP_CHECKCRYPTOCONDITION]);
    const utxo: Utxo = {
      txid: 'cd'.repeat(32),
      outputIndex: 1,
      satoshis: 500_000n,
      script: malformedSmart.toString('hex'),
    };
    expect(() => decodeUtxo(utxo, SYSTEM_ID)).toThrow(TransactionBuildError);
  });
});

describe('selectUtxos — per-currency conservation + native accounting', () => {
  it('selects a token UTXO and conserves the token change exactly', () => {
    // Token UTXO holds 1,000,000 of TOKEN_ID and 50,000 native; plus a native
    // UTXO for the fee. Requiring 400,000 of the token leaves 600,000 change.
    const utxos = [tokenUtxo(1_000_000n, 50_000n, 9), p2pkhUtxo(10_000_000n, 1)];
    const required = new Map([[TOKEN_ID, 400_000n]]);
    const result = selectUtxos(utxos, 0n, required, 2, SYSTEM_ID, undefined, true);

    // token change = held − required
    expect(result.currencyChanges.get(TOKEN_ID)).toBe(600_000n);

    // native conservation: inputs = required-native(0) + fee + nativeChange
    const nativeIn = result.selected.reduce((s, u) => s + u.satoshis, 0n);
    expect(nativeIn).toBe(result.fee + result.nativeChange);
  });

  it('does not double-count the token UTXO’s native value (fixed accounting)', () => {
    // A single token UTXO whose native value alone covers the fee must be
    // usable without an extra native input — proving the native side is
    // credited once, not subtracted twice.
    const utxos = [tokenUtxo(1_000_000n, 10_000_000n, 9)];
    const required = new Map([[TOKEN_ID, 250_000n]]);
    const result = selectUtxos(utxos, 0n, required, 2, SYSTEM_ID, undefined, true);
    expect(result.selected.length).toBe(1);
    const nativeIn = result.selected.reduce((s, u) => s + u.satoshis, 0n);
    expect(nativeIn).toBe(result.fee + result.nativeChange);
    expect(result.currencyChanges.get(TOKEN_ID)).toBe(750_000n);
  });

  it('throws typed InsufficientFundsError when the token balance is short', () => {
    const utxos = [tokenUtxo(100_000n, 50_000n, 9), p2pkhUtxo(10_000_000n, 1)];
    const required = new Map([[TOKEN_ID, 400_000n]]);
    expect(() => selectUtxos(utxos, 0n, required, 2, SYSTEM_ID, undefined, true)).toThrow(/[Ii]nsufficient/);
  });
});

describe('selectUtxos — dust boundary', () => {
  const DUST = 546n;

  it('keeps change strictly above the dust threshold', () => {
    const fee = estimateFee(1, 3, undefined, false);
    const need = 1_000_000n;
    const utxos = [p2pkhUtxo(need + fee + DUST + 1n, 1)];
    const result = selectUtxos(utxos, need, new Map(), 2, SYSTEM_ID);
    expect(result.nativeChange).toBe(DUST + 1n);
  });

  it('absorbs change of exactly the dust threshold into the fee', () => {
    const fee = estimateFee(1, 3, undefined, false);
    const need = 1_000_000n;
    // change would be exactly DUST → not > DUST → absorbed into fee, change 0
    const utxos = [p2pkhUtxo(need + fee + DUST, 1)];
    const result = selectUtxos(utxos, need, new Map(), 2, SYSTEM_ID);
    expect(result.nativeChange).toBe(0n);
    expect(result.fee).toBe(fee + DUST);
  });
});

describe('address boundary — typed InvalidAddressError', () => {
  it('rejects garbage base58 in addressToScriptPubKey', () => {
    expect(() => addressToScriptPubKey('not-a-real-address!!!')).toThrow(InvalidAddressError);
  });

  it('rejects an unsupported address prefix (i-address) in addressToScriptPubKey', () => {
    // i-addresses are valid base58check but not spendable as plain P2PKH/P2SH here
    expect(() => addressToScriptPubKey(SYSTEM_ID)).toThrow(InvalidAddressError);
  });

  it('accepts a valid R-address', () => {
    expect(addressToScriptPubKey(CHANGE_ADDR).length).toBe(25);
  });

  it('rejects a P2PKH-prefixed address whose payload is not 20 bytes', () => {
    // Valid base58check, correct R-address version byte (0x3c), but only 19
    // payload bytes. Without the length guard this emitted a PUSH20 opcode over
    // 19 bytes — a malformed script whose length prefix lies about its data.
    const shortPayload = bs58check.encode(Buffer.concat([Buffer.from([0x3c]), Buffer.alloc(19, 0x11)]));
    expect(() => addressToScriptPubKey(shortPayload)).toThrow(InvalidAddressError);
  });
});
