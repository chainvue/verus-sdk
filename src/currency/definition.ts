/**
 * Offline serialization of a Verus currency definition (`CCurrencyDefinition`)
 * into the `EVAL_CURRENCY_DEFINITION` CryptoCondition output script that a
 * `definecurrency` transaction carries.
 *
 * This is a serialization primitive: it builds (and lets you inspect/verify) the
 * definition output script byte-for-byte as the daemon would. It is NOT a
 * currency launcher — a valid definition transaction also carries currency-state
 * and notarization outputs validated against live chain state, so the actual
 * launch is a daemon (`definecurrency`) operation, not an offline one.
 *
 * Scope: simple tokens (`OPTION_TOKEN`) and fractional reserve baskets
 * (`OPTION_TOKEN | OPTION_FRACTIONAL`). PBaaS chains and gateways are rejected
 * fail-closed — their serialization carries extra trailing fields (launch fees,
 * issuance schedule, gateway converter) that this builder deliberately omits.
 *
 * The byte layout mirrors `CCurrencyDefinition::SerializationOp`
 * (VerusCoin `src/pbaas/crosschainrpc.h`). A subtlety load-bearing for
 * correctness: for a non-gateway, non-PBaaS currency the C++ `else` branch
 * writes the five trailing fee fields (`currencyRegistrationFee` …
 * `transactionExportFee`) into a *shadowed local stream*, so they never reach
 * the wire — a token/basket definition ends at `idImportFees`. This is
 * reproduced here and byte-locked against real on-chain definitions
 * (see test/currency-definition.test.ts) rather than trusted from the header.
 *
 * The CC wrapper (OptCCParams master eval 0 + params eval 2, both m=1/n=1 to a
 * single pubkey destination) sends to the daemon's hardcoded currency-definition
 * pubkey (`CCcustom.cpp` `PBaaSDefinitionPubKey`), which is chain-independent.
 */

import { writeCompactSize } from '../utils/index.js';
import { TransactionBuildError } from '../errors.js';
import {
  requireInt32Range,
  int32LE,
  uint32LE,
  int64LE,
  varInt,
  limitedString,
  uint160,
  vectorU160,
  vectorI64,
  vectorI32,
  normalizeWeights,
  wrapCcOutput,
} from './wire.js';

/** Currency-definition data-structure version (`CCurrencyDefinition::VERSION_CURRENT`). */
export const CURRENCY_DEFINITION_VERSION = 1;

/** Currency option bits (`CCurrencyDefinition::ECurrencyOptions`). */
export const CURRENCY_OPTION = {
  FRACTIONAL: 0x1,
  ID_RESTRICTED: 0x2,
  ID_STAKING: 0x4,
  ID_REFERRALS: 0x8,
  ID_REFERRALREQUIRED: 0x10,
  TOKEN: 0x20,
  SINGLECURRENCY: 0x40,
  GATEWAY: 0x80,
  PBAAS: 0x100,
  GATEWAY_CONVERTER: 0x200,
  GATEWAY_NAMECONTROLLER: 0x400,
  NFT_TOKEN: 0x800,
  NO_IDS: 0x1000,
} as const;

/** Notarization protocol (`ENotarizationProtocol`). */
export const NOTARIZATION_PROTOCOL = { AUTO: 1, NOTARY_CONFIRM: 2, NOTARY_CHAINID: 3 } as const;
/** Proof protocol (`EProofProtocol`). */
export const PROOF_PROTOCOL = { PBAASMMR: 1, CHAINID: 2, ETHNOTARIZATION: 3 } as const;

/**
 * The daemon's hardcoded destination pubkey for EVAL_CURRENCY_DEFINITION outputs
 * (`src/cc/CCcustom.cpp` `PBaaSDefinitionPubKey`). Chain-independent — identical
 * on VRSC and VRSCTEST — so it is safe to embed rather than derive.
 */
const CURRENCY_DEFINITION_PUBKEY = Buffer.from(
  '02a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef5',
  'hex',
);

/**
 * A currency to define. Amounts are bigint satoshis (never `number`). Reserve
 * currencies and pre-allocation recipients are given as i-addresses.
 */
