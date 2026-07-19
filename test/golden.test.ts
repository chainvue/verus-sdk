/**
 * Golden-byte snapshots of every transaction-building path.
 *
 * Phase-0 safety net for the structural refactor: each path is built with fixed
 * inputs (fixed salt, fixed expiry, fixed fixtures) and its signed hex is pinned
 * as a snapshot. Any refactor that changes emitted bytes fails here immediately,
 * so the assembler migration (Phase 3) can be proven byte-identical.
 *
 * Determinism note: only the commitment path carries randomness (the salt); it
 * is pinned via the explicit salt param. Every other path is a pure function of
 * its inputs, and signing is RFC6979-deterministic.
 */
import { describe, it, expect } from 'vitest';
import {
  buildAndSignCommitment,
  buildAndSignRegistration,
  buildAndSignIdentityUpdate,
  prepareNameCommitment,
  deriveIdentityAddress,
  buildTokenChangeOutput,
} from '../src/identity/index.js';
import { defineCurrency } from '../src/currency/index.js';
import { parseAddress } from '../src/core/brands.js';
import type { CommitmentData, Utxo } from '../src/types/index.js';
import {
  TEST_WIF,
  TEST_ADDRESS,
  TEST_ADDRESS_B,
  NETWORK,
  VRSCTEST_SYSTEM_ID,
  makeFundingUtxo,
  createMockIdentityHex,
  TEST_SCRIPT,
} from './fixtures/index.js';

const SALT = Buffer.alloc(32, 0x11);
const MOCK_CURRENCY_DEF_SCRIPT = 'cc'.repeat(50);

/** Deterministic commitmentData + commitmentUtxo for a registration golden. */
function fixedRegInputs(name: string, opts: { parent?: string; referral?: string } = {}) {
  const commitment = prepareNameCommitment(name, TEST_ADDRESS, opts.referral, opts.parent, NETWORK, SALT);
  const commitmentData: CommitmentData = {
    name,
    salt: commitment.salt.toString('hex'),
    referral: opts.referral ?? null,
    parent: opts.parent ?? null,
    namereservationHex: commitment.serializedReservation.toString('hex'),
    commitmentHash: commitment.commitmentHash.toString('hex'),
  };
  const commitmentUtxo: Utxo = {
    txid: 'aa'.repeat(32),
    outputIndex: 0,
    satoshis: 0n,
    script: commitment.commitmentScript.toString('hex'),
  };
  return { commitmentData, commitmentUtxo };
}

describe('golden signed-tx bytes (Phase-0 behavior lock)', () => {
  it('name commitment', () => {
    const r = buildAndSignCommitment(
      { wif: TEST_WIF, name: 'goldcommit', utxos: [makeFundingUtxo('aa', 100_000_000n)], changeAddress: TEST_ADDRESS, expiryHeight: 0, salt: SALT },
      NETWORK,
    );
    expect(r.signedTx).toMatchSnapshot();
  });

  it('VRSC identity registration (root, no referral)', () => {
    const { commitmentData, commitmentUtxo } = fixedRegInputs('goldreg');
    const r = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: [{ txid: 'bb'.repeat(32), outputIndex: 0, satoshis: 20_000_000_000n, script: TEST_SCRIPT }],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      },
      NETWORK,
    );
    expect(r.signedTx).toMatchSnapshot();
  });

  it('VRSC identity registration (with referral)', () => {
    const referrer = deriveIdentityAddress('goldreferrer', VRSCTEST_SYSTEM_ID);
    const { commitmentData, commitmentUtxo } = fixedRegInputs('goldrefreg', { referral: referrer });
    const r = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: [{ txid: 'bb'.repeat(32), outputIndex: 0, satoshis: 20_000_000_000n, script: TEST_SCRIPT }],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        referralChain: [referrer],
      },
      NETWORK,
    );
    expect(r.signedTx).toMatchSnapshot();
  });

  it('sub-ID registration', () => {
    const parent = deriveIdentityAddress('goldparent', VRSCTEST_SYSTEM_ID);
    const { commitmentData, commitmentUtxo } = fixedRegInputs('goldsub', { parent });
    // The parent-currency fee is paid from a token-bearing reserve UTXO; a
    // separate native UTXO covers the import + miner fee.
    const tokenScript = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[parent, 100_000_000n]])).script;
    const r = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: [
          { txid: 'bb'.repeat(32), outputIndex: 0, satoshis: 100_000_000n, script: TEST_SCRIPT },
          { txid: 'cc'.repeat(32), outputIndex: 0, satoshis: 0n, script: tokenScript.toString('hex') },
        ],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        registrationFeeAmount: 100_000_000n,
        nativeImportFee: 2_000_000n,
        parentProofProtocol: 2,
      },
      NETWORK,
    );
    expect(r.signedTx).toMatchSnapshot();
  });

  it('identity update (rotate primary)', () => {
    const mock = createMockIdentityHex({ name: 'goldupd' });
    const r = buildAndSignIdentityUpdate(
      {
        wif: TEST_WIF,
        identityHex: mock.identityHex,
        identityUtxo: mock.identityUtxo,
        utxos: [makeFundingUtxo('aa', 100_000_000n)],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        primaryAddresses: [TEST_ADDRESS_B],
      },
      NETWORK,
      'update',
    );
    expect(r.signedTx).toMatchSnapshot();
  });

  it('currency definition', () => {
    const mock = createMockIdentityHex({ name: 'goldcur' });
    const r = defineCurrency(
      {
        wif: TEST_WIF,
        identityHex: mock.identityHex,
        identityUtxo: mock.identityUtxo,
        currencyDefScript: MOCK_CURRENCY_DEF_SCRIPT,
        utxos: [makeFundingUtxo('aa', 100_000_000n)],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      },
      NETWORK,
    );
    expect(r.signedTx).toMatchSnapshot();
  });
});
