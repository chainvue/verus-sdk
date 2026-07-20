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
import { buildCommitmentScript, buildTokenChangeOutput } from '../src/identity/index.js';
import { parseRAddress, parseAddress } from '../src/core/brands.js';
import { Transaction, script as bscript } from '../src/fork/boundary.js';
import { getNetwork } from '../src/signing/index.js';
import { TEST_WIF, TEST_ADDRESS, NETWORK, makeFundingUtxo } from './fixtures/index.js';

// A real VRSCTEST currency id (ownora), used only as a currency key.
const OWNORA_ID = 'iFefrNRjNcvW473Hnx2eKW9jpWuFKE11vw';

function makeNativeOffer() {
  const funding = buildOfferFunding(
    {
      wif: TEST_WIF,
      utxos: [makeFundingUtxo('aa', 100_000_000n)],
      changeAddress: TEST_ADDRESS,
      makerAddress: TEST_ADDRESS,
      offerAmount: 100_000n, // 0.001 VRSCTEST offered
      expiryHeight: 0,
    },
    NETWORK,
  );
  const offer = buildOffer(
    {
      wif: TEST_WIF,
      commitment: funding.commitment,
      want: { currency: OWNORA_ID, amount: 100_000n, address: TEST_ADDRESS },
      expiryHeight: 0,
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
        { wif: TEST_WIF, utxos: [makeFundingUtxo('aa', 100_000_000n)], changeAddress: TEST_ADDRESS, makerAddress: TEST_ADDRESS, offerAmount: 0n, expiryHeight: 0 },
        NETWORK,
      ),
    ).toThrow(/offerAmount must be positive/);
  });
});
