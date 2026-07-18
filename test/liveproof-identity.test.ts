/**
 * Live-proof harness, identity tx types (P1 increment 2) — same rings as
 * test/liveproof.test.ts: Ring 1 = utxo-lib decode round-trip, Ring 2
 * (SDK_PUBLIC_DECODE=1) = the real daemon decodes each tx via the public
 * testnet node and must agree on the txid.
 *
 * Covers the flagged suspect explicitly: sub-ID registration bundles
 * native change onto the token-change smart output
 * (`_buildSubIdRegistration`) — ring 2 is the authority on whether that
 * output shape is daemon-parseable.
 */
import { describe, expect, it } from 'vitest';
import { Transaction, networks } from '@bitgo/utxo-lib';
import {
  buildAndSignCommitment,
  buildAndSignRegistration,
  buildAndSignIdentityUpdate,
  buildTokenChangeOutput,
  deriveIdentityAddress,
  prepareNameCommitment,
} from '../src/identity/index.js';
import { addressToScriptPubKey } from '../src/utils/index.js';
import type { CommitmentData, Utxo } from '../src/types/index.js';
import {
  TEST_WIF,
  TEST_ADDRESS,
  TEST_ADDRESS_B,
  NETWORK,
  VRSCTEST_SYSTEM_ID,
  makeFundingUtxo,
  createMockIdentityHex,
} from './fixtures/index.js';

const TEST_SCRIPT = addressToScriptPubKey(TEST_ADDRESS).toString('hex');

interface Scenario {
  name: string;
  signedTx: string;
  txid: string;
  fee: bigint;
  /** Native satoshis entering the tx (all inputs). */
  inputTotal: bigint;
  inputCount: number;
  /**
   * Native satoshis deliberately left unclaimed (implicit burn). Root
   * identity registration burns the full fee without referral, or the
   * issuer portion (fee minus referral payouts) with one. Observed SDK
   * behavior, protocol-plausible; ring 3 (funded acceptance) is the
   * final authority.
   */
  expectedBurnSats: bigint;
}

function registrationInputs(name: string, parent?: string) {
  const commitment = prepareNameCommitment(name, TEST_ADDRESS, undefined, parent, NETWORK);
  const commitmentData: CommitmentData = {
    name,
    salt: commitment.salt.toString('hex'),
    referral: null,
    parent: parent ?? null,
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

function buildScenarios(): Scenario[] {
  const scenarios: Scenario[] = [];

  {
    const inputTotal = 100_000_000n;
    const r = buildAndSignCommitment(
      {
        wif: TEST_WIF,
        name: 'proofcommit',
        utxos: [makeFundingUtxo('aa', inputTotal)],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      },
      NETWORK,
    );
    scenarios.push({
      name: 'name commitment',
      signedTx: r.signedTx,
      txid: r.txid,
      fee: r.fee,
      inputTotal,
      inputCount: 1,
      expectedBurnSats: 0n,
    });
  }

  {
    const inputTotal = 20_000_000_000n; // 200 VRSC covers the registration fee
    const { commitmentData, commitmentUtxo } = registrationInputs('proofreg');
    const r = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: [{ txid: 'bb'.repeat(32), outputIndex: 0, satoshis: inputTotal, script: TEST_SCRIPT }],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      },
      NETWORK,
    );
    scenarios.push({
      name: 'identity registration (root, no referral)',
      signedTx: r.signedTx,
      txid: r.txid,
      fee: r.fee,
      inputTotal, // commitment input carries 0 sats
      inputCount: 2,
      expectedBurnSats: 10_000_000_000n, // full fee burned, no referral
    });
  }

  {
    const inputTotal = 20_000_000_000n;
    const referrer = deriveIdentityAddress('proofreferrer', VRSCTEST_SYSTEM_ID);
    const commitment = prepareNameCommitment('proofrefreg', TEST_ADDRESS, referrer, undefined, NETWORK);
    const commitmentData: CommitmentData = {
      name: 'proofrefreg',
      salt: commitment.salt.toString('hex'),
      referral: referrer,
      parent: null,
      namereservationHex: commitment.serializedReservation.toString('hex'),
      commitmentHash: commitment.commitmentHash.toString('hex'),
    };
    const r = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo: {
          txid: 'aa'.repeat(32),
          outputIndex: 0,
          satoshis: 0n,
          script: commitment.commitmentScript.toString('hex'),
        },
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: [{ txid: 'bb'.repeat(32), outputIndex: 0, satoshis: inputTotal, script: TEST_SCRIPT }],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        referralChain: [referrer],
      },
      NETWORK,
    );
    scenarios.push({
      name: 'identity registration (1 referral)',
      signedTx: r.signedTx,
      txid: r.txid,
      fee: r.fee,
      inputTotal,
      inputCount: 2,
      // Registrant funds the issuer fee (80 VRSC): 20 to the referrer, 60 burned
      // to the miner. Verified live on VRSCTEST (inputs 80, referral 20, fee 60).
      expectedBurnSats: 6_000_000_000n,
    });
  }

  {
    // THE SUSPECT: sub-ID registration under a currency parent. Fee paid in
    // parent currency from a token-bearing UTXO; native change rides on the
    // token-change output.
    const parent = deriveIdentityAddress('pecu', VRSCTEST_SYSTEM_ID);
    const { commitmentData, commitmentUtxo } = registrationInputs('agentone', parent);
    const tokenScript = buildTokenChangeOutput(
      TEST_ADDRESS,
      new Map([[parent, 150_000_000n]]),
    );
    const nativeIn = 50_000_000n;
    const r = buildAndSignRegistration(
      {
        wif: TEST_WIF,
        commitmentUtxo,
        commitmentData,
        primaryAddresses: [TEST_ADDRESS],
        utxos: [
          { txid: 'bb'.repeat(32), outputIndex: 0, satoshis: nativeIn, script: TEST_SCRIPT },
          {
            txid: 'cc'.repeat(32),
            outputIndex: 0,
            satoshis: tokenScript.nativeValue,
            script: tokenScript.script.toString('hex'),
          },
        ],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        registrationFeeAmount: 100_000_000n, // 1.0 of the parent currency
      },
      NETWORK,
    );
    scenarios.push({
      name: 'sub-ID registration (token fee + bundled change) — SUSPECT',
      signedTx: r.signedTx,
      txid: r.txid,
      fee: r.fee,
      inputTotal: nativeIn + tokenScript.nativeValue,
      inputCount: 3,
      expectedBurnSats: 0n, // fee travels in parent currency, not native
    });
  }

  {
    const mock = createMockIdentityHex({ name: 'proofupd' });
    const fundingTotal = 100_000_000n;
    const r = buildAndSignIdentityUpdate(
      {
        wif: TEST_WIF,
        identityHex: mock.identityHex,
        identityUtxo: mock.identityUtxo,
        utxos: [makeFundingUtxo('aa', fundingTotal)],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        primaryAddresses: [TEST_ADDRESS_B],
      },
      NETWORK,
      'update',
    );
    scenarios.push({
      name: 'identity update (rotate primary address)',
      signedTx: r.signedTx,
      txid: r.txid,
      fee: r.fee,
      inputTotal: fundingTotal + mock.identityUtxo.satoshis,
      inputCount: 2,
      expectedBurnSats: 0n,
    });
  }

  {
    const mock = createMockIdentityHex({ name: 'proofrevoke' });
    const fundingTotal = 100_000_000n;
    const r = buildAndSignIdentityUpdate(
      {
        wif: TEST_WIF,
        identityHex: mock.identityHex,
        identityUtxo: mock.identityUtxo,
        utxos: [makeFundingUtxo('aa', fundingTotal)],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      },
      NETWORK,
      'revoke',
    );
    scenarios.push({
      name: 'identity revoke',
      signedTx: r.signedTx,
      txid: r.txid,
      fee: r.fee,
      inputTotal: fundingTotal + mock.identityUtxo.satoshis,
      inputCount: 2,
      expectedBurnSats: 0n,
    });
  }

  {
    const mock = createMockIdentityHex({ name: 'proofrecover' });
    const fundingTotal = 100_000_000n;
    const r = buildAndSignIdentityUpdate(
      {
        wif: TEST_WIF,
        identityHex: mock.identityHex,
        identityUtxo: mock.identityUtxo,
        utxos: [makeFundingUtxo('aa', fundingTotal)],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
        primaryAddresses: [TEST_ADDRESS_B],
      },
      NETWORK,
      'recover',
    );
    scenarios.push({
      name: 'identity recover (fresh primary)',
      signedTx: r.signedTx,
      txid: r.txid,
      fee: r.fee,
      inputTotal: fundingTotal + mock.identityUtxo.satoshis,
      inputCount: 2,
      expectedBurnSats: 0n,
    });
  }

  return scenarios;
}

