/**
 * Shared utility functions
 */

import { createHash } from 'crypto';
import bs58check from 'bs58check';
import { fromBase58Check } from 'verus-typescript-primitives';
import { NETWORK_CONFIG } from '../constants/index.js';
import { InvalidAddressError, InvalidAmountError } from '../errors.js';

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

// ─── Exact money conversions (bigint satoshis ↔ decimal strings) ─────────

/** Number of decimal places in a coin amount */
export const AMOUNT_DECIMALS = 8;

/** Satoshis per coin unit */
export const SATS_PER_COIN = 100_000_000n;

/**
 * Grammar for decimal coin amounts: non-negative, no leading zeros in the
 * integer part, optional `.` with 1–8 fraction digits. No exponents, no
 * signs, no whitespace.
 */
const DECIMAL_AMOUNT_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;

/**
 * Parse a decimal coin-amount string into bigint satoshis. Exact arithmetic
 * only — rejects anything outside the grammar (negative, exponent notation,
 * more than 8 fraction digits, empty, non-numeric) with a typed error.
 */
export function parseSats(decimal: string): bigint {
  if (typeof decimal !== 'string' || !DECIMAL_AMOUNT_RE.test(decimal)) {
    throw new InvalidAmountError(String(decimal));
  }
  const [whole = '0', fraction = ''] = decimal.split('.');
  return BigInt(whole) * SATS_PER_COIN + BigInt(fraction.padEnd(AMOUNT_DECIMALS, '0'));
}

/** Convert coin units (decimal string) to satoshis — alias of parseSats */
export function toSatoshis(coins: string): bigint {
  return parseSats(coins);
}

/**
 * Convert satoshis to a decimal coin-unit string (minimal form, trailing
 * fraction zeros trimmed). Exact — never goes through float64.
 */
export function toCoins(satoshis: bigint): string {
  const sign = satoshis < 0n ? '-' : '';
  const abs = satoshis < 0n ? -satoshis : satoshis;
  const whole = abs / SATS_PER_COIN;
  const fraction = abs % SATS_PER_COIN;
  if (fraction === 0n) return `${sign}${whole}`;
  const fractionStr = fraction
    .toString()
    .padStart(AMOUNT_DECIMALS, '0')
    .replace(/0+$/, '');
  return `${sign}${whole}.${fractionStr}`;
}

const MAX_SAFE_SATS = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Convert bigint satoshis to the `number` that @bitgo/utxo-lib expects at its
 * boundary. The SDK is exact-integer internally; this is the single checked
 * crossing into the signing library, which still models values as float64.
 */
export function toSafeNumber(sats: bigint): number {
  if (sats < 0n || sats > MAX_SAFE_SATS) {
    throw new InvalidAmountError(
      sats.toString(),
      'outside the safe-integer range supported by the underlying signing library',
    );
  }
  return Number(sats);
}

/**
 * Convert an R-address or P2SH address to a scriptPubKey Buffer
 */
export function addressToScriptPubKey(address: string): Buffer {
  let decoded: Uint8Array;
  try {
    decoded = bs58check.decode(address);
  } catch (err) {
    throw new InvalidAddressError(address, (err as Error).message);
  }
  const prefix = decoded[0];
  const hash = decoded.slice(1);

  // Both branches emit a PUSH20 opcode, which asserts a 20-byte payload. A
  // base58check string that decodes to a different length (wrong version+len
  // combination) would otherwise produce a malformed script with a length
  // prefix that doesn't match its data.
  if (hash.length !== 20) {
    throw new InvalidAddressError(
      address,
      `Expected a 20-byte hash payload, got ${hash.length} bytes`,
    );
  }

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
    throw new InvalidAddressError(
      address,
      `Unsupported address prefix: 0x${(prefix ?? 0).toString(16)}. Use sendCurrency for i-address destinations.`,
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
  valueSat: bigint;
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
  // Lazy require keeps utils' import graph light for non-tx consumers. The
  // fork's ambient module declaration (bitgo-utxo-lib.d.ts) types the shape.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load; see above
  const utxolib = require('@bitgo/utxo-lib') as typeof import('@bitgo/utxo-lib');
  const { Transaction, address: addressLib, networks, smarttxs } = utxolib;
  const net = network === 'testnet' ? networks.verustest : networks.verus;
  const chainId: string =
    network === 'testnet' ? NETWORK_CONFIG.testnet.chainId : NETWORK_CONFIG.mainnet.chainId;
  const tx = Transaction.fromHex(hex, net);
  const inputs: DecodedInput[] = tx.ins.map((input) => ({
    txid: Buffer.from(input.hash).reverse().toString('hex'),
    vout: input.index,
  }));
  const outputs: DecodedOutput[] = tx.outs.map((out) => {
    let addr: string | null = null;
    try {
      addr = addressLib.fromOutputScript(out.script, net);
    } catch {
      // Smart CC output. Recover the address ONLY for pure payment outputs
      // (all OptCCParams are EVAL_NONE, exactly one destination — e.g. P2ID
      // change back to an identity). Structural outputs (name commitments,
      // identity definitions, reservations) deliberately stay null: callers
      // like the registration flow LOCATE them by address === null.
      try {
        const unpacked = smarttxs.unpackOutput({ script: out.script, value: out.value }, chainId);
        const evalCodes: number[] = (unpacked.params ?? []).map((p) => p.eval);
        if (unpacked.destinations.length === 1 && evalCodes.every((code) => code === 0)) {
          addr = unpacked.destinations[0] ?? null;
        }
      } catch {
        addr = null; // exotic CC output — no address form
      }
    }
    return { valueSat: BigInt(out.value), scriptHex: out.script.toString('hex'), address: addr };
  });
  return { txid: tx.getId(), inputs, outputs };
}
