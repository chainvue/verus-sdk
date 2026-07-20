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
import {
  buildSellIdentityOffer,
  completeSellIdentityOffer,
  buildBuyIdentityOffer,
  completeBuyIdentityOffer,
  buildSwapIdentityOffer,
  completeSwapIdentityOffer,
} from '../src/offers/identity.js';
import { buildIdentityScript, buildCommitmentScript, buildTokenChangeOutput } from '../src/identity/index.js';
import { parseRAddress, parseAddress } from '../src/core/brands.js';
import { Transaction, script as bscript } from '../src/fork/boundary.js';
import { getNetwork } from '../src/signing/index.js';
import { NETWORK, makeFundingUtxo, makeP2PKHScript, TEST_ADDRESS_B } from './fixtures/index.js';

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

describe('buildBuyIdentityOffer', () => {
  // A native currency commitment the buyer funds and offers.
  function commitment() {
    const script = buildCommitmentScript(Buffer.alloc(32, 0), parseRAddress(TEST_ADDRESS)).toString('hex');
    return { txid: 'cd'.repeat(32), vout: 0, value: 3n * 100_000_000n, script };
  }

  it('spends the currency commitment into the identity transferred to the buyer', () => {
    const offer = buildBuyIdentityOffer(
      {
        wif: TEST_WIF,
        commitment: commitment(),
        identityJson: SELLTEST5B_JSON,
        buyerPrimaryAddresses: [TAKER_CONTROL],
        expiryHeight: 1_200_000,
      },
      NETWORK,
    );
    const net = getNetwork(true);
    const tx = Transaction.fromHex(offer.offerTx, net);
    expect(tx.ins.length).toBe(1);
    expect(tx.outs.length).toBe(1);
    // out[0] = the identity transferred to the buyer, byte-identical to the daemon.
    expect(tx.outs[0]!.script.toString('hex')).toBe(DAEMON_TRANSFERRED_OUTPUT);
    expect(tx.outs[0]!.value).toBe(0);
    const ff = (bscript.decompile(tx.ins[0]!.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c));
    expect(ff!.subarray(0, 2).toString('hex')).toBe('0183');
  });

  it('rejects empty buyerPrimaryAddresses', () => {
    expect(() =>
      buildBuyIdentityOffer(
        {
          wif: TEST_WIF,
          commitment: commitment(),
          identityJson: SELLTEST5B_JSON,
          buyerPrimaryAddresses: [],
          expiryHeight: 1_200_000,
        },
        NETWORK,
      ),
    ).toThrow(/buyerPrimaryAddresses must not be empty/);
  });
});

describe('completeBuyIdentityOffer', () => {
  function makeBuyOffer() {
    const script = buildCommitmentScript(Buffer.alloc(32, 0), parseRAddress(TEST_ADDRESS)).toString('hex');
    return buildBuyIdentityOffer(
      {
        wif: TEST_WIF,
        commitment: { txid: 'cd'.repeat(32), vout: 0, value: 3n * 100_000_000n, script },
        identityJson: SELLTEST5B_JSON,
        buyerPrimaryAddresses: [TAKER_CONTROL],
        expiryHeight: 1_200_000,
      },
      NETWORK,
    ).offerTx;
  }

  it('spends the identity output, pays the seller, signs the seller side', () => {
    const net = getNetwork(true);
    const swap = completeBuyIdentityOffer(
      {
        offerTx: makeBuyOffer(),
        offered: { currency: VRSCTEST, amount: 3n * 100_000_000n },
        identityOutput: { txid: 'ab'.repeat(32), vout: 1, script: SELLTEST5B_OUTPUT },
        sellerReceiveAddress: TEST_ADDRESS,
        takerUtxos: [makeFundingUtxo('bb', 100_000_000n)], // native for the fee
        changeAddress: TEST_ADDRESS,
        wif: TEST_WIF,
      },
      NETWORK,
    );
    const tx = Transaction.fromHex(swap.swapTx, net);
    // out[0] = identity to buyer (kept). out[1] = offered currency to seller.
    expect(tx.outs[0]!.script.toString('hex')).toBe(DAEMON_TRANSFERRED_OUTPUT);
    expect(tx.outs[1]!.value).toBe(3 * 100_000_000);
    // in[0] = maker commitment (0x83); in[1] = the seller's identity output.
    const in0f = (bscript.decompile(tx.ins[0]!.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c));
    expect(in0f!.subarray(0, 2).toString('hex')).toBe('0183');
    expect(tx.ins.length).toBeGreaterThanOrEqual(2);
    // the identity input (index 1) is signed.
    expect(tx.ins[1]!.script.length).toBeGreaterThan(0);
  });

  it('rejects a token-bearing fee UTXO (reserve value would be silently dropped)', () => {
    const reserveScript = buildTokenChangeOutput(
      parseAddress(TEST_ADDRESS),
      new Map([['iJWuVTboQbmqL6QWaX6g8oPfWDTpvxtQ2a', 5n * 100_000_000n]]),
    ).script.toString('hex');
    expect(() =>
      completeBuyIdentityOffer(
        {
          offerTx: makeBuyOffer(),
          offered: { currency: VRSCTEST, amount: 3n * 100_000_000n },
          identityOutput: { txid: 'ab'.repeat(32), vout: 1, script: SELLTEST5B_OUTPUT },
          sellerReceiveAddress: TEST_ADDRESS,
          takerUtxos: [{ txid: 'ef'.repeat(32), outputIndex: 0, satoshis: 100_000_000n, script: reserveScript }],
          changeAddress: TEST_ADDRESS,
          wif: TEST_WIF,
        },
        NETWORK,
      ),
    ).toThrow(/fee UTXOs must carry only the native coin/);
  });
});

