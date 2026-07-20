/**
 * Maker side of a native-coin offer (offer VRSCTEST, want a token).
 *
 * Golden byte-locks for the funding tx and the maker's offer tx, plus assertions
 * that the two novel output scripts are byte-identical to what the daemon's
 * `makeoffer` produces (verified on VRSCTEST) and that the offer input carries the
 * 0x83 fulfillment.
 */
import { describe, it, expect } from 'vitest';
import { buildOfferFunding, buildOffer } from '../src/offers/maker.js';
import { buildCommitmentScript, buildTokenCommitmentScript, buildTokenChangeOutput } from '../src/identity/index.js';
import { parseRAddress, parseAddress } from '../src/core/brands.js';
import { Transaction, script as bscript } from '../src/fork/boundary.js';
import { getNetwork } from '../src/signing/index.js';
import { TEST_WIF, TEST_ADDRESS, NETWORK, VRSCTEST_SYSTEM_ID, makeFundingUtxo } from './fixtures/index.js';

// A real VRSCTEST currency id (ownora), used only as a currency key.
const OWNORA_ID = 'iFefrNRjNcvW473Hnx2eKW9jpWuFKE11vw';
// The new token minted for 5a (toktest5a), used as the offered currency here.
const TOKTEST5A_ID = 'iJWuVTboQbmqL6QWaX6g8oPfWDTpvxtQ2a';

/** A token-bearing reserve UTXO the maker can lock into a token commitment. */
function tokenUtxo(currency: string, amount: bigint, txid = 'cc') {
  const script = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[currency, amount]])).script;
  return { txid: txid.repeat(32).slice(0, 64), outputIndex: 0, satoshis: 0n, script: script.toString('hex') };
}

function makeNativeOffer() {
  const funding = buildOfferFunding(
    {
      wif: TEST_WIF,
      utxos: [makeFundingUtxo('aa', 100_000_000n)],
      changeAddress: TEST_ADDRESS,
      makerAddress: TEST_ADDRESS,
      offered: { currency: VRSCTEST_SYSTEM_ID, amount: 100_000n }, // 0.001 VRSCTEST offered
      expiryHeight: 0,
    },
    NETWORK,
  );
  const offer = buildOffer(
    {
      wif: TEST_WIF,
      commitment: funding.commitment,
      want: { currency: OWNORA_ID, amount: 100_000n, address: TEST_ADDRESS },
      expiryHeight: 1_200_000, // a real future height — the daemon rejects 0 as expired
    },
    NETWORK,
  );
  return { funding, offer };
}

describe('offers — native maker flow', () => {
  it('funds the offer into a commitment output byte-identical to the daemon', () => {
    const { funding } = makeNativeOffer();
    const net = getNetwork(true);
    const out0 = Transaction.fromHex(funding.fundingTx, net).outs[0]!;
    const expected = buildCommitmentScript(Buffer.alloc(32, 0), parseRAddress(TEST_ADDRESS));
    expect(out0.script.toString('hex')).toBe(expected.toString('hex'));
    expect(out0.value).toBe(100_000);
    expect(funding.commitment.script).toBe(expected.toString('hex'));
  });

  it("the offer's wanted output is the daemon's reserve output, and the input carries the 0x83 fulfillment", () => {
    const { offer } = makeNativeOffer();
    const net = getNetwork(true);
    const tx = Transaction.fromHex(offer.offerTx, net);

    // Single wanted output = reserve output for the wanted token.
    expect(tx.outs.length).toBe(1);
    const wanted = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[OWNORA_ID, 100_000n]]));
    expect(tx.outs[0]!.script.toString('hex')).toBe(wanted.script.toString('hex'));

    // Input spends the commitment with a 0x83 CC fulfillment.
    const chunks = bscript.decompile(tx.ins[0]!.script) ?? [];
    const fulfillment = chunks.find((c): c is Buffer => Buffer.isBuffer(c));
    expect(fulfillment!.subarray(0, 2).toString('hex')).toBe('0183');
  });

  it('golden: funding tx bytes', () => {
    expect(makeNativeOffer().funding.fundingTx).toMatchSnapshot();
  });

  it('golden: offer tx bytes', () => {
    expect(makeNativeOffer().offer.offerTx).toMatchSnapshot();
  });

  it('rejects a non-positive offer amount', () => {
    expect(() =>
      buildOfferFunding(
        { wif: TEST_WIF, utxos: [makeFundingUtxo('aa', 100_000_000n)], changeAddress: TEST_ADDRESS, makerAddress: TEST_ADDRESS, offered: { currency: VRSCTEST_SYSTEM_ID, amount: 0n }, expiryHeight: 0 },
        NETWORK,
      ),
    ).toThrow(/offered.amount must be positive/);
  });

  it('rejects an offer with a 0 / never-expiring expiryHeight (daemon treats it as expired)', () => {
    const funding = buildOfferFunding(
      { wif: TEST_WIF, utxos: [makeFundingUtxo('aa', 100_000_000n)], changeAddress: TEST_ADDRESS, makerAddress: TEST_ADDRESS, offered: { currency: VRSCTEST_SYSTEM_ID, amount: 100_000n }, expiryHeight: 0 },
      NETWORK,
    );
    for (const bad of [0, -1, 1.5, undefined]) {
      expect(() =>
        buildOffer(
          { wif: TEST_WIF, commitment: funding.commitment, want: { currency: OWNORA_ID, amount: 100_000n, address: TEST_ADDRESS }, expiryHeight: bad as number },
          NETWORK,
        ),
      ).toThrow(/expiryHeight .* is required/);
    }
  });
});

