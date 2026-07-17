/**
 * Key management utilities for Verus
 *
 * Handles WIF parsing, address derivation, and key validation.
 */

import * as crypto from 'crypto';
import bs58check from 'bs58check';
import createHash from 'create-hash';
import { PUBKEY_HASH_PREFIX, WIF_PREFIX } from '../constants/index.js';
import { InvalidWifError } from '../errors.js';

/**
 * Validate a WIF private key
 */
export function validateWif(wif: string): { valid: boolean; error?: string } {
  try {
    const decoded = bs58check.decode(wif);

    if (decoded.length !== 33 && decoded.length !== 34) {
      return { valid: false, error: 'Invalid WIF length' };
    }

    // Only the Verus WIF version byte (0xbc) is valid. The Bitcoin mainnet
    // prefix (0x80) was previously accepted, but 0x80 is never a valid Verus
    // key: the signer (ECPair.fromWIF with the Verus network) rejects it, so
    // accepting it here reports a false "valid" that only fails later at signing.
    const prefix = decoded[0];
    if (prefix !== WIF_PREFIX) {
      return { valid: false, error: `Invalid WIF prefix: ${prefix}` };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Invalid WIF format: ${(error as Error).message}` };
  }
}

/**
 * Extract private key bytes from WIF
 */
export function wifToPrivateKey(wif: string): Buffer {
  const decoded = bs58check.decode(wif);

  // Remove prefix byte and optional compression flag
  if (decoded.length === 34) {
    // Compressed (prefix + 32 bytes + compression flag)
    return Buffer.from(decoded.slice(1, 33));
  } else {
    // Uncompressed (prefix + 32 bytes)
    return Buffer.from(decoded.slice(1));
  }
}

/**
 * Check if WIF indicates compressed public key
 */
export function isCompressedWif(wif: string): boolean {
  const decoded = bs58check.decode(wif);
  return decoded.length === 34 && decoded[33] === 0x01;
}

/**
 * Derive public key from private key
 */
export async function privateKeyToPublicKey(
  privateKey: Buffer,
  compressed: boolean = true
): Promise<Buffer> {
  const secp256k1 = await import('tiny-secp256k1');

  if (!secp256k1.isPrivate(privateKey)) {
    throw new InvalidWifError('Invalid private key');
  }

  const publicKey = secp256k1.pointFromScalar(privateKey, compressed);
  if (!publicKey) {
    throw new InvalidWifError('Failed to derive public key');
  }

  return Buffer.from(publicKey);
}

/**
 * Hash160 (RIPEMD160(SHA256(data)))
 */
export function hash160(data: Buffer): Buffer {
  const sha256 = createHash('sha256').update(data).digest();
  return createHash('ripemd160').update(sha256).digest();
}

/**
 * Derive Verus address from public key
 */
export function publicKeyToAddress(publicKey: Buffer): string {
  const hash = hash160(publicKey);
  const payload = Buffer.concat([Buffer.from([PUBKEY_HASH_PREFIX]), hash]);
  return bs58check.encode(payload);
}

/**
 * Derive Verus address from WIF private key
 */
export async function wifToAddress(wif: string): Promise<string> {
  const validation = validateWif(wif);
  if (!validation.valid) {
    throw new InvalidWifError(validation.error);
  }

  const privateKey = wifToPrivateKey(wif);
  const compressed = isCompressedWif(wif);
  const publicKey = await privateKeyToPublicKey(privateKey, compressed);

  return publicKeyToAddress(publicKey);
}

/**
 * Generate a new random private key as WIF
 */
export function generateWif(compressed: boolean = true): string {
  const privateKey = crypto.randomBytes(32);

  const payload = compressed
    ? Buffer.concat([Buffer.from([WIF_PREFIX]), privateKey, Buffer.from([0x01])])
    : Buffer.concat([Buffer.from([WIF_PREFIX]), privateKey]);

  return bs58check.encode(payload);
}

/**
 * Validate a Verus R-address
 */
export function validateAddress(address: string): { valid: boolean; error?: string } {
  try {
    const decoded = bs58check.decode(address);

    if (decoded.length !== 21) {
      return { valid: false, error: 'Invalid address length' };
    }

    const prefix = decoded[0];
    if (prefix !== PUBKEY_HASH_PREFIX) {
      return { valid: false, error: `Invalid address prefix: ${prefix}` };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Invalid address format: ${(error as Error).message}` };
  }
}