// ─── identity ↔ identity swap (5c) ───────────────────────────────────
//
// Two real VRSCTEST sub-identities (foo1, foo — same parent) and the EXACT output
// bytes the daemon's makeoffer/takeoffer produced when swapping them: the maker
// offers foo1 wanting foo transferred to RUVyiwmr…, the taker owns foo and receives
// foo1 transferred to RQgCpj…. Both transferred outputs are byte-locked below; the
// swap is additionally live-proven end-to-end on VRSCTEST.
const FOO1_JSON = {
  version: 3,
  flags: 0,
  primaryaddresses: ['RNsCdMnAFWVmtbhvVGfzyeUcEQ3o1h5hZh'],
  minimumsignatures: 1,
  name: 'foo1',
  identityaddress: 'i4Es1vPm74ziMLUKv1cRCwnw1baGYTMtUs',
  parent: 'i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe',
  systemid: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
  contentmap: {},
  contentmultimap: {},
  revocationauthority: 'i4Es1vPm74ziMLUKv1cRCwnw1baGYTMtUs',
  recoveryauthority: 'i4Es1vPm74ziMLUKv1cRCwnw1baGYTMtUs',
  timelock: 0,
};
const FOO_JSON = {
  version: 3,
  flags: 0,
  primaryaddresses: ['RNsCdMnAFWVmtbhvVGfzyeUcEQ3o1h5hZh'],
  minimumsignatures: 1,
  name: 'foo',
  identityaddress: 'iFiHkCvSR8BquhCZyqK7i1Vqkv5hRoVMzd',
  parent: 'i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe',
  systemid: 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq',
  contentmap: {},
  contentmultimap: {},
  revocationauthority: 'iFiHkCvSR8BquhCZyqK7i1Vqkv5hRoVMzd',
  recoveryauthority: 'iFiHkCvSR8BquhCZyqK7i1Vqkv5hRoVMzd',
  timelock: 0,
};
// The two identities' current on-chain primary outputs (foo1 5c347643:0, foo eb99aea8:0).
const FOO1_OUTPUT =
  '47040300010315040862a65aecb0c7b7de0b3d796956cae3223af49015040862a65aecb0c7b7de0b3d796956cae3223af49015040862a65aecb0c7b7de0b3d796956cae3223af490cc4cd304030e010115040862a65aecb0c7b7de0b3d796956cae3223af4904c7e0300000000000000011495083c76b8be40dca6e3c8321c387f73093132d5010000000956037c7df826ac1a77e91a0d56c16ed912f63104666f6f3100000862a65aecb0c7b7de0b3d796956cae3223af4900862a65aecb0c7b7de0b3d796956cae3223af49000a6ef9ea235635e328124ff3429db9f9e91b64e2d000000001b04030f010115040862a65aecb0c7b7de0b3d796956cae3223af4901b040310010115040862a65aecb0c7b7de0b3d796956cae3223af49075';
const FOO_OUTPUT =
  '4704030001031504863be83d6d820e2062222795bfc33421e84e21941504863be83d6d820e2062222795bfc33421e84e21941504863be83d6d820e2062222795bfc33421e84e2194cc4cd204030e01011504863be83d6d820e2062222795bfc33421e84e21944c7d0300000000000000011495083c76b8be40dca6e3c8321c387f73093132d5010000000956037c7df826ac1a77e91a0d56c16ed912f63103666f6f0000863be83d6d820e2062222795bfc33421e84e2194863be83d6d820e2062222795bfc33421e84e219400a6ef9ea235635e328124ff3429db9f9e91b64e2d000000001b04030f01011504863be83d6d820e2062222795bfc33421e84e21941b04031001011504863be83d6d820e2062222795bfc33421e84e219475';
