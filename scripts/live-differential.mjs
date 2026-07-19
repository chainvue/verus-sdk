#!/usr/bin/env node
/**
 * Tier-1 live differential runner.
 *
 * Compares the SDK's transaction SHAPE against the daemon's own build of the same
 * operation, live. Read-only: the daemon hex must come from an RPC's `returntx`
 * flag, which builds the tx and returns its hex WITHOUT broadcasting, spending,
 * or signing. Not part of the npm package (`files: [dist, NOTICE, LICENSE]`).
 *
 * The SDK is offline and ships no RPC transport, so this is a deliberate
 * maintainer step, not a CI job.
 *
 * Usage:
 *   node scripts/live-differential.mjs <systemId> <sdkHex> <daemonHex>
 *
 * where <daemonHex> comes from, e.g. (VRSCTEST systemId iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq):
 *   ssh vrsc-testnet 'verus -chain=vrsctest registeridentity "$(cat idreg.json)" true'
 *   ssh vrsc-testnet 'verus -chain=vrsctest updateidentity "<json>" true'
 *   ssh vrsc-testnet 'verus -chain=vrsctest sendcurrency "<from>" "<outs>" 1 0 false true'
 *   ssh vrsc-testnet 'verus -chain=vrsctest definecurrency "<json>" true'
 * and <sdkHex> is the signed hex the SDK produces for the SAME operation
 * (e.g. printed from a golden test or a REPL).
 *
 * It reduces both to `{version, inputCount, outputs:[{evalCodes, reserveCurrencyCount,
 * nativeZero}]}` and diffs the STRUCTURAL outputs — those carrying a CC eval code
 * or a reserve currency. That multiset is what the daemon dictates and what the
 * two worst bugs of the hardening campaign corrupted: a fee output built as
 * EVAL_RESERVE_TRANSFER (8) instead of EVAL_RESERVE_OUTPUT (9), and a dropped
 * reserve-change output (token burn). Plain outputs — native change/payment, and
 * the identity/reservation outputs that `unpackOutput` does not decode to params
 * in this mode — legitimately differ per wallet (own UTXOs, change, amounts) and
 * are not compared. A divergence in the structural multiset exits non-zero.
 *
 * Limitation (shared with the Tier-0 harness): it verifies the reserve/CC output
 * structure, not the identity/reservation outputs, which reduce to plain here.
 */
// @bitgo/utxo-lib is CommonJS; import the default and destructure (named ESM
// imports fail under Node's CJS interop).
import pkg from '@bitgo/utxo-lib';

const { Transaction, networks, smarttxs } = pkg;
const { unpackOutput } = smarttxs;
const [, , systemId, sdkHex, daemonHex] = process.argv;

if (!systemId || !sdkHex || !daemonHex) {
  console.error('usage: node scripts/live-differential.mjs <systemId> <sdkHex> <daemonHex>');
  process.exit(2);
}

/** Reduce a tx hex to its wallet-agnostic shape (mirrors test/support/canonicalize.ts). */
function shape(hex) {
  const tx = Transaction.fromHex(hex, networks.verustest);
  const outputs = tx.outs.map((o) => {
    let evalCodes = [];
    let reserveCurrencyCount = 0;
    try {
      const u = unpackOutput({ script: o.script, value: o.value }, systemId, true);
      evalCodes = (u.params ?? []).map((p) => p.eval).sort((a, b) => a - b);
      for (const [c, v] of Object.entries(u.values ?? {})) {
        if (c !== systemId && BigInt(v.toString(10)) > 0n) reserveCurrencyCount++;
      }
    } catch {
      /* plain output (P2PKH/P2SH) — no CC structure */
    }
    return { evalCodes, reserveCurrencyCount, nativeZero: o.value === 0 };
  });
  return { version: tx.version, inputCount: tx.ins.length, outputs };
}

const key = (o) => `[${o.evalCodes.join(',')}]|reserves=${o.reserveCurrencyCount}|native0=${o.nativeZero}`;
/** Structural outputs: those carrying a CC eval code or a reserve currency, sorted. */
function structural(outputs) {
  return outputs
    .filter((o) => o.evalCodes.length > 0 || o.reserveCurrencyCount > 0)
    .map(key)
    .sort();
}

const sdk = shape(sdkHex);
const daemon = shape(daemonHex);
const sdkStruct = structural(sdk.outputs);
const daemonStruct = structural(daemon.outputs);

console.log('SDK    :', JSON.stringify(sdk));
console.log('daemon :', JSON.stringify(daemon));
console.log('\nstructural (CC / reserve) outputs — must match as a multiset:');
console.log('  SDK   :', sdkStruct.length ? sdkStruct.join('  ') : '(none)');
console.log('  daemon:', daemonStruct.length ? daemonStruct.join('  ') : '(none)');

const ok = sdkStruct.length === daemonStruct.length && sdkStruct.every((s, i) => s === daemonStruct[i]);
console.log(
  `\nplain outputs (native change/payment + undecoded identity/reservation — not compared): ` +
    `sdk ${sdk.outputs.length - sdkStruct.length}, daemon ${daemon.outputs.length - daemonStruct.length}`,
);

if (!ok) {
  console.error('\nDIFFERENTIAL FAILED: the SDK and daemon disagree on the structural output multiset.');
  process.exit(1);
}
console.log('\nDIFFERENTIAL OK: structural output multiset matches the daemon.');
