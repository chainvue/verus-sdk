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
import { script as bscript, opcodes, TransactionBuilder, Transaction, smarttxs, ECPair } from '@bitgo/utxo-lib';
import {
  NETWORK_CONFIG,
  VERSION_GROUP_ID,
  DEFAULT_REGISTRATION_FEE,
  DEFAULT_REFERRAL_LEVELS,
  RESERVE_TRANSFER_FEE,
  RESERVE_TRANSFER_EVAL_PKH,
  PUBKEY_HASH_PREFIX,
  I_ADDR_VERSION,
} from '../constants/index.js';
import type { Network } from '../constants/index.js';
import { sha256d, writeCompactSize, iAddressToHash, toSafeNumber } from '../utils/index.js';
import { signTransactionSmart, getNetwork, resolveExpiryHeight, assertNativeConservation, type VerusNetwork } from '../signing/index.js';
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
 * Assert a base58check address has the expected version byte.
 *
 * KeyID.fromAddress / IdentityID.fromAddress discard the version byte and stamp
 * their own, so an i-address passed where an R-address is expected (or vice
 * versa) is silently laundered into a different, uncontrollable destination —
 * e.g. an i-address as a primary key becomes the hash of the identity paid as a
 * P2PKH nobody controls, permanently bricking the new identity. Validate up
 * front instead.
 */
export function assertAddressVersion(address: string, expectedVersion: number, label: string): void {
  let version: number;
  try {
    version = fromBase58Check(address).version;
  } catch {
    throw new TransactionBuildError(`${label} is not a valid base58check address: ${JSON.stringify(address)}`);
  }
  if (version !== expectedVersion) {
    const want = expectedVersion === I_ADDR_VERSION ? 'an identity i-address' : 'an R-address';
    throw new TransactionBuildError(
      `${label} must be ${want} (version ${expectedVersion}), got version ${version}: ${address}`,
    );
  }
}

/** minSigs must be an integer in [1, number of primary addresses]. */
function validateMinSigs(minSigs: number, primaryCount: number): void {
  if (!Number.isInteger(minSigs) || minSigs < 1 || minSigs > primaryCount) {
    throw new TransactionBuildError(
      `minSigs must be an integer between 1 and the number of primary addresses (${primaryCount}), got ${minSigs}`,
    );
  }
}