const MAKER_NEW = 'RUVyiwmr9yWAvBSSGebEUWCbRm7KS3hg1o';
const TAKER_NEW = 'RQgCpj8aye69e6RRA7kDdtnxJfjsssJowg';
// Exact daemon swap outputs: foo→makerNew (maker acquires), foo1→takerNew (taker acquires).
const DAEMON_SWAP_OUT0_FOO_TO_MAKER =
  '4704030001031504863be83d6d820e2062222795bfc33421e84e21941504863be83d6d820e2062222795bfc33421e84e21941504863be83d6d820e2062222795bfc33421e84e2194cc4cd204030e01011504863be83d6d820e2062222795bfc33421e84e21944c7d03000000000000000114d2d57bf6dd5862c0712a07d323a326969e24d65d010000000956037c7df826ac1a77e91a0d56c16ed912f63103666f6f0000863be83d6d820e2062222795bfc33421e84e2194863be83d6d820e2062222795bfc33421e84e219400a6ef9ea235635e328124ff3429db9f9e91b64e2d000000001b04030f01011504863be83d6d820e2062222795bfc33421e84e21941b04031001011504863be83d6d820e2062222795bfc33421e84e219475';
const DAEMON_SWAP_OUT1_FOO1_TO_TAKER =
  '47040300010315040862a65aecb0c7b7de0b3d796956cae3223af49015040862a65aecb0c7b7de0b3d796956cae3223af49015040862a65aecb0c7b7de0b3d796956cae3223af490cc4cd304030e010115040862a65aecb0c7b7de0b3d796956cae3223af4904c7e03000000000000000114a8e41366e89ee9ce3876a28d116273b3dc320c6d010000000956037c7df826ac1a77e91a0d56c16ed912f63104666f6f3100000862a65aecb0c7b7de0b3d796956cae3223af4900862a65aecb0c7b7de0b3d796956cae3223af49000a6ef9ea235635e328124ff3429db9f9e91b64e2d000000001b04030f010115040862a65aecb0c7b7de0b3d796956cae3223af4901b040310010115040862a65aecb0c7b7de0b3d796956cae3223af49075';

describe('buildSwapIdentityOffer', () => {
  it('spends the offered identity output (0x83) into the wanted identity transferred to the maker', () => {
    const offer = buildSwapIdentityOffer(
      {
        wif: TEST_WIF,
        offeredIdentityOutput: { txid: 'ab'.repeat(32), vout: 0, script: FOO1_OUTPUT },
        wantedIdentityJson: FOO_JSON,
        makerPrimaryAddresses: [MAKER_NEW],
        expiryHeight: 1_200_000,
      },
      NETWORK,
    );
    const net = getNetwork(true);
    const tx = Transaction.fromHex(offer.offerTx, net);
    expect(tx.ins.length).toBe(1);
    expect(tx.outs.length).toBe(1);
    // out[0] = the wanted identity (foo) transferred to the maker, byte-identical to the daemon.
    expect(tx.outs[0]!.script.toString('hex')).toBe(DAEMON_SWAP_OUT0_FOO_TO_MAKER);
    expect(tx.outs[0]!.value).toBe(0);
    const ff = (bscript.decompile(tx.ins[0]!.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c));
    expect(ff!.subarray(0, 2).toString('hex')).toBe('0183');
  });

  it('rejects a 0 / never-expiring offer', () => {
    expect(() =>
      buildSwapIdentityOffer(
        {
          wif: TEST_WIF,
          offeredIdentityOutput: { txid: 'ab'.repeat(32), vout: 0, script: FOO1_OUTPUT },
          wantedIdentityJson: FOO_JSON,
          makerPrimaryAddresses: [MAKER_NEW],
          expiryHeight: 0,
        },
        NETWORK,
      ),
    ).toThrow(/expiryHeight .* is required/);
  });

  it('rejects empty makerPrimaryAddresses with its own (not the buy delegate) message', () => {
    expect(() =>
      buildSwapIdentityOffer(
        {
          wif: TEST_WIF,
          offeredIdentityOutput: { txid: 'ab'.repeat(32), vout: 0, script: FOO1_OUTPUT },
          wantedIdentityJson: FOO_JSON,
          makerPrimaryAddresses: [],
          expiryHeight: 1_200_000,
        },
        NETWORK,
      ),
    ).toThrow(/buildSwapIdentityOffer: makerPrimaryAddresses must not be empty/);
  });
});

