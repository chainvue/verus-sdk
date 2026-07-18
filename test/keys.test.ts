import { describe, it, expect } from 'vitest';
import bs58check from 'bs58check';
import {
  validateWif,
  wifToPrivateKey,
  isCompressedWif,
  privateKeyToPublicKey,
  publicKeyToAddress,
  wifToAddress,
  generateWif,
  validateAddress,
  hash160,
} from '../src/keys/index.js';

// Known test keys from the signer project
const TEST_WIF_A = 'UusoQWsobQKUkezgBJa22D9G4t9Avo6k8wD5UUxmmfAEoTN8bawc';
const TEST_ADDR_A = 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX';

const TEST_WIF_B = 'UtJXdBipt7XKxSe3AKFYhXizA5cgCM1ztQLVDANwHtfERydFEnPG';
const TEST_ADDR_B = 'RPsQDnaxXgrLjcVBh3SpvCpTabWxAdMdzu';

const TEST_WIF_ID = 'UuRYh9nCVRvPgBEgF7tq4rYpfN2kgeZRKSaVWFVebsgsWWUzAEam';
const TEST_ADDR_ID = 'RSS3Qz5hzEVSV6hziLXaD2xPbw9UVpJoXs';

describe('keys', () => {
  describe('validateWif', () => {
    it('should validate a correct WIF', () => {
      expect(validateWif(TEST_WIF_A)).toEqual({ valid: true });
      expect(validateWif(TEST_WIF_B)).toEqual({ valid: true });
    });

    it('rejects a Bitcoin-mainnet WIF (0x80 is never a valid Verus key)', () => {
      // Canonical valid Bitcoin mainnet WIF (version byte 0x80). It decodes
      // cleanly, so it reaches the prefix check — which must now reject it,
      // matching the signer (ECPair.fromWIF with the Verus network throws).
      const bitcoinWif = 'KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617';
      expect(validateWif(bitcoinWif).valid).toBe(false);
    });

    it('should reject an invalid WIF', () => {
      const result = validateWif('not-a-wif');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects a 34-byte WIF whose compression flag is not 0x01', () => {
      // Verus prefix (0xbc) + 32 privkey bytes + a bogus flag byte (0x02).
      // The daemon only ever produces 0x01 here; anything else is malformed
      // and would fail at signing rather than at this boundary.
      const bad = bs58check.encode(
        Buffer.concat([Buffer.from([0xbc]), Buffer.alloc(32, 0x11), Buffer.from([0x02])]),
      );
      const result = validateWif(bad);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/compression flag/);
    });
  });

  describe('wifToPrivateKey', () => {
    it('should extract a 32-byte private key', () => {
      const key = wifToPrivateKey(TEST_WIF_A);
      expect(key.length).toBe(32);
    });
  });

  describe('isCompressedWif', () => {
    it('should detect compressed WIF', () => {
      // Verus WIFs (prefix 0xbc) are typically compressed
      expect(isCompressedWif(TEST_WIF_A)).toBe(true);
    });
  });

  describe('privateKeyToPublicKey', () => {
    it('should derive a compressed public key', async () => {
      const privKey = wifToPrivateKey(TEST_WIF_A);
      const pubKey = await privateKeyToPublicKey(privKey, true);
      expect(pubKey.length).toBe(33); // compressed
    });

    it('should derive an uncompressed public key', async () => {
      const privKey = wifToPrivateKey(TEST_WIF_A);
      const pubKey = await privateKeyToPublicKey(privKey, false);
      expect(pubKey.length).toBe(65); // uncompressed
    });
  });

  describe('publicKeyToAddress', () => {
    it('should derive the correct R-address', async () => {
      const privKey = wifToPrivateKey(TEST_WIF_A);
      const pubKey = await privateKeyToPublicKey(privKey, true);
      const address = publicKeyToAddress(pubKey);
      expect(address).toBe(TEST_ADDR_A);
    });
  });

  describe('wifToAddress', () => {
    it('should derive correct addresses for all test keys', async () => {
      expect(await wifToAddress(TEST_WIF_A)).toBe(TEST_ADDR_A);
      expect(await wifToAddress(TEST_WIF_B)).toBe(TEST_ADDR_B);
      expect(await wifToAddress(TEST_WIF_ID)).toBe(TEST_ADDR_ID);
    });
  });

  describe('generateWif', () => {
    it('should generate a valid WIF', () => {
      const wif = generateWif();
      expect(validateWif(wif).valid).toBe(true);
    });

    it('should generate unique WIFs', () => {
      const wif1 = generateWif();
      const wif2 = generateWif();
      expect(wif1).not.toBe(wif2);
    });
  });

  describe('validateAddress', () => {
    it('should validate correct R-addresses', () => {
      expect(validateAddress(TEST_ADDR_A)).toEqual({ valid: true });
      expect(validateAddress(TEST_ADDR_B)).toEqual({ valid: true });
    });

    it('should reject invalid addresses', () => {
      const result = validateAddress('not-an-address');
      expect(result.valid).toBe(false);
    });
  });

  describe('hash160', () => {
    it('should compute RIPEMD160(SHA256(data))', () => {
      const data = Buffer.from('hello', 'utf8');
      const h = hash160(data);
      expect(h.length).toBe(20);
    });
  });
});
