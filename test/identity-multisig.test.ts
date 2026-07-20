/**
 * Multi-signature (m-of-n) VerusID updates: collect signatures from separate
 * signers into one CryptoCondition fulfillment.
 *
 * The fulfillment layout (version, SIGHASH_ALL, count, per-signer entries in
 * primaryaddresses order) is byte-locked here and additionally live-proven on
 * VRSCTEST: a 2-of-2 update (both signers, tx e1b7c9a3) and a 1-of-2 update (one
 * signer, separate funder, tx 66496f51) were accepted by the daemon.
 */
import { describe, it, expect } from 'vitest';
import pkg from 'verus-typescript-primitives';
import { buildMultisigIdentityUpdate, addIdentitySignature } from '../src/identity/multisig.js';
import { buildIdentityScript } from '../src/identity/index.js';
import { Transaction, ECPair, script as bscript, SmartTransactionSignatures, SmartTransactionSignature } from '../src/fork/boundary.js';
import { getNetwork } from '../src/signing/index.js';
import { VerusSDK } from '../src/index.js';
import {
  NETWORK,
  makeFundingUtxo,
  TEST_WIF,
  TEST_ADDRESS,
  TEST_WIF_B,
  TEST_ADDRESS_B,
  makeP2PKHScript,
  TEST_ADDRESS_C,
} from './fixtures/index.js';

const { Identity } = pkg;
const net = getNetwork(true);
const PK_A = ECPair.fromWIF(TEST_WIF, net).getPublicKeyBuffer().toString('hex');
const PK_B = ECPair.fromWIF(TEST_WIF_B, net).getPublicKeyBuffer().toString('hex');

// A 2-of-2 identity controlled by [A = TEST_ADDRESS, B = TEST_ADDRESS_B].
const ID_JSON = {
  version: 3,
  flags: 0,
  primaryaddresses: [TEST_ADDRESS, TEST_ADDRESS_B],
  minimumsignatures: 2,
  name: 'msid',
  identityaddress: 'iQwv2QyNxixWfiAfUbFJ4siu3TwiTUNBRa',
  parent: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
  systemid: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
  contentmap: {},
  contentmultimap: {},
  revocationauthority: 'iQwv2QyNxixWfiAfUbFJ4siu3TwiTUNBRa',
  recoveryauthority: 'iQwv2QyNxixWfiAfUbFJ4siu3TwiTUNBRa',
  timelock: 0,
};
const ID_SCRIPT = buildIdentityScript(Identity.fromJson(ID_JSON)).toString('hex');
const ID_UTXO = { txid: 'ab'.repeat(32), vout: 0, script: ID_SCRIPT };
const NEW_ID = { ...ID_JSON, contentmap: { '0000000000000000000000000000000000000001': '0000000000000000000000000000000000000000000000000000000000000002' } };

function build(minSig = 2, funding = [makeFundingUtxo('bb', 100_000_000n)]) {
  return buildMultisigIdentityUpdate(
    {
      funderWif: TEST_WIF,
      identityUtxo: ID_UTXO,
      currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B],
      minSignatures: minSig,
      newIdentity: NEW_ID,
      funding,
      changeAddress: TEST_ADDRESS,
      expiryHeight: 1_200_000,
    },
    NETWORK,
  );
}

function ccChunk(tx: Transaction, idx: number): Buffer {
  return (bscript.decompile(tx.ins[idx]!.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c))!;
}

describe('buildMultisigIdentityUpdate', () => {
  it('funds the update, signs funding inputs, leaves the identity CC input open', () => {
    const built = build();
    const tx = Transaction.fromHex(built.partialTx, net);
    // funding input 0 = P2PKH signed; identity input 1 = open.
    expect(built.identityInput.index).toBe(1);
    expect(tx.ins[0]!.script.length).toBeGreaterThan(0);
    expect(tx.ins[1]!.script.length).toBe(0);
    expect(built.collected).toBe(0);
    // out[0] = the recreated identity (value 0); out[1] = native change.
    expect(tx.outs[0]!.value).toBe(0);
    expect(tx.outs.length).toBe(2);
  });

  it('rejects bad expiry, minSignatures overflow, empty funding', () => {
    expect(() => build(2, [])).toThrow(/funding must include/);
    expect(() =>
      buildMultisigIdentityUpdate(
        { funderWif: TEST_WIF, identityUtxo: ID_UTXO, currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B], minSignatures: 3, newIdentity: NEW_ID, funding: [makeFundingUtxo('bb', 100_000_000n)], changeAddress: TEST_ADDRESS, expiryHeight: 1_200_000 },
        NETWORK,
      ),
    ).toThrow(/exceeds the 2 current primary/);
    expect(() =>
      buildMultisigIdentityUpdate(
        { funderWif: TEST_WIF, identityUtxo: ID_UTXO, currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B], minSignatures: 2, newIdentity: NEW_ID, funding: [makeFundingUtxo('bb', 100_000_000n)], changeAddress: TEST_ADDRESS, expiryHeight: 0 },
        NETWORK,
      ),
    ).toThrow(/expiryHeight must be a positive/);
  });

  it('rejects a funding UTXO not controlled by funderWif', () => {
    const foreign = { txid: 'fa'.repeat(32), outputIndex: 0, satoshis: 100_000_000n, script: makeP2PKHScript(TEST_ADDRESS_C) };
    expect(() => build(2, [foreign])).toThrow(/must be a native P2PKH output controlled by funderWif/);
  });
});

