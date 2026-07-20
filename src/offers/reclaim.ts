/**
 * Reclaiming (cancelling) an unaccepted offer, offline.
 *
 * The SDK's maker flow funds the OFFERED asset into a commitment output — a
 * single-key EVAL_IDENTITY_COMMITMENT CryptoCondition the maker controls (see
 * buildOfferFunding) — and then signs a SIGHASH_SINGLE|ANYONECANPAY partial over
 * it (buildOffer). If no taker ever completes that partial, the offered value is
 * still sitting in the maker's own commitment output. `buildReclaimOffer` spends
 * it back to the maker: the same CryptoCondition, now signed SIGHASH_ALL.
 *
 * This is the maker's unilateral cancel — it needs nothing but the maker's key
 * and the commitment outpoint. (It is distinct from the daemon's `closeoffers`,
 * which cancels the daemon's on-chain *posted* offers — a different, two-condition
 * commitment the SDK does not create.)
 *
 * The offered asset may be the native coin or a token:
 *   - native: the fee comes out of the reclaimed value (no extra inputs);
 *   - token:  the commitment carries 0 native, so `feeUtxos` (native, controlled
 *             by `wif`) fund the miner fee; the token returns in full.
 */
import { Transaction, TransactionBuilder, ECPair } from '../fork/boundary.js';
import { selectUtxos, estimateFee } from '../utxo/index.js';
import { getNetwork, assertNativeConservation, resolveExpiryHeight } from '../signing/index.js';
import { buildTokenChangeOutput, identityPaymentScript } from '../identity/index.js';
import { signTakerInputs, type TakerInput } from './sign.js';
import type { FundedOutpoint } from './maker.js';
import { toSafeNumber, addressToScriptPubKey } from '../utils/index.js';
import { parseAddress, parseIAddress } from '../core/brands.js';
import { NETWORK_CONFIG, VERSION_GROUP_ID, DEFAULT_FEE_PER_KB, DUST_THRESHOLD } from '../constants/index.js';
import { TransactionBuildError } from '../errors.js';
import type { Network } from '../constants/index.js';
import type { Utxo } from '../types/index.js';

export interface ReclaimOfferParams {
  wif: string;
  /** The funding commitment to reclaim (the `commitment` from buildOfferFunding). */
  commitment: FundedOutpoint;
  /**
   * What the commitment holds: the native coin (currency = chain id) or a token.
   * `amount` MUST equal the amount originally funded into the commitment — it is
   * the value being reclaimed, and nothing in the outpoint independently carries
   * a token amount. A mismatch produces a value-imbalanced tx the daemon rejects.
   */
  offered: { currency: string; amount: bigint };
  /** Where the reclaimed asset is returned (an address the `wif` controls). */
  makerAddress: string;
  /**
   * Native UTXOs controlled by `wif` to fund the miner fee. REQUIRED when
   * reclaiming a token (the token commitment carries 0 native); ignored for a
   * native reclaim, where the fee comes out of the reclaimed value.
   */
  feeUtxos?: Utxo[];
  /** Native change destination for a token reclaim (defaults to makerAddress). */
  changeAddress?: string;
  expiryHeight: number;
}

export interface ReclaimOfferResult {
  reclaimTx: string;
  txid: string;
}

/** A native payment script to an R-address (P2PKH) or i-address (pay-to-identity). */
function nativePaymentScript(address: string): Buffer {
  return address.startsWith('i')
    ? identityPaymentScript(parseIAddress(address, 'address'))
    : addressToScriptPubKey(address);
}

/**
 * Reclaim (cancel) an unaccepted offer: spend the funding commitment back to the
 * maker, signed SIGHASH_ALL. Returns the signed transaction to broadcast.
 */
