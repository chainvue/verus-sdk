/**
 * The daemon's miner-fee rule (src/fee/index.ts).
 *
 * These tests pin the three things VerusCoin actually charges for — the number
 * of non-change outputs, an output script over MAX_SCRIPT_ELEMENT_SIZE/3, and
 * the serialized size of an identity's contentMultiMap — and pin the three
 * things it does NOT charge for: transaction bytes, input count, and whether an
 * output is a CryptoCondition script.
 *
 * They replace `test/utxo.test.ts`'s old `estimateFee` block, whose assertions
 * (fee rises with inputs; a smart output costs more than a P2PKH; +5000 bytes
 * buys >= +45,000 sat) were all false statements about the daemon. The old
 * numbers are recorded inline where a test supersedes one.
 */
import { describe, it, expect } from 'vitest';
import pkg from 'verus-typescript-primitives';
import {
  estimateMinerFee,
  relayMinimumFee,
  assertFeeMeetsRelayMinimum,
  computeIdentityFeeFactor,
  LARGE_SCRIPT_FEE_THRESHOLD,
} from '../src/fee/index.js';
import { DEFAULT_TRANSACTION_FEE } from '../src/constants/index.js';
import { TransactionBuildError } from '../src/errors.js';
import {
  buildIdentityScript,
  buildTokenChangeOutput,
  createIdentityObject,
  deriveIdentityAddress,
  buildAndSignIdentityUpdate,
} from '../src/identity/index.js';
import { buildMultisigIdentityUpdate } from '../src/identity/multisig.js';
import { sendCurrency } from '../src/transfer/index.js';
import { Transaction } from '../src/fork/boundary.js';
import { getNetwork } from '../src/signing/index.js';
import { parseAddress, parseIAddress, parseRAddress } from '../src/core/brands.js';
import { addressToScriptPubKey } from '../src/utils/index.js';
import {
  TEST_WIF,
  TEST_ADDRESS,
  TEST_ADDRESS_B,
  NETWORK,
  VRSCTEST_SYSTEM_ID,
  makeFundingUtxo,
  createMockIdentityHex,
} from './fixtures/index.js';

const { ContentMultiMap } = pkg;
const net = getNetwork(true);
const P2PKH = addressToScriptPubKey(TEST_ADDRESS);
const TOKEN = deriveIdentityAddress('feetoken', VRSCTEST_SYSTEM_ID);
/** A real reserve-output (CryptoCondition) scriptPubKey, ~82 bytes. */
const RESERVE_OUT = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[TOKEN, 1_000_000n]])).script;

/** An output script of an exact byte length, for the surcharge boundary. */
const scriptOfLength = (n: number): Buffer => Buffer.alloc(n, 0x51);

describe('estimateMinerFee — the daemon charges per OUTPUT', () => {
  it('is DEFAULT_TRANSACTION_FEE per non-change output', () => {
    // pbaasrpc.cpp:10769-10772 — base 10000 plus 10000 for every recipient
    // output beyond the first. Confirmed on VRSC mainnet: txid 5e8d94dd72f64a5e\
    // 59eb0158138c9e11209d74a423cf295a2171b7ee0ec3422a, 1 input, 17 vouts (16
    // recipients + 1 change), 755 bytes, fee 160,000 = 10,000 + 15 × 10,000.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(estimateMinerFee(Array.from({ length: n }, () => P2PKH))).toBe(BigInt(n) * DEFAULT_TRANSACTION_FEE);
    }
  });

  it('does not depend on whether an output is a CryptoCondition script', () => {
    // WAS: `should use larger output size for smart outputs` —
    // estimateFee(5, 5, undefined, true) > estimateFee(5, 5, undefined, false),
    // i.e. 200 bytes per smart output vs 34 per P2PKH (19,600 vs 11,300). Below
    // the 2000-byte threshold the daemon prices outputs by COUNT alone. Measured
    // on VRSC: two 2-vout transactions of 416 B (1 input, reservetransfer) and
    // 2,625 B (14 inputs, reserveoutput) both paid exactly 10,000.
    const p2pkh = Array.from({ length: 5 }, () => P2PKH);
    const smart = Array.from({ length: 5 }, () => RESERVE_OUT);
    expect(RESERVE_OUT.length).toBeGreaterThan(P2PKH.length);
    expect(estimateMinerFee(smart)).toBe(estimateMinerFee(p2pkh));
    expect(estimateMinerFee(smart)).toBe(50_000n);
  });

  it('charges one extra fee for an output script over 2000 bytes, two over 4000', () => {
    // WAS: `scales the fee with pre-built output bytes` — 5000 extra bytes had
    // to buy >= 45,000 sat at DEFAULT_FEE_PER_KB. The daemon's only per-output
    // size term is a two-step surcharge at MAX_SCRIPT_ELEMENT_SIZE/3 and twice
    // that (reserves.cpp:7959-7981, pbaasrpc.cpp:10786-10812). Boundary fixtures:
    expect(LARGE_SCRIPT_FEE_THRESHOLD).toBe(2000);
    expect(estimateMinerFee([scriptOfLength(2000)])).toBe(10_000n);
    expect(estimateMinerFee([scriptOfLength(2001)])).toBe(20_000n);
    expect(estimateMinerFee([scriptOfLength(4000)])).toBe(20_000n);
    expect(estimateMinerFee([scriptOfLength(4001)])).toBe(30_000n);
    // …and it is per OUTPUT, not per transaction.
    expect(estimateMinerFee([scriptOfLength(2001), scriptOfLength(2001)])).toBe(40_000n);
  });
});

