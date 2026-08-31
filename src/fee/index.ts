/**
 * The daemon's miner-fee rule, ported offline.
 *
 * VerusCoin does NOT price a transaction by its size. There is no byte-rate
 * anywhere on the acceptance path: `AcceptToMemoryPool`'s minimum is
 * `GetMinRelayFeeByOutputs` (VerusCoin src/main.cpp:2270 →
 * src/pbaas/reserves.cpp:7906), which contains no size term at all. The
 * size-based `GetMinRelayFee` survives in exactly one call site, and it is the
 * absurdly-HIGH-fee ceiling (src/main.cpp:2326, inside `if (fRejectAbsurdFee …)`);
 * the `minRelayTxFee` CFeeRate is otherwise only the dust threshold
 * (src/main.cpp:878) and the miner's block-template sort (src/miner.cpp:3309).
 * Measured: VRSC txid 87c5bb69a41d778903b899d8880191ede6e93e9da5c64bc90170bd8265e97150
 * (block 4,163,006) is 185,212 bytes with 1,255 inputs and one output, and paid
 * exactly 10,000 satoshis — 54 sat/kB, under the 100 sat/kB `minRelayTxFee`, and
 * mined.
 *
 * The real rule is per OUTPUT:
 *
 *   fee = 10_000 × (identityFeeFactor or 1)                 // base
 *       + 10_000 × (recipient outputs beyond the first)      // per-output
 *       + 10_000 per output script over 2000 bytes           // large-script
 *         (+10_000 more over 4000 bytes)
 *
 * Two twins implement it. `estimateMinerFee` ports the SENDER side —
 * `GetMinRelayFeeForOutputs` / `GetMinRelayFeeForBuilder`
 * (src/rpc/pbaasrpc.cpp:10732 / :10556), which allow ONE free output and are what
 * the daemon's own wallet pays. `relayMinimumFee` ports the MEMPOOL side —
 * `GetMinRelayFeeByOutputs` (src/pbaas/reserves.cpp:7906), which allows THREE and
 * counts change, and is used here only as a fail-closed postcondition. Paying the
 * stricter sender rule keeps every SDK transaction on the safe side of consensus.
 *
 * Live confirmation of the per-output term: VRSC txid
 * 5e8d94dd72f64a5e59eb0158138c9e11209d74a423cf295a2171b7ee0ec3422a — 1 input,
 * 17 vouts (16 recipients + 1 change back to the input address), 755 bytes, fee
 * 160,000 = 10,000 + 15 × 10,000. No sat/byte rate explains it.
 *
 * All amounts are bigint satoshis.
 */

import { Identity, IdentityScript, EVALS } from '../fork/boundary.js';
import { DEFAULT_TRANSACTION_FEE } from '../constants/index.js';
import { TransactionBuildError } from '../errors.js';

/**
 * The daemon's per-output large-script surcharge threshold:
 * `CScript::MAX_SCRIPT_ELEMENT_SIZE / 3` (src/pbaas/reserves.cpp:7959,
 * src/rpc/pbaasrpc.cpp:10786). `MAX_SCRIPT_ELEMENT_SIZE` is a runtime-mutable
 * static (src/script/script.h:518) set to `MAX_SCRIPT_ELEMENT_SIZE_PBAAS = 6000`
 * once PBaaS activates (src/script/script.h:36, src/main.cpp:3376-3382), so the
 * threshold is 2000 on both live chains. A pre-PBaaS chain would use the SMALLER
 * 3073/1024, i.e. charge the surcharge sooner — this is the one constant to
 * revisit if a non-PBaaS chain is ever targeted.
 */
export const LARGE_SCRIPT_FEE_THRESHOLD = 2000;

/**
 * `idExtraLimit` — the extra free-output allowance the daemon grants a
 * transaction carrying an identity RESERVATION output, worth
 * `parentCurrency.IDReferralLevels() + 2` outputs (src/pbaas/reserves.cpp:7918,
 * src/rpc/pbaasrpc.cpp:10745). Reading `IDReferralLevels()` needs a `getcurrency`
 * call, which this offline SDK cannot make. A GUESSED allowance can only
 * underpay; taking NO allowance can only overpay, so it is fixed at 0 here. The
 * cost is ≤ 0.0003 VRSC of extra miner fee on a registration that already burns
 * 100 VRSC.
 */
const ID_EXTRA_LIMIT = 0;