describe('addIdentitySignature', () => {
  it('collects two signatures ordered by primaryaddresses and completes at min_sigs', () => {
    const built = build(2);
    const s1 = addIdentitySignature({ partialTx: built.partialTx, identityInput: built.identityInput, currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B], minSignatures: 2, wif: TEST_WIF }, NETWORK);
    expect(s1.collected).toBe(1);
    expect(s1.complete).toBe(false);
    const s2 = addIdentitySignature({ partialTx: s1.partialTx, identityInput: built.identityInput, currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B], minSignatures: 2, wif: TEST_WIF_B }, NETWORK);
    expect(s2.collected).toBe(2);
    expect(s2.complete).toBe(true);

    // Fulfillment layout: version 01, SIGHASH_ALL 01, count 02, then A entry, B entry.
    const chunk = ccChunk(Transaction.fromHex(s2.partialTx, net), 1);
    expect(chunk.subarray(0, 3).toString('hex')).toBe('010102');
    // entry A: 01 (sigType) 21 (33) <pkA> 40 (64) <sig>
    expect(chunk.subarray(3, 5).toString('hex')).toBe('0121');
    expect(chunk.subarray(5, 38).toString('hex')).toBe(PK_A);
    // entry B follows at offset 3 + (1+1+33+1+64) = 3 + 100 = 103.
    expect(chunk.subarray(103, 105).toString('hex')).toBe('0121');
    expect(chunk.subarray(105, 138).toString('hex')).toBe(PK_B);
  });

  it('orders signatures by primaryaddresses regardless of signing order (B then A)', () => {
    const built = build(2);
    const s1 = addIdentitySignature({ partialTx: built.partialTx, identityInput: built.identityInput, currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B], minSignatures: 2, wif: TEST_WIF_B }, NETWORK);
    const s2 = addIdentitySignature({ partialTx: s1.partialTx, identityInput: built.identityInput, currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B], minSignatures: 2, wif: TEST_WIF }, NETWORK);
    const chunk = ccChunk(Transaction.fromHex(s2.partialTx, net), 1);
    // Still A first (primaryaddresses[0]), then B — not signing order.
    expect(chunk.subarray(5, 38).toString('hex')).toBe(PK_A);
    expect(chunk.subarray(105, 138).toString('hex')).toBe(PK_B);
  });

  it('is idempotent per key (re-signing with A does not duplicate)', () => {
    const built = build(2);
    const s1 = addIdentitySignature({ partialTx: built.partialTx, identityInput: built.identityInput, currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B], minSignatures: 2, wif: TEST_WIF }, NETWORK);
    const s2 = addIdentitySignature({ partialTx: s1.partialTx, identityInput: built.identityInput, currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B], minSignatures: 2, wif: TEST_WIF }, NETWORK);
    expect(s2.collected).toBe(1);
  });

  it('completes at one signature for a 1-of-2 identity', () => {
    const built = build(1);
    const s1 = addIdentitySignature({ partialTx: built.partialTx, identityInput: built.identityInput, currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B], minSignatures: 1, wif: TEST_WIF_B }, NETWORK);
    expect(s1.collected).toBe(1);
    expect(s1.complete).toBe(true);
  });

  it('rejects a wif that is not one of the primary addresses', () => {
    const built = build(2);
    const stranger = VerusSDK.generateWif();
    expect(() =>
      addIdentitySignature({ partialTx: built.partialTx, identityInput: built.identityInput, currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B], minSignatures: 2, wif: stranger }, NETWORK),
    ).toThrow(/not one of the identity's primary addresses/);
  });

  it('drops a foreign signature injected into a supplied partialTx (does not count it)', () => {
    const built = build(2);
    // Forge a partial tx whose CC input already carries a stranger's signature.
    const strangerKey = ECPair.fromWIF(VerusSDK.generateWif(), net);
    const forged = Transaction.fromHex(built.partialTx, net);
    const bogus = new SmartTransactionSignatures(1, Transaction.SIGHASH_ALL, [
      new SmartTransactionSignature(1, 1, strangerKey.getPublicKeyBuffer(), Buffer.alloc(64, 7)),
    ]).toChunk();
    forged.ins[built.identityInput.index]!.script = bscript.compile([bogus]);

    // A real authority signs: the stranger's entry must be dropped, not counted.
    const res = addIdentitySignature({ partialTx: forged.toHex(), identityInput: built.identityInput, currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B], minSignatures: 2, wif: TEST_WIF }, NETWORK);
    expect(res.collected).toBe(1);
    expect(res.complete).toBe(false);
    // The one surviving entry is the authority's, not the stranger's.
    const chunk = ccChunk(Transaction.fromHex(res.partialTx, net), 1);
    expect(chunk.subarray(0, 3).toString('hex')).toBe('010101'); // version, SIGHASH_ALL, count 1
    expect(chunk.subarray(5, 38).toString('hex')).toBe(PK_A);
  });
});