// ─── identityFeeFactor ───────────────────────────────────

/**
 * An identity output whose contentMultiMap holds one key with one value of
 * `valueBytes` bytes. Its serialized contentMultiMap is
 *   1 (map size) + 20 (key) + 1 (array length) + varuint(valueBytes) + valueBytes
 * and the daemon's `serSize` is that minus the 1 byte an EMPTY map serializes to
 * (main.cpp:2218-2222), i.e. 21 + varuint(valueBytes) + valueBytes.
 */
function identityWithContent(name: string, valueBytes: number, primaries: string[] = [TEST_ADDRESS]) {
  const iaddr = deriveIdentityAddress(name, VRSCTEST_SYSTEM_ID);
  const identity = createIdentityObject({
    name,
    primaryAddresses: primaries.map((a) => parseRAddress(a)),
    revocationAuthority: parseIAddress(iaddr),
    recoveryAuthority: parseIAddress(iaddr),
    parentIAddress: parseIAddress(VRSCTEST_SYSTEM_ID),
    systemId: parseIAddress(VRSCTEST_SYSTEM_ID),
  });
  identity.content_multimap = ContentMultiMap.fromJson({
    [deriveIdentityAddress(name + 'key', VRSCTEST_SYSTEM_ID)]: ['ab'.repeat(valueBytes)],
  });
  return { identity, script: buildIdentityScript(identity) };
}

describe('computeIdentityFeeFactor — content costs 10_000 per 128 serialized bytes', () => {
  it('is 0 for a plain single-primary identity and for a non-identity output', () => {
    const { identityScript } = createMockIdentityHex({ name: 'feeplain' });
    expect(computeIdentityFeeFactor([identityScript])).toBe(0);
    expect(computeIdentityFeeFactor([P2PKH, RESERVE_OUT])).toBe(0);
    expect(estimateMinerFee([identityScript])).toBe(10_000n);
  });

  it('counts extra primary addresses and contentMap entries', () => {
    // main.cpp:2231-2233. A 2-primary identity is factor 1 → 10,000; the extra
    // primary is why a multisig identity costs more than a single-key one.
    const iaddr = deriveIdentityAddress('feetwoprim', VRSCTEST_SYSTEM_ID);
    const id = createIdentityObject({
      name: 'feetwoprim',
      primaryAddresses: [parseRAddress(TEST_ADDRESS), parseRAddress(TEST_ADDRESS_B)],
      revocationAuthority: parseIAddress(iaddr),
      recoveryAuthority: parseIAddress(iaddr),
      parentIAddress: parseIAddress(VRSCTEST_SYSTEM_ID),
      systemId: parseIAddress(VRSCTEST_SYSTEM_ID),
    });
    expect(computeIdentityFeeFactor([buildIdentityScript(id)])).toBe(1);
    id.content_map.set(deriveIdentityAddress('feecmkey', VRSCTEST_SYSTEM_ID), Buffer.alloc(32, 7));
    expect(computeIdentityFeeFactor([buildIdentityScript(id)])).toBe(2);
  });

  it('charges ceil(contentMultiMap bytes / 128) — with the 128-byte boundary pinned', () => {
    // serSize = 21 + varuint(valueBytes) + valueBytes; varuint is 3 bytes above
    // 252. valueBytes 1640 → serSize 1664 = 13 × 128 exactly; 1641 → 1665 → 14.
    expect(computeIdentityFeeFactor([identityWithContent('feecmmA', 1640).script])).toBe(13);
    expect(computeIdentityFeeFactor([identityWithContent('feecmmB', 1641).script])).toBe(14);
    // The reported real-world shape: a ~1.6 KB contentMultiMap costs 130,000,
    // where the old byte estimate charged 25,960.
    expect(estimateMinerFee([identityWithContent('feecmmC', 1600).script])).toBe(130_000n);
  });

  it('sums the factor over every identity output in the set', () => {
    const a = identityWithContent('feesumA', 1640).script; // 13
    const b = identityWithContent('feesumB', 1641).script; // 14
    expect(computeIdentityFeeFactor([a, b])).toBe(27);
  });
});