/**
 * The daemon's per-output surcharge for an oversized script:
 * `minFee += DEFAULT_TRANSACTION_FEE + ((extraSize - extraOutputCostThreshold) > 0 ? DEFAULT_TRANSACTION_FEE : 0)`
 * with `extraSize = max(scriptLen - threshold, 0)` (src/pbaas/reserves.cpp:7980).
 * So: over 2000 bytes costs one extra fee, over 4000 costs two.
 */
function largeScriptSurcharge(scriptLength: number): bigint {
  if (scriptLength > 2 * LARGE_SCRIPT_FEE_THRESHOLD) return 2n * DEFAULT_TRANSACTION_FEE;
  if (scriptLength > LARGE_SCRIPT_FEE_THRESHOLD) return DEFAULT_TRANSACTION_FEE;
  return 0n;
}

/**
 * Parse an EVAL_IDENTITY_PRIMARY output script back into its Identity, or null
 * for any other output. Mirrors the daemon's own walk over `tx.vout`
 * (src/main.cpp:2206-2216): it tests `IsPayToCryptoCondition(p) && p.IsValid() &&
 * p.vData.size() && p.evalCode == EVAL_IDENTITY_PRIMARY`. Anything that is not a
 * smart-transaction script (P2PKH, P2ID, a reserve output, a commitment) fails to
 * unpack and is simply not an identity output — the same conclusion the daemon
 * reaches, so a failed parse is the normal path, not an error.
 *
 * The returned Identity is a fresh parse owned by the caller, so
 * {@link computeIdentityFeeFactor} may mutate it.
 */
function parseIdentityOutput(script: Buffer): Identity | null {
  try {
    const parsed = new IdentityScript();
    parsed.fromBuffer(script);
    if (parsed.paramsOptCC.eval_code.toNumber() !== EVALS.EVAL_IDENTITY_PRIMARY) return null;
    return parsed.getIdentity();
  } catch {
    return null;
  }
}

/**
 * `identityFeeFactor`, summed over every identity output a transaction carries.
 * Port of src/main.cpp:2216-2233 (consensus) and src/rpc/pbaasrpc.cpp:10690-10715
 * (the RPC twin):
 *
 *   factor += ceil(serSize / 128)   // only when the contentMultiMap is non-empty
 *   factor += contentMap.size()
 *   factor += max(primaryAddresses - 1, 0)
 *   factor += max(privateAddresses - 1, 0)
 *
 * where `serSize = GetSerializeSize(identity) - GetSerializeSize(identity with the
 * contentMultiMap cleared)` (src/main.cpp:2222) — the serialized size of the
 * contentMultiMap itself, NOT the output script's length and NOT the transaction's
 * size. So content costs 10,000 satoshis per 128 bytes ≈ 78.1 sat/byte. Measured
 * on VRSC: identity updates whose identity script ran 444 / 463 / 595 / 1474 /
 * 2072 bytes paid 10,000 / 20,000 / 30,000 / 100,000 / 140,000 — pure multiples
 * of 10,000 that track the content, never the 905-2695-byte transactions.
 *
 * The SDK's identity serialization is byte-locked to the daemon's by the golden
 * snapshots, so this delta is exact rather than an estimate.
 */
export function computeIdentityFeeFactor(outputScripts: readonly Buffer[]): number {
  let factor = 0;
  for (const script of outputScripts) {
    const identity = parseIdentityOutput(script);
    if (identity === null) continue;

    factor += identity.content_map?.size ?? 0;
    factor += Math.max((identity.primary_addresses?.length ?? 0) - 1, 0);
    factor += Math.max((identity.private_addresses?.length ?? 0) - 1, 0);

    // The daemon only charges the content factor when the multimap is non-empty
    // (`if (identity.contentMultiMap.size())`, src/main.cpp:2221). Clearing it
    // here mutates only our private parse.
    if ((identity.content_multimap?.kv_content?.size ?? 0) > 0) {
      const withContent = identity.getByteLength();
      identity.clearContentMultiMap();
      const serSize = withContent - identity.getByteLength();
      factor += Math.ceil(serSize / 128);
    }
  }
  return factor;
}

/**
 * What this SDK pays: the daemon's SENDER-side minimum for a transaction whose
 * NON-CHANGE outputs have these scripts. Port of `GetMinRelayFeeForOutputs`
 * (src/rpc/pbaasrpc.cpp:10732) / `GetMinRelayFeeForBuilder` (:10556) with
 * `idExtraLimit` pinned to 0 (see {@link ID_EXTRA_LIMIT}).
 *
 * The daemon's input term is `max(SpendCount() - 1, 0)`, and `SpendCount()` is
 * the count of SAPLING spends (src/transaction_builder.h:123-126) — always 0 for
 * the transparent transactions this SDK builds. There is no per-input fee, which
 * is why a 1,255-input transaction pays 10,000.
 *
 * @param outputScripts scriptPubKeys of the declared (non-change) outputs.
 */
