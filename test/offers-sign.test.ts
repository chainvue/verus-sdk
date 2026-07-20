/**
 * The offer input signer produces a CryptoCondition fulfillment signed with
 * SIGHASH_SINGLE|ANYONECANPAY (0x83) — byte-structured exactly like the daemon's
 * `makeoffer` output (fulfillment prefix `01 83 01 01 21<pubkey> …`).
 */
import { describe, it, expect } from 'vitest';
import { TransactionBuilder, Transaction, script as bscript } from '../src/fork/boundary.js';
import { signOfferInput, SIGHASH_OFFER } from '../src/offers/sign.js';
import { buildTokenChangeOutput } from '../src/identity/index.js';
import { parseAddress } from '../src/core/brands.js';
import { getNetwork } from '../src/signing/index.js';
import { TEST_WIF, TEST_ADDRESS, NETWORK, VRSCTEST_SYSTEM_ID } from './fixtures/index.js';

const VERSION_GROUP_ID = 0x892f2085;

/** Build an unsigned offer tx: spend the offered CC output → the single wanted output. */
function unsignedOffer(ccScript: Buffer): string {
  const net = getNetwork(true);
  const txb = new TransactionBuilder(net);
  txb.setVersion(4);
  txb.setExpiryHeight(1_200_000);
  txb.setVersionGroupId(VERSION_GROUP_ID);
  txb.addInput(Buffer.alloc(32, 0xab), 0, 0xffffffff, ccScript);
  txb.addOutput(TEST_ADDRESS, 90_000);
  return txb.buildIncomplete().toHex();
}

describe('signOfferInput', () => {
  it('constant SIGHASH_OFFER is SINGLE|ANYONECANPAY', () => {
    expect(SIGHASH_OFFER).toBe(0x83);
  });

  it('produces a 0x83 CC fulfillment matching the daemon structure', () => {
    const net = getNetwork(true);
    // The offered asset in a CC output controlled by TEST_WIF's address.
    const ccScript = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[VRSCTEST_SYSTEM_ID, 100_000n]])).script;
    const unsignedHex = unsignedOffer(ccScript);

    const { signedTx, txid } = signOfferInput(unsignedHex, 0, ccScript, 100_000n, TEST_WIF, NETWORK);

    expect(txid).toMatch(/^[0-9a-f]{64}$/);
    const scriptSig = Transaction.fromHex(signedTx, net).ins[0]!.script;
    const chunks = bscript.decompile(scriptSig) ?? [];
    const fulfillment = chunks.find((c): c is Buffer => Buffer.isBuffer(c));
    expect(fulfillment).toBeDefined();
    // 01 (version) | 83 (SINGLE|ANYONECANPAY) | 01 01 (inner sig m/n) | 21<pubkey> …
    expect(fulfillment!.subarray(0, 4).toString('hex')).toBe('01830101');
    // The 33-byte compressed pubkey push follows.
    expect(fulfillment![4]).toBe(0x21);
  });

  it('is deterministic (RFC6979) — same inputs, same signed bytes', () => {
    const ccScript = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[VRSCTEST_SYSTEM_ID, 100_000n]])).script;
    const unsignedHex = unsignedOffer(ccScript);
    const a = signOfferInput(unsignedHex, 0, ccScript, 100_000n, TEST_WIF, NETWORK);
    const b = signOfferInput(unsignedHex, 0, ccScript, 100_000n, TEST_WIF, NETWORK);
    expect(a.signedTx).toBe(b.signedTx);
  });
});
