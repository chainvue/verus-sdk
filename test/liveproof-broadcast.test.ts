/**
 * Ring 3 — the FINAL acceptance proof: a real VRSCTEST daemon must accept
 * (mempool + sign-check) a transaction this SDK built and signed offline.
 * Rings 1/2 proved the wire format; only a funded `sendrawtransaction`
 * proves the SIGNATURES.
 *
 * Flow (fully self-contained, dust amounts):
 *   1. generate a fresh local keypair (the SDK's own keys module),
 *   2. fund it from the node wallet (`sendtoaddress`), wait 1 confirmation,
 *   3. fetch its UTXOs via `getaddressutxos`,
 *   4. build+sign a sweep back to the node wallet OFFLINE with the SDK,
 *   5. `sendrawtransaction` — acceptance IS the proof,
 *   6. verify the tx is known to the daemon (`getrawtransaction`).
 *
 * Gated twice: VERUS_RPC_URL/USER/PASS (a reachable funded node) AND
 * SDK_ALLOW_SPEND=1 (this moves real testnet coin). Never runs in CI.
 */
import { describe, expect, it } from 'vitest';
import { generateWif, wifToAddress } from '../src/keys/index.js';
import { transfer } from '../src/transfer/index.js';
import type { Utxo } from '../src/types/index.js';

const RPC_URL = process.env['VERUS_RPC_URL'];
const RPC_USER = process.env['VERUS_RPC_USER'];
const RPC_PASS = process.env['VERUS_RPC_PASS'];
const ALLOW_SPEND = process.env['SDK_ALLOW_SPEND'] === '1';

const enabled = Boolean(RPC_URL && RPC_USER && RPC_PASS && ALLOW_SPEND);

const FUNDING_COINS = 0.05;
const FUNDING_SATS = 5_000_000;

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(RPC_URL!, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64'),
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'ring3', method, params }),
  });
  const body = (await response.json()) as {
    result: unknown;
    error: { code: number; message: string } | null;
  };
  if (body.error) {
    throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  }
  return body.result;
}

async function waitForConfirmation(txid: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const tx = (await rpc('gettransaction', [txid])) as { confirmations: number };
    if (tx.confirmations >= 1) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`funding tx ${txid} unconfirmed after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

describe.skipIf(!enabled)('ring 3: funded broadcast acceptance (VRSCTEST, SPENDS DUST)', () => {
  it(
    'daemon ACCEPTS an SDK-built, offline-signed sweep',
    { timeout: 300_000 },
    async () => {
      // 1. Fresh local key — the daemon has never seen it and cannot help sign.
      const probeWif = generateWif();
      const probeAddress = await wifToAddress(probeWif);

      // 2. Fund it and wait for one confirmation (~1 block).
      const fundingTxid = (await rpc('sendtoaddress', [probeAddress, FUNDING_COINS])) as string;
      expect(fundingTxid).toMatch(/^[0-9a-f]{64}$/);
      await waitForConfirmation(fundingTxid, 240_000);

      // 3. The probe's UTXOs, as any lite client would fetch them.
      const rawUtxos = (await rpc('getaddressutxos', [{ addresses: [probeAddress] }])) as Array<{
        txid: string;
        outputIndex: number;
        script: string;
        satoshis: number;
      }>;
      expect(rawUtxos.length).toBeGreaterThan(0);
      const utxos: Utxo[] = rawUtxos.map((u) => ({
        txid: u.txid,
        outputIndex: u.outputIndex,
        satoshis: u.satoshis,
        script: u.script,
      }));
      const totalIn = utxos.reduce((acc, u) => acc + u.satoshis, 0);
      expect(totalIn).toBe(FUNDING_SATS);

      // 4. Build + sign OFFLINE: sweep everything (minus fee) back to the node.
      const nodeAddress = (await rpc('getnewaddress', [])) as string;
      const fee = 10_000;
      const result = transfer(
        {
          wif: probeWif,
          to: nodeAddress,
          amount: totalIn - fee,
          utxos,
          changeAddress: probeAddress,
          fee,
        },
        'testnet',
      );

      // 5. THE proof: the daemon accepts the raw bytes into its mempool —
      // this validates scripts and signatures, not just serialization.
      const acceptedTxid = (await rpc('sendrawtransaction', [result.signedTx])) as string;
      expect(acceptedTxid).toBe(result.txid);

      // 6. The daemon serves it back.
      const known = (await rpc('getrawtransaction', [acceptedTxid, 1])) as {
        txid: string;
        vout: Array<{ valueSat: number }>;
      };
      expect(known.txid).toBe(result.txid);
      const outSum = known.vout.reduce((acc, o) => acc + o.valueSat, 0);
      expect(outSum + fee).toBe(totalIn);
    },
  );
});