/** Validate the address-typed params shared by identity update/recover. */
function validateUpdateAddressParams(params: {
  primaryAddresses?: string[];
  revocationAuthority?: string;
  recoveryAuthority?: string;
}): void {
  params.primaryAddresses?.forEach((a, i) =>
    assertAddressVersion(a, PUBKEY_HASH_PREFIX, `primaryAddresses[${i}]`),
  );
  if (params.revocationAuthority) {
    assertAddressVersion(params.revocationAuthority, I_ADDR_VERSION, 'revocationAuthority');
  }
  if (params.recoveryAuthority) {
    assertAddressVersion(params.recoveryAuthority, I_ADDR_VERSION, 'recoveryAuthority');
  }
}

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
  params.primaryAddresses.forEach((addr, i) =>
    assertAddressVersion(addr, PUBKEY_HASH_PREFIX, `primaryAddresses[${i}]`),
  );
  assertAddressVersion(params.revocationAuthority, I_ADDR_VERSION, 'revocationAuthority');
  assertAddressVersion(params.recoveryAuthority, I_ADDR_VERSION, 'recoveryAuthority');
  validateMinSigs(params.minSigs ?? 1, params.primaryAddresses.length);
  const primaryKeys = params.primaryAddresses.map(addr => KeyID.fromAddress(addr));

  const identity = new Identity({
    version: Identity.VERSION_CURRENT,
    flags: new BN(0),
    min_sigs: new BN(params.minSigs || 1),
    primary_addresses: primaryKeys,
    parent: IdentityID.fromAddress(params.parentIAddress),
    system_id: IdentityID.fromAddress(params.systemId),
    name: params.name,
    revocation_authority: IdentityID.fromAddress(params.revocationAuthority),
    recovery_authority: IdentityID.fromAddress(params.recoveryAuthority),
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
  // KeyID.fromAddress launders any address to the R-address form, so token
  // change to an i-address changeAddress was paid to a transparent script
  // nobody controls (burned on paths with no funded-transfer validator). Build
  // a pay-to-identity destination for i-addresses, and reject anything that is
  // neither an R- nor an i-address rather than silently mis-routing it.
  const version = fromBase58Check(changeAddress).version;
  let destination: InstanceType<typeof TxDestination>;
  if (version === I_ADDR_VERSION) {
    destination = new TxDestination(IdentityID.fromAddress(changeAddress));
  } else if (version === PUBKEY_HASH_PREFIX) {
    destination = new TxDestination(KeyID.fromAddress(changeAddress));
  } else {
    throw new TransactionBuildError(
      `token change address must be an R-address or identity i-address, got version ${version}: ${changeAddress}`,
    );
  }

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

  // The commitment output is controlled by, and must be spent by, the key that
  // completes the registration in step 2 — which signs with this same WIF. Using
  // changeAddress as the control address broke that when changeAddress differed
  // from the WIF's address (unsignable commitment), or was an i-address
  // (KeyID.fromAddress laundered it to an uncontrollable key — permanently
  // unspendable, wasting the commitment fee). Derive it from the WIF instead.
  const controlAddress = (ECPair.fromWIF(params.wif, verusNetwork) as { getAddress(): string }).getAddress();
  const commitment = prepareNameCommitment(
    params.name,
    controlAddress,
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
  txb.setExpiryHeight(resolveExpiryHeight(params.expiryHeight));
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
    // utxo-lib's addOutput only resolves base58 R-addresses; an i-address
    // changeAddress needs the explicit P2ID script (matching sendCurrency), or
    // it throws an untyped "no matching Script".
    if (params.changeAddress.startsWith('i')) {
      txb.addOutput(identityPaymentScript(params.changeAddress), toSafeNumber(selection.nativeChange));
    } else {
      txb.addOutput(params.changeAddress, toSafeNumber(selection.nativeChange));
    }
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
    ...(params.minSigs !== undefined ? { minSigs: params.minSigs } : {}),
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
  network: VerusNetwork,
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

    // Each entry pays referralAmount = totalFee/(levels+2); more entries than
    // the chain allows would pay out more than the registration fee, leaving the
    // transaction under-funded (outputs > inputs).
    const referralLevels = params.referralLevels ?? DEFAULT_REFERRAL_LEVELS;
    if (chain.length > referralLevels) {
      throw new TransactionBuildError(
        `referralChain has ${chain.length} entries but at most ${referralLevels} referral levels are allowed`,
      );
    }

    for (const referrerAddr of chain) {
      referralOutputs.push({
        script: buildReferralPaymentScript(referrerAddr),
        value: fees.referralAmount,
      });
    }
  }

  // With a referral, the registrant pays the discounted issuer fee, not the full
  // registration fee — the referral outputs are paid OUT OF the issuer fee (the
  // referrers take referralAmount each, the rest is the implicit miner fee).
  // Verified live on VRSCTEST: a 1-referral registration required 80 VRSC total
  // (20 to the referrer, 60 to the miner), not 100. Funding totalFee overpaid by
  // exactly (totalFee - issuerFee) every referred registration.
  const totalFee = params.registrationFee ?? DEFAULT_REGISTRATION_FEE;
  const totalReferralPayments = referralOutputs.reduce((sum, o) => sum + o.value, 0n);
  const requiredNative = hasReferral ? fees.issuerFee : totalFee;
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
  txb.setExpiryHeight(resolveExpiryHeight(params.expiryHeight));
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
    // utxo-lib's addOutput only resolves base58 R-addresses; an i-address
    // changeAddress needs the explicit P2ID script (matching sendCurrency), or
    // it throws an untyped "no matching Script".
    if (params.changeAddress.startsWith('i')) {
      txb.addOutput(identityPaymentScript(params.changeAddress), toSafeNumber(selection.nativeChange));
    } else {
      txb.addOutput(params.changeAddress, toSafeNumber(selection.nativeChange));
    }
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
    commitUtxo.satoshis + requiredNative - totalReferralPayments + selection.fee;

  // Independent value-conservation check on the assembled transaction: recompute
  // the native fee straight from inputs and outputs and require it to equal the
  // fee this path intends to pay. buildAndSign has the same guard; registration
  // moves the largest amounts (the registration fee is burned as implicit fee),
  // so a selection/accounting slip must fail loudly here instead of being paid
  // to miners.
  const assembledNativeFee =
    allUtxos.reduce((sum, u) => sum + u.satoshis, 0n) -
    unsignedTx.outs.reduce((sum: bigint, o: { value: number }) => sum + BigInt(o.value), 0n);
  if (assembledNativeFee !== expectedImplicitFee) {
    throw new TransactionBuildError(
      `identity registration value conservation failed: assembled native fee ${assembledNativeFee} sat ` +
        `!= intended ${expectedImplicitFee} sat`,
    );
  }

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
    // The registrant's registration outlay: the discounted issuer fee when
    // referred, the full fee otherwise. (Of this, referralPayments go to the
    // referrers and the remainder is the implicit miner fee.)
    registrationFee: requiredNative,
    referralPayments: referralOutputs.length,
    referralAmountEach: fees.referralAmount,
    inputsUsed: allUtxos.length,
    nativeChange: selection.nativeChange,
  };
}

