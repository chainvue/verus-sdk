/**
 * Guards on the identity UTXO grafted into an identity-respend transaction.
 *
 * The identity input is added AFTER assertTokenConservation has already run over
 * the funding selection, so anything it carries sits outside conservation
 * accounting. Native was guarded; token was not. These lock both halves.
 */
import { describe, it, expect } from 'vitest';
import { assembleFundedIdentityUpdate } from '../src/assemble/fundedIdentityUpdate.js';
import { buildTokenChangeOutput, deriveIdentityAddress } from '../src/identity/index.js';
import { decodeUtxo } from '../src/utxo/index.js';
import { parseAddress } from '../src/core/brands.js';
import {
  TEST_WIF,
  TEST_ADDRESS,
  NETWORK,
  VRSCTEST_SYSTEM_ID,
  makeFundingUtxo,
  createMockIdentityHex,
} from './fixtures/index.js';

/** A token-bearing reserve output (eval 8/9) posing as the identity UTXO. */
function tokenBearingUtxo(currency: string, amount: bigint) {
  const script = buildTokenChangeOutput(
    parseAddress(TEST_ADDRESS),
    new Map([[currency, amount]]),
  ).script;
  return { txid: 'ee'.repeat(32), outputIndex: 0, satoshis: 0n, script: script.toString('hex') };
}

function intentWith(identityUtxo: { txid: string; outputIndex: number; satoshis: bigint; script: string }) {
  const { identityScript } = createMockIdentityHex({ name: 'idguard' });
  return {
    network: NETWORK,
    wif: TEST_WIF,
    expiryHeight: 0,
    funding: [makeFundingUtxo('aa', 100_000_000n)],
    identityUtxo,
    outputs: [{ script: identityScript, nativeSat: 0n }],
    changeAddress: TEST_ADDRESS,
    extraOutputBytes: identityScript.length,
    label: 'test-identity-guard',
  };
}

describe('assembleFundedIdentityUpdate: identityUtxo guards', () => {
  it('fails closed when identityUtxo carries token value', () => {
    const token = deriveIdentityAddress('idguardtoken', VRSCTEST_SYSTEM_ID);
    expect(() =>
      assembleFundedIdentityUpdate(intentWith(tokenBearingUtxo(token, 100_000_000n))),
    ).toThrow(/identityUtxo carries 100000000 of .* outside token conservation/);
  });

  it('fails closed when identityUtxo carries native value (pre-existing guard)', () => {
    const nativeBearing = { ...tokenBearingUtxo(VRSCTEST_SYSTEM_ID, 0n), satoshis: 5_000_000n };
    expect(() => assembleFundedIdentityUpdate(intentWith(nativeBearing))).toThrow(
      /identityUtxo carries 5000000 native satoshis, which would be burned/,
    );
  });

  it('does not reject a real identity UTXO (guard is not vacuous in either direction)', () => {
    // Positive control for the SHAPE of the guard: a genuine identity output is
    // an EVAL_IDENTITY_PRIMARY CC that decodeUtxo does not model, so it takes the
    // catch path and must pass. If this ever throws the guard error, the guard
    // has started rejecting the normal case.
    const { identityUtxo } = createMockIdentityHex({ name: 'idguard' });
    let err: unknown;
    try {
      assembleFundedIdentityUpdate(intentWith(identityUtxo));
    } catch (e) {
      err = e;
    }
    expect(String((err as Error | undefined)?.message ?? '')).not.toMatch(
      /outside token conservation|would be burned/,
    );
  });

  it('confirms the token fixture really decodes as token-bearing (guards against a dead test)', () => {
    // If buildTokenChangeOutput ever stopped producing a decodable reserve
    // output, the token test above would pass for the wrong reason.
    const token = deriveIdentityAddress('idguardtoken', VRSCTEST_SYSTEM_ID);
    const { currencyValues } = decodeUtxo(tokenBearingUtxo(token, 100_000_000n), VRSCTEST_SYSTEM_ID);
    expect(currencyValues.get(token)).toBe(100_000_000n);
  });
});