describe('offers — token maker flow (5a: offering a token)', () => {
  // Offer 10 toktest5a, want 5 VRSCTEST. The offered token is sourced from a
  // reserve UTXO and locked into a token commitment; native for the fee comes
  // from a plain UTXO.
  function makeTokenOffer() {
    const funding = buildOfferFunding(
      {
        wif: TEST_WIF,
        utxos: [tokenUtxo(TOKTEST5A_ID, 30n * 100_000_000n), makeFundingUtxo('aa', 100_000_000n)],
        changeAddress: TEST_ADDRESS,
        makerAddress: TEST_ADDRESS,
        offered: { currency: TOKTEST5A_ID, amount: 10n * 100_000_000n },
        expiryHeight: 0,
      },
      NETWORK,
    );
    const offer = buildOffer(
      {
        wif: TEST_WIF,
        commitment: funding.commitment,
        want: { currency: VRSCTEST_SYSTEM_ID, amount: 5n * 100_000_000n, address: TEST_ADDRESS },
        expiryHeight: 1_200_000,
      },
      NETWORK,
    );
    return { funding, offer };
  }

  it('locks the offered token into a commitment byte-identical to the daemon', () => {
    const { funding } = makeTokenOffer();
    const net = getNetwork(true);
    const out0 = Transaction.fromHex(funding.fundingTx, net).outs[0]!;
    // The exact bytes captured from `makeoffer` on VRSCTEST (marker + TokenOutput).
    const expected = buildTokenCommitmentScript(TOKTEST5A_ID, 10n * 100_000_000n, parseRAddress(TEST_ADDRESS));
    expect(out0.script.toString('hex')).toBe(expected.toString('hex'));
    expect(out0.value).toBe(0); // token commitment carries 0 native
    expect(funding.commitment.value).toBe(0n);
    expect(funding.commitment.script).toBe(expected.toString('hex'));
  });

  it('the token-commitment vData is the constant marker followed by a v1 TokenOutput', () => {
    const script = buildTokenCommitmentScript(TOKTEST5A_ID, 10n * 100_000_000n, parseRAddress(TEST_ADDRESS));
    // Locate the eval-17 vData push and check its head is the captured marker.
    const hex = script.toString('hex');
    const marker = '2767181a4f6abe2090a7dca2c689477d163900f6' + '00'.repeat(12);
    expect(hex).toContain(marker + '01'); // marker (32B) then TokenOutput version 1
  });

  it("the offer's wanted native output is a plain payment and the input carries 0x83", () => {
    const { offer } = makeTokenOffer();
    const net = getNetwork(true);
    const tx = Transaction.fromHex(offer.offerTx, net);
    expect(tx.outs.length).toBe(1);
    expect(tx.outs[0]!.value).toBe(5 * 100_000_000); // wanted native
    const chunks = bscript.decompile(tx.ins[0]!.script) ?? [];
    const fulfillment = chunks.find((c): c is Buffer => Buffer.isBuffer(c));
    expect(fulfillment!.subarray(0, 2).toString('hex')).toBe('0183');
  });

  it('golden: token funding tx bytes', () => {
    expect(makeTokenOffer().funding.fundingTx).toMatchSnapshot();
  });

  it('golden: token offer tx bytes', () => {
    expect(makeTokenOffer().offer.offerTx).toMatchSnapshot();
  });
});
