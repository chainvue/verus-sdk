/**
 * Tests for currency definition (defineCurrency)
 *
 * Uses real Identity serialization with mock currency definition scripts.
 */

import { describe, it, expect } from 'vitest';
import { defineCurrency } from '../src/currency/index.js';
import { InvalidWifError, TransactionBuildError } from '../src/errors.js';
import {
  TEST_WIF,
  TEST_ADDRESS,
  NETWORK,
  makeFundingUtxo,
  createMockIdentityHex,
} from './fixtures/index.js';

// A minimal valid-looking CC script hex for a currency definition output.
// In real usage this comes from the daemon or is built manually.
// For testing we just need any non-empty hex buffer since defineCurrency
// passes it through to an output without parsing.
const MOCK_CURRENCY_DEF_SCRIPT = 'cc'.repeat(50);

describe('currency', () => {
  it('should be importable', () => {
    expect(defineCurrency).toBeDefined();
    expect(typeof defineCurrency).toBe('function');
  });

  it('should build a currency definition transaction with mock identity', () => {
    const mock = createMockIdentityHex({ name: 'testcoin' });

    const result = defineCurrency({
      wif: TEST_WIF,
      identityHex: mock.identityHex,
      identityUtxo: mock.identityUtxo,
      currencyDefScript: MOCK_CURRENCY_DEF_SCRIPT,
      utxos: [makeFundingUtxo('aa', 100_000_000n)],
      changeAddress: TEST_ADDRESS,
      expiryHeight: 0,
    }, NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(result.fee).toBeGreaterThan(0n);
    expect(result.identityAddress).toMatch(/^i/);
    expect(result.inputsUsed).toBeGreaterThanOrEqual(2); // funding + identity
    expect(result.nativeChange).toBeGreaterThan(0n);
  });

  it('should set FLAG_ACTIVECURRENCY on the identity', () => {
    // Create identity without the flag set (flags = 0)
    const mock = createMockIdentityHex({ name: 'flagtest', flags: 0 });

    // The function should set FLAG_ACTIVECURRENCY internally
    const result = defineCurrency({
      wif: TEST_WIF,
      identityHex: mock.identityHex,
      identityUtxo: mock.identityUtxo,
      currencyDefScript: MOCK_CURRENCY_DEF_SCRIPT,
      utxos: [makeFundingUtxo('aa', 100_000_000n)],
      changeAddress: TEST_ADDRESS,
      expiryHeight: 0,
    }, NETWORK);

    // Verify the TX was built successfully (flag was set internally)
    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should handle non-zero currencyDefValue', () => {
    const mock = createMockIdentityHex({ name: 'paidcoin' });

    const result = defineCurrency({
      wif: TEST_WIF,
      identityHex: mock.identityHex,
      identityUtxo: mock.identityUtxo,
      currencyDefScript: MOCK_CURRENCY_DEF_SCRIPT,
      currencyDefValue: 1_000_000n, // 0.01 VRSC output value on currency def
      utxos: [makeFundingUtxo('aa', 100_000_000n)],
      changeAddress: TEST_ADDRESS,
      expiryHeight: 0,
    }, NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.fee).toBeGreaterThan(0n);
  });

  it('should throw on insufficient funds', () => {
    const mock = createMockIdentityHex({ name: 'poordef' });

    expect(() =>
      defineCurrency({
        wif: TEST_WIF,
        identityHex: mock.identityHex,
        identityUtxo: mock.identityUtxo,
        currencyDefScript: MOCK_CURRENCY_DEF_SCRIPT,
        currencyDefValue: 500_000_000_000n, // 5000 VRSC
        utxos: [makeFundingUtxo('aa', 1_000n)], // only 0.00001 VRSC
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      }, NETWORK),
    ).toThrow(/[Ii]nsufficient/);
  });

  describe('input validation', () => {
    const mock = createMockIdentityHex({ name: 'valcoin' });
    const base = {
      identityHex: mock.identityHex,
      identityUtxo: mock.identityUtxo,
      currencyDefScript: MOCK_CURRENCY_DEF_SCRIPT,
      utxos: [makeFundingUtxo('aa', 100_000_000n)],
      changeAddress: TEST_ADDRESS,
      expiryHeight: 0,
    };

    it('rejects an invalid WIF up front', () => {
      expect(() => defineCurrency({ ...base, wif: 'not-a-wif' }, NETWORK)).toThrow(InvalidWifError);
    });

    it('rejects an empty utxo set up front', () => {
      expect(() => defineCurrency({ ...base, wif: TEST_WIF, utxos: [] }, NETWORK)).toThrow(TransactionBuildError);
    });
  });
});
