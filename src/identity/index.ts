/**
 * Identity transaction building utilities and workflows
 *
 * Handles:
 * - Name commitment (Step 1 of identity creation)
 * - Identity registration (Step 2)
 * - Identity updates (modify, revoke, recover, lock, unlock)
 * - Script/hash construction for CC outputs
 */

import { randomBytes } from 'crypto';
import BN from 'bn.js';
import {
  OptCCParams,
  TxDestination,
  IdentityID,
  KeyID,
  TokenOutput,
  CurrencyValueMap,
  SmartTransactionScript,
  Identity,
  IdentityScript,
  ReserveTransfer,
  TransferDestination,
  ContentMultiMap,
  RESERVE_TRANSFER_VALID,
  RESERVE_TRANSFER_BURN_CHANGE_PRICE,
  DEST_ID,
} from 'verus-typescript-primitives';
import { EVALS } from 'verus-typescript-primitives';
import {
  nameAndParentAddrToIAddr,
  fromBase58Check,
} from 'verus-typescript-primitives';
import { script as bscript, opcodes, TransactionBuilder, Transaction, smarttxs } from '@bitgo/utxo-lib';
import {
  NETWORK_CONFIG,
  VERSION_GROUP_ID,
  DEFAULT_REGISTRATION_FEE,
  DEFAULT_REFERRAL_LEVELS,
  RESERVE_TRANSFER_FEE,
  RESERVE_TRANSFER_EVAL_PKH,
  IDENTITY_FLAG_ACTIVECURRENCY,
} from '../constants/index.js';
import type { Network } from '../constants/index.js';
import { sha256d, writeCompactSize, iAddressToHash, toSafeNumber } from '../utils/index.js';
import { signTransactionSmart, getNetwork } from '../signing/index.js';
import { selectUtxos } from '../utxo/index.js';
import { InvalidWifError, InvalidNameError, TransactionBuildError } from '../errors.js';
import { validateWif } from '../keys/index.js';
import type {
  Utxo,
  CreateCommitmentParams,
  CreateCommitmentResult,
  RegisterIdentityParams,
  RegisterIdentityResult,
  UpdateIdentityParams,
  UpdateIdentityResult,
  LockIdentityParams,
  UnlockIdentityParams,
  RevokeIdentityParams,
  RecoverIdentityParams,
  DefineCurrencyParams,
  DefineCurrencyResult,
  CommitmentData,
} from '../types/index.js';

const { createUnfundedIdentityUpdate, completeFundedIdentityUpdate } = smarttxs;

// Re-export for convenience
export { nameAndParentAddrToIAddr };

const HASH160_BYTE_LENGTH = 20;
const HASH256_BYTE_LENGTH = 32;

/** Null identity hash (20 zero bytes) */
const NULL_ID_HASH = Buffer.alloc(HASH160_BYTE_LENGTH, 0);

/** Eval code for CAdvancedNameReservation (sub-ID) */
const EVAL_IDENTITY_ADVANCEDRESERVATION = 10;

// ─── Script / Hash Builders ────────────────────────────────────────

/**
 * Generate a random 32-byte salt for name commitment
 */
export function generateSalt(): Buffer {
  return randomBytes(HASH256_BYTE_LENGTH);
}

/**
 * Serialize a CNameReservation (for VRSC-parent identities)
 */
export function serializeNameReservation(
  name: string,
  referralHash: Buffer,
  salt: Buffer
): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  const compactSize = writeCompactSize(nameBytes.length);
  return Buffer.concat([compactSize, nameBytes, referralHash, salt]);
}

/**
 * Serialize a CAdvancedNameReservation (for PBaaS-parent identities)
 */
export function serializeAdvancedNameReservation(
  version: number,
  name: string,
  parentHash: Buffer,
  referralHash: Buffer,
  salt: Buffer
): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  const compactSize = writeCompactSize(nameBytes.length);
  const versionBuf = Buffer.alloc(4);
  versionBuf.writeUInt32LE(version, 0);
  return Buffer.concat([versionBuf, compactSize, nameBytes, parentHash, referralHash, salt]);
}

