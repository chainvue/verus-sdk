/**
 * The other outputs of a currency-definition (`definecurrency`) transaction,
 * built offline. A launch transaction carries seven outputs:
 *
 *   0  identity update    (EVAL_IDENTITY_PRIMARY)   — re-issues the defining ID with FLAG_ACTIVECURRENCY
 *   1  currency definition(EVAL_CURRENCY_DEFINITION) — see definition.ts
 *   2  cross-chain import (EVAL_CROSSCHAIN_IMPORT)   — same-chain definition import stub
 *   3  notarization       (EVAL_ACCEPTEDNOTARIZATION)— DEF_NOTARIZATION|PRE_LAUNCH|SAME_CHAIN stub + currency state
 *   4  cross-chain export (EVAL_CROSSCHAIN_EXPORT)   — definition export stub
 *   5  reserve deposit    (EVAL_RESERVE_DEPOSIT)     — carries the launch (import) fee
 *   6  change             (identity CC output)       — returns funds to the defining ID
 *
 * Outputs 2–4 embed the current chain tip height; everything else is a
 * deterministic function of the definition. Byte-locked against live
 * `definecurrency` output across tokens and fractional baskets — see
 * test/currency-outputs.test.ts. This produces the output *scripts*; funding,
 * the identity input, and signing are assembled separately.
 *
 * For a same-chain token/basket the notarization is a fixed stub (nVersion 2,
 * flags 0x83, null prev-refs, empty state maps) — it does NOT depend on live
 * notarization state, which is why the launch can be built off a lite node.
 */
import BN from 'bn.js';
import { Identity } from '../fork/boundary.js';
import { writeCompactSize, iAddressToHash } from '../utils/index.js';
import { buildIdentityScript, deriveIdentityAddress } from '../identity/index.js';
import { TransactionBuildError } from '../errors.js';
import {
  CURRENCY_OPTION,
  normalizeCurrencyDefinition,
  buildCurrencyDefinitionScript,
  type CurrencyDefinitionInput,
  type NormalizedDefinition,
} from './definition.js';
import {
  SATOSHIDEN,
  ZEROS_32,
  uint16LE,
  int32LE,
  uint32LE,
  int64LE,
  varInt,
  uint160Raw,
  uint256Raw,
  currencyValueMap,
  wrapCcOutput,
} from './wire.js';

// CryptoCondition eval codes and the daemon's fixed destination pubkeys
// (`src/cc/CCcustom.cpp`). Chain-independent, so safe to embed. The import
// output is special: it pays to the Hash160 of its pubkey (TYPE_PKH), not the
// raw pubkey (TYPE_PK) every other CC output uses.
const EVAL_CROSSCHAIN_IMPORT = 13;
const EVAL_ACCEPTEDNOTARIZATION = 5;
const EVAL_CROSSCHAIN_EXPORT = 12;
const EVAL_RESERVE_DEPOSIT = 11;

const CC_PUBKEY = {
  [EVAL_ACCEPTEDNOTARIZATION]: '02d85f078815b7a52faa92639c3691d2a640e26c4e06de54dd1490f0e93bcc11c3',
  [EVAL_CROSSCHAIN_EXPORT]: '02cbfe54fb371cfc89d35b46cafcad6ac3b7dc9b40546b0f30b2b29a4865ed3b4a',
  [EVAL_RESERVE_DEPOSIT]: '03b99d7cb946c5b1f8a54cde49b8d7e0a2a15a22639feb798009f82b519526c050',
} as const;
// Hash160 of the EVAL_CROSSCHAIN_IMPORT pubkey (038d259e…). The import output's
// destination is this KeyID, not the pubkey.
const CC_IMPORT_KEYHASH = Buffer.from('6e4ae35cca122eb65e73abd4c956940ef25a3eab', 'hex');

// Identity flags (`identity.h`).
const IDENTITY_FLAG_ACTIVECURRENCY = 1;
const IDENTITY_FLAG_TOKENIZED_ID_CONTROL = 4;

function pubkeyDest(evalCode: keyof typeof CC_PUBKEY) {
  return { kind: 'pubkey' as const, pubkey: Buffer.from(CC_PUBKEY[evalCode], 'hex') };
}

