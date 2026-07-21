/**
 * Offline assembly of a full currency-definition transaction
 * (buildCurrencyLaunchTransaction): the seven output scripts funded, the defining
 * identity spent under primary authority, and everything signed — without any
 * node RPC. The output scripts themselves are byte-locked in
 * currency-outputs.test.ts; this exercises funding, conservation, the identity
 * input, and signing on a test identity we control (primary = TEST_WIF).
 */
import { describe, it, expect } from 'vitest';
import { buildCurrencyLaunchTransaction } from '../src/currency/launch.js';
import { buildCurrencyLaunchOutputs } from '../src/currency/outputs.js';
import { CURRENCY_OPTION } from '../src/currency/definition.js';
import { InvalidWifError, TransactionBuildError } from '../src/errors.js';
import {
  TEST_WIF,
  TEST_WIF_B,
  TEST_ADDRESS,
  NETWORK,
  VRSCTEST_SYSTEM_ID,
  makeFundingUtxo,
  createMockIdentityHex,
} from './fixtures/index.js';

const mock = createMockIdentityHex({ name: 'launchtest' });

// The identity as a lite node's getidentity would return it, matching the mock's
// controlling UTXO (primary = TEST_ADDRESS, revocation/recovery = self).
const IDENTITY = {
  version: 3,
  flags: 0,
  primaryaddresses: [TEST_ADDRESS],
  minimumsignatures: 1,
  name: 'launchtest',
  identityaddress: mock.identityAddress,
  parent: VRSCTEST_SYSTEM_ID,
  systemid: VRSCTEST_SYSTEM_ID,
  contentmap: {},
  contentmultimap: {},
  revocationauthority: mock.identityAddress,
  recoveryauthority: mock.identityAddress,
  timelock: 0,
};

const DEFINITION = {
  name: 'launchtest',
  parent: VRSCTEST_SYSTEM_ID,
  options: CURRENCY_OPTION.TOKEN,
  proofProtocol: 2,
  startBlock: 1_200_000,
  idRegistrationFees: 100_000_000n,
  idReferralLevels: 3,
  preAllocations: [{ address: mock.identityAddress, amount: 100_00000000n }],
};

const HEIGHT = 1_180_000;
const LAUNCH_FEE = 20_000_000_000n; // 200 native → 100 native reserve deposit

function baseParams() {
  return {
    wif: TEST_WIF,
    definition: DEFINITION,
    identity: IDENTITY,
    identityUtxo: mock.identityUtxo,
    fundingUtxos: [makeFundingUtxo('aa', 200_00000000n)], // 200 VRSC: covers 100 reserve + fee + change
    changeAddress: TEST_ADDRESS,
    height: HEIGHT,
    launchFeeSats: LAUNCH_FEE,
  };
}

describe('buildCurrencyLaunchTransaction — offline assembly + signing', () => {
  it('builds and signs a broadcastable token-launch transaction', () => {
    const result = buildCurrencyLaunchTransaction(baseParams(), NETWORK);

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(result.fee).toBeGreaterThan(0n);
    expect(result.inputsUsed).toBe(2); // one funding UTXO + the identity input
    expect(result.nativeChange).toBeGreaterThan(0n);
    expect(result.currencyAddress).toBe(mock.identityAddress);
  });

  it('embeds all six consensus output scripts, in order, in the signed transaction', () => {
    const result = buildCurrencyLaunchTransaction(baseParams(), NETWORK);
    const outs = buildCurrencyLaunchOutputs(DEFINITION, {
      identity: IDENTITY,
      height: HEIGHT,
      launchFeeSats: LAUNCH_FEE,
    });
    let cursor = 0;
    for (let i = 0; i < 6; i++) {
      const script = outs.ordered[i]!.script;
      const at = result.signedTx.indexOf(script, cursor);
      expect(at, `consensus output ${i} must appear in order`).toBeGreaterThanOrEqual(cursor);
      cursor = at + script.length;
    }
    // The reserve deposit carries half the launch fee.
    expect(outs.reserveDeposit.value).toBe(LAUNCH_FEE / 2n);
  });

  it('conserves value: inputs = outputs + fee', () => {
    const result = buildCurrencyLaunchTransaction(baseParams(), NETWORK);
    // funding 200 VRSC = reserveDeposit 100 + change + fee
    expect(result.nativeChange + result.fee + 100_00000000n).toBe(200_00000000n);
  });

  it('rejects an invalid WIF up front', () => {
    expect(() => buildCurrencyLaunchTransaction({ ...baseParams(), wif: 'not-a-wif' }, NETWORK)).toThrow(InvalidWifError);
  });

  it('rejects a WIF that does not control the identity', () => {
    expect(() => buildCurrencyLaunchTransaction({ ...baseParams(), wif: TEST_WIF_B }, NETWORK)).toThrow(
      /not among the identity's primary addresses/,
    );
  });

  it('rejects an empty funding set', () => {
    expect(() => buildCurrencyLaunchTransaction({ ...baseParams(), fundingUtxos: [] }, NETWORK)).toThrow(TransactionBuildError);
  });

  it('throws on insufficient funds (cannot cover the reserve deposit)', () => {
    expect(() =>
      buildCurrencyLaunchTransaction({ ...baseParams(), fundingUtxos: [makeFundingUtxo('aa', 1_000n)] }, NETWORK),
    ).toThrow(/[Ii]nsufficient/);
  });

  it('defaults expiry to height + delta, not 0 (never-expire)', () => {
    // baseParams() sets no expiryHeight, so the tx must be bounded at
    // height + DEFAULT_EXPIRY_DELTA (20), not left never-expiring. A matching
    // explicit value yields the same txid; an explicit 0 (opt-in never-expire)
    // yields a different one.
    const defaulted = buildCurrencyLaunchTransaction(baseParams(), NETWORK);
    const explicitDelta = buildCurrencyLaunchTransaction({ ...baseParams(), expiryHeight: HEIGHT + 20 }, NETWORK);
    const neverExpire = buildCurrencyLaunchTransaction({ ...baseParams(), expiryHeight: 0 }, NETWORK);
    expect(defaulted.txid).toBe(explicitDelta.txid);
    expect(defaulted.txid).not.toBe(neverExpire.txid);
  });
});