// ─── the mempool floor ───────────────────────────────────

describe('relayMinimumFee — the acceptance floor, and the tripwire', () => {
  it('allows three outputs where the sender rule allows one', () => {
    // reserves.cpp:7943 (`vout.size() > 3 + idExtraLimit`) vs pbaasrpc.cpp:10769
    // (`tOutputs.size() > 1 + idExtraLimit`). Boundary at 3 → 4 vouts:
    expect(relayMinimumFee(Array.from({ length: 3 }, () => P2PKH))).toBe(10_000n);
    expect(relayMinimumFee(Array.from({ length: 4 }, () => P2PKH))).toBe(20_000n);
  });

  it('is never above what estimateMinerFee pays, for every change count the SDK emits', () => {
    // The SDK emits at most 2 change outputs, so max(D + C - 3, 0) <= max(D - 1, 0).
    for (let declared = 1; declared <= 6; declared++) {
      const declaredScripts = Array.from({ length: declared }, () => P2PKH);
      for (let change = 0; change <= 2; change++) {
        const finalScripts = [...declaredScripts, ...Array.from({ length: change }, () => P2PKH)];
        expect(estimateMinerFee(declaredScripts)).toBeGreaterThanOrEqual(relayMinimumFee(finalScripts));
      }
    }
  });

  it('throws rather than hand back an underpaying transaction (oversized change)', () => {
    // The one shape that can defeat the construction above: a token-change
    // reserve output over the 2000-byte threshold, which cannot be known before
    // selection. Fail closed with a typed error instead of relying on the
    // daemon's free-transaction rate limiter (main.cpp:2296-2317).
    const declared = [P2PKH];
    const fee = estimateMinerFee(declared); // 10_000
    const finalOuts = [...declared, scriptOfLength(2001)];
    expect(relayMinimumFee(finalOuts)).toBe(20_000n);
    expect(() => assertFeeMeetsRelayMinimum(fee, finalOuts, 'oversized-change')).toThrow(TransactionBuildError);
    expect(() => assertFeeMeetsRelayMinimum(fee, finalOuts, 'oversized-change')).toThrow(
      /miner fee 10000 is below the daemon's relay minimum 20000/,
    );
    // …and it passes once the fee covers the surcharge.
    expect(() => assertFeeMeetsRelayMinimum(20_000n, finalOuts, 'oversized-change')).not.toThrow();
  });
});

// ─── the regression this change exists for ────────────────