export interface CurrencyDefinitionInput {
  /** Bare currency name, matching the identity it is defined under (no `@`). */
  name: string;
  /** Parent namespace i-address (the chain/currency this is registered under). */
  parent: string;
  /**
   * Option bits (see {@link CURRENCY_OPTION}). Must include `TOKEN`. `GATEWAY`
   * and `PBAAS` are rejected — out of scope for this offline builder.
   */
  options: number;
  /** Controlling system i-address. Defaults to `parent`. */
  systemId?: string;
  /** Launch system i-address. Defaults to `systemId`. */
  launchSystemId?: string;
  /** Notarization protocol. Defaults to `AUTO` (1). */
  notarizationProtocol?: number;
  /** Proof protocol. Defaults to `CHAINID` (2) for a centralized token. */
  proofProtocol?: number;
  /** Block at which pre-launch ends / the token activates. Defaults to 0. */
  startBlock?: number;
  /** End-of-life block, 0 = no end. Defaults to 0. */
  endBlock?: number;

  /** Fractional supply available for pre-launch conversion (fractional only). */
  initialSupply?: bigint;
  /** Pre-allocation / premine recipients. */
  preAllocations?: Array<{ address: string; amount: bigint }>;

  /** Reserve currency i-addresses (fractional basket). */
  currencies?: string[];
  /**
   * Relative reserve weights, one positive int32 ratio per reserve currency.
   * Normalized to sum to 1e8 exactly as `definecurrency` does (so `[0.4, 0.4]`
   * expressed as `[40_000_000n, 40_000_000n]` becomes `[50_000_000n,
   * 50_000_000n]`); pass values already summing to 1e8 for a no-op.
   */
  weights?: bigint[];
  /** Minimum per-reserve to launch (same length as `currencies`). */
  minPreconversion?: bigint[];
  /** Maximum per-reserve allowed (same length as `currencies`); each ≥ its minimum. */
  maxPreconversion?: bigint[];

  /** Pre-launch discount ratio (fractional < 100%). Defaults to 0. */
  preLaunchDiscount?: bigint;
  /** Pre-launch carve-out ratio in satoshis. Defaults to 0. */
  preLaunchCarveOut?: number;

  /** ID registration fee in native satoshis. Defaults to 100 native (1e10). */
  idRegistrationFees?: bigint;
  /** Referral levels. Defaults to 3. */
  idReferralLevels?: number;
  /**
   * ID import fee in native satoshis. For a fractional currency this is instead
   * the pricing-currency index into `currencies`. Defaults to 0.02 native.
   */
  idImportFees?: bigint;
}

/** Fully resolved definition with all defaults applied. */
export interface NormalizedDefinition {
  version: number;
  options: number;
  parent: string;
  name: string;
  launchSystemId: string;
  systemId: string;
  notarizationProtocol: number;
  proofProtocol: number;
  startBlock: number;
  endBlock: number;
  initialFractionalSupply: bigint;
  preAllocations: Array<{ address: string; amount: bigint }>;
  gatewayConverterIssuance: bigint;
  currencies: string[];
  weights: bigint[];
  conversions: bigint[];
  minPreconversion: bigint[];
  maxPreconversion: bigint[];
  initialContributions: bigint[];
  preconverted: bigint[];
  preLaunchDiscount: bigint;
  preLaunchCarveOut: number;
  notaries: string[];
  minNotariesConfirm: number;
  idRegistrationFees: bigint;
  idReferralLevels: number;
  idImportFees: bigint;
}

const DEFAULT_ID_REGISTRATION_FEE = 10_000_000_000n; // 100 native
const DEFAULT_ID_IMPORT_FEE = 2_000_000n; // 0.02 native
const DEFAULT_ID_REFERRAL_LEVELS = 3;

/**
 * Apply daemon-like defaults, enforce the token/basket scope, and normalize
 * reserve weights. Exposed so the currency-launch output builders derive the
 * notarization currency-state from the exact same normalized weights the
 * definition output carries — the daemon validates one against the other.
 */
