/**
 * Multi-signature (m-of-n) VerusID updates, offline.
 *
 * A VerusID with `minimumsignatures > 1` is controlled by an m-of-n set of primary
 * keys. Spending its output (to update/lock/revoke/… the identity) needs m of those
 * signatures on the identity's CryptoCondition input. The bundled fork's high-level
 * `TransactionBuilder.sign` can only attach ONE signature to a CC input, which is
 * why the single-key update path fails closed for `min_sigs > 1`. Here we drive the
 * fork's low-level primitives directly (`SmartTransactionSignatures`, which DOES
 * serialize and parse an N-signature fulfillment) to collect signatures from
 * separate signers who never share keys:
 *
 *   1. A funder builds the funded update tx (funding inputs signed, the identity CC
 *      input left open) with {@link buildMultisigIdentityUpdate}.
 *   2. Each authority adds their signature with {@link addIdentitySignature}; the
 *      partial tx carries the accumulating fulfillment between signers.
 *   3. Once `minSignatures` are collected the tx is complete — broadcast it.
 *
 * The signatures are ordered to match the identity's `primaryaddresses` order (the
 * daemon's convention, verified byte-for-byte on VRSCTEST). The sighash is
 * SIGHASH_ALL over the fixed tx, so every signer signs the same digest
 * independently and order of collection doesn't matter.
 */
import {
  Transaction,
  TransactionBuilder,
  ECPair,
  SmartTransactionSignatures,
  SmartTransactionSignature,
  script as bscript,
  Identity,
  smarttxs,
  type VerusCLIVerusIDJson,
} from '../fork/boundary.js';
import { selectUtxos } from '../utxo/index.js';
import { getNetwork, assertNativeConservation, resolveExpiryHeight } from '../signing/index.js';
import { buildIdentityScript, identityPaymentScript } from './index.js';
import { toSafeNumber, addressToScriptPubKey } from '../utils/index.js';
import { parseIAddress } from '../core/brands.js';
import { NETWORK_CONFIG, VERSION_GROUP_ID } from '../constants/index.js';
import { TransactionBuildError } from '../errors.js';
import type { Network } from '../constants/index.js';
import type { Utxo } from '../types/index.js';

const { completeFundedIdentityUpdate } = smarttxs;
const SIGHASH_ALL = Transaction.SIGHASH_ALL;

/** A native payment script to an R-address (P2PKH) or i-address (pay-to-identity). */
function nativePaymentScript(address: string): Buffer {
  return address.startsWith('i')
    ? identityPaymentScript(parseIAddress(address, 'address'))
    : addressToScriptPubKey(address);
}

/** The R-address that a compressed public key hashes to, on this network. */
function addressOfPubkey(pubkey: Buffer, verusNetwork: ReturnType<typeof getNetwork>): string {
  return (ECPair.fromPublicKeyBuffer(pubkey, verusNetwork) as { getAddress(): string }).getAddress();
}

export interface MultisigIdentityUpdateParams {
  /** The funder's WIF — pays the miner fee. The funding UTXOs are P2PKH it controls. */
  funderWif: string;
  /** The identity's current on-chain primary output (the CC being respent). Must carry 0 native. */
  identityUtxo: { txid: string; vout: number; script: string };
  /**
   * The current identity's primary addresses, IN ORDER. They control the output
   * being spent and determine the signature order in the fulfillment.
   */
  currentPrimaryAddresses: string[];
  /** How many authority signatures the current identity requires (its min_sigs). */
  minSignatures: number;
  /** The desired new identity state (a getidentity-style JSON); its output is recreated. */
  newIdentity: VerusCLIVerusIDJson;
  /** Native UTXOs (P2PKH controlled by funderWif) that fund the miner fee. */
  funding: Utxo[];
  changeAddress: string;
  expiryHeight: number;
}

export interface IdentityInputRef {
  /** The identity CC input's index in the transaction. */
  index: number;
  /** The identity's current output scriptPubKey (hex) — what the input spends. */
  script: string;
}

export interface MultisigIdentityUpdateResult {
  /** The funded update tx: funding inputs signed, identity CC input awaiting authority signatures. */
  partialTx: string;
  identityInput: IdentityInputRef;
  currentPrimaryAddresses: string[];
  minSignatures: number;
  /** Signatures collected on the identity input so far (0 after build). */
  collected: number;
}

/**
 * Build the funded half of a multisig identity update: select native fee UTXOs,
 * recreate the identity output, graft the identity CC input, and sign the funding
 * inputs with the funder's key. The identity CC input is left open for authorities
 * to sign via {@link addIdentitySignature}.
 */
