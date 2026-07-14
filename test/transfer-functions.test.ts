/**
 * Unit tests for transfer module functions:
 * transfer(), transferToken(), convert(), sendCurrency()
 *
 * All tests are 100% offline — no RPC needed. Uses mock UTXOs.
 */

import { describe, it, expect } from 'vitest';
import {
  transfer,
  transferToken,
  convert,
  sendCurrency,
} from '../src/transfer/index.js';
import { NETWORK_CONFIG, DUST_THRESHOLD } from '../src/constants/index.js';
import {
  TEST_WIF,
  TEST_ADDRESS,
  TEST_ADDRESS_B,
  TEST_SCRIPT,
  VRSCTEST_SYSTEM_ID,
  NETWORK,
  makeFundingUtxo,
  makeP2PKHScript,
} from './fixtures/index.js';
import { deriveIdentityAddress } from '../src/identity/index.js';

const SYSTEM_ID = VRSCTEST_SYSTEM_ID;

// ─── transfer() ──────────────────────────────────────────

describe('transfer()', () => {
  it('should build a valid signed transaction for a basic native send', () => {
    const utxos = [makeFundingUtxo('aa', 100_000_000n)]; // 1 VRSC

    const result = transfer({
      wif: TEST_WIF,
      to: TEST_ADDRESS_B,
      amount: 50_000_000n, // 0.5 VRSC
      utxos,
      changeAddress: TEST_ADDRESS,
    }, NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(result.fee).toBeGreaterThan(0n);
    expect(result.inputsUsed).toBe(1);
    expect(result.nativeChange).toBeGreaterThan(0n);
  });

  it('should select multiple UTXOs when single is insufficient', () => {
    const utxos = [
      makeFundingUtxo('aa', 30_000_000n),
      makeFundingUtxo('bb', 30_000_000n),
      makeFundingUtxo('cc', 30_000_000n),
    ];

    const result = transfer({
      wif: TEST_WIF,
      to: TEST_ADDRESS_B,
      amount: 70_000_000n, // 0.7 VRSC — needs 2-3 UTXOs
      utxos,
      changeAddress: TEST_ADDRESS,
    }, NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.inputsUsed).toBeGreaterThanOrEqual(2);
  });

  it('should absorb dust change into the fee', () => {
    // Precisely craft amounts so change would be below DUST_THRESHOLD
    const fee = 10_000n; // minimum fee
    const amount = 100_000_000n - fee - 100n; // leaves 100 sat change (< 546)
    const utxos = [makeFundingUtxo('aa', 100_000_000n)];

    const result = transfer({
      wif: TEST_WIF,
      to: TEST_ADDRESS_B,
      amount,
      utxos,
      changeAddress: TEST_ADDRESS,
    }, NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    // Change should be 0 (absorbed into fee) since it's below dust threshold
    expect(result.nativeChange).toBe(0n);
    // Fee should be higher than normal to absorb the dust
    expect(result.fee).toBeGreaterThan(fee);
  });

  it('should throw on insufficient funds', () => {
    const utxos = [makeFundingUtxo('aa', 1_000n)]; // 0.00001 VRSC

    expect(() =>
      transfer({
        wif: TEST_WIF,
        to: TEST_ADDRESS_B,
        amount: 100_000_000n, // 1 VRSC
        utxos,
        changeAddress: TEST_ADDRESS,
      }, NETWORK),
    ).toThrow(/[Ii]nsufficient/);
  });
});

// ─── transferToken() ─────────────────────────────────────

describe('transferToken()', () => {
  it('should build a token transfer to a PKH address', () => {
    // For token transfers we need UTXOs with native VRSC for fees
    const utxos = [makeFundingUtxo('aa', 100_000_000n)];

    const result = transferToken({
      wif: TEST_WIF,
      to: TEST_ADDRESS_B,
      amount: 10_000_000n,
      currency: SYSTEM_ID, // native as token — simplest test
      utxos,
      changeAddress: TEST_ADDRESS,
    }, NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(result.fee).toBeGreaterThan(0n);
  });

  it('should handle ID address type', () => {
    const iAddr = deriveIdentityAddress('testrecipient', SYSTEM_ID);
    const utxos = [makeFundingUtxo('aa', 100_000_000n)];

    const result = transferToken({
      wif: TEST_WIF,
      to: iAddr,
      amount: 10_000_000n,
      currency: SYSTEM_ID,
      addressType: 'ID',
      utxos,
      changeAddress: TEST_ADDRESS,
    }, NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── convert() ───────────────────────────────────────────

describe('convert()', () => {
  it('should build a single-hop conversion TX', () => {
    const utxos = [makeFundingUtxo('aa', 200_000_000n)];
    const targetCurrency = deriveIdentityAddress('bridge', SYSTEM_ID);

    const result = convert({
      wif: TEST_WIF,
      amount: 50_000_000n,
      currency: SYSTEM_ID,
      convertTo: targetCurrency,
      utxos,
      changeAddress: TEST_ADDRESS,
    }, NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(result.fee).toBeGreaterThan(0n);
  });

  it('should build a reserve-to-reserve conversion with via', () => {
    const utxos = [makeFundingUtxo('aa', 200_000_000n)];
    const targetCurrency = deriveIdentityAddress('targettoken', SYSTEM_ID);
    const viaCurrency = deriveIdentityAddress('bridge', SYSTEM_ID);

    const result = convert({
      wif: TEST_WIF,
      amount: 50_000_000n,
      currency: SYSTEM_ID,
      convertTo: targetCurrency,
      via: viaCurrency,
      utxos,
      changeAddress: TEST_ADDRESS,
    }, NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── sendCurrency() ──────────────────────────────────────

describe('sendCurrency()', () => {
  it('should handle multi-output transfers', () => {
    const utxos = [makeFundingUtxo('aa', 500_000_000n)]; // 5 VRSC

    const result = sendCurrency({
      wif: TEST_WIF,
      outputs: [
        {
          currency: SYSTEM_ID,
          satoshis: 100_000_000n,
          address: TEST_ADDRESS_B,
          addressType: 'PKH',
        },
        {
          currency: SYSTEM_ID,
          satoshis: 50_000_000n,
          address: TEST_ADDRESS,
          addressType: 'PKH',
        },
      ],
      utxos,
      changeAddress: TEST_ADDRESS,
    }, NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(result.inputsUsed).toBeGreaterThanOrEqual(1);
  });

  it('should set cross-chain export fields', () => {
    const utxos = [makeFundingUtxo('aa', 500_000_000n)];
    const bridgeId = deriveIdentityAddress('bridge', SYSTEM_ID);
    const exportSystem = deriveIdentityAddress('veth', SYSTEM_ID);

    const result = sendCurrency({
      wif: TEST_WIF,
      outputs: [
        {
          currency: SYSTEM_ID,
          satoshis: 100_000_000n,
          address: TEST_ADDRESS_B,
          addressType: 'PKH',
          exportTo: exportSystem,
          bridgeId,
        },
      ],
      utxos,
      changeAddress: TEST_ADDRESS,
    }, NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should handle ETH address type', () => {
    const utxos = [makeFundingUtxo('aa', 500_000_000n)];
    const bridgeId = deriveIdentityAddress('bridge', SYSTEM_ID);
    const exportSystem = deriveIdentityAddress('veth', SYSTEM_ID);

    const result = sendCurrency({
      wif: TEST_WIF,
      outputs: [
        {
          currency: SYSTEM_ID,
          satoshis: 100_000_000n,
          address: '0x1234567890abcdef1234567890abcdef12345678',
          addressType: 'ETH',
          exportTo: exportSystem,
          bridgeId,
        },
      ],
      utxos,
      changeAddress: TEST_ADDRESS,
    }, NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
  });
});
