/**
 * Low-level Verus wire encoders shared by the currency-definition serializer and
 * the currency-launch output builders. Kept in one place so the definition output
 * and the notarization/import/export outputs encode integers, vectors, i-addresses
 * and CryptoCondition wrappers identically — the daemon validates them against one
 * another, so any drift between the two would ship an unbroadcastable transaction.
 *
 * Encodings mirror VerusCoin: CompactSize for vector/string lengths, Bitcoin
 * `VARINT` (MSB base-128 continuation) for scalar counts/fees, little-endian
 * fixed-width for the rest. Amounts are bigint satoshis; `number` is only used for
 * genuinely 32-bit fields (protocol ids, heights, ratios).
 */
import BN from 'bn.js';
import {
  OptCCParams,
  TxDestination,
  PubKey,
  KeyID,
  script as bscript,
  opcodes,
} from '../fork/boundary.js';
import { iAddressToHash, writeCompactSize } from '../utils/index.js';
import { parseIAddress } from '../core/brands.js';
import { TransactionBuildError } from '../errors.js';

export const SATOSHIDEN = 100_000_000n;
export const INT32_MIN = -0x80000000;
export const INT32_MAX = 0x7fffffff;
export const ZEROS_32 = Buffer.alloc(32);

/** Assert a bigint fits a non-negative int32 (VARINT-encoded int32 ratio fields). */
export function requireInt32Range(value: bigint, label: string): bigint {
  if (value < 0n || value > BigInt(INT32_MAX)) {
    throw new TransactionBuildError(`${label} must be in [0, ${INT32_MAX}], got ${value}`);
  }
  return value;
}

const INT64_MAX = 2n ** 63n - 1n;

/** Assert a bigint fits a non-negative int64 (VARINT-encoded CAmount fee fields). */
export function requireInt64Range(value: bigint, label: string): bigint {
  if (value < 0n || value > INT64_MAX) {
    throw new TransactionBuildError(`${label} must be in [0, 2^63-1], got ${value}`);
  }
  return value;
}

/** Little-endian int16 (uint16 domain — flags/versions are small non-negative). */
export function uint16LE(value: number, label: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new TransactionBuildError(`${label} must be a uint16, got ${value}`);
  }
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

/** Little-endian int32. */
export function int32LE(value: number, label: string): Buffer {
  if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) {
    throw new TransactionBuildError(`${label} must be an int32, got ${value}`);
  }
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(value, 0);
  return buf;
}

/** Little-endian uint32. */
export function uint32LE(value: number, label: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new TransactionBuildError(`${label} must be a uint32, got ${value}`);
  }
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

/** Little-endian signed int64. */
export function int64LE(value: bigint, label: string): Buffer {
  const buf = Buffer.alloc(8);
  try {
    buf.writeBigInt64LE(value, 0);
  } catch {
    throw new TransactionBuildError(`${label} does not fit in an int64: ${value}`);
  }
  return buf;
}

/**
 * Bitcoin/Verus `VARINT` (serialize.h `WriteVarInt`): base-128, MSB continuation,
 * most-significant group first. Distinct from the CompactSize used for vector
 * lengths. Non-negative only (all VARINT fields here are counts/fees/heights).
 */
export function varInt(value: bigint, label: string): Buffer {
  if (value < 0n) {
    throw new TransactionBuildError(`${label} must be non-negative for VARINT, got ${value}`);
  }
  let n = value;
  const out: number[] = [];
  let len = 0;
  for (;;) {
    out.push(Number(n & 0x7fn) | (len > 0 ? 0x80 : 0x00));
    if (n <= 0x7fn) break;
    n = (n >> 7n) - 1n;
    len++;
  }
  return Buffer.from(out.reverse());
}

/** LIMITED_STRING: CompactSize length + UTF-8 bytes. */
export function limitedString(value: string, maxLen: number, label: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > maxLen) {
    throw new TransactionBuildError(`${label} exceeds ${maxLen} bytes`);
  }
  return Buffer.concat([writeCompactSize(bytes.length), bytes]);
}

/** A uint160 i-address on the wire: its raw 20-byte hash, no length prefix. */
export function uint160(iAddress: string, label: string): Buffer {
  const hash = iAddressToHash(parseIAddress(iAddress, label));
  if (hash.length !== 20) {
    throw new TransactionBuildError(`${label} must be a 20-byte i-address hash`);
  }
  return hash;
}

/** A pre-hashed uint160 (20 raw bytes), validated for length. */
export function uint160Raw(hash: Buffer, label: string): Buffer {
  if (hash.length !== 20) {
    throw new TransactionBuildError(`${label} must be a 20-byte hash, got ${hash.length}`);
  }
  return Buffer.from(hash);
}