export function normalizeCurrencyDefinition(input: CurrencyDefinitionInput): NormalizedDefinition {
  if (!input.name || input.name.includes('@')) {
    throw new TransactionBuildError('name must be a bare currency name without "@"');
  }
  if (!Number.isInteger(input.options)) {
    throw new TransactionBuildError('options is required (must include the TOKEN bit)');
  }
  if (!(input.options & CURRENCY_OPTION.TOKEN)) {
    throw new TransactionBuildError('options must include the TOKEN bit (0x20); native currencies are out of scope');
  }
  if (input.options & (CURRENCY_OPTION.GATEWAY | CURRENCY_OPTION.PBAAS | CURRENCY_OPTION.GATEWAY_CONVERTER)) {
    throw new TransactionBuildError('GATEWAY and PBAAS currencies are out of scope for the offline builder');
  }
  if (input.options < 0 || input.options > CURRENCY_OPTION.NO_IDS * 2 - 1) {
    throw new TransactionBuildError(`options has bits outside the known mask: ${input.options}`);
  }

  // `conversions` and `initialContributions` are deliberately unsupported.
  // definecurrency ignores an explicit `conversions` for a fractional currency
  // (it derives prices at launch), and `initialContributions` seeds reserves the
  // identity must already hold — requiring reserve-deposit inputs this offline
  // builder does not assemble. Reject rather than silently drop, so a caller
  // migrating from definecurrency JSON fails loud instead of shipping a
  // definition the daemon would not have produced.
  const legacy = input as unknown as Record<string, unknown>;
  if (legacy.conversions !== undefined) {
    throw new TransactionBuildError(
      'conversions are not supported: a fractional definition always carries a zero conversion vector (the daemon derives launch prices); omit the field',
    );
  }
  if (legacy.initialContributions !== undefined) {
    throw new TransactionBuildError(
      'initialContributions are out of scope: they seed reserves the identity must hold and require reserve-deposit inputs the offline builder cannot assemble; contribute via a preconvert reserve-transfer instead',
    );
  }

  const isFractional = Boolean(input.options & CURRENCY_OPTION.FRACTIONAL);
  const isNFT = Boolean(input.options & CURRENCY_OPTION.NFT_TOKEN);
  const currencies = input.currencies ?? [];
  const systemId = input.systemId ?? input.parent;
  const launchSystemId = input.launchSystemId ?? systemId;

  if (isNFT) {
    // An NFT (tokenized ID control) is a single-satoshi token mapped to the
    // native currency, NOT a fractional reserve. The daemon
    // (`crosschainrpc.cpp`) auto-adds the system currency when maxpreconversion
    // is [0], and the consensus precheck (`pbaas.cpp`) requires exactly 1 satoshi
    // of pre-allocation with maxPreconvert=[0], and rejects a centralized
    // (PROOF_CHAINID) proof protocol ("may not also be a centralized currency").
    // Reproduce that canonical form here rather than making the caller know it.
    if (isFractional) {
      throw new TransactionBuildError('an NFT (NFT_TOKEN) cannot also be FRACTIONAL');
    }
    if (currencies.length || input.weights?.length) {
      throw new TransactionBuildError('do not set currencies/weights for an NFT — the system currency is added automatically');
    }
    if (input.minPreconversion || input.maxPreconversion) {
      throw new TransactionBuildError('do not set min/maxPreconversion for an NFT — they are fixed (maxPreconversion=[0])');
    }
    const proofProtocol = input.proofProtocol ?? PROOF_PROTOCOL.PBAASMMR;
    if (proofProtocol === PROOF_PROTOCOL.CHAINID) {
      throw new TransactionBuildError('an NFT may not use a centralized proof protocol (CHAINID/2); use PBAASMMR (1)');
    }
    const preAllocations = input.preAllocations ?? [];
    const preallocTotal = preAllocations.reduce((sum, p) => sum + p.amount, 0n);
    if (preallocTotal !== 1n) {
      throw new TransactionBuildError('an NFT must pre-allocate exactly 1 satoshi — the single indivisible token');
    }
    return {
      version: CURRENCY_DEFINITION_VERSION,
      options: input.options,
      parent: input.parent,
      name: input.name,
      launchSystemId,
      systemId,
      notarizationProtocol: input.notarizationProtocol ?? NOTARIZATION_PROTOCOL.AUTO,
      proofProtocol,
      startBlock: input.startBlock ?? 0,
      endBlock: input.endBlock ?? 0,
      initialFractionalSupply: 0n,
      preAllocations,
      gatewayConverterIssuance: 0n,
      // The daemon maps the NFT to the native/system currency with a zeroed
      // conversion and maxPreconvert=[0]; weights stay empty (not fractional).
      currencies: [systemId],
      weights: [],
      conversions: [0n],
      minPreconversion: [],
      maxPreconversion: [0n],
      initialContributions: [0n],
      preconverted: [0n],
      preLaunchDiscount: 0n,
      preLaunchCarveOut: 0,
      notaries: [],
      minNotariesConfirm: 0,
      idRegistrationFees: input.idRegistrationFees ?? DEFAULT_ID_REGISTRATION_FEE,
      idReferralLevels: input.idReferralLevels ?? DEFAULT_ID_REFERRAL_LEVELS,
      idImportFees: input.idImportFees ?? DEFAULT_ID_IMPORT_FEE,
    };
  }

  if (isFractional && currencies.length === 0) {
    throw new TransactionBuildError('a fractional currency requires at least one reserve currency');
  }
  if (!isFractional && currencies.length > 0) {
    throw new TransactionBuildError('reserve currencies require the FRACTIONAL bit (0x01)');
  }
  // A fractional currency has no sensible default weighting: the daemon requires
  // one weight per reserve, so an omitted/short `weights` would serialize to a
  // definition the daemon rejects. Fail closed here instead.
  if (isFractional && (input.weights === undefined || input.weights.length !== currencies.length)) {
    throw new TransactionBuildError(`a fractional currency requires one weight per reserve currency (${currencies.length})`);
  }

  // Reserve-currency vectors, when present, must all match the currency count.
  // The daemon leaves min/max-preconversion empty when unspecified but zero-fills
  // conversions / contributions / preconverted to the currency count; mirror that
  // so an omitted field serializes identically to what `definecurrency` produces.
  const checkLen = (arr: bigint[], label: string): bigint[] => {
    if (arr.length !== currencies.length) {
      throw new TransactionBuildError(`${label} must have one entry per reserve currency (${currencies.length}), got ${arr.length}`);
    }
    return arr;
  };
  const emptyOr = (arr: bigint[] | undefined, label: string): bigint[] =>
    arr === undefined ? [] : checkLen(arr, label);
  const zeros = (): bigint[] => new Array<bigint>(currencies.length).fill(0n);

  const minPreconversion = emptyOr(input.minPreconversion, 'minPreconversion');
  const maxPreconversion = emptyOr(input.maxPreconversion, 'maxPreconversion');
  // The daemon rejects any maximum below its own minimum (crosschainrpc.cpp).
  if (minPreconversion.length && maxPreconversion.length) {
    for (let i = 0; i < currencies.length; i++) {
      const min = minPreconversion[i];
      const max = maxPreconversion[i];
      if (min !== undefined && max !== undefined && max < min) {
        throw new TransactionBuildError(
          `maxPreconversion[${i}] (${max}) must be ≥ minPreconversion[${i}] (${min})`,
        );
      }
    }
  }

  return {
    version: CURRENCY_DEFINITION_VERSION,
    options: input.options,
    parent: input.parent,
    name: input.name,
    launchSystemId,
    systemId,
    notarizationProtocol: input.notarizationProtocol ?? NOTARIZATION_PROTOCOL.AUTO,
    proofProtocol: input.proofProtocol ?? PROOF_PROTOCOL.CHAINID,
    startBlock: input.startBlock ?? 0,
    endBlock: input.endBlock ?? 0,
    initialFractionalSupply: input.initialSupply ?? 0n,
    preAllocations: input.preAllocations ?? [],
    gatewayConverterIssuance: 0n,
    currencies,
    // Weights are normalized to sum to 1e8, exactly as the daemon does.
    weights: isFractional ? normalizeWeights(input.weights as bigint[]) : [],
    // A fractional definition always carries a zero conversion vector (the daemon
    // ignores any explicit `conversions` and derives launch prices); a
    // non-fractional token has no reserves, hence an empty vector.
    conversions: zeros(),
    minPreconversion,
    maxPreconversion,
    // `initialContributions` and `preconverted` are internal to a fresh
    // definition: both carry a zero per reserve currency (empty for a
    // non-fractional token). Matches on-chain definitions.
    initialContributions: zeros(),
    preconverted: zeros(),
    preLaunchDiscount: requireInt32Range(input.preLaunchDiscount ?? 0n, 'preLaunchDiscount'),
    preLaunchCarveOut: input.preLaunchCarveOut ?? 0,
    notaries: [],
    minNotariesConfirm: 0,
    idRegistrationFees: input.idRegistrationFees ?? DEFAULT_ID_REGISTRATION_FEE,
    idReferralLevels: input.idReferralLevels ?? DEFAULT_ID_REFERRAL_LEVELS,
    idImportFees: input.idImportFees ?? DEFAULT_ID_IMPORT_FEE,
  };
}

