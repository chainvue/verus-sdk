/**
 * The offer input signer produces a CryptoCondition fulfillment signed with
 * SIGHASH_SINGLE|ANYONECANPAY (0x83) — byte-structured exactly like the daemon's
 * `makeoffer` output (fulfillment prefix `01 83 01 01 21<pubkey> …`).
 */
import { describe, it, expect } from 'vitest';
import { TransactionBuilder, Transaction, script as bscript } from '../src/fork/boundary.js';
import { signOfferInput, signTakerInputs, SIGHASH_OFFER } from '../src/offers/sign.js';
import { buildTokenChangeOutput } from '../src/identity/index.js';
import { parseAddress } from '../src/core/brands.js';
import { getNetwork } from '../src/signing/index.js';
import { addressToScriptPubKey } from '../src/utils/index.js';
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

describe('signTakerInputs', () => {
  it('signs a taker P2PKH input with SIGHASH_ALL while leaving the maker 0x83 input untouched', () => {
    const net = getNetwork(true);
    // Maker offer partial (input 0 signed 0x83).
    const ccScript = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[VRSCTEST_SYSTEM_ID, 100_000n]])).script;
    const offer = signOfferInput(unsignedOffer(ccScript), 0, ccScript, 100_000n, TEST_WIF, NETWORK);

    // Taker appends an input + outputs to the maker's partial.
    const tx = Transaction.fromHex(offer.signedTx, net);
    const takerScript = addressToScriptPubKey(TEST_ADDRESS);
    tx.addInput(Buffer.alloc(32, 0xbb), 0, 0xffffffff);
    tx.addOutput(addressToScriptPubKey(TEST_ADDRESS), 90_000); // offered asset to taker
    tx.addOutput(addressToScriptPubKey(TEST_ADDRESS), 4_800_000); // taker change
    const in0Before = tx.ins[0]!.script.toString('hex');

    const { signedTx } = signTakerInputs(
      tx.toHex(),
      [{ index: 1, prevOutScript: takerScript, value: 5_000_000n }],
      TEST_WIF,
      NETWORK,
    );

    const done = Transaction.fromHex(signedTx, net);
    // Maker input 0 byte-for-byte untouched, 0x83 fulfillment intact.
    expect(done.ins[0]!.script.toString('hex')).toBe(in0Before);
    const in0f = (bscript.decompile(done.ins[0]!.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c));
    expect(in0f!.subarray(0, 2).toString('hex')).toBe('0183');
    // Taker input 1 is a standard P2PKH scriptSig (sig+pubkey), SIGHASH_ALL.
    const in1 = bscript.decompile(done.ins[1]!.script) ?? [];
    expect(in1.length).toBe(2);
    const sig = in1[0] as Buffer;
    expect(sig[sig.length - 1]).toBe(0x01); // SIGHASH_ALL
  });
});
