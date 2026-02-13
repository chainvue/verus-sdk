/**
 * Shared utility functions
 */

import { createHash } from 'crypto';
import bs58check from 'bs58check';
import { fromBase58Check } from 'verus-typescript-primitives';

/**
 * SHA256d (double SHA-256) of one or more buffers
 */
export function sha256d(...buffers: Buffer[]): Buffer {
  const first = createHash('sha256');
  for (const buf of buffers) {
    first.update(buf);
  }
  return createHash('sha256').update(first.digest()).digest();
}

/**
 * Write a Bitcoin-style compactsize integer to a buffer
 */
export function writeCompactSize(value: number): Buffer {
  if (value < 253) {
    const buf = Buffer.alloc(1);
    buf.writeUInt8(value, 0);
    return buf;
  } else if (value <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf.writeUInt8(253, 0);
    buf.writeUInt16LE(value, 1);
    return buf;
  } else if (value <= 0xffffffff) {
    const buf = Buffer.alloc(5);
    buf.writeUInt8(254, 0);
    buf.writeUInt32LE(value, 1);
    return buf;
  } else {
    throw new Error('CompactSize value too large');
  }
}

/**
 * Decode an i-address to its 20-byte hash
 */
export function iAddressToHash(iAddress: string): Buffer {
  const { hash } = fromBase58Check(iAddress);
  return Buffer.from(hash);
}

/**
 * Convert an R-address or P2SH address to a scriptPubKey Buffer
 */
export function addressToScriptPubKey(address: string): Buffer {
  const decoded = bs58check.decode(address);
  const prefix = decoded[0];
  const hash = decoded.slice(1);

  if (prefix === 0x3c) {
    // P2PKH (R-address)
    return Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH20
      hash,
      Buffer.from([0x88, 0xac]), // OP_EQUALVERIFY OP_CHECKSIG
    ]);
  } else if (prefix === 0x55) {
    // P2SH
    return Buffer.concat([
      Buffer.from([0xa9, 0x14]), // OP_HASH160 PUSH20
      hash,
      Buffer.from([0x87]), // OP_EQUAL
    ]);
  } else {
    throw new Error(
      `Unsupported address prefix: 0x${prefix.toString(16)}. Use sendCurrency for i-address destinations.`
    );
  }
}