export function buildReclaimOffer(params: ReclaimOfferParams, network: Network): ReclaimOfferResult {
  const verusNetwork = getNetwork(network === 'testnet');
  const systemId = NETWORK_CONFIG[network].chainId;
  const offeringNative = params.offered.currency === systemId;

  if (params.offered.amount <= 0n) {
    throw new TransactionBuildError('buildReclaimOffer: offered.amount must be positive');
  }
  if (!Number.isInteger(params.expiryHeight) || params.expiryHeight <= 0) {
    throw new TransactionBuildError('buildReclaimOffer: expiryHeight must be a positive block height');
  }

  const commitmentScript = Buffer.from(params.commitment.script, 'hex');

  const txb = new TransactionBuilder(verusNetwork);
  txb.setVersion(4);
  txb.setExpiryHeight(resolveExpiryHeight(params.expiryHeight));
  txb.setVersionGroupId(VERSION_GROUP_ID);
  txb.addInput(
    Buffer.from(params.commitment.txid, 'hex').reverse(),
    params.commitment.vout,
    0xffffffff,
    commitmentScript,
  );

  if (offeringNative) {
    // The fee comes out of the reclaimed native value; one CC input, one output.
    const fee = estimateFee(1, 1, DEFAULT_FEE_PER_KB, false, 100);
    const outAmount = params.offered.amount - fee;
    if (outAmount <= DUST_THRESHOLD) {
      throw new TransactionBuildError(
        `buildReclaimOffer: reclaimed native value ${params.offered.amount} is too small to cover the fee ${fee} above dust`,
      );
    }
    txb.addOutput(nativePaymentScript(params.makerAddress), toSafeNumber(outAmount));

    const tx = Transaction.fromHex(txb.buildIncomplete().toHex(), verusNetwork);
    const takerInputs: TakerInput[] = [
      { index: 0, prevOutScript: commitmentScript, value: params.commitment.value },
    ];
    assertNativeConservation([{ satoshis: params.commitment.value }], tx.outs, fee, 'reclaimOffer');
    const { signedTx, txid } = signTakerInputs(tx.toHex(), takerInputs, params.wif, network);
    return { reclaimTx: signedTx, txid };
  }

  // Token reclaim: the commitment carries 0 native and the token returns in full;
  // native fee UTXOs (controlled by wif) pay the miner fee.
  const feeUtxos = params.feeUtxos ?? [];
  if (feeUtxos.length === 0) {
    throw new TransactionBuildError(
      'buildReclaimOffer: reclaiming a token requires feeUtxos (native UTXOs) — the token commitment carries no native coin for the fee',
    );
  }

  // Output 0: the offered token returned to the maker (a reserve output, 0 native).
  const tokenOut = buildTokenChangeOutput(
    parseAddress(params.makerAddress, 'makerAddress'),
    new Map([[params.offered.currency, params.offered.amount]]),
  );
  txb.addOutput(tokenOut.script, 0);

  const tx = Transaction.fromHex(txb.buildIncomplete().toHex(), verusNetwork);
  const takerInputs: TakerInput[] = [
    { index: 0, prevOutScript: commitmentScript, value: 0n },
  ];

  // Select native-only fee UTXOs (numOutputs = token out + native change).
  const selection = selectUtxos(feeUtxos, 0n, new Map(), 2, systemId, undefined, true, 200);
  if (selection.currencyChanges.size > 0) {
    throw new TransactionBuildError(
      'buildReclaimOffer: feeUtxos must carry only the native coin; a token-bearing UTXO was selected and its reserve value would be lost.',
    );
  }
  // Fee UTXOs must be native P2PKH controlled by `wif`. Rejecting anything else
  // (including CryptoCondition outputs, whose control can't be verified offline)
  // fails closed with a typed error instead of a doomed, daemon-rejected tx.
  const expectedFeeScript = addressToScriptPubKey(
    (ECPair.fromWIF(params.wif, verusNetwork) as { getAddress(): string }).getAddress(),
  ).toString('hex');
  for (const u of selection.selected) {
    if (u.script !== expectedFeeScript) {
      throw new TransactionBuildError(
        `buildReclaimOffer: fee UTXO ${u.txid}:${u.outputIndex} must be a native P2PKH output controlled by the provided wif.`,
      );
    }
    const idx = tx.addInput(Buffer.from(u.txid, 'hex').reverse(), u.outputIndex, 0xffffffff);
    takerInputs.push({ index: idx, prevOutScript: Buffer.from(u.script, 'hex'), value: u.satoshis });
  }

  if (selection.nativeChange > 0n) {
    tx.addOutput(nativePaymentScript(params.changeAddress ?? params.makerAddress), toSafeNumber(selection.nativeChange));
  }

  const feeNativeIn = selection.selected.reduce((s, u) => s + u.satoshis, 0n);
  assertNativeConservation([{ satoshis: feeNativeIn }], tx.outs, selection.fee, 'reclaimOffer');

  const { signedTx, txid } = signTakerInputs(tx.toHex(), takerInputs, params.wif, network);
  return { reclaimTx: signedTx, txid };
}