/**
 * Calculate the commitment hash from a serialized name reservation
 */
export function calculateCommitmentHash(serializedReservation: Buffer): Buffer {
  return sha256d(serializedReservation);
}

/**
 * Serialize a CCommitmentHash
 */
export function serializeCommitmentHash(hash: Buffer): Buffer {
  const tokenOutput = new TokenOutput({
    version: new BN(0),
    values: new CurrencyValueMap(),
  });
  const tokenBuf = tokenOutput.toBuffer();
  return Buffer.concat([tokenBuf, hash]);
}

/**
 * Build the commitment output script
 */
export function buildCommitmentScript(
  commitmentHashBuf: Buffer,
  controlAddress: string,
): Buffer {
  const controlDest = new TxDestination(KeyID.fromAddress(controlAddress));

  const master = new OptCCParams({
    version: new BN(3),
    eval_code: new BN(EVALS.EVAL_NONE),
    m: new BN(1),
    n: new BN(1),
    destinations: [controlDest],
    vdata: [],
  });

  const params = new OptCCParams({
    version: new BN(3),
    eval_code: new BN(EVALS.EVAL_IDENTITY_COMMITMENT),
    m: new BN(1),
    n: new BN(1),
    destinations: [controlDest],
    vdata: [commitmentHashBuf],
  });

  const script = new SmartTransactionScript(master, params);
  return script.toBuffer();
}

/**
 * Build the name reservation output script
 */
export function buildReservationScript(
  newIdentityIAddress: string,
  serializedReservation: Buffer,
  isAdvanced: boolean = false,
): Buffer {
  const identityDest = new TxDestination(IdentityID.fromAddress(newIdentityIAddress));

  const evalCode = isAdvanced
    ? EVAL_IDENTITY_ADVANCEDRESERVATION
    : EVALS.EVAL_IDENTITY_RESERVATION;

  const master = new OptCCParams({
    version: new BN(3),
    eval_code: new BN(EVALS.EVAL_NONE),
    m: new BN(1),
    n: new BN(1),
    destinations: [identityDest],
    vdata: [],
  });

  const params = new OptCCParams({
    version: new BN(3),
    eval_code: new BN(evalCode),
    m: new BN(1),
    n: new BN(1),
    destinations: [identityDest],
    vdata: [serializedReservation],
  });

  const script = new SmartTransactionScript(master, params);
  return script.toBuffer();
}

/**
 * Build an identity definition output script from an Identity object
 */
export function buildIdentityScript(identity: Identity): Buffer {
  const identityScript = IdentityScript.fromIdentity(identity);
  return identityScript.toBuffer();
}

/**
 * Derive the identity i-address from a name and optional parent
 */
export function deriveIdentityAddress(
  name: string,
  parentIAddress?: string
): string {
  return nameAndParentAddrToIAddr(name, parentIAddress || undefined);
}

/**
 * Determine if a parent is the VRSC root system
 */
export function isVRSCParent(
  parentIAddress: string | undefined,
  network: Network = 'mainnet'
): boolean {
  if (!parentIAddress) return true;
  const systemId = NETWORK_CONFIG[network].chainId;
  return parentIAddress === systemId;
}

/**
 * Build the full commitment data needed for Step 1 of identity creation
 */
