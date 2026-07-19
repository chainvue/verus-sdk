import { describe, it, expect } from 'vitest';
import { createTransactionBuilder, getNetwork, resolveExpiryHeight } from '../src/signing/index.js';
import { TransactionBuildError } from '../src/errors.js';

const NET = getNetwork(true); // testnet

describe('createTransactionBuilder', () => {
  it('builds with an explicit expiry height', () => {
    const txb = createTransactionBuilder(NET, 1_000_000);
    expect(txb).toBeDefined();
  });

  it('accepts an explicit 0 (opt-in never-expires)', () => {
    expect(() => createTransactionBuilder(NET, 0)).not.toThrow();
  });

  it('rejects a timestamp-sized expiry height (no silent never-expiring tx)', () => {
    // A UNIX timestamp passed by mistake — above the Sapling cap; must be rejected
    // rather than producing a transaction the daemon never mines.
    expect(() => createTransactionBuilder(NET, 1_900_000_000)).toThrow(TransactionBuildError);
  });

  it('rejects a negative expiry height', () => {
    expect(() => createTransactionBuilder(NET, -1)).toThrow(TransactionBuildError);
  });
});

describe('resolveExpiryHeight', () => {
  it('requires an explicit value', () => {
    expect(() => resolveExpiryHeight(undefined)).toThrow(/expiryHeight is required/);
  });
  it('allows an explicit 0 and a normal height', () => {
    expect(resolveExpiryHeight(0)).toBe(0);
    expect(resolveExpiryHeight(1_234_567)).toBe(1_234_567);
  });
  it('rejects >= the Sapling cap (500_000_000)', () => {
    expect(() => resolveExpiryHeight(500_000_000)).toThrow(TransactionBuildError);
  });
});
