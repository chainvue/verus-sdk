import { describe, it, expect } from 'vitest';
import bs58check from 'bs58check';
import { createHash as nodeCreateHash } from 'node:crypto';
import { ECPair, networks } from '@bitgo/utxo-lib';
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
  seedToPrivateKey,
  seedToWif,
  seedToAddress,
} from '../src/keys/index.js';
import { InvalidSeedError } from '../src/errors.js';

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

    it('rejects a non-Verus (Bitcoin 0x80) WIF instead of returning bytes', () => {
      const bitcoinWif = 'KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617';
      expect(() => wifToPrivateKey(bitcoinWif)).toThrow();
      expect(() => isCompressedWif(bitcoinWif)).toThrow();
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

// ─── Verus Mobile / Verus Desktop seed compatibility ─────────────────────────
//
// Reference: agama-wallet-lib `seedToWif(seed, network, iguana)` — Verus Mobile
// src/utils/agama-wallet-lib/keys.js, called with iguana=true from every call
// site (deriveElectrumKeypair in V1, and the legacy V0 path). Transcribed here
// against node's own crypto, then driven through the SAME fork
// (@bitgo/utxo-lib ECPair) that Verus Mobile itself runs — so if our pure-TS
// derivation diverges from the wallet's library, these addresses disagree.
function referenceSeedWif(seed: string): string {
  const bytes = nodeCreateHash('sha256').update(Buffer.from(seed, 'utf8')).digest();
  bytes.writeUInt8(bytes.readUInt8(0) & 248, 0); // bytes[0] &= 248
  bytes.writeUInt8((bytes.readUInt8(31) & 127) | 64, 31); // bytes[31] &= 127; |= 64
  return bs58check.encode(
    Buffer.concat([Buffer.from([0xbc]), bytes, Buffer.from([0x01])]),
  );
}

const SEEDS = [
  // A real BIP39 phrase is just a string to this convention — it is hashed
  // verbatim, NOT run through BIP39/BIP32.
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'sample verus seed phrase for testing only do not use',
  'a', // degenerate but legal — the wallets accept any non-WIF string
] as const;

describe('Verus Mobile seed compatibility', () => {
  it('matches the fork ECPair the wallet itself derives with', async () => {
    for (const seed of SEEDS) {
      const forkAddress = ECPair.fromWIF(referenceSeedWif(seed), networks.verus).getAddress();
      expect(await seedToAddress(seed)).toBe(forkAddress);
      expect(seedToWif(seed)).toBe(referenceSeedWif(seed));
    }
  });

  it('holds the derivation constant (locked known-answer vectors)', async () => {
    // Regression lock: a change to any of these values is a change to which
    // address a user's existing seed phrase controls.
    expect(await seedToAddress(SEEDS[0])).toBe('RFHG6jCuPmTZknnwPwjMWv67HRarPCtEFh');
    expect(await seedToAddress(SEEDS[1])).toBe('RQi75WyyN6naucDBwfKD7TfwpCUPLJSa6v');
    expect(await seedToAddress(SEEDS[2])).toBe('R9ZMKPDhaiiqiGT7KKD4wXmR9a78ih3qn8');
  });

  it('applies the iguana clamp', () => {
    for (const seed of SEEDS) {
      const key = seedToPrivateKey(seed);
      expect(key.length).toBe(32);
      expect(key.readUInt8(0) & 0b0000_0111).toBe(0); // bytes[0] &= 248
      expect(key.readUInt8(31) & 0b1000_0000).toBe(0); // bytes[31] &= 127
      expect(key.readUInt8(31) & 0b0100_0000).toBe(0b0100_0000); // bytes[31] |= 64
    }
  });

  it('derives a compressed WIF that round-trips through the WIF path', async () => {
    const wif = seedToWif(SEEDS[1]);
    expect(validateWif(wif)).toEqual({ valid: true });
    expect(isCompressedWif(wif)).toBe(true);
    expect(await wifToAddress(wif)).toBe(await seedToAddress(SEEDS[1]));
  });

  it('hashes the phrase verbatim — whitespace and case are significant', async () => {
    const base = await seedToAddress('my seed phrase');
    expect(await seedToAddress(' my seed phrase')).not.toBe(base);
    expect(await seedToAddress('My seed phrase')).not.toBe(base);
    expect(await seedToAddress('my  seed phrase')).not.toBe(base);
  });

  it('rejects a WIF passed as a seed instead of silently deriving a new key', () => {
    // The dangerous case: hashing a WIF would produce a valid-looking address
    // the user does not control the funds of.
    expect(() => seedToWif(TEST_WIF_A)).toThrow(InvalidSeedError);
    expect(() => seedToPrivateKey(TEST_WIF_A)).toThrow(/WIF private key/);
  });

  it('rejects an empty or whitespace-only seed', () => {
    // Deviation from the wallets, which would hash "" happily: an empty seed
    // is an unset config value, and its address is one an attacker watches.
    expect(() => seedToWif('')).toThrow(InvalidSeedError);
    expect(() => seedToWif('   ')).toThrow(InvalidSeedError);
  });
});
