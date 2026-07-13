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

/** Convert coin units to satoshis */
export function toSatoshis(coins: number): number {
  return Math.round(coins * 1e8);
}

/** Convert satoshis to coin units */
export function toCoins(satoshis: number): number {
  return satoshis / 1e8;
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

// ─── Signed-transaction summary (consumer-facing) ────────────────────────

/** One consumed input of a signed transaction, in `txid`/`vout` form. */
export interface DecodedInput {
  txid: string;
  vout: number;
}

/** One output of a signed transaction. `address` is null for smart outputs. */
export interface DecodedOutput {
  valueSat: number;
  scriptHex: string;
  /** Base58 address when the script is plain P2PKH/P2SH, else null. */
  address: string | null;
}

/**
 * Decode a signed transaction hex into the facts a wallet ledger needs:
 * txid, the exact outpoints consumed, and the outputs (with addresses where
 * the script is plain P2PKH/P2SH). Wallets use this to record spent
 * outpoints and locate their own change output without re-implementing
 * transaction parsing.
 */
export function summarizeSignedTransaction(
  hex: string,
  network: 'mainnet' | 'testnet'
): { txid: string; inputs: DecodedInput[]; outputs: DecodedOutput[] } {
  // Lazy require keeps utils' import graph light for non-tx consumers.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Transaction, address: addressLib, networks } = require('@bitgo/utxo-lib');
  const net = network === 'testnet' ? networks.verustest : networks.verus;
  const tx = Transaction.fromHex(hex, net);
  const inputs: DecodedInput[] = tx.ins.map((input: { hash: Buffer; index: number }) => ({
    txid: Buffer.from(input.hash).reverse().toString('hex'),
    vout: input.index,
  }));
  const outputs: DecodedOutput[] = tx.outs.map((out: { script: Buffer; value: number }) => {
    let addr: string | null = null;
    try {
      addr = addressLib.fromOutputScript(out.script, net);
    } catch {
      addr = null; // smart output (CC script) — no plain address form
    }
    return { valueSat: out.value, scriptHex: out.script.toString('hex'), address: addr };
  });
  return { txid: tx.getId(), inputs, outputs };
}