export function prepareNameCommitment(
  name: string,
  controlAddress: string,
  referralIAddress?: string,
  parentIAddress?: string,
  network: Network = 'mainnet'
): {
  salt: Buffer;
  serializedReservation: Buffer;
  commitmentHash: Buffer;
  serializedCommitmentHash: Buffer;
  commitmentScript: Buffer;
  identityAddress: string;
} {
  const salt = generateSalt();
  const systemId = NETWORK_CONFIG[network].chainId;

  const referralHash = referralIAddress
    ? iAddressToHash(referralIAddress)
    : NULL_ID_HASH;

  const effectiveParent = parentIAddress && parentIAddress !== systemId
    ? parentIAddress
    : undefined;

  const identityAddress = deriveIdentityAddress(name, effectiveParent || systemId);

  let serializedReservation: Buffer;
  if (isVRSCParent(parentIAddress, network)) {
    serializedReservation = serializeNameReservation(name, referralHash, salt);
  } else {
    const parentHash = parentIAddress
      ? iAddressToHash(parentIAddress)
      : NULL_ID_HASH;
    serializedReservation = serializeAdvancedNameReservation(
      1,
      name,
      parentHash,
      referralHash,
      salt,
    );
  }

  const commitmentHash = calculateCommitmentHash(serializedReservation);
  const serializedCommitmentHash = serializeCommitmentHash(commitmentHash);
  const commitmentScript = buildCommitmentScript(commitmentHash, controlAddress);

  return {
    salt,
    serializedReservation,
    commitmentHash,
    serializedCommitmentHash,
    commitmentScript,
    identityAddress,
  };
}

/**
 * Build a P2ID output script (pay to identity)
 */
export function buildP2IDScript(iAddress: string): Buffer {
  const idHash = iAddressToHash(iAddress);
  return bscript.compile([
    opcodes.OP_DUP,
    opcodes.OP_HASH160,
    idHash,
    opcodes.OP_EQUALVERIFY,
    opcodes.OP_CHECKSIG,
    opcodes.OP_CHECKCRYPTOCONDITION,
  ]);
}

/**
 * The standard pay-to-identity output script (CC EVAL_NONE 1-of-1 to an
 * IdentityID) — byte-identical to what the chain itself produces when paying
 * an identity (verified against on-chain P2ID outputs). Use this for change
 * or payment outputs to an i-address.
 */
export function identityPaymentScript(iAddress: string): Buffer {
  return buildReferralPaymentScript(iAddress);
}

/**
 * Build a CC referral payment output script
 */
export function buildReferralPaymentScript(iAddress: string): Buffer {
  const identityDest = new TxDestination(IdentityID.fromAddress(iAddress));

  // Master: EVAL_NONE outputs have empty master (no index destinations)
  // This matches the daemon's MakeMofNCCScript for EVAL_NONE condition objects
  const master = new OptCCParams({
    version: new BN(3),
    eval_code: new BN(EVALS.EVAL_NONE),
    m: new BN(0),
    n: new BN(0),
    destinations: [],
    vdata: [],
  });

  const params = new OptCCParams({
    version: new BN(3),
    eval_code: new BN(EVALS.EVAL_NONE),
    m: new BN(1),
    n: new BN(1),
    destinations: [identityDest],
    vdata: [],
  });

  const script = new SmartTransactionScript(master, params);
  return script.toBuffer();
}

/**
 * Calculate registration fee breakdown
 */
export function calculateRegistrationFees(
  hasReferral: boolean,
  totalFee: bigint = DEFAULT_REGISTRATION_FEE,
  referralLevels: number = DEFAULT_REFERRAL_LEVELS
): {
  issuerFee: bigint;
  referralAmount: bigint;
  totalRequired: bigint;
} {
  if (!hasReferral) {
    return { issuerFee: totalFee, referralAmount: 0n, totalRequired: totalFee };
  }

  const issuerFee = (totalFee * BigInt(referralLevels + 1)) / BigInt(referralLevels + 2);
  const referralAmount = totalFee / BigInt(referralLevels + 2);
  const totalRequired = issuerFee + referralAmount * BigInt(referralLevels);

  return { issuerFee, referralAmount, totalRequired };
}

/**
 * Build a new Identity object for registration
 */
export function createIdentityObject(params: {
  name: string;
  primaryAddresses: string[];
  minSigs?: number;
  revocationAuthority: string;
  recoveryAuthority: string;
  parentIAddress: string;
  systemId: string;
}): Identity {
  const primaryKeys = params.primaryAddresses.map(addr => KeyID.fromAddress(addr));

  const identity = new Identity({
    version: Identity.VERSION_CURRENT,
    flags: new BN(0),
    min_sigs: new BN(params.minSigs || 1),
    primary_addresses: primaryKeys,
    parent: IdentityID.fromAddress(params.parentIAddress) as IdentityID,
    system_id: IdentityID.fromAddress(params.systemId) as IdentityID,
    name: params.name,
    revocation_authority: IdentityID.fromAddress(params.revocationAuthority) as IdentityID,
    recovery_authority: IdentityID.fromAddress(params.recoveryAuthority) as IdentityID,
    private_addresses: [],
    unlock_after: new BN(0),
  });

  return identity;
}