const MAX_NAME_LEN = 64;

/**
 * Serialize a normalized currency definition to its `AsVector()` bytes — the
 * blob carried as `vData[0]` of the EVAL_CURRENCY_DEFINITION output. Field order
 * and encodings mirror `CCurrencyDefinition::SerializationOp` for the
 * token/basket (non-gateway, non-PBaaS) case.
 */
export function serializeNormalizedDefinition(def: NormalizedDefinition): Buffer {
  const parts: Buffer[] = [
    uint32LE(def.version, 'version'),
    uint32LE(def.options, 'options'),
    uint160(def.parent, 'parent'),
    limitedString(def.name, MAX_NAME_LEN, 'name'),
    uint160(def.launchSystemId, 'launchSystemId'),
    uint160(def.systemId, 'systemId'),
    int32LE(def.notarizationProtocol, 'notarizationProtocol'),
    int32LE(def.proofProtocol, 'proofProtocol'),
    // nativeCurrencyID: a null CTransferDestination (type 0, empty destination) → `0000`.
    Buffer.from([0x00, 0x00]),
    // gatewayID: null uint160 for a non-gateway currency → 20 zero bytes.
    Buffer.alloc(20),
    varInt(BigInt(def.startBlock), 'startBlock'),
    varInt(BigInt(def.endBlock), 'endBlock'),
    int64LE(def.initialFractionalSupply, 'initialSupply'),
    // preAllocation: CompactSize count, then (uint160 recipient, int64 amount) pairs.
    writeCompactSize(def.preAllocations.length),
    ...def.preAllocations.flatMap((p, i) => [
      uint160(p.address, `preAllocations[${i}].address`),
      int64LE(p.amount, `preAllocations[${i}].amount`),
    ]),
    int64LE(def.gatewayConverterIssuance, 'gatewayConverterIssuance'),
    vectorU160(def.currencies, 'currencies'),
    vectorI32(def.weights, 'weights'),
    vectorI64(def.conversions, 'conversions'),
    vectorI64(def.minPreconversion, 'minPreconversion'),
    vectorI64(def.maxPreconversion, 'maxPreconversion'),
    vectorI64(def.initialContributions, 'initialContributions'),
    vectorI64(def.preconverted, 'preconverted'),
    varInt(def.preLaunchDiscount, 'preLaunchDiscount'),
    int32LE(def.preLaunchCarveOut, 'preLaunchCarveOut'),
    vectorU160(def.notaries, 'notaries'),
    varInt(BigInt(def.minNotariesConfirm), 'minNotariesConfirm'),
    varInt(def.idRegistrationFees, 'idRegistrationFees'),
    varInt(BigInt(def.idReferralLevels), 'idReferralLevels'),
    varInt(def.idImportFees, 'idImportFees'),
  ];
  return Buffer.concat(parts);
}