/** A uint256 (32 raw bytes), validated for length. */
export function uint256Raw(hash: Buffer, label: string): Buffer {
  if (hash.length !== 32) {
    throw new TransactionBuildError(`${label} must be a 32-byte hash, got ${hash.length}`);
  }
  return Buffer.from(hash);
}

/** CompactSize-counted vector of uint160 i-addresses. */
export function vectorU160(addresses: string[], label: string): Buffer {
  return Buffer.concat([
    writeCompactSize(addresses.length),
    ...addresses.map((a, i) => uint160(a, `${label}[${i}]`)),
  ]);
}

/** CompactSize-counted vector of little-endian int64 amounts. */
export function vectorI64(values: bigint[], label: string): Buffer {
  return Buffer.concat([
    writeCompactSize(values.length),
    ...values.map((v, i) => int64LE(v, `${label}[${i}]`)),
  ]);
}

/**
 * CompactSize-counted vector of little-endian int32 values (weights). Weights are
 * int32 on the wire, so `Number(v)` is exact here — any bigint that would lose
 * precision (> 2^53) is far above INT32_MAX and rejected by `int32LE` first.
 */
export function vectorI32(values: bigint[], label: string): Buffer {
  return Buffer.concat([
    writeCompactSize(values.length),
    ...values.map((v, i) => int32LE(Number(v), `${label}[${i}]`)),
  ]);
}

/**
 * `CCurrencyValueMap` wire format: CompactSize(n) + n·(uint160 + int64). Entries
 * must already be sorted by currency id the way the daemon emits them; callers
 * here pass single-entry or empty maps, so ordering is not a concern yet.
 */
export function currencyValueMap(entries: Array<{ hash: Buffer; amount: bigint }>, label: string): Buffer {
  return Buffer.concat([
    writeCompactSize(entries.length),
    ...entries.flatMap((e, i) => [uint160Raw(e.hash, `${label}[${i}].id`), int64LE(e.amount, `${label}[${i}].amount`)]),
  ]);
}

/**
 * Normalize raw relative reserve weights to canonical weights summing to
 * exactly SATOSHIDEN (1e8), reproducing `definecurrency` byte-for-byte
 * (`CCurrencyDefinition(UniValue)`, VerusCoin `src/pbaas/crosschainrpc.cpp`):
 * each weight becomes `floor(1e8 · raw[i] / Σraw)`, and the last currency — or
 * any earlier one whose share would overrun what remains — absorbs the leftover
 * so the vector sums to precisely 1e8. Byte-locked against the daemon for even
 * and uneven splits (see test/currency-definition.test.ts).
 */
export function normalizeWeights(raw: bigint[]): bigint[] {
  let total = 0n;
  for (const w of raw) {
    if (w <= 0n) {
      throw new TransactionBuildError(`each reserve weight must be > 0, got ${w}`);
    }
    requireInt32Range(w, 'weight'); // the daemon reads each raw weight as an int32
    total += w;
  }
  const out: bigint[] = [];
  let reserveLeft = SATOSHIDEN;
  raw.forEach((w, i) => {
    let amount = (SATOSHIDEN * w) / total; // integer floor, matching arith_uint256
    if (reserveLeft <= amount || i + 1 === raw.length) {
      amount = reserveLeft;
    }
    reserveLeft -= amount;
    out.push(amount);
  });
  return out;
}

/** The CC destination kinds a currency-launch output uses. */
export type CcDestination =
  | { kind: 'pubkey'; pubkey: Buffer }
  | { kind: 'keyid'; hash: Buffer };

function toTxDestination(dest: CcDestination): TxDestination {
  return dest.kind === 'pubkey'
    ? new TxDestination(new PubKey(dest.pubkey, true))
    : new TxDestination(new KeyID(uint160Raw(dest.hash, 'cc destination hash')));
}

/**
 * Wrap serialized data in a Verus CryptoCondition output script:
 * `OptCCParams(master, eval 0) OP_CHECKCRYPTOCONDITION OptCCParams(params, evalCode) OP_DROP`,
 * both m=1/n=1 to a single fixed destination. This is the shape every CC output
 * in a currency-definition transaction uses; the eval code, destination, and
 * payload vary per output.
 */
export function wrapCcOutput(evalCode: number, vdata: Buffer[], dest: CcDestination): Buffer {
  const destination = (): TxDestination => toTxDestination(dest);
  const master = new OptCCParams({
    version: new BN(3),
    eval_code: new BN(0),
    m: new BN(1),
    n: new BN(1),
    destinations: [destination()],
    vdata: [],
  });
  const params = new OptCCParams({
    version: new BN(3),
    eval_code: new BN(evalCode),
    m: new BN(1),
    n: new BN(1),
    destinations: [destination()],
    vdata,
  });
  return bscript.compile([
    master.toChunk(),
    opcodes.OP_CHECKCRYPTOCONDITION,
    params.toChunk(),
    opcodes.OP_DROP,
  ]);
}
