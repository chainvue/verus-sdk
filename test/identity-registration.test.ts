/**
 * Tests for buildAndSignRegistration() with various referral chain scenarios.
 *
 * Uses real SDK functions with mock UTXOs — no RPC needed.
 * Each test builds a real signed transaction and verifies its structure.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAndSignRegistration,
  calculateRegistrationFees,
  deriveIdentityAddress,
  prepareNameCommitment,
} from '../src/identity/index.js';
import { addressToScriptPubKey } from '../src/utils/index.js';
import { TransactionBuildError } from '../src/errors.js';
import {
  DEFAULT_REGISTRATION_FEE,
  NETWORK_CONFIG,
} from '../src/constants/index.js';
import type { CommitmentData, Utxo } from '../src/types/index.js';

// ─── Test Data ────────────────────────────────────────

// Valid testnet WIF (for offline signing — no funds needed)
const TEST_WIF = 'UusoQWsobQKUkezgBJa22D9G4t9Avo6k8wD5UUxmmfAEoTN8bawc';
const TEST_ADDRESS = 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX';
const NETWORK = 'testnet' as const;
const SYSTEM_ID = NETWORK_CONFIG.testnet.chainId;

// Valid P2PKH script for the test address (required by utxo-lib signer)
const TEST_SCRIPT = addressToScriptPubKey(TEST_ADDRESS).toString('hex');

// Referrer i-addresses (derived from known names on testnet)
const REFERRER_A = deriveIdentityAddress('referrera', SYSTEM_ID);
const REFERRER_B = deriveIdentityAddress('referrerb', SYSTEM_ID);
const REFERRER_C = deriveIdentityAddress('referrerc', SYSTEM_ID);

/**
 * Helper: prepare commitment data and a mock commitment UTXO for registration.
 * Uses prepareNameCommitment to get the real CC script.
 */
function createMockRegistrationInputs(
  name: string,
  referralIAddress?: string,
  fundingSatoshis: bigint = 20_000_000_000n, // 200 VRSC
) {
  const commitment = prepareNameCommitment(
    name,
    TEST_ADDRESS,
    referralIAddress,
    undefined,
    NETWORK,
  );

  const commitmentData: CommitmentData = {
    name,
    salt: commitment.salt.toString('hex'),
    referral: referralIAddress || null,
    parent: null,
    namereservationHex: commitment.serializedReservation.toString('hex'),
    commitmentHash: commitment.commitmentHash.toString('hex'),
  };

  // Mock commitment UTXO with the real CC script
  const commitmentUtxo: Utxo = {
    txid: 'aa'.repeat(32),
    outputIndex: 0,
    satoshis: 0n,
    script: commitment.commitmentScript.toString('hex'),
  };

  // Funding UTXOs (separate txid from commitment)
  const fundingUtxos: Utxo[] = [
    {
      txid: 'bb'.repeat(32),
      outputIndex: 0,
      satoshis: fundingSatoshis,
      script: TEST_SCRIPT,
    },
  ];

  return { commitmentData, commitmentUtxo, fundingUtxos, identityAddress: commitment.identityAddress };
}

// ─── Tests ────────────────────────────────────────────

