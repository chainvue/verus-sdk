/**
 * Live-proof harness (P1) — proves the SDK's wire bytes, not just its
 * arithmetic. Three rings:
 *
 *   Ring 1 (always): re-decode every built transaction with utxo-lib
 *     `Transaction.fromHex` and assert structure + value conservation +
 *     txid stability. Catches self-inconsistent serialization.
 *   Ring 2 (SDK_PUBLIC_DECODE=1): feed the same hex to a REAL Verus
 *     daemon via the public testnet node's whitelisted
 *     `decoderawtransaction` — the daemon's parser is the authority.
 *     Asserts the daemon-computed txid equals the SDK-computed txid and
 *     that recipient outputs decode to the expected addresses/amounts.
 *   Ring 3 (VERUS_RPC_URL + SDK_ALLOW_SPEND=1): funded broadcast
 *     acceptance on VRSCTEST — see docs; added once the LAN node harness
 *     account is provisioned.
 *
 * Until Rings 2/3 pass, no consumer (Peculium) may move real value
 * through this SDK. See RISKS notes in the Peculium repo.
 */
import { describe, expect, it } from 'vitest';
import { Transaction, networks } from '@bitgo/utxo-lib';
import { transfer, transferToken, sendCurrency } from '../src/transfer/index.js';
import { addressToScriptPubKey } from '../src/utils/index.js';
import {
  TEST_WIF,
  TEST_ADDRESS,
  TEST_ADDRESS_B,
  NETWORK,
  VRSCTEST_SYSTEM_ID,
  makeFundingUtxo,
} from './fixtures/index.js';

interface ExpectedOutput {
  address: string;
  satoshis: bigint;
}

interface Scenario {
  name: string;
  signedTx: string;
  txid: string;
  fee: bigint;
  inputTotal: bigint;
  inputsUsed: number;
  /** P2PKH outputs the tx must contain with exact values. */
  expectP2pkh: ExpectedOutput[];
  /** Smart/CC outputs (value checked in ring 2 via daemon decode only). */
  hasSmartOutputs: boolean;
}

function buildScenarios(): Scenario[] {
  const scenarios: Scenario[] = [];

  {
    const inputTotal = 100_000_000n;
    const r = transfer(
      {
        wif: TEST_WIF,
        to: TEST_ADDRESS_B,
        amount: 50_000_000n,
        utxos: [makeFundingUtxo('aa', inputTotal)],
        changeAddress: TEST_ADDRESS,
      },
      NETWORK,
    );
    scenarios.push({
      name: 'native transfer with change',
      signedTx: r.signedTx,
      txid: r.txid,
      fee: r.fee,
      inputTotal,
      inputsUsed: r.inputsUsed,
      expectP2pkh: [
        { address: TEST_ADDRESS_B, satoshis: 50_000_000n },
        { address: TEST_ADDRESS, satoshis: r.nativeChange },
      ],
      hasSmartOutputs: false,
    });
  }

  {
    const r = transfer(
      {
        wif: TEST_WIF,
        to: TEST_ADDRESS_B,
        amount: 70_000_000n,
        utxos: [
          makeFundingUtxo('aa', 30_000_000n),
          makeFundingUtxo('bb', 30_000_000n),
          makeFundingUtxo('cc', 30_000_000n),
        ],
        changeAddress: TEST_ADDRESS,
      },
      NETWORK,
    );
    scenarios.push({
      name: 'native transfer, multi-UTXO selection',
      signedTx: r.signedTx,
      txid: r.txid,
      fee: r.fee,
      // selectUtxos may not use all three inputs; recompute what it consumed.
      inputTotal: 70_000_000n + r.fee + r.nativeChange,
      inputsUsed: r.inputsUsed,
      expectP2pkh: [{ address: TEST_ADDRESS_B, satoshis: 70_000_000n }],
      hasSmartOutputs: false,
    });
  }

  {
    const inputTotal = 100_000_000n;
    const r = transferToken(
      {
        wif: TEST_WIF,
        to: TEST_ADDRESS_B,
        amount: 10_000_000n,
        currency: VRSCTEST_SYSTEM_ID,
        utxos: [makeFundingUtxo('aa', inputTotal)],
        changeAddress: TEST_ADDRESS,
      },
      NETWORK,
    );
    scenarios.push({
      name: 'token transfer (smart output)',
      signedTx: r.signedTx,
      txid: r.txid,
      fee: r.fee,
      inputTotal,
      inputsUsed: r.inputsUsed,
      expectP2pkh: [],
      hasSmartOutputs: true,
    });
  }

  {
    const inputTotal = 500_000_000n;
    const r = sendCurrency(
      {
        wif: TEST_WIF,
        outputs: [
          {
            currency: VRSCTEST_SYSTEM_ID,
            satoshis: 100_000_000n,
            address: TEST_ADDRESS_B,
            addressType: 'PKH',
          },
          {
            currency: VRSCTEST_SYSTEM_ID,
            satoshis: 50_000_000n,
            address: TEST_ADDRESS,
            addressType: 'PKH',
          },
        ],
        utxos: [makeFundingUtxo('aa', inputTotal)],
        changeAddress: TEST_ADDRESS,
      },
      NETWORK,
    );
    scenarios.push({
      name: 'sendCurrency multi-output',
      signedTx: r.signedTx,
      txid: r.txid,
      fee: r.fee,
      inputTotal,
      inputsUsed: r.inputsUsed,
      expectP2pkh: [],
      hasSmartOutputs: true,
    });
  }

  return scenarios;
}