const scenarios = buildScenarios();

// ─── Ring 1: offline decode round-trip ───────────────────────────────────

describe('ring 1 (identity): utxo-lib decode round-trip', () => {
  for (const s of scenarios) {
    describe(s.name, () => {
      const tx = Transaction.fromHex(s.signedTx, networks.verustest);

      it('re-decodes and the txid is stable', () => {
        expect(tx.getId()).toBe(s.txid);
      });

      it('consumes the expected inputs', () => {
        expect(tx.ins.length).toBe(s.inputCount);
      });

      it('conserves native value: inputs = outputs + fee + burn', () => {
        const outSum = tx.outs.reduce((acc: bigint, o: { value: number }) => acc + BigInt(o.value), 0n);
        expect(outSum + s.fee + s.expectedBurnSats).toBe(s.inputTotal);
      });
    });
  }
});

// ─── Ring 2: real daemon decode via public testnet node ──────────────────

async function daemonDecode(
  hex: string,
): Promise<{ txid: string; vin: unknown[]; vout: { valueSat: number }[] }> {
  const response = await fetch('https://api.verustest.net', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '1.0',
      id: 'liveproof-identity',
      method: 'decoderawtransaction',
      params: [hex],
    }),
  });
  const body = (await response.json()) as {
    result: { txid: string; vin: unknown[]; vout: { valueSat: number }[] } | null;
    error: { code: number; message: string } | null;
  };
  if (body.error) {
    throw new Error(`daemon rejected decode: ${body.error.code} ${body.error.message}`);
  }
  if (!body.result) throw new Error('daemon returned no result');
  return body.result;
}

describe.skipIf(process.env['SDK_PUBLIC_DECODE'] !== '1')(
  'ring 2 (identity): public testnet daemon decoderawtransaction',
  () => {
    for (const s of scenarios) {
      it(`daemon decodes "${s.name}" and agrees on the txid`, async () => {
        const decoded = await daemonDecode(s.signedTx);
        expect(decoded.txid).toBe(s.txid);
        expect(decoded.vin.length).toBe(s.inputCount);

        const voutSum = decoded.vout.reduce((acc, o) => acc + BigInt(o.valueSat), 0n);
        expect(voutSum + s.fee + s.expectedBurnSats).toBe(s.inputTotal);
      });
    }
  },
);
