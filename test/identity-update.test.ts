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

    // Same silent-corruption trap as contentMap, via ContentMultiMap.fromJson.
    it('rejects a non-hex contentMultimap value', () => {
      const key = deriveIdentityAddress('cmmkey', SYSTEM_ID);
      const params = makeUpdateParams('cmmbad', { contentMultimap: { [key]: ['deadbeefX9'] } });
      expect(() => buildAndSignIdentityUpdate(params, NETWORK, 'update')).toThrow(TransactionBuildError);
    });

    it('rejects an odd-length hex contentMultimap value (also the string form)', () => {
      const key = deriveIdentityAddress('cmmkey', SYSTEM_ID);
      const params = makeUpdateParams('cmmodd', { contentMultimap: { [key]: 'abc' } });
      expect(() => buildAndSignIdentityUpdate(params, NETWORK, 'update')).toThrow(TransactionBuildError);
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

    it('rejects unlock with expiryHeight 0 (would bypass the timelock)', () => {
      const mock = createMockIdentityHex({ name: 'unlockzero', flags: 2, unlockAfter: 100_000 });
      expect(() =>
        buildAndSignIdentityUpdate(
          {
            wif: TEST_WIF,
            identityHex: mock.identityHex,
            identityUtxo: mock.identityUtxo,
            utxos: [makeFundingUtxo('aa', 100_000_000n)],
            changeAddress: TEST_ADDRESS,
            expiryHeight: 0,
          },
          NETWORK,
          'unlock',
        ),
      ).toThrow(TransactionBuildError);
    });
  });

  // ─── Revoke ────────────────────────────────────────────

  describe('revoke', () => {
    // The mock defaults its revocation authority to the identity itself.
    const OTHER_WIF = 'UtJXdBipt7XKxSe3AKFYhXizA5cgCM1ztQLVDANwHtfERydFEnPG'; // → TEST_ADDRESS_B

    it('should revoke an identity', () => {
      const params = makeUpdateParams('revokeid');

      const result = buildAndSignIdentityUpdate(params, NETWORK, 'revoke');

      expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
      expect(result.operation).toBe('revoke');
      expect(result.fee).toBeGreaterThan(0n);
    });

    it('rejects a non-primary WIF when the identity is its own revocation authority', () => {
      const params = makeUpdateParams('revwrong', { wif: OTHER_WIF });
      expect(() => buildAndSignIdentityUpdate(params, NETWORK, 'revoke')).toThrow(TransactionBuildError);
    });

    it('does not block revoke when the authority is a different identity (uncheckable offline)', () => {
      // A separate revocation authority — the signer can't be verified here, so
      // the primary-controls guard must NOT fire (no false positive). It may
      // still fail downstream on the funding-input signature; we only assert the
      // guard itself did not reject.
      const mock = createMockIdentityHex({
        name: 'revother',
        revocationAuthority: deriveIdentityAddress('some-authority', SYSTEM_ID),
      });
      expect(() =>
        buildAndSignIdentityUpdate(
          {
            wif: OTHER_WIF,
            identityHex: mock.identityHex,
            identityUtxo: mock.identityUtxo,
            utxos: [makeFundingUtxo('aa', 100_000_000n)],
            changeAddress: TEST_ADDRESS,
            expiryHeight: 0,
          },
          NETWORK,
          'revoke',
        ),
      ).not.toThrow(/not among the identity's primary addresses/);
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

  describe('minSigs validation', () => {
    it('rejects minSigs greater than the number of primary addresses', () => {
      const params = makeUpdateParams('sigshi', { primaryAddresses: [TEST_ADDRESS_B], minSigs: 2 });
      expect(() => buildAndSignIdentityUpdate(params, NETWORK, 'update')).toThrow(TransactionBuildError);
    });

    it('rejects minSigs of 0', () => {
      const params = makeUpdateParams('sigszero', { primaryAddresses: [TEST_ADDRESS_B], minSigs: 0 });
      expect(() => buildAndSignIdentityUpdate(params, NETWORK, 'update')).toThrow(TransactionBuildError);
    });
  });

  describe('identityUtxo value guard', () => {
    it('rejects an identityUtxo carrying native value (would be burned)', () => {
      const mock = createMockIdentityHex({ name: 'idutxoval' });
      const params = {
        wif: TEST_WIF,
        identityHex: mock.identityHex,
        identityUtxo: { ...mock.identityUtxo, satoshis: 1_000_000n },
        utxos: [makeFundingUtxo('aa', 100_000_000n)],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      };
      expect(() => buildAndSignIdentityUpdate(params, NETWORK, 'update')).toThrow(TransactionBuildError);
    });
  });

  describe('signer control (WIF must control the identity)', () => {
    // Valid Verus WIF for TEST_ADDRESS_B — not the mock identity's primary.
    const OTHER_WIF = 'UtJXdBipt7XKxSe3AKFYhXizA5cgCM1ztQLVDANwHtfERydFEnPG';

    it('rejects a WIF that is not a current primary address (update)', () => {
      const params = makeUpdateParams('wrongsigner', { wif: OTHER_WIF });
      expect(() => buildAndSignIdentityUpdate(params, NETWORK, 'update')).toThrow(TransactionBuildError);
    });

    it('accepts a WIF that is a current primary address', () => {
      const params = makeUpdateParams('rightsigner', { primaryAddresses: [TEST_ADDRESS_B] });
      const result = buildAndSignIdentityUpdate(params, NETWORK, 'update');
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('i-address changeAddress (native change)', () => {
    it('builds native change to an i-address via P2ID instead of throwing', () => {
      // Previously utxo-lib's addOutput threw an untyped "no matching Script"
      // for an i-address change destination.
      const iAddr = deriveIdentityAddress('changeid', SYSTEM_ID);
      const params = makeUpdateParams('ichange', { changeAddress: iAddr });
      const result = buildAndSignIdentityUpdate(params, NETWORK, 'update');
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
