/**
 * Taker flow: completing a native-for-token offer.
 *
 * The maker offers native VRSCTEST for a token; the taker pays the token, receives
 * the native coin, and signs their side. Asserts the swap's structure and that the
 * maker's 0x83 input survives. (The full flow is additionally live-validated on
 * VRSCTEST — the SDK built both halves and the network accepted the swap.)
 */
import { describe, it, expect } from 'vitest';
import { buildOfferFunding, buildOffer } from '../src/offers/maker.js';
import { completeOffer } from '../src/offers/taker.js';
import { buildTokenChangeOutput } from '../src/identity/index.js';
import { parseAddress } from '../src/core/brands.js';
import { Transaction, script as bscript } from '../src/fork/boundary.js';
import { getNetwork } from '../src/signing/index.js';
import { TEST_WIF, TEST_ADDRESS, NETWORK, VRSCTEST_SYSTEM_ID, makeFundingUtxo } from './fixtures/index.js';

const OWNORA_ID = 'iFefrNRjNcvW473Hnx2eKW9jpWuFKE11vw';

function makeOfferPartial() {
  const funding = buildOfferFunding(
    { wif: TEST_WIF, utxos: [makeFundingUtxo('aa', 100_000_000n)], changeAddress: TEST_ADDRESS, makerAddress: TEST_ADDRESS, offered: { currency: VRSCTEST_SYSTEM_ID, amount: 100_000n }, expiryHeight: 0 },
    NETWORK,
  );
  const offer = buildOffer(
    { wif: TEST_WIF, commitment: funding.commitment, want: { currency: OWNORA_ID, amount: 100_000n, address: TEST_ADDRESS }, expiryHeight: 1_200_000 },
    NETWORK,
  );
  return offer.offerTx;
}

const TOKTEST5A_ID = 'iJWuVTboQbmqL6QWaX6g8oPfWDTpvxtQ2a';

/** A token-bearing reserve UTXO the taker uses to pay the wanted currency. */
function ownoraUtxo(amount: bigint) {
  const script = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[OWNORA_ID, amount]])).script;
  return { txid: 'ee'.repeat(32), outputIndex: 0, satoshis: 0n, script: script.toString('hex') };
}

/** A maker offer partial: offer a TOKEN (toktest5a), want the native coin. */
function makeTokenOfferPartial() {
  const funding = buildOfferFunding(
    {
      wif: TEST_WIF,
      utxos: [tokenReserveUtxo(TOKTEST5A_ID, 30n * 100_000_000n, 'cc'), makeFundingUtxo('aa', 100_000_000n)],
      changeAddress: TEST_ADDRESS,
      makerAddress: TEST_ADDRESS,
      offered: { currency: TOKTEST5A_ID, amount: 10n * 100_000_000n },
      expiryHeight: 0,
    },
    NETWORK,
  );
  const offer = buildOffer(
    { wif: TEST_WIF, commitment: funding.commitment, want: { currency: VRSCTEST_SYSTEM_ID, amount: 5n * 100_000_000n, address: TEST_ADDRESS }, expiryHeight: 1_200_000 },
    NETWORK,
  );
  return offer.offerTx;
}

/** A token-bearing reserve UTXO for an arbitrary currency. */
function tokenReserveUtxo(currency: string, amount: bigint, txid: string) {
  const script = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[currency, amount]])).script;
  return { txid: txid.repeat(32).slice(0, 64), outputIndex: 0, satoshis: 0n, script: script.toString('hex') };
}

describe('completeOffer — native-for-token taker flow', () => {
  it('builds a valid atomic swap: maker input preserved, taker side added & signed', () => {
    const offerTx = makeOfferPartial();
    const net = getNetwork(true);

    const swap = completeOffer(
      {
        offerTx,
        offered: { currency: VRSCTEST_SYSTEM_ID, amount: 100_000n },
        want: { currency: OWNORA_ID, amount: 100_000n },
        takerUtxos: [ownoraUtxo(200_000n), makeFundingUtxo('bb', 10_000_000n)],
        takerAddress: TEST_ADDRESS,
        changeAddress: TEST_ADDRESS,
        wif: TEST_WIF,
      },
      NETWORK,
    );

    const tx = Transaction.fromHex(swap.swapTx, net);
    // Output 0 = the maker's wanted output, kept.
    const wanted = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[OWNORA_ID, 100_000n]]));
    expect(tx.outs[0]!.script.toString('hex')).toBe(wanted.script.toString('hex'));
    // Output 1 = the offered native coin to the taker.
    expect(tx.outs[1]!.value).toBe(100_000);
    // A change output exists (token + native change bundled).
    expect(tx.outs.length).toBeGreaterThanOrEqual(3);

    // Input 0 = the maker's commitment, 0x83 fulfillment intact.
    const in0f = (bscript.decompile(tx.ins[0]!.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c));
    expect(in0f!.subarray(0, 2).toString('hex')).toBe('0183');
    // Taker inputs are present and signed (2 of them).
    expect(tx.ins.length).toBe(3);
    for (let i = 1; i < tx.ins.length; i++) {
      expect(tx.ins[i]!.script.length).toBeGreaterThan(0);
    }
  });

  it('rejects a non-positive amount', () => {
    expect(() =>
      completeOffer(
        {
          offerTx: makeOfferPartial(),
          offered: { currency: VRSCTEST_SYSTEM_ID, amount: 0n },
          want: { currency: OWNORA_ID, amount: 100_000n },
          takerUtxos: [ownoraUtxo(200_000n)],
          takerAddress: TEST_ADDRESS,
          changeAddress: TEST_ADDRESS,
          wif: TEST_WIF,
        },
        NETWORK,
      ),
    ).toThrow(/must be positive/);
  });
});

describe('completeOffer — token-for-native taker flow (5a mirror)', () => {
  it('takes a token offer: pays native, receives the offered token, maker input preserved', () => {
    const offerTx = makeTokenOfferPartial();
    const net = getNetwork(true);

    const swap = completeOffer(
      {
        offerTx,
        offered: { currency: TOKTEST5A_ID, amount: 10n * 100_000_000n },
        want: { currency: VRSCTEST_SYSTEM_ID, amount: 5n * 100_000_000n },
        // Native to pay the wanted 5 VRSCTEST + the fee.
        takerUtxos: [makeFundingUtxo('bb', 6n * 100_000_000n)],
        takerAddress: TEST_ADDRESS,
        changeAddress: TEST_ADDRESS,
        wif: TEST_WIF,
      },
      NETWORK,
    );

    const tx = Transaction.fromHex(swap.swapTx, net);
    // Output 0 = the maker's wanted native output, kept (5 VRSCTEST).
    expect(tx.outs[0]!.value).toBe(5 * 100_000_000);
    // Output 1 = the offered token to the taker: a reserve output carrying 0 native.
    const offeredOut = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[TOKTEST5A_ID, 10n * 100_000_000n]]));
    expect(tx.outs[1]!.script.toString('hex')).toBe(offeredOut.script.toString('hex'));
    expect(tx.outs[1]!.value).toBe(0);
    // Change output (native) exists.
    expect(tx.outs.length).toBeGreaterThanOrEqual(3);
    // Input 0 = maker commitment, 0x83 intact.
    const in0f = (bscript.decompile(tx.ins[0]!.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c));
    expect(in0f!.subarray(0, 2).toString('hex')).toBe('0183');
    // Taker input present and signed.
    expect(tx.ins.length).toBe(2);
    expect(tx.ins[1]!.script.length).toBeGreaterThan(0);
  });
});