/**
 * Build a CReserveTransfer fee output for sub-ID registration
 */
export function buildRegistrationFeeOutput(
  parentCurrencyId: string,
  feeAmount: bigint,
  systemId: string,
  _controlAddress: string,
): { script: Buffer; nativeValue: bigint } {
  const destination = new TxDestination(KeyID.fromAddress(RESERVE_TRANSFER_EVAL_PKH));

  const values = new CurrencyValueMap({
    value_map: new Map([[parentCurrencyId, new BN(feeAmount.toString(10))]]),
    multivalue: false,
  });

  const parentHash = fromBase58Check(parentCurrencyId).hash;
  const transferDest = new TransferDestination({
    type: DEST_ID,
    destination_bytes: Buffer.from(parentHash),
  });

  const flags = RESERVE_TRANSFER_VALID.or(RESERVE_TRANSFER_BURN_CHANGE_PRICE);

  const resTransfer = new ReserveTransfer({
    values,
    version: new BN(1),
    flags,
    fee_currency_id: systemId,
    fee_amount: new BN(RESERVE_TRANSFER_FEE.toString(10)),
    transfer_destination: transferDest,
    dest_currency_id: parentCurrencyId,
  });

  const master = new OptCCParams({
    version: new BN(3),
    eval_code: new BN(EVALS.EVAL_NONE),
    m: new BN(1),
    n: new BN(1),
    destinations: [destination],
    vdata: [],
  });

  const params = new OptCCParams({
    version: new BN(3),
    eval_code: new BN(EVALS.EVAL_RESERVE_TRANSFER),
    m: new BN(1),
    n: new BN(1),
    destinations: [destination],
    vdata: [resTransfer.toBuffer()],
  });

  const script = new SmartTransactionScript(master, params);
  return { script: script.toBuffer(), nativeValue: RESERVE_TRANSFER_FEE };
}

/**
 * Build a token change output (EVAL_RESERVE_OUTPUT)
 */
export function buildTokenChangeOutput(
  changeAddress: string,
  currencyChanges: Map<string, bigint>,
): { script: Buffer; nativeValue: bigint } {
  const destination = new TxDestination(KeyID.fromAddress(changeAddress));

  const valueMap = new Map<string, typeof BN.prototype>();
  for (const [currency, amount] of currencyChanges) {
    if (amount > 0n) {
      valueMap.set(currency, new BN(amount.toString(10)));
    }
  }

  const values = new CurrencyValueMap({
    value_map: valueMap,
    multivalue: false,
  });

  const tokenOutput = new TokenOutput({ version: new BN(1), values });

  const master = new OptCCParams({
    version: new BN(3),
    eval_code: new BN(EVALS.EVAL_NONE),
    m: new BN(1),
    n: new BN(1),
    destinations: [destination],
    vdata: [],
  });

  const params = new OptCCParams({
    version: new BN(3),
    eval_code: new BN(EVALS.EVAL_RESERVE_OUTPUT),
    m: new BN(1),
    n: new BN(1),
    destinations: [destination],
    vdata: [tokenOutput.toBuffer()],
  });

  const script = new SmartTransactionScript(master, params);
  return { script: script.toBuffer(), nativeValue: 0n };
}

// ─── Validation ──────────────────────────────────────────────────

const IDENTITY_NAME_RE = /^[a-z0-9_-]{1,64}$/;

function validateIdentityWif(wif: string): void {
  if (!wif || typeof wif !== 'string') {
    throw new InvalidWifError('WIF is required');
  }
  const check = validateWif(wif);
  if (!check.valid) {
    throw new InvalidWifError(check.error);
  }
}