function _buildSubIdRegistration(
  params: RegisterIdentityParams,
  identity: Identity,
  identityScript: Buffer,
  reservationScript: Buffer,
  identityAddress: string,
  parentIAddress: string,
  systemId: string,
  network: VerusNetwork,
): RegisterIdentityResult {
  const registrationFeeAmount = params.registrationFeeAmount;
  if (!registrationFeeAmount || registrationFeeAmount <= 0n) {
    throw new TransactionBuildError(
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
  txb.setExpiryHeight(resolveExpiryHeight(params.expiryHeight));
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
      // utxo-lib's addOutput only resolves base58 R-addresses; an i-address
    // changeAddress needs the explicit P2ID script (matching sendCurrency), or
    // it throws an untyped "no matching Script".
    if (params.changeAddress.startsWith('i')) {
      txb.addOutput(identityPaymentScript(params.changeAddress), toSafeNumber(selection.nativeChange));
    } else {
      txb.addOutput(params.changeAddress, toSafeNumber(selection.nativeChange));
    }
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

  // update/lock/unlock are authorized by the identity's primary key(s). The fork
  // signs CC inputs with whatever key it is given, so a WIF that does not control
  // the identity would yield a "valid" signed tx the daemon rejects at broadcast.
  // Verify the signer is a current primary before spending the identity input.
  // (revoke/recover use the revocation/recovery authority — a separate identity
  // whose keys we can't check here — so they are excluded.)
  // update/lock/unlock are authorized by the identity's own primary key(s).
  // revoke/recover are authorized by the revocation/recovery AUTHORITY — a
  // separate identity whose keys aren't in identityHex, so uncheckable in
  // general — EXCEPT the very common self-authority case (authority == this
  // identity), which reduces to the same primary check. Guard what we can.
  let requiresPrimary = operation === 'update' || operation === 'lock' || operation === 'unlock';
  if (!requiresPrimary && (operation === 'revoke' || operation === 'recover')) {
    const self = identity.getIdentityAddress();
    const authority =
      operation === 'revoke'
        ? identity.revocation_authority?.toAddress()
        : identity.recovery_authority?.toAddress();
    requiresPrimary = authority === self;
  }
  if (requiresPrimary) {
    const signerAddress = (ECPair.fromWIF(params.wif, verusNetwork) as { getAddress(): string }).getAddress();
    const currentPrimaries = (identity.primary_addresses ?? []).map((k) => k.toAddress());
    if (!currentPrimaries.includes(signerAddress)) {
      throw new TransactionBuildError(
        `the provided WIF (${signerAddress}) is not among the identity's primary addresses ` +
          `[${currentPrimaries.join(', ')}]; it cannot authorize a ${operation}.`,
      );
    }
  }

  switch (operation) {
    case 'update': {
      validateUpdateAddressParams(params);
      if (params.primaryAddresses) {
        identity.setPrimaryAddresses(params.primaryAddresses);
      }
      if (params.minSigs !== undefined) {
        validateMinSigs(params.minSigs, identity.primary_addresses?.length ?? 0);
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
          // Buffer.from(_, 'hex') silently drops non-hex characters and
          // truncates odd-length input, so a malformed value would be committed
          // to the identity on-chain as wrong/empty bytes with no error. Reject
          // it instead.
          if (!/^[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
            throw new TransactionBuildError(
              `contentMap["${key}"] must be an even-length hex string (got ${JSON.stringify(value)})`,
            );
          }
          identity.content_map.set(key, Buffer.from(value, 'hex'));
        }
      }
      if (params.contentMultimap) {
        const jsonObj: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(params.contentMultimap)) {
          // Keys are vdxf i-addresses; ContentMultiMap.fromJson runs
          // fromBase58Check(key) and throws an untyped error for a bad key.
          assertAddressVersion(key, I_ADDR_VERSION, `contentMultimap key "${key}"`);
          const items = Array.isArray(value) ? value : [value];
          // Same trap as contentMap: ContentMultiMap.fromJson runs
          // Buffer.from(_, 'hex') on each array entry with no validation, so a
          // malformed value is silently truncated/emptied and committed on-chain.
          for (const item of items) {
            if (!/^[0-9a-fA-F]*$/.test(item) || item.length % 2 !== 0) {
              throw new TransactionBuildError(
                `contentMultimap["${key}"] entries must be even-length hex strings (got ${JSON.stringify(item)})`,
              );
            }
          }
          jsonObj[key] = items;
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
      validateUpdateAddressParams(params);
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
        throw new TransactionBuildError('unlockAfter (block height) is required for lock operation');
      }
      identity.lock(new BN(unlockAfter));
      break;
    }
    case 'unlock': {
      // Identity.unlock anchors the remaining lock delay to the tx expiry height
      // (unlock_after += txExpiryHeight). expiryHeight 0 ("never expires") leaves
      // the delay unanchored — a relative delay collapses to a past height and
      // the timelock is effectively bypassed. Require a real height for unlock.
      const unlockExpiry = resolveExpiryHeight(params.expiryHeight);
      if (unlockExpiry === 0) {
        throw new TransactionBuildError(
          'unlock requires a non-zero expiryHeight (currentBlockHeight + DEFAULT_EXPIRY_DELTA): ' +
            'the unlock delay is anchored to it, so 0 would bypass the timelock.',
        );
      }
      identity.unlock(new BN(0), new BN(unlockExpiry));
      break;
    }
  }

  const identityBuf = identity.toBuffer();
  const unfundedHex = createUnfundedIdentityUpdate(
    identityBuf.toString('hex'),
    verusNetwork,
    resolveExpiryHeight(params.expiryHeight),
  );

  const selection = selectUtxos(
    params.utxos,
    0n,
    new Map(),
    1,
    systemId,
    undefined,
    true,
    // The identity output embeds the full serialized identity (a large
    // contentMultimap can make it multi-KB); size the fee from its real bytes
    // so a big update isn't fee-estimated below the relay minimum.
    unfundedHex.length / 2,
  );

  const txb = new TransactionBuilder(verusNetwork);
  txb.setVersion(4);
  txb.setExpiryHeight(resolveExpiryHeight(params.expiryHeight));
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
    // utxo-lib's addOutput only resolves base58 R-addresses; an i-address
    // changeAddress needs the explicit P2ID script (matching sendCurrency), or
    // it throws an untyped "no matching Script".
    if (params.changeAddress.startsWith('i')) {
      txb.addOutput(identityPaymentScript(params.changeAddress), toSafeNumber(selection.nativeChange));
    } else {
      txb.addOutput(params.changeAddress, toSafeNumber(selection.nativeChange));
    }
  }

  const fundedTx = txb.buildIncomplete();
  const fundedHex = fundedTx.toHex();

  const prevOutScripts = selection.selected.map(u => Buffer.from(u.script, 'hex'));
  const idUtxo = params.identityUtxo;
  // The identity input is spent and its definition output is recreated with
  // value 0, so any native value riding on identityUtxo would be silently
  // burned to miner fee. Identity outputs normally carry 0; fail closed if not.
  if (idUtxo.satoshis !== 0n) {
    throw new TransactionBuildError(
      `identityUtxo carries ${idUtxo.satoshis} native satoshis, which would be burned to miner fee ` +
        `(the recreated identity output is value 0). Spend that value separately before updating.`,
    );
  }
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
  // The identity input and its recreated output are both value 0, so the
  // assembled native fee must equal selection.fee. Fail loudly on any slip.
  assertNativeConservation(
    allUtxos,
    Transaction.fromHex(completedHex, verusNetwork).outs,
    selection.fee,
    `identity ${operation}`,
  );
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