/** A built transaction output: its scriptPubKey hex and satoshi value. */
export interface CurrencyLaunchOutput {
  script: string;
  value: bigint;
}

/** Everything needed to assemble the launch outputs that the definition alone can't provide. */
export interface CurrencyLaunchContext {
  /** The `identity` object from the lite node's `getidentity` for the defining ID. */
  identity: Record<string, unknown>;
  /** Current chain tip height (from the lite node); embedded in import/notarization/export. */
  height: number;
  /**
   * Currency launch (registration) fee in native satoshis — the fee the chain
   * charges to define a currency (query `getcurrency <parent>`; 200 native for a
   * standard token/basket, 0.02 native for an NFT). Half of it funds the reserve
   * deposit. Passing the wrong value yields a definition the daemon rejects.
   */
  launchFeeSats: bigint;
}

/** The seven output scripts of a currency-definition transaction. */
export interface CurrencyLaunchOutputs {
  identityUpdate: CurrencyLaunchOutput;
  currencyDefinition: CurrencyLaunchOutput;
  import: CurrencyLaunchOutput;
  notarization: CurrencyLaunchOutput;
  export: CurrencyLaunchOutput;
  reserveDeposit: CurrencyLaunchOutput;
  change: CurrencyLaunchOutput;
  /** Flat, in-order [0..6] view — the order they must appear in the transaction. */
  ordered: CurrencyLaunchOutput[];
}

/** Output 0: re-issue the defining identity with FLAG_ACTIVECURRENCY (+ TOKENIZED_ID_CONTROL for NFTs). */
function buildIdentityUpdateOutput(identityJson: Record<string, unknown>, options: number): CurrencyLaunchOutput {
  const identity = Identity.fromJson(identityJson);
  // An identity may define a currency only once (pbaas.cpp:4533 "Identity already
  // has used its one-time ability to define a currency"). If FLAG_ACTIVECURRENCY
  // is already set, the launch is doomed — fail closed instead of signing it.
  if (identity.flags.and(new BN(IDENTITY_FLAG_ACTIVECURRENCY)).gtn(0)) {
    throw new TransactionBuildError('identity already has an active currency (FLAG_ACTIVECURRENCY set); a currency can be defined only once per identity');
  }
  identity.flags = identity.flags.or(new BN(IDENTITY_FLAG_ACTIVECURRENCY));
  if (options & CURRENCY_OPTION.NFT_TOKEN) {
    identity.flags = identity.flags.or(new BN(IDENTITY_FLAG_TOKENIZED_ID_CONTROL));
  }
  return { script: buildIdentityScript(identity).toString('hex'), value: 0n };
}

/** Output 2: same-chain currency-definition import stub (`CCrossChainImport`). */
function serializeImport(systemHash: Buffer, currencyHash: Buffer, exportTxOutNum: number, height: number): Buffer {
  return Buffer.concat([
    uint16LE(1, 'import.version'),
    uint16LE(0x0009, 'import.flags'), // DEFINITION_IMPORT(1) | SAME_CHAIN(8)
    uint160Raw(systemHash, 'import.sourceSystemID'),
    uint32LE(height, 'import.sourceSystemHeight'),
    uint160Raw(currencyHash, 'import.importCurrencyID'),
    currencyValueMap([], 'import.importValue'),
    currencyValueMap([], 'import.totalReserveOutMap'),
    int32LE(0, 'import.numOutputs'),
    uint256Raw(ZEROS_32, 'import.hashReserveTransfers'),
    uint256Raw(ZEROS_32, 'import.exportTxId'),
    int32LE(exportTxOutNum, 'import.exportTxOutNum'),
  ]);
}

/**
 * The `CCoinbaseCurrencyState` embedded in the definition notarization. For a
 * fresh fractional currency the pre-launch conversion price is the Bancor price
 * with reserves substituted by SATOSHIDEN: `SATS³ / (initialSupply · weight[i])`
 * (integer floor). Weights MUST be the normalized weights the definition carries
 * — verified byte-exact against the daemon for even and uneven splits.
 */
