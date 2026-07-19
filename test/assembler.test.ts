import { describe, it, expect } from 'vitest';
import { assembleAndSign } from '../src/assemble/assembler.js';
import { buildTokenChangeOutput, deriveIdentityAddress } from '../src/identity/index.js';
import { parseAddress } from '../src/core/brands.js';
import { TEST_WIF, TEST_ADDRESS, NETWORK, VRSCTEST_SYSTEM_ID, makeFundingUtxo } from './fixtures/index.js';

describe('assembleAndSign: leading-input token guard', () => {
  // Leading inputs are outside the token-conservation check (which only sees the
  // funding selection), so a token-bearing leading input would burn its token
  // value silently. The assembler must fail closed. (Today unreachable — the only
  // leading input is the SDK-built commitment UTXO, which carries no token — but
  // the guard enforces the assumption rather than trusting it.)
  it('fails closed when a leading input carries token value', () => {
    const token = deriveIdentityAddress('leadguardtoken', VRSCTEST_SYSTEM_ID);
    const tokenScript = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[token, 100_000_000n]])).script;
    const leadingInput = { txid: 'ab'.repeat(32), outputIndex: 0, satoshis: 0n, script: tokenScript.toString('hex') };

    expect(() =>
      assembleAndSign({
        network: NETWORK,
        wif: TEST_WIF,
        expiryHeight: 0,
        funding: [makeFundingUtxo('aa', 100_000_000n)],
        leadingInputs: [leadingInput],
        outputs: [{ script: Buffer.from(`76a914${'00'.repeat(20)}88ac`, 'hex'), nativeSat: 0n }],
        changeAddress: TEST_ADDRESS,
        fee: { policy: 'estimate' },
        label: 'test-leading-guard',
      }),
    ).toThrow(/leading input .* carries .* outside token conservation/);
  });

  it('fails closed when a leading input carries native value (would burn to fee)', () => {
    // Native on a leading input folds into the fee — burned to miner. The
    // identity-respend assembler fails closed on the same; the value-output
    // assembler must match. A name-commitment output is value 0.
    const nativeLeading = makeFundingUtxo('cd', 5_000_000n);
    expect(() =>
      assembleAndSign({
        network: NETWORK,
        wif: TEST_WIF,
        expiryHeight: 0,
        funding: [makeFundingUtxo('aa', 100_000_000n)],
        leadingInputs: [nativeLeading],
        outputs: [{ script: Buffer.from(`76a914${'00'.repeat(20)}88ac`, 'hex'), nativeSat: 0n }],
        changeAddress: TEST_ADDRESS,
        fee: { policy: 'estimate' },
        label: 'test-native-leading',
      }),
    ).toThrow(/carries 5000000 native satoshis, which would be burned/);
  });

  it('accepts a zero-native, zero-token leading input', () => {
    // A commitment-style leading input (0 native, no token) passes both guards; it
    // may still fail later for unrelated reasons, so we only assert neither guard
    // error surfaces.
    const cleanLeading = makeFundingUtxo('cd', 0n);
    let err: unknown;
    try {
      assembleAndSign({
        network: NETWORK,
        wif: TEST_WIF,
        expiryHeight: 0,
        funding: [makeFundingUtxo('aa', 100_000_000n)],
        leadingInputs: [cleanLeading],
        outputs: [{ script: Buffer.from(`76a914${'00'.repeat(20)}88ac`, 'hex'), nativeSat: 0n }],
        changeAddress: TEST_ADDRESS,
        fee: { policy: 'estimate' },
        label: 'test-clean-leading',
      });
    } catch (e) {
      err = e;
    }
    const msg = String((err as Error | undefined)?.message ?? '');
    expect(msg).not.toMatch(/outside token conservation/);
    expect(msg).not.toMatch(/would be burned/);
  });
});