describe('completeSwapIdentityOffer', () => {
  function makeSwapOffer() {
    return buildSwapIdentityOffer(
      {
        wif: TEST_WIF,
        offeredIdentityOutput: { txid: 'ab'.repeat(32), vout: 0, script: FOO1_OUTPUT },
        wantedIdentityJson: FOO_JSON,
        makerPrimaryAddresses: [MAKER_NEW],
        expiryHeight: 1_200_000,
      },
      NETWORK,
    ).offerTx;
  }

  it('appends the offered identity to the taker, spends the wanted identity, funds only the fee', () => {
    const net = getNetwork(true);
    const swap = completeSwapIdentityOffer(
      {
        offerTx: makeSwapOffer(),
        offeredIdentityJson: FOO1_JSON,
        takerPrimaryAddresses: [TAKER_NEW],
        wantedIdentityOutput: { txid: 'cd'.repeat(32), vout: 0, script: FOO_OUTPUT },
        takerUtxos: [makeFundingUtxo('bb', 100_000_000n)], // native for the fee only
        changeAddress: TEST_ADDRESS,
        wif: TEST_WIF,
      },
      NETWORK,
    );
    const tx = Transaction.fromHex(swap.swapTx, net);
    // out[0] = wanted identity (foo) to maker, kept from the offer partial.
    expect(tx.outs[0]!.script.toString('hex')).toBe(DAEMON_SWAP_OUT0_FOO_TO_MAKER);
    expect(tx.outs[0]!.value).toBe(0);
    // out[1] = offered identity (foo1) transferred to the taker, byte-identical to the daemon.
    expect(tx.outs[1]!.script.toString('hex')).toBe(DAEMON_SWAP_OUT1_FOO1_TO_TAKER);
    expect(tx.outs[1]!.value).toBe(0);
    // out[2] = native change (no currency moves).
    expect(tx.outs.length).toBe(3);
    expect(tx.outs[2]!.value).toBeGreaterThan(0);
    // in[0] = maker offered-identity input (0x83), preserved.
    const in0f = (bscript.decompile(tx.ins[0]!.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c));
    expect(in0f!.subarray(0, 2).toString('hex')).toBe('0183');
    // in[1] = taker's wanted-identity input (CC), in[2] = native fee — both signed.
    expect(tx.ins.length).toBe(3);
    expect(tx.ins[1]!.script.length).toBeGreaterThan(0);
    expect(tx.ins[2]!.script.length).toBeGreaterThan(0);
    // in[1]'s CC fulfillment carries SIGHASH_ALL (0x01), not the maker's 0x83.
    const in1f = (bscript.decompile(tx.ins[1]!.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c));
    expect(in1f!.subarray(0, 2).toString('hex')).toBe('0101');
  });

  it('rejects empty takerPrimaryAddresses', () => {
    expect(() =>
      completeSwapIdentityOffer(
        {
          offerTx: makeSwapOffer(),
          offeredIdentityJson: FOO1_JSON,
          takerPrimaryAddresses: [],
          wantedIdentityOutput: { txid: 'cd'.repeat(32), vout: 0, script: FOO_OUTPUT },
          takerUtxos: [makeFundingUtxo('bb', 100_000_000n)],
          changeAddress: TEST_ADDRESS,
          wif: TEST_WIF,
        },
        NETWORK,
      ),
    ).toThrow(/takerPrimaryAddresses must not be empty/);
  });

  const SWAP_TOKEN_ID = 'iJWuVTboQbmqL6QWaX6g8oPfWDTpvxtQ2a';

  function swapArgs(takerUtxos: ReturnType<typeof makeFundingUtxo>[]) {
    return {
      offerTx: makeSwapOffer(),
      offeredIdentityJson: FOO1_JSON,
      takerPrimaryAddresses: [TAKER_NEW],
      wantedIdentityOutput: { txid: 'cd'.repeat(32), vout: 0, script: FOO_OUTPUT },
      takerUtxos,
      changeAddress: TEST_ADDRESS,
      wif: TEST_WIF,
    };
  }

  it('rejects a token-bearing fee UTXO (its reserve value would be silently dropped)', () => {
    // A reserve output carrying native (to attract selection) + a token.
    const reserveScript = buildTokenChangeOutput(
      parseAddress(TEST_ADDRESS),
      new Map([[SWAP_TOKEN_ID, 5n * 100_000_000n]]),
    ).script.toString('hex');
    const tokenFeeUtxo = { txid: 'ef'.repeat(32), outputIndex: 0, satoshis: 100_000_000n, script: reserveScript };
    expect(() => completeSwapIdentityOffer(swapArgs([tokenFeeUtxo]), NETWORK)).toThrow(
      /fee UTXOs must carry only the native coin/,
    );
  });

  it('rejects a native fee UTXO not controlled by the provided wif', () => {
    // P2PKH to a different address than TEST_WIF's — a doomed signature otherwise.
    const foreignUtxo = { txid: 'fa'.repeat(32), outputIndex: 0, satoshis: 100_000_000n, script: makeP2PKHScript(TEST_ADDRESS_B) };
    expect(() => completeSwapIdentityOffer(swapArgs([foreignUtxo]), NETWORK)).toThrow(
      /not controlled by the provided wif/,
    );
  });
});
