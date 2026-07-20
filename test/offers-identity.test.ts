/**
 * Selling a VerusID via a marketplace offer (offer the identity, want a currency).
 *
 * The maker spends the identity's current primary output with 0x83 into the wanted
 * currency; the taker appends the TRANSFERRED identity output (the same identity
 * with its primary addresses replaced by the taker's) and pays. The transferred
 * output is byte-locked against a real `takeoffer` capture from VRSCTEST, and the
 * full round-trip is additionally live-proven (identity transferred, maker paid).
 */
import { describe, it, expect } from 'vitest';
import pkg from 'verus-typescript-primitives';
import { buildSellIdentityOffer, completeSellIdentityOffer } from '../src/offers/identity.js';
import { buildIdentityScript } from '../src/identity/index.js';
import { Transaction, script as bscript } from '../src/fork/boundary.js';
import { getNetwork } from '../src/signing/index.js';
import { NETWORK, makeFundingUtxo } from './fixtures/index.js';

const { Identity } = pkg;

// A real VRSCTEST identity (selltest5b) and the exact bytes the daemon's takeoffer
// produced when transferring it to RERzsuZSq4rCxtSMtKRmUyK1h1sECbNMJD.
const SELLTEST5B_JSON = {
  version: 3,
  flags: 0,
  primaryaddresses: ['RHZwAS5RQGicCXndeuJAL37SmsjXhHd6xD'],
  minimumsignatures: 1,
  name: 'selltest5b',
  identityaddress: 'iQwv2QyNxixWfiAfUbFJ4siu3TwiTUNBRa',
  parent: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
  systemid: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
  contentmap: {},
  contentmultimap: {},
  revocationauthority: 'iQwv2QyNxixWfiAfUbFJ4siu3TwiTUNBRa',
  recoveryauthority: 'iQwv2QyNxixWfiAfUbFJ4siu3TwiTUNBRa',
  timelock: 0,
};
const TAKER_CONTROL = 'RERzsuZSq4rCxtSMtKRmUyK1h1sECbNMJD';
const DAEMON_TRANSFERRED_OUTPUT =
  '4704030001031504eb88bb3672e2e4984f253cc92c354b8ec007ff791504eb88bb3672e2e4984f253cc92c354b8ec007ff791504eb88bb3672e2e4984f253cc92c354b8ec007ff79cc4cd904030e01011504eb88bb3672e2e4984f253cc92c354b8ec007ff794c8403000000000000000114388305ed8631778dd5f4a0c106fea85589da919601000000a6ef9ea235635e328124ff3429db9f9e91b64e2d0a73656c6c7465737435620000eb88bb3672e2e4984f253cc92c354b8ec007ff79eb88bb3672e2e4984f253cc92c354b8ec007ff7900a6ef9ea235635e328124ff3429db9f9e91b64e2d000000001b04030f01011504eb88bb3672e2e4984f253cc92c354b8ec007ff791b04031001011504eb88bb3672e2e4984f253cc92c354b8ec007ff7975';
// The identity's on-chain primary output (d465cdc7:0), spent by the maker's offer.
const SELLTEST5B_OUTPUT =
  '4704030001031504eb88bb3672e2e4984f253cc92c354b8ec007ff791504eb88bb3672e2e4984f253cc92c354b8ec007ff791504eb88bb3672e2e4984f253cc92c354b8ec007ff79cc4cd904030e01011504eb88bb3672e2e4984f253cc92c354b8ec007ff794c84030000000000000001145aeba08462499421a494a4d9ea1fe9c6834c3ade01000000a6ef9ea235635e328124ff3429db9f9e91b64e2d0a73656c6c7465737435620000eb88bb3672e2e4984f253cc92c354b8ec007ff79eb88bb3672e2e4984f253cc92c354b8ec007ff7900a6ef9ea235635e328124ff3429db9f9e91b64e2d000000001b04030f01011504eb88bb3672e2e4984f253cc92c354b8ec007ff791b04031001011504eb88bb3672e2e4984f253cc92c354b8ec007ff7975';

const TEST_WIF = 'UusoQWsobQKUkezgBJa22D9G4t9Avo6k8wD5UUxmmfAEoTN8bawc';
const TEST_ADDRESS = 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX';
const VRSCTEST = 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq';