export function buildMultisigIdentityUpdate(
  params: MultisigIdentityUpdateParams,
  network: Network,
): MultisigIdentityUpdateResult {
  const verusNetwork = getNetwork(network === 'testnet');
  const systemId = NETWORK_CONFIG[network].chainId;

  if (!Number.isInteger(params.expiryHeight) || params.expiryHeight <= 0) {
    throw new TransactionBuildError('buildMultisigIdentityUpdate: expiryHeight must be a positive block height');
  }
  if (params.minSignatures < 1) {
    throw new TransactionBuildError('buildMultisigIdentityUpdate: minSignatures must be >= 1');
  }
  if (params.currentPrimaryAddresses.length < params.minSignatures) {
    throw new TransactionBuildError(
      `buildMultisigIdentityUpdate: minSignatures ${params.minSignatures} exceeds the ${params.currentPrimaryAddresses.length} current primary address(es)`,
    );
  }
  if (params.funding.length === 0) {
    throw new TransactionBuildError('buildMultisigIdentityUpdate: funding must include native UTXOs for the fee');
  }

  // The recreated identity output (value 0), from the desired new state.
  const newIdScript = buildIdentityScript(Identity.fromJson(params.newIdentity));

  // Select native-only fee UTXOs; the identity output is value 0 so requiredNative is 0.
  const selection = selectUtxos(params.funding, 0n, new Map(), 2, systemId, undefined, true, newIdScript.length + 100);
  if (selection.currencyChanges.size > 0) {
    throw new TransactionBuildError(
      'buildMultisigIdentityUpdate: funding must carry only the native coin; a token-bearing UTXO was selected and its reserve value would be lost.',
    );
  }
  const funderScript = addressToScriptPubKey(
    (ECPair.fromWIF(params.funderWif, verusNetwork) as { getAddress(): string }).getAddress(),
  ).toString('hex');
  for (const u of selection.selected) {
    if (u.script !== funderScript) {
      throw new TransactionBuildError(
        `buildMultisigIdentityUpdate: funding UTXO ${u.txid}:${u.outputIndex} must be a native P2PKH output controlled by funderWif.`,
      );
    }
  }

  const txb = new TransactionBuilder(verusNetwork);
  txb.setVersion(4);
  txb.setExpiryHeight(resolveExpiryHeight(params.expiryHeight));
  txb.setVersionGroupId(VERSION_GROUP_ID);
  for (const u of selection.selected) {
    txb.addInput(Buffer.from(u.txid, 'hex').reverse(), u.outputIndex, 0xffffffff, Buffer.from(u.script, 'hex'));
  }
  txb.addOutput(newIdScript, 0);
  if (selection.nativeChange > 0n) {
    txb.addOutput(nativePaymentScript(params.changeAddress), toSafeNumber(selection.nativeChange));
  }

  // Graft the identity CC input (added last, unsigned) via the fork helper.
  const prevOutScripts = selection.selected.map((u) => Buffer.from(u.script, 'hex'));
  const identityIndex = selection.selected.length;
  const completedHex = completeFundedIdentityUpdate(txb.buildIncomplete().toHex(), verusNetwork, prevOutScripts, {
    hash: Buffer.from(params.identityUtxo.txid, 'hex').reverse(),
    index: params.identityUtxo.vout,
    sequence: 0xffffffff,
    script: Buffer.from(params.identityUtxo.script, 'hex'),
  });

  const tx = Transaction.fromHex(completedHex, verusNetwork);

  // Native conservation: the identity input and its recreated output are both value
  // 0, so the funder's native inputs must equal the change + fee.
  const funderNativeIn = selection.selected.reduce((s, u) => s + u.satoshis, 0n);
  assertNativeConservation([{ satoshis: funderNativeIn }], tx.outs, selection.fee, 'multisigIdentityUpdate');

  // Sign the funding inputs (P2PKH) with the funder's key; leave the CC input open.
  const funderKey = ECPair.fromWIF(params.funderWif, verusNetwork);
  for (let i = 0; i < selection.selected.length; i++) {
    const u = selection.selected[i]!;
    const sighash = tx.hashForSignatureByNetwork(i, Buffer.from(u.script, 'hex'), toSafeNumber(u.satoshis), SIGHASH_ALL, false);
    const sig = funderKey.sign(sighash);
    tx.ins[i]!.script = bscript.compile([sig.toScriptSignature(SIGHASH_ALL), funderKey.getPublicKeyBuffer()]);
  }

  return {
    partialTx: tx.toHex(),
    identityInput: { index: identityIndex, script: params.identityUtxo.script },
    currentPrimaryAddresses: params.currentPrimaryAddresses,
    minSignatures: params.minSignatures,
    collected: 0,
  };
}