describe('every build path clears the daemon relay minimum', () => {
  const finalOutScripts = (signedTx: string): Buffer[] =>
    Transaction.fromHex(signedTx, net).outs.map((o: { script: Buffer }) => o.script);

  /** Each row: label, a thunk building the tx, and the fee the daemon's rule requires. */
  const rows: Array<[string, () => { signedTx: string; fee: bigint }, bigint]> = [];

  const nativeSend = (n: number) => () =>
    sendCurrency(
      {
        wif: TEST_WIF,
        outputs: Array.from({ length: n }, () => ({ currency: VRSCTEST_SYSTEM_ID, satoshis: 100_000n, address: TEST_ADDRESS })),
        utxos: [makeFundingUtxo('aa', 100_000_000n)],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 0,
      },
      NETWORK,
    );

  // On main these paid 10,000 (native ×3 and ×5 never left the MIN_FEE floor)
  // and 14,200 (token ×3), against daemon minima of 20,000 / 40,000 / 30,000.
  rows.push(['sendCurrency native ×3', nativeSend(3), 30_000n]);
  rows.push(['sendCurrency native ×5', nativeSend(5), 50_000n]);

  const tokenScript = buildTokenChangeOutput(parseAddress(TEST_ADDRESS), new Map([[TOKEN, 900_000_000n]])).script;
  rows.push([
    'sendCurrency token ×3',
    () =>
      sendCurrency(
        {
          wif: TEST_WIF,
          outputs: Array.from({ length: 3 }, () => ({ currency: TOKEN, satoshis: 100_000_000n, address: TEST_ADDRESS })),
          utxos: [
            makeFundingUtxo('aa', 100_000_000n),
            { txid: 'bb'.repeat(32), outputIndex: 0, satoshis: 0n, script: tokenScript.toString('hex') },
          ],
          changeAddress: TEST_ADDRESS,
          expiryHeight: 0,
        },
        NETWORK,
      ),
    30_000n,
  ]);

  // The case `extraBytes` was written for. On main this paid 25,960 — a ~5×
  // shortfall — because extraBytes tops out at 10 sat/byte where the daemon
  // charges 10,000 per 128 bytes of content (78.1 sat/byte).
  rows.push([
    'identity update, ~1.6 KB contentMultiMap',
    () => {
      const { identity } = identityWithContent('feeupdcmm', 1600);
      const mock = createMockIdentityHex({ name: 'feeupdcmm' });
      return buildAndSignIdentityUpdate(
        {
          wif: TEST_WIF,
          identityHex: mock.identityHex,
          identityUtxo: mock.identityUtxo,
          utxos: [makeFundingUtxo('aa', 100_000_000n)],
          changeAddress: TEST_ADDRESS,
          expiryHeight: 0,
          contentMultimap: identity.content_multimap.toJson() as Record<string, string[]>,
        },
        NETWORK,
        'update',
      );
    },
    130_000n,
  ]);

  for (const [label, build, expected] of rows) {
    it(`${label} pays ${expected} and clears the floor`, () => {
      const built = build();
      expect(built.fee).toBe(expected);
      expect(built.fee).toBeGreaterThanOrEqual(relayMinimumFee(finalOutScripts(built.signedTx)));
    });
  }

  it('multisig identity update prices the identity factor (2 primaries + 1 contentMap key)', () => {
    // On main this paid 12,290 — a byte estimate — against a 20,000 minimum.
    const idJson = {
      version: 3,
      flags: 0,
      primaryaddresses: [TEST_ADDRESS, TEST_ADDRESS_B],
      minimumsignatures: 2,
      name: 'feemsid',
      identityaddress: deriveIdentityAddress('feemsid', VRSCTEST_SYSTEM_ID),
      parent: VRSCTEST_SYSTEM_ID,
      systemid: VRSCTEST_SYSTEM_ID,
      contentmap: { '0000000000000000000000000000000000000001': '00'.repeat(31) + '02' },
      contentmultimap: {},
      revocationauthority: deriveIdentityAddress('feemsid', VRSCTEST_SYSTEM_ID),
      recoveryauthority: deriveIdentityAddress('feemsid', VRSCTEST_SYSTEM_ID),
      timelock: 0,
    };
    const built = buildMultisigIdentityUpdate(
      {
        funderWif: TEST_WIF,
        identityUtxo: { txid: 'ab'.repeat(32), vout: 0, script: 'ff' },
        currentPrimaryAddresses: [TEST_ADDRESS, TEST_ADDRESS_B],
        minSignatures: 2,
        newIdentity: idJson,
        funding: [makeFundingUtxo('bb', 100_000_000n)],
        changeAddress: TEST_ADDRESS,
        expiryHeight: 1_200_000,
      },
      NETWORK,
    );
    const outs = Transaction.fromHex(built.partialTx, net).outs.map((o: { script: Buffer }) => o.script);
    expect(computeIdentityFeeFactor([outs[0]!])).toBe(2);
    expect(relayMinimumFee(outs)).toBe(20_000n);
  });
});
