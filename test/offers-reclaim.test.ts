/**
 * Reclaiming (cancelling) an unaccepted offer: spend the maker's funding
 * commitment back to the maker, signed SIGHASH_ALL.
 *
 * The native path is additionally live-proven on VRSCTEST — the SDK funded a
 * commitment (0.01) and reclaimed it (0.0099 after fee, tx 6208d0db). The token
 * path reuses primitives that are themselves byte-proven (the reserve output) and
 * live-proven (the CC spend + native fee funding), and is asserted here.
 */
import { describe, it, expect } from 'vitest';
import { buildReclaimOffer } from '../src/offers/reclaim.js';
import { buildCommitmentScript, buildTokenCommitmentScript, buildTokenChangeOutput } from '../src/identity/index.js';
import { parseRAddress, parseAddress } from '../src/core/brands.js';
import { Transaction, script as bscript } from '../src/fork/boundary.js';
import { getNetwork } from '../src/signing/index.js';
import { estimateFee } from '../src/utxo/index.js';
import {
  TEST_WIF,
  TEST_ADDRESS,
  TEST_ADDRESS_B,
  NETWORK,
  VRSCTEST_SYSTEM_ID,
  makeFundingUtxo,
  makeP2PKHScript,
} from './fixtures/index.js';

const TOKTEST5A_ID = 'iJWuVTboQbmqL6QWaX6g8oPfWDTpvxtQ2a';
const net = getNetwork(true);

/** The maker's native funding commitment (single-key eval-17 CC), carrying `amount`. */
function nativeCommitment(amount: bigint) {
  return {
    txid: 'ab'.repeat(32),
    vout: 0,
    value: amount,
    script: buildCommitmentScript(Buffer.alloc(32, 0), parseRAddress(TEST_ADDRESS)).toString('hex'),
  };
}

/** The maker's token funding commitment (carries the token as reserve, 0 native). */
function tokenCommitment(currency: string, amount: bigint) {
  return {
    txid: 'cd'.repeat(32),
    vout: 0,
    value: 0n,
    script: buildTokenCommitmentScript(currency, amount, parseRAddress(TEST_ADDRESS)).toString('hex'),
  };
}

/** The CC fulfillment on an input carries SIGHASH_ALL (0x01), not the offer's 0x83. */
function fulfillmentPrefix(tx: Transaction, i: number): string {
  const chunk = (bscript.decompile(tx.ins[i]!.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c));
  return chunk!.subarray(0, 2).toString('hex');
}

describe('buildReclaimOffer — native', () => {
  it('spends the commitment back to the maker, fee out of the reclaimed value', () => {
    const offered = 1_000_000n;
    const res = buildReclaimOffer(
      { wif: TEST_WIF, commitment: nativeCommitment(offered), offered: { currency: VRSCTEST_SYSTEM_ID, amount: offered }, makerAddress: TEST_ADDRESS, expiryHeight: 1_200_000 },
      NETWORK,
    );
    const tx = Transaction.fromHex(res.reclaimTx, net);
    expect(tx.ins.length).toBe(1);
    expect(tx.outs.length).toBe(1);
    // in[0] = the commitment, signed SIGHASH_ALL as a CC.
    expect(fulfillmentPrefix(tx, 0)).toBe('0101');
    // out[0] = native back to the maker, minus the fee.
    const fee = estimateFee(1, 1, 10_000n, false, 100);
    expect(tx.outs[0]!.value).toBe(Number(offered - fee));
  });

  it('rejects a reclaim whose value cannot cover the fee above dust', () => {
    expect(() =>
      buildReclaimOffer(
        { wif: TEST_WIF, commitment: nativeCommitment(10_000n), offered: { currency: VRSCTEST_SYSTEM_ID, amount: 10_000n }, makerAddress: TEST_ADDRESS, expiryHeight: 1_200_000 },
        NETWORK,
      ),
    ).toThrow(/too small to cover the fee/);
  });

  it('rejects a non-positive amount and a bad expiry height', () => {
    expect(() =>
      buildReclaimOffer(
        { wif: TEST_WIF, commitment: nativeCommitment(1_000_000n), offered: { currency: VRSCTEST_SYSTEM_ID, amount: 0n }, makerAddress: TEST_ADDRESS, expiryHeight: 1_200_000 },
        NETWORK,
      ),
    ).toThrow(/amount must be positive/);
    expect(() =>
      buildReclaimOffer(
        { wif: TEST_WIF, commitment: nativeCommitment(1_000_000n), offered: { currency: VRSCTEST_SYSTEM_ID, amount: 1_000_000n }, makerAddress: TEST_ADDRESS, expiryHeight: 0 },
        NETWORK,
      ),
    ).toThrow(/expiryHeight must be a positive/);
  });
});

