/**
 * Tier-0 differential tests: SDK-built transaction structure vs recorded daemon
 * structure (test/fixtures/daemon-shapes.json). Hermetic — no daemon needed at
 * test time; the fixtures were captured once from `registeridentity … true`.
 *
 * This is the check that would have auto-caught the two worst bugs of the
 * hardening campaign: the sub-ID fee output built as EVAL_RESERVE_TRANSFER
 * instead of EVAL_RESERVE_OUTPUT, and token value dropped for want of a reserve
 * change output. Wallet-specific tails (change outputs, amounts, addresses) are
 * ignored; only the structural shape the daemon dictates is pinned.
 */
import { describe, it, expect } from 'vitest';
import {
  buildAndSignRegistration,
  prepareNameCommitment,
  deriveIdentityAddress,
  buildTokenChangeOutput,
} from '../src/identity/index.js';
import { canonicalize } from './support/canonicalize.js';
import { parseAddress } from '../src/core/brands.js';
import daemonShapes from './fixtures/daemon-shapes.json';
import type { CommitmentData, Utxo } from '../src/types/index.js';
import {
  TEST_WIF,
  TEST_ADDRESS,
  NETWORK,
  VRSCTEST_SYSTEM_ID,
  TEST_SCRIPT,
} from './fixtures/index.js';

const SALT = Buffer.alloc(32, 0x22);

function fixedRegInputs(name: string, opts: { parent?: string; referral?: string } = {}) {
  const c = prepareNameCommitment(name, TEST_ADDRESS, opts.referral, opts.parent, NETWORK, SALT);
  const commitmentData: CommitmentData = {
    name,
    salt: c.salt.toString('hex'),
    referral: opts.referral ?? null,
    parent: opts.parent ?? null,
    namereservationHex: c.serializedReservation.toString('hex'),
    commitmentHash: c.commitmentHash.toString('hex'),
  };
  const commitmentUtxo: Utxo = {
    txid: 'aa'.repeat(32),
    outputIndex: 0,
    satoshis: 0n,
    script: c.commitmentScript.toString('hex'),
  };
  return { commitmentData, commitmentUtxo };
}

describe('Tier-0 differential: SDK structure matches recorded daemon shape', () => {
  it('sub-ID registration fee output matches the daemon (reserve output, 1 currency, 0 native)', () => {
    const parent = deriveIdentityAddress('diffparent', VRSCTEST_SYSTEM_ID);
    const { commitmentData, commitmentUtxo } = fixedRegInputs('diffsub', { parent });
    const tokenScript = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[parent, 100_000_000n]])).script;
    const r = buildAndSignRegistration(
      {
        wif: TEST_WIF, commitmentUtxo, commitmentData, primaryAddresses: [TEST_ADDRESS],
        utxos: [
          { txid: 'bb'.repeat(32), outputIndex: 0, satoshis: 100_000_000n, script: TEST_SCRIPT },
          { txid: 'cc'.repeat(32), outputIndex: 0, satoshis: 0n, script: tokenScript.toString('hex') },
        ],
        changeAddress: TEST_ADDRESS, expiryHeight: 0,
        registrationFeeAmount: 100_000_000n, nativeImportFee: 2_000_000n, parentProofProtocol: 2,
      },
      NETWORK,
    );
    const canon = canonicalize(r.signedTx, NETWORK, VRSCTEST_SYSTEM_ID);
    const want = daemonShapes['subid-registration'].feeOutput;
    // Exactly one output must have the daemon's fee-output shape.
    const feeOutputs = canon.outputs.filter(
      (o) =>
        JSON.stringify(o.evalCodes) === JSON.stringify(want.evalCodes) &&
        o.reserveCurrencyCount === want.reserveCurrencyCount &&
        o.nativeZero === want.nativeZero,
    );
    expect(feeOutputs).toHaveLength(1);
  });

  it('VRSC (root) registration carries no reserve currency — native burn only', () => {
    const { commitmentData, commitmentUtxo } = fixedRegInputs('diffreg');
    const r = buildAndSignRegistration(
      {
        wif: TEST_WIF, commitmentUtxo, commitmentData, primaryAddresses: [TEST_ADDRESS],
        utxos: [{ txid: 'bb'.repeat(32), outputIndex: 0, satoshis: 20_000_000_000n, script: TEST_SCRIPT }],
        changeAddress: TEST_ADDRESS, expiryHeight: 0,
      },
      NETWORK,
    );
    const canon = canonicalize(r.signedTx, NETWORK, VRSCTEST_SYSTEM_ID);
    const reserveCarrying = canon.outputs.filter((o) => o.reserveCurrencyCount > 0).length;
    expect(reserveCarrying).toBe(daemonShapes['vrsc-registration'].reserveCarryingOutputs);
  });
});
