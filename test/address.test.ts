import { describe, it, expect } from 'vitest';
import { isRAddress, isIAddress, isVerusAddress, isIdentityName, BASE58_RE } from '../src/address/index';

describe('address utilities', () => {
  const VALID_R_ADDRESS = 'RXL3YXG2ceaB6C5hfJcN4fvmLH2C34knhA';
  const VALID_I_ADDRESS = 'i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV';

  describe('BASE58_RE', () => {
    it('matches valid base58 characters', () => {
      expect(BASE58_RE.test('abc123XYZ')).toBe(true);
    });
    it('rejects 0, O, I, l', () => {
      expect(BASE58_RE.test('0abc')).toBe(false);
      expect(BASE58_RE.test('Oabc')).toBe(false);
      expect(BASE58_RE.test('Iabc')).toBe(false);
      expect(BASE58_RE.test('labc')).toBe(false);
    });
  });

  describe('isRAddress', () => {
    it('accepts valid R-address', () => {
      expect(isRAddress(VALID_R_ADDRESS)).toBe(true);
    });
    it('rejects i-address', () => {
      expect(isRAddress(VALID_I_ADDRESS)).toBe(false);
    });
    it('rejects too short', () => {
      expect(isRAddress('R12345')).toBe(false);
    });
    it('rejects too long', () => {
      expect(isRAddress('R' + 'a'.repeat(36))).toBe(false);
    });
    it('rejects non-base58 characters', () => {
      expect(isRAddress('R0000000000000000000000000000')).toBe(false);
    });
    it('rejects empty string', () => {
      expect(isRAddress('')).toBe(false);
    });
  });

  describe('isIAddress', () => {
    it('accepts valid i-address', () => {
      expect(isIAddress(VALID_I_ADDRESS)).toBe(true);
    });
    it('rejects R-address', () => {
      expect(isIAddress(VALID_R_ADDRESS)).toBe(false);
    });
    it('rejects too short', () => {
      expect(isIAddress('i12345')).toBe(false);
    });
    it('rejects empty string', () => {
      expect(isIAddress('')).toBe(false);
    });
  });

  describe('isVerusAddress', () => {
    it('accepts R-address', () => {
      expect(isVerusAddress(VALID_R_ADDRESS)).toBe(true);
    });
    it('accepts i-address', () => {
      expect(isVerusAddress(VALID_I_ADDRESS)).toBe(true);
    });
    it('rejects identity name', () => {
      expect(isVerusAddress('myid@')).toBe(false);
    });
    it('rejects empty string', () => {
      expect(isVerusAddress('')).toBe(false);
    });
  });

  describe('isIdentityName', () => {
    it('accepts name with @', () => {
      expect(isIdentityName('myid@')).toBe(true);
    });
    it('accepts short name without @', () => {
      expect(isIdentityName('myid')).toBe(true);
    });
    it('rejects R-address', () => {
      expect(isIdentityName(VALID_R_ADDRESS)).toBe(false);
    });
    it('rejects i-address', () => {
      expect(isIdentityName(VALID_I_ADDRESS)).toBe(false);
    });
    it('rejects empty string', () => {
      expect(isIdentityName('')).toBe(false);
    });
  });
});