function serializeCoinbaseCurrencyState(
  currencyHash: Buffer,
  reserveHashes: Buffer[],
  normalizedWeights: bigint[],
  isFractional: boolean,
  initialFractionalSupply: bigint,
  tokenSupply: bigint,
): Buffer {
  const n = reserveHashes.length;
  const zeroVec = (): Buffer => Buffer.concat([writeCompactSize(n), ...Array.from({ length: n }, () => int64LE(0n, 'state.zero'))]);
  const supply = isFractional ? initialFractionalSupply : tokenSupply;
  // The state's weight vector is always one entry per currency: the normalized
  // weights for a fractional basket, or all-zero for a currency-mapped token
  // (e.g. an NFT, whose definition carries no weights but whose state carries a
  // zero weight for the mapped system currency).
  const stateWeights = normalizedWeights.length === n ? normalizedWeights : new Array<bigint>(n).fill(0n);

  const parts: Buffer[] = [
    uint16LE(1, 'state.version'),
    uint16LE(isFractional ? 0x0003 : 0x0002, 'state.flags'), // PRELAUNCH(2) [| FRACTIONAL(1)]
    uint160Raw(currencyHash, 'state.currencyID'),
    writeCompactSize(n),
    ...reserveHashes.map((h, i) => uint160Raw(h, `state.currencies[${i}]`)),
    writeCompactSize(n),
    ...stateWeights.map((w, i) => int32LE(Number(w), `state.weights[${i}]`)),
    zeroVec(), // reserves — zero at definition (no preconversions yet)
    varInt(isFractional ? initialFractionalSupply : 0n, 'state.initialSupply'),
    varInt(0n, 'state.emitted'),
    varInt(supply, 'state.supply'),
    // CCoinbaseCurrencyState extension — all-zero at definition.
    int64LE(0n, 'state.primaryCurrencyOut'),
    int64LE(0n, 'state.preConvertedOut'),
    int64LE(0n, 'state.primaryCurrencyFees'),
    int64LE(0n, 'state.primaryCurrencyConversionFees'),
    zeroVec(), // reserveIn
    zeroVec(), // primaryCurrencyIn
    zeroVec(), // reserveOut
    // conversionPrice (Bancor, reserves→SATOSHIDEN substitution)
    writeCompactSize(n),
    ...stateWeights.map((w, i) => {
      const price = isFractional && initialFractionalSupply > 0n && w > 0n
        ? (SATOSHIDEN * SATOSHIDEN * SATOSHIDEN) / (initialFractionalSupply * w)
        : 0n;
      return int64LE(price, `state.conversionPrice[${i}]`);
    }),
    zeroVec(), // viaConversionPrice
    zeroVec(), // fees
    // priorWeights — zero at definition (int32 vector, one per reserve).
    writeCompactSize(n),
    ...stateWeights.map((_, i) => int32LE(0, `state.priorWeights[${i}]`)),
    zeroVec(), // conversionFees
  ];
  return Buffer.concat(parts);
}

/** Output 3 body: `CPBaaSNotarization` definition stub. */
function serializeNotarization(currencyHash: Buffer, currencyState: Buffer, height: number): Buffer {
  return Buffer.concat([
    varInt(2n, 'notarization.version'), // CPBaaSNotarization::VERSION_CURRENT on VRSC/VRSCTEST
    varInt(0x83n, 'notarization.flags'), // DEF_NOTARIZATION(1) | PRE_LAUNCH(2) | SAME_CHAIN(0x80)
    Buffer.from([0x00, 0x00]), // proposer: empty CTransferDestination
    uint160Raw(currencyHash, 'notarization.currencyID'),
    currencyState,
    uint32LE(height, 'notarization.notarizationHeight'),
    uint256Raw(ZEROS_32, 'notarization.prevNotarization.hash'),
    uint32LE(0xffffffff, 'notarization.prevNotarization.n'),
    uint256Raw(ZEROS_32, 'notarization.hashPrevCrossNotarization'),
    uint32LE(0, 'notarization.prevHeight'),
    writeCompactSize(0), // currencyStates map (empty) — version ≥ 2
    writeCompactSize(0), // proofRoots map (empty)   — version ≥ 2
    writeCompactSize(0), // nodes vector (empty)
  ]);
}