describe('buildReclaimOffer — token', () => {
  const offered = 10n * 100_000_000n;

  it('returns the token to the maker and funds the fee from native UTXOs', () => {
    const res = buildReclaimOffer(
      {
        wif: TEST_WIF,
        commitment: tokenCommitment(TOKTEST5A_ID, offered),
        offered: { currency: TOKTEST5A_ID, amount: offered },
        makerAddress: TEST_ADDRESS,
        feeUtxos: [makeFundingUtxo('bb', 100_000_000n)],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 1_200_000,
      },
      NETWORK,
    );
    const tx = Transaction.fromHex(res.reclaimTx, net);
    // in[0] = commitment (CC, SIGHASH_ALL); in[1] = native fee.
    expect(fulfillmentPrefix(tx, 0)).toBe('0101');
    expect(tx.ins.length).toBe(2);
    // out[0] = the token returned to the maker, byte-identical to a reserve output.
    const expectedToken = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[TOKTEST5A_ID, offered]]));
    expect(tx.outs[0]!.script.toString('hex')).toBe(expectedToken.script.toString('hex'));
    expect(tx.outs[0]!.value).toBe(0);
    // out[1] = native change.
    expect(tx.outs[1]!.value).toBeGreaterThan(0);
  });

  it('rejects reclaiming a token without feeUtxos', () => {
    expect(() =>
      buildReclaimOffer(
        { wif: TEST_WIF, commitment: tokenCommitment(TOKTEST5A_ID, offered), offered: { currency: TOKTEST5A_ID, amount: offered }, makerAddress: TEST_ADDRESS, expiryHeight: 1_200_000 },
        NETWORK,
      ),
    ).toThrow(/requires feeUtxos/);
  });

  it('rejects a token-bearing fee UTXO (its reserve value would be dropped)', () => {
    const reserveScript = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[TOKTEST5A_ID, 5n * 100_000_000n]])).script.toString('hex');
    expect(() =>
      buildReclaimOffer(
        {
          wif: TEST_WIF,
          commitment: tokenCommitment(TOKTEST5A_ID, offered),
          offered: { currency: TOKTEST5A_ID, amount: offered },
          makerAddress: TEST_ADDRESS,
          feeUtxos: [{ txid: 'ef'.repeat(32), outputIndex: 0, satoshis: 100_000_000n, script: reserveScript }],
          expiryHeight: 1_200_000,
        },
        NETWORK,
      ),
    ).toThrow(/must carry only the native coin/);
  });

  it('rejects a native fee UTXO not controlled by the provided wif', () => {
    expect(() =>
      buildReclaimOffer(
        {
          wif: TEST_WIF,
          commitment: tokenCommitment(TOKTEST5A_ID, offered),
          offered: { currency: TOKTEST5A_ID, amount: offered },
          makerAddress: TEST_ADDRESS,
          feeUtxos: [{ txid: 'fa'.repeat(32), outputIndex: 0, satoshis: 100_000_000n, script: makeP2PKHScript(TEST_ADDRESS_B) }],
          expiryHeight: 1_200_000,
        },
        NETWORK,
      ),
    ).toThrow(/not controlled by the provided wif/);
  });
});