const scenarios = buildScenarios();

// ─── Ring 1: offline decode round-trip ───────────────────────────────────

describe('ring 1: utxo-lib decode round-trip', () => {
  for (const s of scenarios) {
    describe(s.name, () => {
      const tx = Transaction.fromHex(s.signedTx, networks.verustest);

      it('re-decodes and the txid is stable', () => {
        expect(tx.getId()).toBe(s.txid);
      });

      it('consumes the expected inputs', () => {
        expect(tx.ins.length).toBe(s.inputsUsed);
      });

      it('conserves value: inputs = outputs + fee', () => {
        const outSum = tx.outs.reduce((acc: bigint, o: { value: number }) => acc + BigInt(o.value), 0n);
        expect(outSum + s.fee).toBe(s.inputTotal);
      });

      it('contains the expected P2PKH outputs with exact values', () => {
        for (const expected of s.expectP2pkh) {
          if (expected.satoshis === 0n) continue; // change absorbed into fee
          const script = addressToScriptPubKey(expected.address).toString('hex');
          const match = tx.outs.find(
            (o: { script: Buffer; value: number }) =>
              o.script.toString('hex') === script && BigInt(o.value) === expected.satoshis,
          );
          expect(match, `${expected.address} @ ${expected.satoshis}`).toBeTruthy();
        }
      });
    });
  }
});

// ─── Ring 2: real daemon decode via public testnet node ──────────────────

interface DaemonVout {
  valueSat: number;
  scriptPubKey: { addresses?: string[]; type: string };
}

async function daemonDecode(hex: string): Promise<{ txid: string; vin: unknown[]; vout: DaemonVout[] }> {
  const response = await fetch('https://api.verustest.net', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '1.0',
      id: 'liveproof',
      method: 'decoderawtransaction',
      params: [hex],
    }),
  });
  const body = (await response.json()) as {
    result: { txid: string; vin: unknown[]; vout: DaemonVout[] } | null;
    error: { code: number; message: string } | null;
  };
  if (body.error) {
    throw new Error(`daemon rejected decode: ${body.error.code} ${body.error.message}`);
  }
  if (!body.result) throw new Error('daemon returned no result');
  return body.result;
}

describe.skipIf(process.env['SDK_PUBLIC_DECODE'] !== '1')(
  'ring 2: public testnet daemon decoderawtransaction',
  () => {
    for (const s of scenarios) {
      it(`daemon decodes "${s.name}" and agrees on the txid`, async () => {
        const decoded = await daemonDecode(s.signedTx);
        expect(decoded.txid).toBe(s.txid);
        expect(decoded.vin.length).toBe(s.inputsUsed);

        const voutSum = decoded.vout.reduce((acc, o) => acc + BigInt(o.valueSat), 0n);
        expect(voutSum + s.fee).toBe(s.inputTotal);

        for (const expected of s.expectP2pkh) {
          if (expected.satoshis === 0n) continue;
          const match = decoded.vout.find(
            (o) =>
              BigInt(o.valueSat) === expected.satoshis &&
              (o.scriptPubKey.addresses ?? []).includes(expected.address),
          );
          expect(match, `${expected.address} @ ${expected.satoshis}`).toBeTruthy();
        }
      });
    }
  },
);
