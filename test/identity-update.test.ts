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
import { deriveIdentityAddress, buildTokenChangeOutput } from '../src/identity/index.js';
import { TransactionBuildError } from '../src/errors.js';

const SYSTEM_ID = VRSCTEST_SYSTEM_ID;

// ─── Helper ──────────────────────────────────────────────

function makeUpdateParams(name: string, overrides?: Record<string, unknown>) {
  const mock = createMockIdentityHex({ name });
  return {
    wif: TEST_WIF,
    identityHex: mock.identityHex,
    identityUtxo: mock.identityUtxo,
    utxos: [makeFundingUtxo('aa', 100_000_000n)],
    changeAddress: TEST_ADDRESS,
    expiryHeight: 0,
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
      expect(result.fee).toBeGreaterThan(0n);
      expect(result.inputsUsed).toBeGreaterThanOrEqual(2); // funding + identity
    });

    // Buffer.from(_, 'hex') silently drops non-hex and truncates odd-length
    // input, so a malformed contentMap value would be committed on-chain as
    // wrong/empty bytes. It must be rejected instead.
    it('rejects a non-hex contentMap value', () => {
      const key = deriveIdentityAddress('cmkey', SYSTEM_ID);
      const params = makeUpdateParams('cmapbad', { contentMap: { [key]: '0xdeadbeef' } });
      expect(() => buildAndSignIdentityUpdate(params, NETWORK, 'update')).toThrow(TransactionBuildError);
    });

    it('rejects an odd-length hex contentMap value', () => {
      const key = deriveIdentityAddress('cmkey', SYSTEM_ID);
      const params = makeUpdateParams('cmapodd', { contentMap: { [key]: 'abc' } });
      expect(() => buildAndSignIdentityUpdate(params, NETWORK, 'update')).toThrow(TransactionBuildError);
    });

    it('accepts a valid 32-byte hex contentMap value', () => {
      const key = deriveIdentityAddress('cmkey', SYSTEM_ID);
      const params = makeUpdateParams('cmapok', { contentMap: { [key]: 'ab'.repeat(32) } });
      const result = buildAndSignIdentityUpdate(params, NETWORK, 'update');
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
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
      expect(result.fee).toBeGreaterThan(0n);
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
          utxos: [makeFundingUtxo('aa', 100_000_000n)],
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
      expect(result.fee).toBeGreaterThan(0n);
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
      expect(result.fee).toBeGreaterThan(0n);
    });
  });

  // KeyID/IdentityID.fromAddress launder any address to their own version, so a
  // wrong-kind address silently becomes a different, uncontrollable destination.
  describe('address-type validation (laundering regression)', () => {
    const anIdentity = deriveIdentityAddress('sdk-hardening-test', SYSTEM_ID);

    it('rejects an i-address passed as a primaryAddress (would brick the identity)', () => {
      const params = makeUpdateParams('primbad', { primaryAddresses: [anIdentity] });
      expect(() => buildAndSignIdentityUpdate(params, NETWORK, 'update')).toThrow(TransactionBuildError);
    });

    it('rejects an R-address passed as revocationAuthority', () => {
      const params = makeUpdateParams('authbad', { revocationAuthority: TEST_ADDRESS_B });
      expect(() => buildAndSignIdentityUpdate(params, NETWORK, 'recover')).toThrow(TransactionBuildError);
    });

    it('buildTokenChangeOutput builds for an i-address change (pay-to-identity) and an R-address, rejects garbage', () => {
      const token = deriveIdentityAddress('sometoken', SYSTEM_ID);
      // Both valid kinds succeed; the i-address path routes to the identity
      // (verified against the daemon) rather than a laundered R-address.
      expect(() => buildTokenChangeOutput(anIdentity, new Map([[token, 100n]]))).not.toThrow();
      expect(() => buildTokenChangeOutput(TEST_ADDRESS_B, new Map([[token, 100n]]))).not.toThrow();
      expect(() => buildTokenChangeOutput('not-a-real-address', new Map([[token, 100n]]))).toThrow();
    });
  });
});