function validateIdentityName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new InvalidNameError('', 'Name is required');
  }
  if (!IDENTITY_NAME_RE.test(name)) {
    throw new InvalidNameError(name);
  }
}

// ─── Workflow Orchestrators ────────────────────────────────────────

/**
 * Build and sign a name commitment transaction (Step 1 of identity creation)
 */
export function buildAndSignCommitment(
  params: CreateCommitmentParams,
  network: Network
): CreateCommitmentResult {
  validateIdentityWif(params.wif);
  validateIdentityName(params.name);
  if (!params.utxos || params.utxos.length === 0) {
    throw new TransactionBuildError('At least one UTXO is required');
  }
  const verusNetwork = getNetwork(network === 'testnet');
  const networkConfig = NETWORK_CONFIG[network];

  const commitment = prepareNameCommitment(
    params.name,
    params.changeAddress,
    params.referral,
    params.parent,
    network,
  );

  const utxos = params.utxos;
  const selection = selectUtxos(
    utxos,
    0n,
    new Map(),
    1,
    networkConfig.chainId,
    undefined,
    true,
  );

  const txb = new TransactionBuilder(verusNetwork);
  txb.setVersion(4);
  txb.setExpiryHeight(params.expiryHeight || 0);
  txb.setVersionGroupId(VERSION_GROUP_ID);

  for (const utxo of selection.selected) {
    txb.addInput(
      Buffer.from(utxo.txid, 'hex').reverse(),
      utxo.outputIndex,
      0xffffffff,
      Buffer.from(utxo.script, 'hex'),
    );
  }

  txb.addOutput(commitment.commitmentScript, 0);

  if (selection.nativeChange > 0n) {
    txb.addOutput(params.changeAddress, toSafeNumber(selection.nativeChange));
  }

  const unsignedTx = txb.buildIncomplete();
  const { signedTx, txid } = signTransactionSmart(
    unsignedTx.toHex(),
    params.wif,
    selection.selected,
    verusNetwork,
  );

  return {
    signedTx,
    txid,
    fee: selection.fee,
    identityAddress: commitment.identityAddress,
    commitmentData: {
      name: params.name,
      salt: commitment.salt.toString('hex'),
      referral: params.referral || null,
      parent: params.parent || null,
      namereservationHex: commitment.serializedReservation.toString('hex'),
      commitmentHash: commitment.commitmentHash.toString('hex'),
    },
  };
}

/**
 * Build and sign an identity registration transaction (Step 2)
 */
export function buildAndSignRegistration(
  params: RegisterIdentityParams,
  network: Network
): RegisterIdentityResult {
  validateIdentityWif(params.wif);
  if (!params.primaryAddresses || params.primaryAddresses.length === 0) {
    throw new TransactionBuildError('At least one primary address is required');
  }
  if (!params.utxos || params.utxos.length === 0) {
    throw new TransactionBuildError('At least one funding UTXO is required');
  }
  const verusNetwork = getNetwork(network === 'testnet');
  const networkConfig = NETWORK_CONFIG[network];
  const systemId = networkConfig.chainId;

  const commitData = params.commitmentData;
  const parentIAddress = commitData.parent || systemId;
  const isSubId = !isVRSCParent(commitData.parent || undefined, network);

  const effectiveParent = isSubId ? commitData.parent! : systemId;
  const identityAddress = deriveIdentityAddress(commitData.name, effectiveParent);

  const identity = createIdentityObject({
    name: commitData.name,
    primaryAddresses: params.primaryAddresses,
    minSigs: params.minSigs,
    revocationAuthority: params.revocationAuthority || identityAddress,
    recoveryAuthority: params.recoveryAuthority || identityAddress,
    parentIAddress,
    systemId,
  });

  const identityScript = buildIdentityScript(identity);
  const reservationScript = buildReservationScript(
    identityAddress,
    Buffer.from(commitData.namereservationHex, 'hex'),
    isSubId,
  );

  if (isSubId) {
    return _buildSubIdRegistration(params, identity, identityScript, reservationScript, identityAddress, parentIAddress, systemId, verusNetwork);
  }

  return _buildVrscRegistration(params, identityScript, reservationScript, identityAddress, parentIAddress, systemId, verusNetwork);
}