export function estimateMinerFee(outputScripts: readonly Buffer[]): bigint {
  const factor = BigInt(computeIdentityFeeFactor(outputScripts));
  const count = outputScripts.length;

  // `CAmount minFee = identityFeeFactor * DEFAULT_TRANSACTION_FEE;` then
  // `if (!minFee) minFee = DEFAULT_TRANSACTION_FEE;` (pbaasrpc.cpp:10735, :10765).
  let fee = factor > 0n ? factor * DEFAULT_TRANSACTION_FEE : DEFAULT_TRANSACTION_FEE;

  // `minFee += max(tOutputs.size() - (1 + idExtraLimit), 0) * DEFAULT_TRANSACTION_FEE`
  // (pbaasrpc.cpp:10771). The z-output terms are 0 — this SDK builds none.
  fee += BigInt(Math.max(count - (1 + ID_EXTRA_LIMIT), 0)) * DEFAULT_TRANSACTION_FEE;

  // `if (!(identityFeeFactor && tOutputs.size() <= (1 + idExtraLimit)))` — an
  // identity factor already prices its own oversized output (pbaasrpc.cpp:10782).
  if (!(factor > 0n && count <= 1 + ID_EXTRA_LIMIT)) {
    for (const script of outputScripts) fee += largeScriptSurcharge(script.length);
  }
  return fee;
}

/**
 * The daemon's mempool ACCEPTANCE floor for a transaction with these FINAL vout
 * scripts (change included). Port of `GetMinRelayFeeByOutputs`
 * (src/pbaas/reserves.cpp:7906), the value `AcceptToMemoryPool` compares `nFees`
 * against (src/main.cpp:2270, :2280, :2296).
 *
 * This is looser than {@link estimateMinerFee} — it allows three free outputs
 * rather than one — so it is used only as a postcondition, never to size a fee.
 */
export function relayMinimumFee(outputScripts: readonly Buffer[]): bigint {
  const factor = BigInt(computeIdentityFeeFactor(outputScripts));
  const count = outputScripts.length;

  let fee = factor > 0n ? factor * DEFAULT_TRANSACTION_FEE : DEFAULT_TRANSACTION_FEE;
  // `if (tx.vout.size() > (3 + idExtraLimit)) minFee += max(vout.size() - (3 + idExtraLimit), 0) * …`
  // (reserves.cpp:7943).
  fee += BigInt(Math.max(count - (3 + ID_EXTRA_LIMIT), 0)) * DEFAULT_TRANSACTION_FEE;
  if (!(factor > 0n && count <= 3 + ID_EXTRA_LIMIT)) {
    for (const script of outputScripts) fee += largeScriptSurcharge(script.length);
  }
  return fee;
}

/**
 * Fail closed if the fee we chose would not clear the daemon's relay minimum for
 * the transaction we actually built.
 *
 * `estimateMinerFee >= relayMinimumFee` holds by construction for every shape the
 * SDK emits: the sender rule's allowance is 1 output against the mempool's 3, and
 * the SDK adds at most 2 change outputs. The ONE way this can fire is a CHANGE
 * output whose script exceeds the 2000-byte surcharge threshold (a token-change
 * reserve output bundling ~48 currencies), which cannot be known before selection.
 * Handing the caller a typed error there is strictly better than handing them a
 * transaction that lands in the daemon's free-transaction rate limiter
 * (src/main.cpp:2296-2317) — where acceptance depends on network-wide free-relay
 * volume at that moment, and is an outright reject above 15,000 bytes.
 *
 * Asserted on the miner fee alone, not `fee + burnSat`: stricter, and every
 * declared-burn path still clears it.
 *
 * @param outputScripts scriptPubKeys of the FINAL vout set, change included.
 */
export function assertFeeMeetsRelayMinimum(
  fee: bigint,
  outputScripts: readonly Buffer[],
  label: string,
): void {
  const minimum = relayMinimumFee(outputScripts);
  if (fee < minimum) {
    throw new TransactionBuildError(
      `${label}: miner fee ${fee} is below the daemon's relay minimum ${minimum} for this ` +
        `transaction's ${outputScripts.length} output(s); it would not reliably relay.`,
    );
  }
}