export interface AddIdentitySignatureParams {
  /** The partial update tx (from buildMultisigIdentityUpdate or a prior addIdentitySignature). */
  partialTx: string;
  identityInput: IdentityInputRef;
  /**
   * The current identity's primary addresses IN ORDER — the signature ordering key.
   * Every signer MUST pass the identical list (read from the same `getidentity`);
   * each call re-sorts the whole fulfillment by this list, so an inconsistent order
   * from the last signer would win. Read it from the identity, don't hand-order it.
   */
  currentPrimaryAddresses: string[];
  minSignatures: number;
  /** An authority's WIF — must control one of `currentPrimaryAddresses`. */
  wif: string;
}

export interface AddIdentitySignatureResult {
  partialTx: string;
  /** Signatures now present on the identity input. */
  collected: number;
  minSignatures: number;
  /** True once `collected >= minSignatures` — the tx is ready to broadcast. */
  complete: boolean;
}

/**
 * Add one authority signature to the identity CC input of a partial multisig update,
 * merging it into any existing signatures in `primaryaddresses` order. Idempotent per
 * key (re-signing with the same key does not duplicate).
 */
export function addIdentitySignature(
  params: AddIdentitySignatureParams,
  network: Network,
): AddIdentitySignatureResult {
  const verusNetwork = getNetwork(network === 'testnet');
  const keyPair = ECPair.fromWIF(params.wif, verusNetwork);
  const signerAddress = (keyPair as { getAddress(): string }).getAddress();
  const order = params.currentPrimaryAddresses.indexOf(signerAddress);
  if (order < 0) {
    throw new TransactionBuildError(
      `addIdentitySignature: the provided wif (${signerAddress}) is not one of the identity's primary addresses`,
    );
  }

  const tx = Transaction.fromHex(params.partialTx, verusNetwork);
  const input = tx.ins[params.identityInput.index];
  if (!input) {
    throw new TransactionBuildError(`addIdentitySignature: no input at index ${params.identityInput.index}`);
  }

  const sighash = tx.hashForSignatureByNetwork(
    params.identityInput.index,
    Buffer.from(params.identityInput.script, 'hex'),
    0,
    SIGHASH_ALL,
    false,
  );
  const sig = keyPair.sign(sighash).toCompact().slice(1); // 64-byte r||s
  const entry = new SmartTransactionSignature(1, 1, keyPair.getPublicKeyBuffer(), sig);

  // Parse any existing signatures on this input. Keep only genuine authority
  // signatures — an entry whose pubkey is NOT one of the current primary addresses
  // (a stale or tampered-in signature from a supplied partialTx) is dropped, so it
  // can neither inflate `collected` nor sort ahead of the real signers. Our own
  // prior signature is dropped too and re-added fresh (idempotent).
  const existing: InstanceType<typeof SmartTransactionSignature>[] = [];
  if (input.script.length > 0) {
    const chunk = (bscript.decompile(input.script) ?? []).find((c): c is Buffer => Buffer.isBuffer(c));
    if (chunk) {
      const parsed = SmartTransactionSignatures.fromChunk(chunk);
      for (const s of parsed.signatures ?? []) existing.push(s);
    }
  }
  const merged = existing.filter((s) => {
    const addr = addressOfPubkey(s.pubKeyData, verusNetwork);
    return addr !== signerAddress && params.currentPrimaryAddresses.indexOf(addr) >= 0;
  });
  merged.push(entry);

  // Order by each signer's position in the identity's primary addresses.
  merged.sort(
    (a, b) =>
      params.currentPrimaryAddresses.indexOf(addressOfPubkey(a.pubKeyData, verusNetwork)) -
      params.currentPrimaryAddresses.indexOf(addressOfPubkey(b.pubKeyData, verusNetwork)),
  );

  const fulfillment = new SmartTransactionSignatures(1, SIGHASH_ALL, merged).toChunk();
  input.script = bscript.compile([fulfillment]);

  const collected = merged.length;
  return {
    partialTx: tx.toHex(),
    collected,
    minSignatures: params.minSignatures,
    complete: collected >= params.minSignatures,
  };
}
