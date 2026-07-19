/**
 * Structural canonicalizer for differential testing against the daemon.
 *
 * Reduces a transaction to its *shape* — the structural facts that must match
 * the daemon's own build of the same operation, independent of wallet-specific
 * bytes (addresses, amounts, salts, txids, signatures). Two transactions are
 * "structurally equal" when their canonical shapes are equal.
 *
 * Per output it records: the CC eval codes (sorted), how many distinct non-native
 * reserve currencies the output carries, and whether its native value is zero.
 * This is enough to distinguish a correct transaction from the two bug classes
 * that motivated the differential harness:
 *   - sub-ID fee as EVAL_RESERVE_TRANSFER (8) vs EVAL_RESERVE_OUTPUT (9);
 *   - a missing reserve-output change (token burn) → different output count / shape.
 * It deliberately does NOT capture destinations or amounts (wallet-specific).
 */
import { Transaction, networks, smarttxs } from '@bitgo/utxo-lib';

const { unpackOutput } = smarttxs;

export interface CanonicalOutput {
  /** CC eval codes on the output, ascending; empty for a plain (P2PKH) output. */
  evalCodes: number[];
  /** Count of distinct non-native reserve currencies carried by the output. */
  reserveCurrencyCount: number;
  /** True when the output carries zero native satoshis. */
  nativeZero: boolean;
}

export interface CanonicalTx {
  version: number;
  inputCount: number;
  outputs: CanonicalOutput[];
}

export function canonicalize(
  txHex: string,
  network: 'mainnet' | 'testnet',
  systemId: string,
): CanonicalTx {
  const net = network === 'testnet' ? networks.verustest : networks.verus;
  // The fork's ambient .d.ts doesn't expose `version`; it exists at runtime.
  const tx = Transaction.fromHex(txHex, net) as InstanceType<typeof Transaction> & { version: number };

  const outputs: CanonicalOutput[] = tx.outs.map((o: { script: Buffer; value: number }) => {
    let evalCodes: number[] = [];
    let reserveCurrencyCount = 0;
    try {
      const unpacked = unpackOutput({ script: o.script, value: o.value }, systemId, true);
      evalCodes = (unpacked.params ?? [])
        .map((p: { eval: number }) => p.eval)
        .sort((a: number, b: number) => a - b);
      for (const [currency, value] of Object.entries(unpacked.values ?? {})) {
        if (currency === systemId) continue;
        if (BigInt((value as { toString(radix: number): string }).toString(10)) > 0n) {
          reserveCurrencyCount++;
        }
      }
    } catch {
      // Plain script (P2PKH/P2SH) — no CC structure; leave evalCodes empty.
    }
    return { evalCodes, reserveCurrencyCount, nativeZero: o.value === 0 };
  });

  return { version: tx.version, inputCount: tx.ins.length, outputs };
}

/** Stable string key of a canonical shape, for equality assertions / fixtures. */
export function shapeKey(c: CanonicalTx): string {
  return JSON.stringify({
    version: c.version,
    outputs: c.outputs.map((o) => [o.evalCodes, o.reserveCurrencyCount, o.nativeZero]),
  });
}
