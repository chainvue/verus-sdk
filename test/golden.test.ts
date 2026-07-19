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
import { sendCurrency } from '../src/transfer/index.js';
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

  it('sendCurrency (native transfer, native change)', () => {
    const r = sendCurrency(
      {
        wif: TEST_WIF,
        outputs: [{ currency: VRSCTEST_SYSTEM_ID, satoshis: 50_000_000n, address: TEST_ADDRESS_B, addressType: 'PKH' }],
        utxos: [makeFundingUtxo('aa', 100_000_000n)],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      },
      NETWORK,
    );
    expect(r.signedTx).toMatchSnapshot();
  });

  it('sendCurrency (token transfer, token + native change)', () => {
    const token = deriveIdentityAddress('goldsendtoken', VRSCTEST_SYSTEM_ID);
    // One token-bearing reserve UTXO (funds the transfer + token change) and one
    // native UTXO (covers the reserve-transfer native + miner fee).
    const tokenScript = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[token, 100_000_000n]])).script;
    const r = sendCurrency(
      {
        wif: TEST_WIF,
        outputs: [{ currency: token, satoshis: 40_000_000n, address: TEST_ADDRESS_B, addressType: 'PKH' }],
        utxos: [
          { txid: 'cc'.repeat(32), outputIndex: 0, satoshis: 0n, script: tokenScript.toString('hex') },
          makeFundingUtxo('aa', 100_000_000n),
        ],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      },
      NETWORK,
    );
    expect(r.signedTx).toMatchSnapshot();
  });

  // ─── Edge-path goldens ───────────────────────────────────────────────
  // The core goldens above cover the happy path with R-address change and no
  // token change. A Fable-5 review noted the "byte-identical" safety net was
  // thinner than the claim: no golden exercised i-address change, bundled token
  // change, a pp1 sub-ID (reserve-transfer fee), a multi-level referral chain,
  // or an input above the fork's 2^32-sat truncation blind spot. These lock all
  // five so a future refactor can't silently change their bytes.

  it('name commitment (i-address change → P2ID script)', () => {
    const iChange = deriveIdentityAddress('goldichange', VRSCTEST_SYSTEM_ID);
    const r = buildAndSignCommitment(
      { wif: TEST_WIF, name: 'goldcommit', utxos: [makeFundingUtxo('aa', 100_000_000n)], changeAddress: iChange, expiryHeight: 0, salt: SALT },
      NETWORK,
    );
    expect(r.signedTx).toMatchSnapshot();
  });

  it('name commitment (bundled token change on one reserve output)', () => {
    const token = deriveIdentityAddress('goldbundletoken', VRSCTEST_SYSTEM_ID);
    // A single reserve UTXO carrying native + token: the small commitment fee comes
    // out, the rest returns as bundled token + native change on one reserve output.
    const reserveScript = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[token, 100_000_000n]])).script;
    const r = buildAndSignCommitment(
      { wif: TEST_WIF, name: 'goldcommit', utxos: [{ txid: 'dd'.repeat(32), outputIndex: 0, satoshis: 200_000_000n, script: reserveScript.toString('hex') }], changeAddress: TEST_ADDRESS, expiryHeight: 0, salt: SALT },
      NETWORK,
    );
    expect(r.signedTx).toMatchSnapshot();
  });

  it('VRSC identity registration (2-level referral chain)', () => {
    const ref1 = deriveIdentityAddress('goldref1', VRSCTEST_SYSTEM_ID);
    const ref2 = deriveIdentityAddress('goldref2', VRSCTEST_SYSTEM_ID);
    const { commitmentData, commitmentUtxo } = fixedRegInputs('gold2ref', { referral: ref1 });
    const r = buildAndSignRegistration(
      {
        wif: TEST_WIF, commitmentUtxo, commitmentData, primaryAddresses: [TEST_ADDRESS],
        utxos: [{ txid: 'bb'.repeat(32), outputIndex: 0, satoshis: 20_000_000_000n, script: TEST_SCRIPT }],
        changeAddress: TEST_ADDRESS, expiryHeight: 0, referralChain: [ref1, ref2], referralLevels: 2,
      },
      NETWORK,
    );
    expect(r.signedTx).toMatchSnapshot();
  });

  it('sub-ID registration (pp1 parent → reserve-transfer fee)', () => {
    const parent = deriveIdentityAddress('goldpp1parent', VRSCTEST_SYSTEM_ID);
    const { commitmentData, commitmentUtxo } = fixedRegInputs('goldpp1sub', { parent });
    const tokenScript = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[parent, 100_000_000n]])).script;
    const r = buildAndSignRegistration(
      {
        wif: TEST_WIF, commitmentUtxo, commitmentData, primaryAddresses: [TEST_ADDRESS],
        utxos: [
          { txid: 'bb'.repeat(32), outputIndex: 0, satoshis: 100_000_000n, script: TEST_SCRIPT },
          { txid: 'cc'.repeat(32), outputIndex: 0, satoshis: 0n, script: tokenScript.toString('hex') },
        ],
        changeAddress: TEST_ADDRESS, expiryHeight: 0,
        registrationFeeAmount: 100_000_000n, nativeImportFee: 2_000_000n, parentProofProtocol: 1,
      },
      NETWORK,
    );
    expect(r.signedTx).toMatchSnapshot();
  });

  it('sendCurrency (input above the 2^32-sat truncation blind spot)', () => {
    // 500 VRSC = 50e9 sat > 2^32 (~42.9 VRSC): the fork's absurd-fee guard truncates
    // input value mod 2^32, so the SDK's bigint conservation is the real backstop.
    const r = sendCurrency(
      {
        wif: TEST_WIF,
        outputs: [{ currency: VRSCTEST_SYSTEM_ID, satoshis: 50_000_000n, address: TEST_ADDRESS_B, addressType: 'PKH' }],
        utxos: [makeFundingUtxo('aa', 50_000_000_000n)],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      },
      NETWORK,
    );
    expect(r.signedTx).toMatchSnapshot();
  });
});