function _buildVrscRegistration(
  params: RegisterIdentityParams,
  identityScript: Buffer,
  reservationScript: Buffer,
  identityAddress: string,
  parentIAddress: string,
  systemId: string,
  network: any,
): RegisterIdentityResult {
  const commitData = params.commitmentData;
  const hasReferral = !!commitData.referral;
  const fees = calculateRegistrationFees(
    hasReferral,
    params.registrationFee,
    params.referralLevels,
  );

  const referralOutputs: { script: Buffer; value: bigint }[] = [];
  if (hasReferral) {
    const chain = (params.referralChain && params.referralChain.length > 0)
      ? params.referralChain
      : commitData.referral ? [commitData.referral] : [];

    for (const referrerAddr of chain) {
      referralOutputs.push({
        script: buildReferralPaymentScript(referrerAddr),
        value: fees.referralAmount,
      });
    }
  }

  // requiredNative = full registration fee (referral outputs come out of this total)
  // implicit fee to miners = totalFee - sum(referral outputs) + txFee
  const totalFee = params.registrationFee ?? DEFAULT_REGISTRATION_FEE;
  const totalReferralPayments = referralOutputs.reduce((sum, o) => sum + o.value, 0n);
  const requiredNative = totalFee;
  const numOutputs = 2 + referralOutputs.length + 1;
  const selection = selectUtxos(
    params.utxos,
    requiredNative,
    new Map(),
    numOutputs,
    systemId,
    undefined,
    true,
  );

  const txb = new TransactionBuilder(network);
  txb.setVersion(4);
  txb.setExpiryHeight(params.expiryHeight || 0);
  txb.setVersionGroupId(VERSION_GROUP_ID);

  const commitUtxo = params.commitmentUtxo;
  txb.addInput(
    Buffer.from(commitUtxo.txid, 'hex').reverse(),
    commitUtxo.outputIndex,
    0xffffffff,
    Buffer.from(commitUtxo.script, 'hex'),
  );

  for (const utxo of selection.selected) {
    txb.addInput(
      Buffer.from(utxo.txid, 'hex').reverse(),
      utxo.outputIndex,
      0xffffffff,
      Buffer.from(utxo.script, 'hex'),
    );
  }

  txb.addOutput(identityScript, 0);

  for (const referralOut of referralOutputs) {
    txb.addOutput(referralOut.script, toSafeNumber(referralOut.value));
  }

  txb.addOutput(reservationScript, 0);

  if (selection.nativeChange > 0n) {
    txb.addOutput(params.changeAddress, toSafeNumber(selection.nativeChange));
  }

  const unsignedTx = txb.buildIncomplete();
  const allUtxos: Utxo[] = [commitUtxo, ...selection.selected];

  // The registration fee is burned as an IMPLICIT miner fee (identity and
  // reservation outputs carry 0; referral payouts come out of the total) —
  // this matches on-chain registrations, and the daemon exempts recognized
  // identity definitions from its absurd-fee check (IS_HIGH_FEE). utxo-lib's
  // client-side fee-rate cap (default 2500 sat/vbyte) must be told the
  // intended absolute fee or build() throws "Transaction has absurd fees".
  const expectedImplicitFee =
    commitUtxo.satoshis + totalFee - totalReferralPayments + selection.fee;

  const { signedTx, txid } = signTransactionSmart(
    unsignedTx.toHex(),
    params.wif,
    allUtxos,
    network,
    expectedImplicitFee,
  );

  return {
    signedTx,
    txid,
    fee: selection.fee,
    identityAddress,
    registrationFee: totalFee - totalReferralPayments,
    referralPayments: referralOutputs.length,
    referralAmountEach: fees.referralAmount,
    inputsUsed: allUtxos.length,
    nativeChange: selection.nativeChange,
  };
}

