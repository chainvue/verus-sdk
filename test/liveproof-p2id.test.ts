/**
 * Ring 4 — identity-held funds (P2ID): a real daemon must accept an
 * offline-signed spend of a UTXO held BY A VERUSID (CC EVAL_NONE 1-of-1 to
 * an IdentityID destination), signed with the identity's primary key.
 * This is the input type behind "the agent spends from its identity" —
 * script/signature validation happens at mempool acceptance, so acceptance
 * IS the consensus proof that utxo-lib's smart-tx identity signing is valid.
 *
 * Flow (dust amounts; the identity is a PERSISTENT test fixture):
 *   1. fund the identity's i-address from the node wallet, wait 1 conf,
 *   2. fetch the i-address UTXOs (`getaddressutxos` serves identities too),
 *   3. build+sign a sweep to the primary R-address OFFLINE with the SDK
 *      (the P2ID prevout script comes from the chain, not from us),
 *   4. broadcast through the PUBLIC gateway — daemon-free like Peculium,
 *   5. verify the tx is served back.
 *
 * Fixture: a VRSCTEST identity whose primary key we keep (SDK_P2ID_* in the
 * gitignored .env; registered once via Peculium's provisioning flow, cold
 * revocation/recovery). Gates: SDK_LIVE_P2ID=1 + the fixture env vars +
 * VERUS_RPC_URL/USER/PASS (funding only). Never runs in CI.
 */
import { describe, expect, it } from 'vitest';
import { transfer } from '../src/transfer/index.js';
import type { Utxo } from '../src/types/index.js';

const RPC_URL = process.env['VERUS_RPC_URL'];
const RPC_USER = process.env['VERUS_RPC_USER'];
const RPC_PASS = process.env['VERUS_RPC_PASS'];
const PUBLIC_URL = process.env['SDK_PUBLIC_NODE_URL'] ?? 'https://api.verustest.net';

const ID_NAME = process.env['SDK_P2ID_ID_NAME'];
const ID_ADDRESS = process.env['SDK_P2ID_ID_ADDRESS'];
const PRIMARY_ADDRESS = process.env['SDK_P2ID_PRIMARY_ADDRESS'];
const ID_WIF = process.env['SDK_P2ID_WIF'];

const enabled = Boolean(
  process.env['SDK_LIVE_P2ID'] === '1' &&
    RPC_URL &&
    RPC_USER &&
    RPC_PASS &&
    ID_NAME &&
    ID_ADDRESS &&
    PRIMARY_ADDRESS &&
    ID_WIF,
);

const FUNDING_COINS = 0.05;
const FUNDING_SATS = 5_000_000n;

async function lanRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(RPC_URL!, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64'),
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'ring4', method, params }),
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

async function publicRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(PUBLIC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'ring4', method, params }),
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
    try {
      const tx = (await publicRpc('getrawtransaction', [txid, 1])) as {
        confirmations?: number;
      };
      if ((tx.confirmations ?? 0) >= 1) {
        return;
      }
    } catch {
      // not indexed yet
    }
    if (Date.now() > deadline) {
      throw new Error(`tx ${txid} unconfirmed after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

describe.skipIf(!enabled)('ring 4: P2ID spend acceptance (VRSCTEST, SPENDS DUST)', () => {
  it(
    'daemon ACCEPTS an offline-signed spend of identity-held funds',
    { timeout: 420_000 },
    async () => {
      // 1. Put funds ON the identity (the wallet resolves the i-address).
      const fundingTxid = (await lanRpc('sendtoaddress', [ID_ADDRESS, FUNDING_COINS])) as string;
      expect(fundingTxid).toMatch(/^[0-9a-f]{64}$/);
      await waitForConfirmation(fundingTxid, 300_000);

      // 2. The identity's UTXOs, as any lite client sees them — the P2ID
      // prevout scripts come from the chain itself.
      const rawUtxos = (await publicRpc('getaddressutxos', [
        { addresses: [ID_ADDRESS] },
      ])) as Array<{ txid: string; outputIndex: number; script: string; satoshis: number }>;
      const utxos: Utxo[] = rawUtxos
        .filter((u) => u.satoshis > 0)
        .map((u) => ({
          txid: u.txid,
          outputIndex: u.outputIndex,
          satoshis: BigInt(u.satoshis),
          script: u.script,
        }));
      const totalIn = utxos.reduce((acc, u) => acc + u.satoshis, 0n);
      expect(totalIn).toBeGreaterThanOrEqual(FUNDING_SATS);

      // 3. Build + sign OFFLINE with the identity's primary key: sweep the
      // identity-held funds to the primary R-address.
      const fee = 10_000n;
      const result = transfer(
        {
          wif: ID_WIF!,
          to: PRIMARY_ADDRESS!,
          amount: totalIn - fee,
          utxos,
          changeAddress: PRIMARY_ADDRESS!,
          fee,
        },
        'testnet',
      );

      // 4. THE proof: the PUBLIC gateway accepts the identity-spend
      // signature into the network mempool.
      const acceptedTxid = (await publicRpc('sendrawtransaction', [result.signedTx])) as string;
      expect(acceptedTxid).toBe(result.txid);

      // 5. Served back by the public node.
      const known = (await publicRpc('getrawtransaction', [acceptedTxid, 1])) as {
        txid: string;
        vout: Array<{ valueSat: number }>;
      };
      expect(known.txid).toBe(result.txid);
      const outSum = known.vout.reduce((acc, o) => acc + BigInt(o.valueSat), 0n);
      expect(outSum + fee).toBe(totalIn);

      console.log(
        `[ring4] P2ID spend accepted: ${ID_NAME} (${ID_ADDRESS}) → ${PRIMARY_ADDRESS}, tx ${acceptedTxid.slice(0, 16)}…`,
      );
    },
  );
});
