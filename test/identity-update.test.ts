/**
 * Unit tests for buildAndSignIdentityUpdate() covering all 5 operations:
 * update, lock, unlock, revoke, recover
 *
 * All tests are 100% offline — no RPC needed.
 * Uses real Identity serialization via verus-typescript-primitives.
 */

import { describe, it, expect } from 'vitest';
import { buildAndSignIdentityUpdate } from '../src/identity/index.js';
import {
  TEST_WIF,
  TEST_ADDRESS,
  TEST_ADDRESS_B,
  NETWORK,
  VRSCTEST_SYSTEM_ID,
  makeFundingUtxo,
  createMockIdentityHex,
} from './fixtures/index.js';
import { deriveIdentityAddress } from '../src/identity/index.js';

const SYSTEM_ID = VRSCTEST_SYSTEM_ID;

// ─── Helper ──────────────────────────────────────────────

function makeUpdateParams(name: string, overrides?: Record<string, unknown>) {
  const mock = createMockIdentityHex({ name });
  return {
    wif: TEST_WIF,
    identityHex: mock.identityHex,
    identityUtxo: mock.identityUtxo,
    utxos: [makeFundingUtxo('aa', 100_000_000)],
    changeAddress: TEST_ADDRESS,
    ...overrides,
  };
}

// ─── Update operations ───────────────────────────────────

describe('buildAndSignIdentityUpdate', () => {
  describe('update', () => {
    it('should update primary addresses', () => {
      const params = makeUpdateParams('updaddr', {
        primaryAddresses: [TEST_ADDRESS_B],
      });

      const result = buildAndSignIdentityUpdate(params, NETWORK, 'update');

      expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
      expect(result.operation).toBe('update');
      expect(result.fee).toBeGreaterThan(0);
      expect(result.inputsUsed).toBeGreaterThanOrEqual(2); // funding + identity
    });

    it('should update revocation and recovery authorities', () => {
      const newRevAuth = deriveIdentityAddress('revoker', SYSTEM_ID);
      const newRecAuth = deriveIdentityAddress('recoverer', SYSTEM_ID);
      const params = makeUpdateParams('updauth', {
        revocationAuthority: newRevAuth,
        recoveryAuthority: newRecAuth,
      });

      const result = buildAndSignIdentityUpdate(params, NETWORK, 'update');

      expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
      expect(result.operation).toBe('update');
    });

    it('should set contentMap', () => {
      // contentMap keys are 20-byte hashes (hex), values are 32-byte hashes (hex)
      // The key gets stored directly in the map, not decoded as an address
      const key = deriveIdentityAddress('cmapkey', SYSTEM_ID);
      const val = 'b'.repeat(64); // 32-byte hex value
      const params = makeUpdateParams('updcmap', {
        contentMap: { [key]: val },
      });

      const result = buildAndSignIdentityUpdate(params, NETWORK, 'update');

      expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
      expect(result.operation).toBe('update');
    });

    it('should set contentMultimap', () => {
      // ContentMultiMap keys are i-addresses, values are hex strings
      const key = deriveIdentityAddress('cmmkey', SYSTEM_ID);
      const val = 'd'.repeat(64); // 32-byte hex value
      const params = makeUpdateParams('updcmm', {
        contentMultimap: { [key]: [val] },
      });

      const result = buildAndSignIdentityUpdate(params, NETWORK, 'update');

      expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
      expect(result.operation).toBe('update');
    });
  });

  // ─── Lock ──────────────────────────────────────────────

  describe('lock', () => {
    it('should lock with unlockAfter height', () => {
      const params = makeUpdateParams('lockid');

      const result = buildAndSignIdentityUpdate(
        params,
        NETWORK,
        'lock',
        { unlockAfter: 500_000 },
      );

      expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
      expect(result.operation).toBe('lock');
      expect(result.fee).toBeGreaterThan(0);
    });

    it('should throw when unlockAfter is missing for lock', () => {
      const params = makeUpdateParams('lockfail');

      expect(() =>
        buildAndSignIdentityUpdate(params, NETWORK, 'lock'),
      ).toThrow(/unlockAfter/);
    });
  });

  // ─── Unlock ────────────────────────────────────────────

  describe('unlock', () => {
    it('should unlock a locked identity', () => {
      // Create a mock identity that has the locked flag set
      const mock = createMockIdentityHex({
        name: 'unlockid',
        flags: 2, // IDENTITY_FLAG_LOCKED
        unlockAfter: 100_000,
      });

      const result = buildAndSignIdentityUpdate(
        {
          wif: TEST_WIF,
          identityHex: mock.identityHex,
          identityUtxo: mock.identityUtxo,
          utxos: [makeFundingUtxo('aa', 100_000_000)],
          changeAddress: TEST_ADDRESS,
          expiryHeight: 200_000,
        },
        NETWORK,
        'unlock',
      );

      expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
      expect(result.operation).toBe('unlock');
    });
  });

  // ─── Revoke ────────────────────────────────────────────

  describe('revoke', () => {
    it('should revoke an identity', () => {
      const params = makeUpdateParams('revokeid');

      const result = buildAndSignIdentityUpdate(params, NETWORK, 'revoke');

      expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
      expect(result.operation).toBe('revoke');
      expect(result.fee).toBeGreaterThan(0);
    });
  });

  // ─── Recover ───────────────────────────────────────────

  describe('recover', () => {
    it('should recover an identity with new addresses', () => {
      const params = makeUpdateParams('recoverid', {
        primaryAddresses: [TEST_ADDRESS_B],
      });

      const result = buildAndSignIdentityUpdate(params, NETWORK, 'recover');

      expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
      expect(result.operation).toBe('recover');
      expect(result.fee).toBeGreaterThan(0);
    });
  });
});