function _buildSubIdRegistration(
  params: RegisterIdentityParams,
  identity: any,
  identityScript: Buffer,
  reservationScript: Buffer,
  identityAddress: string,
  parentIAddress: string,
  systemId: string,
  network: any,
): RegisterIdentityResult {
  const registrationFeeAmount = params.registrationFeeAmount;
  if (!registrationFeeAmount || registrationFeeAmount <= 0n) {
    throw new Error(
      'registrationFeeAmount is required for sub-ID registration. ' +
      'Specify the fee in parent currency satoshis.'
    );
  }

  const feeOutput = buildRegistrationFeeOutput(
    parentIAddress,
    registrationFeeAmount,
    systemId,
    params.changeAddress,
  );

  const requiredCurrencies = new Map<string, bigint>([
    [parentIAddress, registrationFeeAmount],
  ]);

  const nativeImportFee = params.nativeImportFee || 0n;
  const nativeTarget = feeOutput.nativeValue + nativeImportFee;

  const numOutputs = 4;
  const selection = selectUtxos(
    params.utxos,
    nativeTarget,
    requiredCurrencies,
    numOutputs,
    systemId,
    undefined,
    true,
  );

  const txb = new TransactionBuilder(network);
  txb.setVersion(4);
  txb.setExpiryHeight(params.expiryHeight || 0);
  txb.setVersionGroupId(VERSION_GROUP_ID);

  const commitUtxo = params.commitmentUtxo;
  txb.addInput(
    Buffer.from(commitUtxo.txid, 'hex').reverse(),
    commitUtxo.outputIndex,
    0xffffffff,
    Buffer.from(commitUtxo.script, 'hex'),
  );

  for (const utxo of selection.selected) {
    txb.addInput(
      Buffer.from(utxo.txid, 'hex').reverse(),
      utxo.outputIndex,
      0xffffffff,
      Buffer.from(utxo.script, 'hex'),
    );
  }

  txb.addOutput(identityScript, 0);
  txb.addOutput(feeOutput.script, toSafeNumber(feeOutput.nativeValue));
  txb.addOutput(reservationScript, 0);

  const hasTokenChange = selection.currencyChanges.size > 0;
  if (hasTokenChange || selection.nativeChange > 0n) {
    if (hasTokenChange) {
      const tokenChangeScript = buildTokenChangeOutput(
        params.changeAddress,
        selection.currencyChanges,
      );
      txb.addOutput(tokenChangeScript.script, toSafeNumber(selection.nativeChange));
    } else {
      txb.addOutput(params.changeAddress, toSafeNumber(selection.nativeChange));
    }
  }

  const unsignedTx = txb.buildIncomplete();
  const allUtxos: Utxo[] = [commitUtxo, ...selection.selected];

  const { signedTx, txid } = signTransactionSmart(
    unsignedTx.toHex(),
    params.wif,
    allUtxos,
    network,
  );

  return {
    signedTx,
    txid,
    fee: selection.fee,
    identityAddress,
    registrationFee: registrationFeeAmount,
    referralPayments: 0,
    referralAmountEach: 0n,
    inputsUsed: allUtxos.length,
    nativeChange: selection.nativeChange,
  };
}

/**
 * Build and sign an identity update transaction
 */