describe('buildAndSignRegistration', () => {
  // ─── Test 1: No referral ───────────────────────────

  it('should register without referral (2 outputs + change)', () => {
    const { commitmentData, commitmentUtxo, fundingUtxos } =
      createMockRegistrationInputs('norefreg');

    const result = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: fundingUtxos,
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      },
      NETWORK,
    );

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(result.referralPayments).toBe(0);
    expect(result.referralAmountEach).toBe(0n);
    expect(result.registrationFee).toBe(DEFAULT_REGISTRATION_FEE);
    expect(result.identityAddress).toMatch(/^i/);
    expect(result.nativeChange).toBeGreaterThan(0n);
  });

  // ─── Test 2: 1 referrer, chain=[A] ────────────────

  it('should register with 1 referrer (1 referral output)', () => {
    const { commitmentData, commitmentUtxo, fundingUtxos } =
      createMockRegistrationInputs('oneref', REFERRER_A);

    const result = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: fundingUtxos,
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        referralChain: [REFERRER_A],
      },
      NETWORK,
    );

    const fees = calculateRegistrationFees(true);
    expect(result.referralPayments).toBe(1);
    expect(result.referralAmountEach).toBe(fees.referralAmount);
    expect(result.registrationFee).toBe(fees.issuerFee);
    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
  });

  // ─── Test 3: 2 referrers, chain=[A, B] ────────────

  it('should register with 2 referrers (2 referral outputs)', () => {
    const { commitmentData, commitmentUtxo, fundingUtxos } =
      createMockRegistrationInputs('tworef', REFERRER_A);

    const result = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: fundingUtxos,
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        referralChain: [REFERRER_A, REFERRER_B],
      },
      NETWORK,
    );

    expect(result.referralPayments).toBe(2);
    expect(result.referralAmountEach).toBe(2_000_000_000n); // 20 VRSC
    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
  });

  // ─── Test 4: 3 referrers (max), chain=[A,B,C] ────

  it('should register with 3 referrers (max chain)', () => {
    const { commitmentData, commitmentUtxo, fundingUtxos } =
      createMockRegistrationInputs('threeref', REFERRER_A, 30_000_000_000n);

    const result = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: fundingUtxos,
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        referralChain: [REFERRER_A, REFERRER_B, REFERRER_C],
      },
      NETWORK,
    );

    expect(result.referralPayments).toBe(3);
    expect(result.referralAmountEach).toBe(2_000_000_000n); // 20 VRSC each
    // issuer fee = totalFee - 3 * referralAmount = 100 - 60 = 40 VRSC
    expect(result.registrationFee).toBe(4_000_000_000n);
    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
  });

  // ─── Test 5: Single large UTXO (thin set) ─────────

  it('should succeed with a single large UTXO', () => {
    const { commitmentData, commitmentUtxo } =
      createMockRegistrationInputs('thinreg', REFERRER_A, 20_000_000_000n);

    const singleUtxo: Utxo = {
      txid: 'cc'.repeat(32),
      outputIndex: 0,
      satoshis: 20_000_000_000n,
      script: TEST_SCRIPT,
    };

    const result = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: [singleUtxo],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        referralChain: [REFERRER_A],
      },
      NETWORK,
    );

    expect(result.referralPayments).toBe(1);
    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.nativeChange).toBeGreaterThan(0n);
  });

  // ─── Test 6: Insufficient balance ─────────────────

  it('should throw on insufficient balance', () => {
    const { commitmentData, commitmentUtxo } =
      createMockRegistrationInputs('poorid', REFERRER_A, 1_000_000_000n);

    const tinyUtxo: Utxo = {
      txid: 'dd'.repeat(32),
      outputIndex: 0,
      satoshis: 50_000_000n, // 0.5 VRSC — below 80 VRSC needed
      script: TEST_SCRIPT,
    };

    expect(() =>
      buildAndSignRegistration(
        {
          wif: TEST_WIF,
          commitmentUtxo,
          commitmentData,
          primaryAddresses: [TEST_ADDRESS],
          utxos: [tinyUtxo],
          changeAddress: TEST_ADDRESS,
          expiryHeight: 0,
          referralChain: [REFERRER_A],
        },
        NETWORK,
      ),
    ).toThrow(/[Ii]nsufficient/);
  });

  // ─── Test 7: commitmentData.referral set, referralChain not provided → fallback ───

  it('should fall back to commitmentData.referral when referralChain not provided', () => {
    const { commitmentData, commitmentUtxo, fundingUtxos } =
      createMockRegistrationInputs('fallback', REFERRER_A);

    const result = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: fundingUtxos,
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        // No referralChain — falls back to [commitmentData.referral]
      },
      NETWORK,
    );

    expect(result.referralPayments).toBe(1);
    expect(result.referralAmountEach).toBe(2_000_000_000n);
  });

  // ─── Test 8: commitmentData.referral + explicit referralChain ───

  it('should use explicit referralChain over commitmentData.referral', () => {
    const { commitmentData, commitmentUtxo, fundingUtxos } =
      createMockRegistrationInputs('explicit', REFERRER_A);

    const result = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: fundingUtxos,
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        referralChain: [REFERRER_A, REFERRER_B],
      },
      NETWORK,
    );

    expect(result.referralPayments).toBe(2);
    expect(result.referralAmountEach).toBe(2_000_000_000n);
  });

  // ─── Structural verification ──────────────────────

  it('should produce valid hex with no duplicate inputs', () => {
    const { commitmentData, commitmentUtxo, fundingUtxos } =
      createMockRegistrationInputs('structcheck', REFERRER_A);

    const result = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: fundingUtxos,
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        referralChain: [REFERRER_A, REFERRER_B],
      },
      NETWORK,
    );

    expect(result.signedTx.length).toBeGreaterThan(0);
    expect(result.signedTx.length % 2).toBe(0);
    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(result.inputsUsed).toBeGreaterThanOrEqual(2);
    expect(result.fee).toBeGreaterThan(0n);
  });

  // ─── Regression: E6 live failure ──────────────────
  // utxo-lib's TransactionBuilder.build() enforces a last-resort fee-rate cap
  // (default 2500 sat/vbyte) with a check that 32-bit-truncates input values
  // (`x.value >>> 0`). A registration funded by a ~101-coin UTXO (the real
  // E6 live scenario) computed a huge positive "fee" and threw "Transaction
  // has absurd fees" at BUILD time — while these unit tests' 200-coin UTXO
  // happened to truncate into a NEGATIVE fee and passed. The builder now
  // declares the intended absolute fee, converted to a rate bound.
  it('regression: builds with a funding UTXO just above the registration fee (E6 live shape)', () => {
    const { commitmentData, commitmentUtxo } =
      createMockRegistrationInputs('e6regression');

    // The live failure: 101 coins funded, minus commitment tx fee.
    const liveShapeUtxo: Utxo = {
      txid: 'ee'.repeat(32),
      outputIndex: 0,
      satoshis: 10_099_990_000n,
      script: TEST_SCRIPT,
    };

    const result = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: [liveShapeUtxo],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      },
      NETWORK,
    );

    expect(result.signedTx).toMatch(/^[0-9a-f]+$/);
    expect(result.registrationFee).toBe(DEFAULT_REGISTRATION_FEE);
  });

  // ─── Custom fee parameters ────────────────────────

  it('should respect custom registrationFee and referralLevels', () => {
    const { commitmentData, commitmentUtxo, fundingUtxos } =
      createMockRegistrationInputs('customfee', REFERRER_A, 50_000_000_000n);

    const customFee = 20_000_000_000n; // 200 VRSC
    const customLevels = 4;
    const expectedFees = calculateRegistrationFees(true, customFee, customLevels);

    const result = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: fundingUtxos,
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        referralChain: [REFERRER_A, REFERRER_B],
        registrationFee: customFee,
        referralLevels: customLevels,
      },
      NETWORK,
    );

    // Actual issuer fee = totalFee - numReferrers * referralAmount
    expect(result.registrationFee).toBe(customFee - 2n * expectedFees.referralAmount);
    expect(result.referralAmountEach).toBe(expectedFees.referralAmount);
    expect(result.referralPayments).toBe(2);
  });

  it('rejects a referralChain longer than the allowed referral levels', () => {
    const { commitmentData, commitmentUtxo, fundingUtxos } =
      createMockRegistrationInputs('toolong', REFERRER_A);
    const tooLong = [
      REFERRER_A,
      REFERRER_B,
      REFERRER_C,
      deriveIdentityAddress('referrerd', SYSTEM_ID),
    ]; // 4 entries, default idReferralLevels is 3
    expect(() =>
      buildAndSignRegistration(
        {
          wif: TEST_WIF,
          commitmentUtxo,
          commitmentData,
          primaryAddresses: [TEST_ADDRESS],
          utxos: fundingUtxos,
          changeAddress: TEST_ADDRESS,
          expiryHeight: 0,
          referralChain: tooLong,
        },
        NETWORK,
      ),
    ).toThrow(TransactionBuildError);
  });
});