describe('identity transfer output', () => {
  it('builds the transferred identity output byte-identical to the daemon takeoffer', () => {
    const identity = Identity.fromJson(SELLTEST5B_JSON);
    identity.setPrimaryAddresses([TAKER_CONTROL]);
    expect(buildIdentityScript(identity).toString('hex')).toBe(DAEMON_TRANSFERRED_OUTPUT);
  });
});

describe('buildSellIdentityOffer', () => {
  it('spends the identity output with a 0x83 fulfillment into the wanted output', () => {
    const offer = buildSellIdentityOffer(
      {
        wif: TEST_WIF,
        identityOutput: { txid: 'ab'.repeat(32), vout: 0, script: SELLTEST5B_OUTPUT },
        want: { currency: VRSCTEST, amount: 3n * 100_000_000n, address: TEST_ADDRESS },
        expiryHeight: 1_200_000,
      },
      NETWORK,
    );
    const net = getNetwork(true);
    const tx = Transaction.fromHex(offer.offerTx, net);
    expect(tx.ins.length).toBe(1);
    expect(tx.outs.length).toBe(1);
    expect(tx.outs[0]!.value).toBe(3 * 100_000_000); // wanted native
    const ff = (bscript.decompile(tx.ins[0]!.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c));
    expect(ff!.subarray(0, 2).toString('hex')).toBe('0183');
  });

  it('rejects a 0 / never-expiring offer', () => {
    expect(() =>
      buildSellIdentityOffer(
        {
          wif: TEST_WIF,
          identityOutput: { txid: 'ab'.repeat(32), vout: 0, script: SELLTEST5B_OUTPUT },
          want: { currency: VRSCTEST, amount: 100_000n, address: TEST_ADDRESS },
          expiryHeight: 0,
        },
        NETWORK,
      ),
    ).toThrow(/expiryHeight .* is required/);
  });
});

describe('completeSellIdentityOffer', () => {
  function makeOffer() {
    return buildSellIdentityOffer(
      {
        wif: TEST_WIF,
        identityOutput: { txid: 'ab'.repeat(32), vout: 0, script: SELLTEST5B_OUTPUT },
        want: { currency: VRSCTEST, amount: 3n * 100_000_000n, address: TEST_ADDRESS },
        expiryHeight: 1_200_000,
      },
      NETWORK,
    ).offerTx;
  }

  it('appends the transferred identity, pays the wanted currency, signs the taker side', () => {
    const net = getNetwork(true);
    const swap = completeSellIdentityOffer(
      {
        offerTx: makeOffer(),
        identityJson: SELLTEST5B_JSON,
        newPrimaryAddresses: [TAKER_CONTROL],
        want: { currency: VRSCTEST, amount: 3n * 100_000_000n },
        takerUtxos: [makeFundingUtxo('bb', 4n * 100_000_000n)],
        changeAddress: TEST_ADDRESS,
        wif: TEST_WIF,
      },
      NETWORK,
    );
    const tx = Transaction.fromHex(swap.swapTx, net);
    // out[0] = wanted native to maker (kept from the offer partial).
    expect(tx.outs[0]!.value).toBe(3 * 100_000_000);
    // out[1] = the transferred identity, byte-identical to the daemon, 0 native.
    expect(tx.outs[1]!.script.toString('hex')).toBe(DAEMON_TRANSFERRED_OUTPUT);
    expect(tx.outs[1]!.value).toBe(0);
    // maker input preserved with its 0x83 fulfillment.
    const in0f = (bscript.decompile(tx.ins[0]!.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c));
    expect(in0f!.subarray(0, 2).toString('hex')).toBe('0183');
    // taker input present and signed.
    expect(tx.ins.length).toBe(2);
    expect(tx.ins[1]!.script.length).toBeGreaterThan(0);
  });

  it('rejects empty newPrimaryAddresses', () => {
    expect(() =>
      completeSellIdentityOffer(
        {
          offerTx: makeOffer(),
          identityJson: SELLTEST5B_JSON,
          newPrimaryAddresses: [],
          want: { currency: VRSCTEST, amount: 3n * 100_000_000n },
          takerUtxos: [makeFundingUtxo('bb', 4n * 100_000_000n)],
          changeAddress: TEST_ADDRESS,
          wif: TEST_WIF,
        },
        NETWORK,
      ),
    ).toThrow(/newPrimaryAddresses must not be empty/);
  });
});
