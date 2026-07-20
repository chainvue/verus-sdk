/**
 * Building the maker's side of a marketplace offer (offline).
 *
 * Two transactions, mirroring the daemon's `makeoffer`:
 *
 *   1. FUNDING tx — moves the OFFERED asset into a CryptoCondition commitment
 *      output the maker controls (an EVAL_IDENTITY_COMMITMENT CC with a zero
 *      commitment hash, byte-identical to the daemon). Signed normally
 *      (SIGHASH_ALL) and broadcast; the offered value now sits in one outpoint.
 *
 *   2. OFFER tx — spends that commitment with SIGHASH_SINGLE|ANYONECANPAY (see
 *      signOfferInput) into a single WANTED output: a reserve output when a token
 *      is wanted, a plain P2PKH when native is wanted. This is the maker's HALF of
 *      the atomic swap; a taker completes it.
 *
 * Every byte-bearing piece here is verified byte-identical to the daemon's
 * makeoffer output on VRSCTEST: the funding commitment
 * (`buildCommitmentScript` with a zero hash), the wanted reserve output
 * (`buildTokenChangeOutput`), and the 0x83 fulfillment.
 *
 * This module covers offers of the NATIVE coin (the offered value is native).
 * Offering a token (a reserve-value commitment) is a separate follow-up.
 */
import { TransactionBuilder } from '../fork/boundary.js';
import { assembleAndSign } from '../assemble/assembler.js';
import { buildCommitmentScript, buildTokenChangeOutput, identityPaymentScript } from '../identity/index.js';
import { signOfferInput } from './sign.js';
import { getNetwork, resolveExpiryHeight } from '../signing/index.js';
import { toSafeNumber, addressToScriptPubKey } from '../utils/index.js';
import { parseRAddress, parseAddress, parseIAddress } from '../core/brands.js';
import { NETWORK_CONFIG, VERSION_GROUP_ID } from '../constants/index.js';
import { TransactionBuildError } from '../errors.js';
import type { Network } from '../constants/index.js';
import type { Utxo } from '../types/index.js';

/** An outpoint plus the data needed to spend it. */
export interface FundedOutpoint {
  txid: string;
  vout: number;
  /** Native satoshis on the output. */
  value: bigint;
  /** The output's scriptPubKey (hex). */
  script: string;
}

export interface BuildOfferFundingParams {
  wif: string;
  utxos: Utxo[];
  changeAddress: string;
  /** The maker's R-address that will control (and later spend) the commitment. */
  makerAddress: string;
  /** Native satoshis being offered — locked into the commitment output. */
  offerAmount: bigint;
  expiryHeight?: number;
}

export interface BuildOfferFundingResult {
  fundingTx: string;
  txid: string;
  fee: bigint;
  /** The commitment outpoint to hand to buildOffer once this tx is broadcast. */
  commitment: FundedOutpoint;
}

/**
 * Step 1: fund the offer — lock the offered NATIVE value in a commitment output.
 * Broadcast the returned tx, then pass `commitment` to buildOffer.
 */
export function buildOfferFunding(
  params: BuildOfferFundingParams,
  network: Network,
): BuildOfferFundingResult {
  if (params.offerAmount <= 0n) {
    throw new TransactionBuildError('offerAmount must be positive');
  }
  const commitmentScript = buildCommitmentScript(
    Buffer.alloc(32, 0),
    parseRAddress(params.makerAddress, 'makerAddress'),
  );

  const assembled = assembleAndSign({
    network,
    wif: params.wif,
    expiryHeight: params.expiryHeight ?? 0,
    funding: params.utxos,
    outputs: [{ script: commitmentScript, nativeSat: params.offerAmount }],
    changeAddress: params.changeAddress,
    fee: { policy: 'estimate' },
    label: 'offer funding',
  });

  return {
    fundingTx: assembled.signedTx,
    txid: assembled.txid,
    fee: assembled.fee,
    commitment: {
      txid: assembled.txid,
      vout: 0,
      value: params.offerAmount,
      script: commitmentScript.toString('hex'),
    },
  };
}

/** What the maker wants in return: a currency paid to an address. */
export interface OfferWant {
  /** Currency id (i-address) for a token, or the chain id for native. */
  currency: string;
  amount: bigint;
  /** Where the wanted asset is paid (the maker's receiving address). */
  address: string;
}

export interface BuildOfferParams {
  wif: string;
  /** The commitment outpoint from buildOfferFunding (after broadcast). */
  commitment: FundedOutpoint;
  want: OfferWant;
  expiryHeight?: number;
}

export interface BuildOfferResult {
  /** The maker's half-signed offer transaction (SIGHASH_SINGLE|ANYONECANPAY). */
  offerTx: string;
  txid: string;
}

/**
 * Step 2: build the maker's offer transaction — spend the funding commitment into
 * the single wanted output, signed 0x83 so a taker can complete the swap.
 */
export function buildOffer(params: BuildOfferParams, network: Network): BuildOfferResult {
  const verusNetwork = getNetwork(network === 'testnet');
  const systemId = NETWORK_CONFIG[network].chainId;
  if (params.want.amount <= 0n) {
    throw new TransactionBuildError('want.amount must be positive');
  }
  // An offer MUST expire at a real future block height. Verified live on VRSCTEST:
  // the daemon rejects an offer with expiryHeight 0 ("never expires") as expired
  // and refuses to take it. This SDK is offline and can't check "future", but it
  // fails closed on the one value the daemon definitively rejects. Pass
  // currentBlockHeight + a margin (the daemon's own makeoffer uses +200).
  if (
    params.expiryHeight === undefined ||
    !Number.isInteger(params.expiryHeight) ||
    params.expiryHeight <= 0
  ) {
    throw new TransactionBuildError(
      'expiryHeight (a positive future block height) is required for an offer; the daemon rejects a 0/never-expiring offer as expired. Use currentBlockHeight + a margin (e.g. +200).',
    );
  }

  // The single wanted output: a reserve output for a token, a plain payment for native.
  let wantedScript: Buffer;
  let wantedNative: bigint;
  if (params.want.currency === systemId) {
    // Want native → plain P2PKH (i-address → explicit P2ID), value = wanted amount.
    wantedScript = params.want.address.startsWith('i')
      ? identityPaymentScript(parseIAddress(params.want.address, 'want.address'))
      : addressToScriptPubKey(params.want.address);
    wantedNative = params.want.amount;
  } else {
    // Want token → reserve output carrying the wanted currency; 0 native.
    wantedScript = buildTokenChangeOutput(
      parseAddress(params.want.address, 'want.address'),
      new Map([[params.want.currency, params.want.amount]]),
    ).script;
    wantedNative = 0n;
  }

  const txb = new TransactionBuilder(verusNetwork);
  txb.setVersion(4);
  txb.setExpiryHeight(resolveExpiryHeight(params.expiryHeight ?? 0));
  txb.setVersionGroupId(VERSION_GROUP_ID);
  txb.addInput(
    Buffer.from(params.commitment.txid, 'hex').reverse(),
    params.commitment.vout,
    0xffffffff,
    Buffer.from(params.commitment.script, 'hex'),
  );
  txb.addOutput(wantedScript, toSafeNumber(wantedNative));

  const unsignedHex = txb.buildIncomplete().toHex();
  const { signedTx, txid } = signOfferInput(
    unsignedHex,
    0,
    Buffer.from(params.commitment.script, 'hex'),
    params.commitment.value,
    params.wif,
    network,
  );
  return { offerTx: signedTx, txid };
}