export function buildAndSignIdentityUpdate(
  params: UpdateIdentityParams,
  network: Network,
  operation: 'update' | 'revoke' | 'recover' | 'lock' | 'unlock' = 'update',
  lockUnlockParams?: { unlockAfter?: number }
): UpdateIdentityResult {
  validateIdentityWif(params.wif);
  if (!params.identityHex) {
    throw new TransactionBuildError('identityHex is required');
  }
  if (!params.utxos || params.utxos.length === 0) {
    throw new TransactionBuildError('At least one funding UTXO is required');
  }
  const verusNetwork = getNetwork(network === 'testnet');
  const networkConfig = NETWORK_CONFIG[network];
  const systemId = networkConfig.chainId;

  const identity = new Identity();
  identity.fromBuffer(Buffer.from(params.identityHex, 'hex'));

  switch (operation) {
    case 'update': {
      if (params.primaryAddresses) {
        identity.setPrimaryAddresses(params.primaryAddresses);
      }
      if (params.minSigs !== undefined) {
        identity.min_sigs = new BN(params.minSigs);
      }
      if (params.revocationAuthority) {
        identity.setRevocation(params.revocationAuthority);
      }
      if (params.recoveryAuthority) {
        identity.setRecovery(params.recoveryAuthority);
      }
      if (params.contentMap) {
        for (const [key, value] of Object.entries(params.contentMap)) {
          identity.content_map.set(key, Buffer.from(value, 'hex'));
        }
      }
      if (params.contentMultimap) {
        const jsonObj: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(params.contentMultimap)) {
          jsonObj[key] = Array.isArray(value) ? value : [value];
        }
        identity.content_multimap = ContentMultiMap.fromJson(jsonObj);
      }
      break;
    }
    case 'revoke': {
      identity.clearContentMultiMap();
      identity.revoke();
      break;
    }
    case 'recover': {
      identity.unrevoke();
      identity.clearContentMultiMap();
      if (params.primaryAddresses) {
        identity.setPrimaryAddresses(params.primaryAddresses);
      }
      if (params.revocationAuthority) {
        identity.setRevocation(params.revocationAuthority);
      }
      if (params.recoveryAuthority) {
        identity.setRecovery(params.recoveryAuthority);
      }
      break;
    }
    case 'lock': {
      const unlockAfter = lockUnlockParams?.unlockAfter;
      if (!unlockAfter) {
        throw new Error('unlockAfter (block height) is required for lock operation');
      }
      identity.lock(new BN(unlockAfter));
      break;
    }
    case 'unlock': {
      identity.unlock(new BN(0), new BN(params.expiryHeight || 0));
      break;
    }
  }

  const identityBuf = identity.toBuffer();
  const unfundedHex = createUnfundedIdentityUpdate(
    identityBuf.toString('hex'),
    verusNetwork,
    params.expiryHeight || 0,
  );

  const selection = selectUtxos(
    params.utxos,
    0n,
    new Map(),
    1,
    systemId,
    undefined,
    true,
  );

  const txb = new TransactionBuilder(verusNetwork);
  txb.setVersion(4);
  txb.setExpiryHeight(params.expiryHeight || 0);
  txb.setVersionGroupId(VERSION_GROUP_ID);

  for (const utxo of selection.selected) {
    txb.addInput(
      Buffer.from(utxo.txid, 'hex').reverse(),
      utxo.outputIndex,
      0xffffffff,
      Buffer.from(utxo.script, 'hex'),
    );
  }

  const unfundedTx = Transaction.fromHex(unfundedHex, verusNetwork);
  for (const out of unfundedTx.outs) {
    txb.addOutput(out.script, out.value);
  }

  if (selection.nativeChange > 0n) {
    txb.addOutput(params.changeAddress, toSafeNumber(selection.nativeChange));
  }

  const fundedTx = txb.buildIncomplete();
  const fundedHex = fundedTx.toHex();

  const prevOutScripts = selection.selected.map(u => Buffer.from(u.script, 'hex'));
  const idUtxo = params.identityUtxo;
  const completedHex = completeFundedIdentityUpdate(
    fundedHex,
    verusNetwork,
    prevOutScripts,
    {
      hash: Buffer.from(idUtxo.txid, 'hex').reverse(),
      index: idUtxo.outputIndex,
      sequence: 0xffffffff,
      script: Buffer.from(idUtxo.script, 'hex'),
    },
  );

  const allUtxos: Utxo[] = [...selection.selected, idUtxo];
  const { signedTx, txid } = signTransactionSmart(
    completedHex,
    params.wif,
    allUtxos,
    verusNetwork,
  );

  return {
    signedTx,
    txid,
    fee: selection.fee,
    identityAddress: identity.getIdentityAddress(),
    operation,
    inputsUsed: allUtxos.length,
    nativeChange: selection.nativeChange,
  };
}