/** Output 4: same-chain currency-definition export stub (`CCrossChainExport`). */
function serializeExport(
  systemHash: Buffer,
  currencyHash: Buffer,
  height: number,
  fee: Array<{ hash: Buffer; amount: bigint }>,
): Buffer {
  return Buffer.concat([
    uint16LE(1, 'export.version'),
    uint16LE(0x0041, 'export.flags'), // DEFINITION_EXPORT(0x40) | PRELAUNCH(1)
    uint160Raw(systemHash, 'export.sourceSystemID'),
    uint256Raw(ZEROS_32, 'export.hashReserveTransfers'),
    uint160Raw(systemHash, 'export.destSystemID'), // same chain
    uint160Raw(currencyHash, 'export.destCurrencyID'),
    Buffer.from([0x00, 0x00]), // exporter: empty CTransferDestination
    int32LE(-1, 'export.firstInput'),
    int32LE(0, 'export.numInputs'),
    varInt(0n, 'export.sourceHeightStart'),
    varInt(BigInt(height), 'export.sourceHeightEnd'),
    currencyValueMap(fee, 'export.totalFees'),
    currencyValueMap(fee, 'export.totalAmounts'),
    currencyValueMap([], 'export.totalBurned'),
    writeCompactSize(0), // reserveTransfers (empty)
  ]);
}

/**
 * Output 5 body: `CReserveDeposit` = single-value `CTokenOutput` + controlling
 * currency. Note the value fields here are VARINT, not the int64 used elsewhere.
 */
function serializeReserveDeposit(systemHash: Buffer, controllingHash: Buffer, amount: bigint): Buffer {
  return Buffer.concat([
    varInt(1n, 'reserveDeposit.version'),
    uint160Raw(systemHash, 'reserveDeposit.currencyID'),
    varInt(amount, 'reserveDeposit.amount'),
    uint160Raw(controllingHash, 'reserveDeposit.controllingCurrencyID'),
  ]);
}

/**
 * Output 6: the change output — a CC output spendable by the defining identity.
 * Hand-assembled (master `OptCCParams` m=0/n=0, params m=1/n=1 with a single
 * DEST_ID destination) to match exactly what the daemon emits for currency-def
 * change.
 */
function buildIdentityChangeScript(identityHash: Buffer): Buffer {
  const master = Buffer.from([0x04, 0x03, 0x00, 0x00, 0x00]); // v3, eval 0, m0, n0
  const idDest = Buffer.concat([Buffer.from([0x15, 0x04]), identityHash]); // push 21: type DEST_ID(4) + 20-byte id
  const params = Buffer.concat([Buffer.from([0x04, 0x03, 0x00, 0x01, 0x01]), idDest]); // v3, eval 0, m1, n1
  return Buffer.concat([
    Buffer.from([master.length]),
    master,
    Buffer.from([0xcc]), // OP_CHECKCRYPTOCONDITION
    Buffer.from([params.length]),
    params,
    Buffer.from([0x75]), // OP_DROP
  ]);
}

/**
 * Build all seven output scripts of a currency-definition transaction offline,
 * byte-equivalent to what `definecurrency` produces. The currency is defined
 * under an identity of the same name; its i-address (from `context.identity`) is
 * the new currency's id.
 */
