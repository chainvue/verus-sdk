/**
 * Key management utilities for Verus
 *
 * Handles WIF parsing, address derivation, and key validation.
 */

import * as crypto from 'crypto';
import bs58check from 'bs58check';
import createHash from 'create-hash';
import { PUBKEY_HASH_PREFIX, WIF_PREFIX } from '../constants/index.js';
import { InvalidSeedError, InvalidWifError } from '../errors.js';

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

    // A 34-byte WIF is compressed and its trailing byte must be exactly 0x01.
    // Any other value is a malformed key the daemon rejects; accepting it here
    // reports a false "valid" that only fails later at signing.
    if (decoded.length === 34 && decoded[33] !== 0x01) {
      return { valid: false, error: `Invalid WIF compression flag: ${decoded[33]}` };
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
  // Validate the Verus version byte / length / compression flag first; a raw
  // bs58check.decode accepts a Bitcoin (0x80) WIF and returns key bytes for a
  // non-Verus key with no error.
  const check = validateWif(wif);
  if (!check.valid) throw new InvalidWifError(check.error);
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
  const check = validateWif(wif);
  if (!check.valid) throw new InvalidWifError(check.error);
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

// ─── Verus Mobile / Verus Desktop seed compatibility ───────────────────────
//
// Verus wallets are NOT hierarchical-deterministic. A seed phrase maps to
// exactly ONE key — no account, no chain, no index, no BIP32/BIP39/BIP44
// anywhere. The convention comes from Agama/Iguana and lives in
// `agama-wallet-lib/keys.js` (`seedToWif`), shared by Verus Mobile and Verus
// Desktop:
//
//   bytes = sha256(utf8(seed))
//   bytes[0] &= 248; bytes[31] &= 127; bytes[31] |= 64      // "iguana" clamp
//   key   = ECPair(bytes, { network: verus })                // compressed
//
// Verus Mobile calls this with `iguana = true` from every call site, in both
// derivation versions (`deriveKeyPairV1` → `deriveElectrumKeypair`, and the
// legacy `deriveKeypairV0`), so for a phrase input both versions agree and the
// clamp is unconditional here. It is deliberately NOT an option: an unclamped
// key is one no Verus wallet would ever show the user.
//
// SECURITY, stated plainly: this is a single unsalted SHA-256 over the phrase
// text — no PBKDF2, no salt, no stretching. All security rests on the entropy
// of the phrase itself, and a weak phrase is cheap to brute-force offline.
// That is the ecosystem's format, not a choice this SDK gets to make; it is
// implemented for compatibility with wallets users already hold. Do not invent
// your own passphrase — only import one a Verus wallet generated.

/** secp256k1 curve order is irrelevant after the clamp: `bytes[0] &= 248`
 * forces the scalar below 2^253 (< n), and `bytes[31] |= 64` forces it
 * non-zero. Every clamped seed is therefore a valid private key. */
function seedBytes(seed: string): Buffer {
  if (typeof seed !== 'string' || seed.trim().length === 0) {
    throw new InvalidSeedError('seed phrase is empty');
  }

  // A WIF is a KEY, not a seed. Verus Mobile routes base58check-decodable
  // input to `wifToWif` and its `seedToWif` throws on it; hashing it here
  // would silently derive a DIFFERENT address and strand funds.
  let isWif = false;
  try {
    bs58check.decode(seed);
    isWif = true;
  } catch {
    // not base58check — a seed phrase, as expected
  }
  if (isWif) {
    throw new InvalidSeedError(
      'input is a WIF private key, not a seed phrase — use wifToPrivateKey / wifToAddress',
    );
  }

  // The clamp is `bytes[0] &= 248; bytes[31] &= 127; bytes[31] |= 64` upstream;
  // read/writeUInt8 expresses the same bytes under noUncheckedIndexedAccess
  // without asserting away the index type.
  const bytes = createHash('sha256').update(Buffer.from(seed, 'utf8')).digest();
  bytes.writeUInt8(bytes.readUInt8(0) & 248, 0);
  bytes.writeUInt8((bytes.readUInt8(31) & 127) | 64, 31);
  return bytes;
}

/**
 * Derive the private key a Verus Mobile / Verus Desktop seed phrase maps to.
 *
 * The phrase is hashed verbatim: no trimming, no case folding, no Unicode
 * normalization, no BIP39 word validation — exactly as the wallets do it.
 * Whitespace is significant.
 */
export function seedToPrivateKey(seed: string): Buffer {
  return seedBytes(seed);
}

/**
 * Derive the compressed WIF a Verus Mobile / Verus Desktop seed phrase maps to.
 *
 * The result is the same string the wallet shows under "export private key",
 * and can be handed to every signing entry point in this SDK.
 */
export function seedToWif(seed: string): string {
  const privateKey = seedBytes(seed);
  const payload = Buffer.concat([
    Buffer.from([WIF_PREFIX]),
    privateKey,
    Buffer.from([0x01]), // Verus wallets always derive a compressed key here
  ]);
  return bs58check.encode(payload);
}

/**
 * Derive the R-address a Verus Mobile / Verus Desktop seed phrase maps to.
 *
 * Compare this against the receiving address your wallet displays before
 * trusting a seed import.
 */
export async function seedToAddress(seed: string): Promise<string> {
  const publicKey = await privateKeyToPublicKey(seedBytes(seed), true);
  return publicKeyToAddress(publicKey);
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