/** EVAL_CURRENCY_DEFINITION (=2). */
const EVAL_CURRENCY_DEFINITION = 2;

/**
 * Serialize a currency definition to its `CCurrencyDefinition::AsVector()` bytes.
 * Exposed mainly for byte-level testing; most callers want
 * {@link buildCurrencyDefinitionScript}.
 */
export function serializeCurrencyDefinition(input: CurrencyDefinitionInput): Buffer {
  return serializeNormalizedDefinition(normalizeCurrencyDefinition(input));
}

/**
 * Build the EVAL_CURRENCY_DEFINITION CryptoCondition output script for a token or
 * fractional basket, as a hex string — byte-equivalent to the output the daemon's
 * `definecurrency` produces for the same parameters. For building, inspecting, or
 * verifying a definition script offline; a full on-chain launch is a daemon
 * operation (the transaction also needs live-state notarization outputs).
 */
export function buildCurrencyDefinitionScript(input: CurrencyDefinitionInput): string {
  const defBytes = serializeNormalizedDefinition(normalizeCurrencyDefinition(input));
  return wrapCcOutput(EVAL_CURRENCY_DEFINITION, [defBytes], {
    kind: 'pubkey',
    pubkey: CURRENCY_DEFINITION_PUBKEY,
  }).toString('hex');
}