export function buildCurrencyLaunchOutputs(
  input: CurrencyDefinitionInput,
  context: CurrencyLaunchContext,
): CurrencyLaunchOutputs {
  const def: NormalizedDefinition = normalizeCurrencyDefinition(input);
  const identityAddress = context.identity.identityaddress;
  if (typeof identityAddress !== 'string' || !identityAddress) {
    throw new TransactionBuildError('context.identity.identityaddress is required');
  }
  // The new currency's id is derived from its name + parent, and MUST equal the
  // defining identity's address — the import/notarization/export/state outputs all
  // reference it, so a mismatched identity (or a typo'd name/parent) would build
  // and sign a transaction the daemon rejects with an opaque error. Fail closed.
  const derivedId = deriveIdentityAddress(def.name, def.parent);
  if (derivedId !== identityAddress) {
    throw new TransactionBuildError(
      `identity mismatch: currency "${def.name}" under ${def.parent} derives ${derivedId}, ` +
        `but context.identity.identityaddress is ${identityAddress}`,
    );
  }
  if (!Number.isInteger(context.height) || context.height < 0) {
    throw new TransactionBuildError(`context.height must be a non-negative block height, got ${context.height}`);
  }
  // A launch's start block must be in the future: the daemon clamps startBlock to
  // above the tip (pbaasrpc.cpp:13491) and never emits a past/zero one, so a
  // startBlock ≤ tip would clear the launch immediately (a state no daemon-built
  // definition produces — instant launch-failure/refund for a preconvert basket).
  if (def.startBlock <= context.height) {
    throw new TransactionBuildError(`startBlock (${def.startBlock}) must be greater than the current height (${context.height})`);
  }
  // The currency's system must be this chain (pbaasrpc.cpp:13450 forces
  // systemID = chain id for every same-chain token). The defining identity's
  // `systemid` is that chain, so mismatch here means a wrong systemId/parent.
  if (typeof context.identity.systemid === 'string' && def.systemId !== context.identity.systemid) {
    throw new TransactionBuildError(`currency systemId (${def.systemId}) must equal the chain system id (${String(context.identity.systemid)})`);
  }
  if (context.launchFeeSats <= 0n) {
    throw new TransactionBuildError('context.launchFeeSats must be positive');
  }

  const systemHash = iAddressToHash(def.systemId);
  const currencyHash = iAddressToHash(identityAddress);
  const reserveHashes = def.currencies.map((c) => iAddressToHash(c));
  const isFractional = Boolean(def.options & CURRENCY_OPTION.FRACTIONAL);

  // Half the launch fee funds the reserve deposit; the export/import threads
  // carry the same amount as their fee. The token supply in the state is the sum
  // of pre-allocations (fractional currencies wait for preconversions).
  // LaunchFeeImportShare = fee - (fee >> 1): the ceiling half for odd fees, so the
  // reserve deposit matches consensus byte-for-byte (crosschainrpc.h:1039-1047).
  const importFee = context.launchFeeSats - context.launchFeeSats / 2n;
  const tokenSupply = def.preAllocations.reduce((sum, p) => sum + p.amount, 0n);
  const feeEntry = [{ hash: systemHash, amount: importFee }];

  const identityUpdate = buildIdentityUpdateOutput(context.identity, def.options);

  const currencyDefinition: CurrencyLaunchOutput = {
    script: buildCurrencyDefinitionScript(input),
    value: 0n,
  };

  const importOutput: CurrencyLaunchOutput = {
    // exportTxOutNum = 4 points at the export output (same tx).
    script: wrapCcOutput(EVAL_CROSSCHAIN_IMPORT, [serializeImport(systemHash, currencyHash, 4, context.height)], {
      kind: 'keyid',
      hash: CC_IMPORT_KEYHASH,
    }).toString('hex'),
    value: 0n,
  };

  const currencyState = serializeCoinbaseCurrencyState(
    currencyHash,
    reserveHashes,
    def.weights,
    isFractional,
    def.initialFractionalSupply,
    tokenSupply,
  );
  const notarization: CurrencyLaunchOutput = {
    script: wrapCcOutput(
      EVAL_ACCEPTEDNOTARIZATION,
      [serializeNotarization(currencyHash, currencyState, context.height)],
      pubkeyDest(EVAL_ACCEPTEDNOTARIZATION),
    ).toString('hex'),
    value: 0n,
  };

  const exportOutput: CurrencyLaunchOutput = {
    script: wrapCcOutput(
      EVAL_CROSSCHAIN_EXPORT,
      [serializeExport(systemHash, currencyHash, context.height, feeEntry)],
      pubkeyDest(EVAL_CROSSCHAIN_EXPORT),
    ).toString('hex'),
    value: 0n,
  };

  const reserveDeposit: CurrencyLaunchOutput = {
    script: wrapCcOutput(
      EVAL_RESERVE_DEPOSIT,
      [serializeReserveDeposit(systemHash, currencyHash, importFee)],
      pubkeyDest(EVAL_RESERVE_DEPOSIT),
    ).toString('hex'),
    value: importFee,
  };

  const change: CurrencyLaunchOutput = {
    script: buildIdentityChangeScript(currencyHash).toString('hex'),
    value: 0n,
  };

  const ordered = [identityUpdate, currencyDefinition, importOutput, notarization, exportOutput, reserveDeposit, change];
  return { identityUpdate, currencyDefinition, import: importOutput, notarization, export: exportOutput, reserveDeposit, change, ordered };
}
