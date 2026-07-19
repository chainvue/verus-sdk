#!/usr/bin/env node
/**
 * Record daemon structural shapes for the Tier-0 differential fixtures
 * (test/fixtures/daemon-shapes.json). Read-only against a testnet daemon — it
 * never broadcasts, spends, or signs; it asks the daemon to *build* a tx via the
 * `returntx` flag and reduces it to a wallet-agnostic shape (eval codes,
 * reserve-currency count, native-zero per output). Not part of the npm package
 * (`files: [dist, NOTICE, LICENSE]`).
 *
 * Usage (against the VRSCTEST node):
 *   node scripts/record-diff-fixtures.mjs <returntx-hex> <systemId>
 *
 * where <returntx-hex> comes from, e.g.:
 *   ssh vrsc-testnet 'verus -chain=vrsctest registeridentity "$(cat /tmp/idreg.json)" true'
 *   ssh vrsc-testnet 'verus -chain=vrsctest updateidentity "<json>" true'
 *   ssh vrsc-testnet 'verus -chain=vrsctest sendcurrency "<from>" "<outs>" 1 0 false true'  # returntxtemplate
 *
 * and <systemId> is the chain id (VRSCTEST: iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq).
 * Fail-closed: refuse to run against a non-testnet daemon shape is the caller's
 * responsibility (this script only reads a hex you already obtained read-only).
 */
import { Transaction, networks, smarttxs } from '@bitgo/utxo-lib';

const { unpackOutput } = smarttxs;
const [, , hex, systemId] = process.argv;

if (!hex || !systemId) {
  console.error('usage: node scripts/record-diff-fixtures.mjs <returntx-hex> <systemId>');
  process.exit(2);
}

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
    /* plain output */
  }
  return { evalCodes, reserveCurrencyCount, nativeZero: o.value === 0 };
});

console.log(JSON.stringify({ version: tx.version, inputCount: tx.ins.length, outputs }, null, 2));
