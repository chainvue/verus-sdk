/**
 * Offline currency-definition serialization: reproduce a real token and a real
 * fractional basket byte-for-byte.
 *
 * The expected `AsVector()` bytes and full EVAL_CURRENCY_DEFINITION output
 * scripts are lifted from live VRSCTEST definition transactions:
 *   - TST (simple token, options 0x20)  — tx 9c2018a3…, vout 1
 *   - bankroll (fractional basket 0x21) — tx 6ed7a21f…, vout 1
 * If the serialization drifts, these locks break. The field layout additionally
 * mirrors CCurrencyDefinition::SerializationOp; the token/basket wire format ends
 * at idImportFees (the C++ else-branch fee fields are written to a discarded
 * stream — see src/currency/definition.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  serializeCurrencyDefinition,
  buildCurrencyDefinitionScript,
  CURRENCY_OPTION,
  type CurrencyDefinitionInput,
} from '../src/currency/definition.js';

const VRSCTEST = 'iJhCezBExJHvtyH3fGhNnt2NhU4Ztkf2yq';

// ── TST: a simple centralized token (options 0x20, proofprotocol CHAINID). ──
const TST_INPUT: CurrencyDefinitionInput = {
  name: 'TST',
  parent: VRSCTEST,
  options: CURRENCY_OPTION.TOKEN, // 0x20
  notarizationProtocol: 1,
  proofProtocol: 2,
  startBlock: 879130,
  endBlock: 0,
  preAllocations: [{ address: 'iK2k8YH1jfR7RLmEZ3zac2Mkx5rxSgbMqg', amount: 20_000_000_000n }],
  idRegistrationFees: 100_000_000n,
  idReferralLevels: 3,
  idImportFees: 2_000_000n,
};
const TST_VDATA =
  '0100000020000000a6ef9ea235635e328124ff3429db9f9e91b64e2d03545354a6ef9ea235635e328124ff3429db9f9e91b64e2da6ef9ea235635e328124ff3429db9f9e91b64e2d010000000200000000000000000000000000000000000000000000000000b4d31a00000000000000000001aaa1cc07bb12d36811c700e247c6a100ffc66d0500c817a80400000000000000000000000000000000000000000000000000aed6c10003f98800';
const TST_SCRIPT =
  '2704030001012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef5cc4cd604030201012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef54cad0100000020000000a6ef9ea235635e328124ff3429db9f9e91b64e2d03545354a6ef9ea235635e328124ff3429db9f9e91b64e2da6ef9ea235635e328124ff3429db9f9e91b64e2d010000000200000000000000000000000000000000000000000000000000b4d31a00000000000000000001aaa1cc07bb12d36811c700e247c6a100ffc66d0500c817a80400000000000000000000000000000000000000000000000000aed6c10003f9880075';

// ── bankroll: a 4-reserve fractional basket (options 0x21). ──
const BANKROLL_INPUT: CurrencyDefinitionInput = {
  name: 'bankroll',
  parent: VRSCTEST,
  options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL, // 0x21
  notarizationProtocol: 1,
  proofProtocol: 1,
  startBlock: 475260,
  endBlock: 0,
  initialSupply: 100_000_000_000_000n,
  currencies: [
    VRSCTEST,
    'iDMAoXEjZLkpofokBGsVwen7YEwo1iujMQ',
    'iPJCmjFfPTPSEecRQ4htkaCmJ3C4YWDZHa',
    'iGhBps9rmbN7U544dZY7nx2rfg26QTh1zY',
  ],
  weights: [25_000_000n, 25_000_000n, 25_000_000n, 25_000_000n],
  minPreconversion: [1n, 1n, 1n, 2_500_000_000_000n],
  idRegistrationFees: 777_000_000n,
  idReferralLevels: 3,
  idImportFees: 3n, // pricing-currency index for a fractional currency
};
const BANKROLL_VDATA =
  '0100000021000000a6ef9ea235635e328124ff3429db9f9e91b64e2d0862616e6b726f6c6ca6ef9ea235635e328124ff3429db9f9e91b64e2da6ef9ea235635e328124ff3429db9f9e91b64e2d0100000001000000000000000000000000000000000000000000000000009bff7c0000407a10f35a000000000000000000000004a6ef9ea235635e328124ff3429db9f9e91b64e2d6c4d1ff569d46ff39270b2b7059cbeaf44d8203fd96ec74c05689c8d2545b524baa597a8dc7bbc7290feaceebe8c95784cd44c5c8b433b0c0d13ffee0440787d0140787d0140787d0140787d010400000000000000000000000000000000000000000000000000000000000000000401000000000000000100000000000000010000000000000000a89c1346020000000400000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000000000000000081f1bfa7400303';
const BANKROLL_SCRIPT =
  '2704030001012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef5cc4d9f0104030201012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef54d75010100000021000000a6ef9ea235635e328124ff3429db9f9e91b64e2d0862616e6b726f6c6ca6ef9ea235635e328124ff3429db9f9e91b64e2da6ef9ea235635e328124ff3429db9f9e91b64e2d0100000001000000000000000000000000000000000000000000000000009bff7c0000407a10f35a000000000000000000000004a6ef9ea235635e328124ff3429db9f9e91b64e2d6c4d1ff569d46ff39270b2b7059cbeaf44d8203fd96ec74c05689c8d2545b524baa597a8dc7bbc7290feaceebe8c95784cd44c5c8b433b0c0d13ffee0440787d0140787d0140787d0140787d010400000000000000000000000000000000000000000000000000000000000000000401000000000000000100000000000000010000000000000000a89c1346020000000400000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000000000000000081f1bfa740030375';

describe('serializeCurrencyDefinition — byte-lock against real definitions', () => {
  it('reproduces the TST token AsVector bytes', () => {
    expect(serializeCurrencyDefinition(TST_INPUT).toString('hex')).toBe(TST_VDATA);
  });

  it('reproduces the TST token CC output script', () => {
    expect(buildCurrencyDefinitionScript(TST_INPUT)).toBe(TST_SCRIPT);
  });

  it('reproduces the bankroll basket AsVector bytes', () => {
    expect(serializeCurrencyDefinition(BANKROLL_INPUT).toString('hex')).toBe(BANKROLL_VDATA);
  });

  it('reproduces the bankroll basket CC output script', () => {
    expect(buildCurrencyDefinitionScript(BANKROLL_INPUT)).toBe(BANKROLL_SCRIPT);
  });

  it('applies daemon defaults for omitted fee fields (100 native / 3 / 0.02 native)', () => {
    const common = {
      name: 'TST',
      parent: VRSCTEST,
      options: CURRENCY_OPTION.TOKEN,
      notarizationProtocol: 1,
      proofProtocol: 2,
      startBlock: 879130,
      preAllocations: [{ address: 'iK2k8YH1jfR7RLmEZ3zac2Mkx5rxSgbMqg', amount: 20_000_000_000n }],
    };
    const withDefaults = serializeCurrencyDefinition(common).toString('hex');
    const explicit = serializeCurrencyDefinition({
      ...common,
      idRegistrationFees: 10_000_000_000n, // 100 native
      idReferralLevels: 3,
      idImportFees: 2_000_000n, // 0.02 native
    }).toString('hex');
    expect(withDefaults).toBe(explicit);
  });
});

// ── Risky fractional configs, byte-locked against live `definecurrency` output
// (name "kmerg", parent VRSCTEST, options 0x21, startblock 1160000). These cover
// the transforms the daemon applies to the input before serializing — weight
// normalization (even and uneven), pre-launch discount, min+max preconversion,
// and carve-out — which the simpler token/basket locks above do not exercise. ──
const RISKY_BASE = {
  name: 'kmerg',
  parent: VRSCTEST,
  options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL,
  notarizationProtocol: 1,
  proofProtocol: 1,
  startBlock: 1_160_000,
  initialSupply: 1_000_000_000_000n, // 10000
  idRegistrationFees: 100_000_000n, // 1 native
  idReferralLevels: 3,
} as const;
const SECOND = 'iDMAoXEjZLkpofokBGsVwen7YEwo1iujMQ';
const THIRD = 'iPJCmjFfPTPSEecRQ4htkaCmJ3C4YWDZHa';

const RISKY_CASES: Array<{ label: string; input: CurrencyDefinitionInput; script: string }> = [
  {
    // weights [0.4, 0.4] (sum 0.8) → normalized [0.5, 0.5]; prelaunchdiscount 0.05.
    label: 'weight normalization (even) + discount',
    input: {
      ...RISKY_BASE,
      currencies: [VRSCTEST, SECOND],
      weights: [40_000_000n, 40_000_000n],
      minPreconversion: [10_000_000_000n, 5_000_000_000n],
      preLaunchDiscount: 5_000_000n,
    },
    script:
      '2704030001012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef5cc4d300104030201012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef54d06010100000021000000a6ef9ea235635e328124ff3429db9f9e91b64e2d056b6d657267a6ef9ea235635e328124ff3429db9f9e91b64e2da6ef9ea235635e328124ff3429db9f9e91b64e2d010000000100000000000000000000000000000000000000000000000000c5e540000010a5d4e800000000000000000000000002a6ef9ea235635e328124ff3429db9f9e91b64e2d6c4d1ff569d46ff39270b2b7059cbeaf44d8203f0280f0fa0280f0fa0202000000000000000000000000000000000200e40b540200000000f2052a01000000000200000000000000000000000000000000020000000000000000000000000000000081b09540000000000000aed6c10003f9880075',
  },
  {
    // weights [0.3, 0.3, 0.3] (sum 0.9) → [33333333, 33333333, 33333334];
    // the last reserve absorbs the rounding remainder so the vector sums to 1e8.
    label: 'weight normalization (uneven, 3 reserves, remainder on last)',
    input: {
      ...RISKY_BASE,
      currencies: [VRSCTEST, SECOND, THIRD],
      weights: [30_000_000n, 30_000_000n, 30_000_000n],
    },
    script:
      '2704030001012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef5cc4d4d0104030201012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef54d23010100000021000000a6ef9ea235635e328124ff3429db9f9e91b64e2d056b6d657267a6ef9ea235635e328124ff3429db9f9e91b64e2da6ef9ea235635e328124ff3429db9f9e91b64e2d010000000100000000000000000000000000000000000000000000000000c5e540000010a5d4e800000000000000000000000003a6ef9ea235635e328124ff3429db9f9e91b64e2d6c4d1ff569d46ff39270b2b7059cbeaf44d8203fd96ec74c05689c8d2545b524baa597a8dc7bbc720355a0fc0155a0fc0156a0fc01030000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000aed6c10003f9880075',
  },
  {
    // min + max preconversion both present.
    label: 'min + max preconversion',
    input: {
      ...RISKY_BASE,
      currencies: [VRSCTEST, SECOND],
      weights: [50_000_000n, 50_000_000n],
      minPreconversion: [10_000_000_000n, 5_000_000_000n],
      maxPreconversion: [100_000_000_000n, 50_000_000_000n],
    },
    script:
      '2704030001012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef5cc4d3d0104030201012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef54d13010100000021000000a6ef9ea235635e328124ff3429db9f9e91b64e2d056b6d657267a6ef9ea235635e328124ff3429db9f9e91b64e2da6ef9ea235635e328124ff3429db9f9e91b64e2d010000000100000000000000000000000000000000000000000000000000c5e540000010a5d4e800000000000000000000000002a6ef9ea235635e328124ff3429db9f9e91b64e2d6c4d1ff569d46ff39270b2b7059cbeaf44d8203f0280f0fa0280f0fa0202000000000000000000000000000000000200e40b540200000000f2052a010000000200e876481700000000743ba40b0000000200000000000000000000000000000000020000000000000000000000000000000000000000000000aed6c10003f9880075',
  },
  {
    // prelaunchcarveout 0.1 (→ 10_000_000 sat ratio, int32).
    label: 'pre-launch carve-out',
    input: {
      ...RISKY_BASE,
      currencies: [VRSCTEST, SECOND],
      weights: [50_000_000n, 50_000_000n],
      minPreconversion: [10_000_000_000n, 5_000_000_000n],
      preLaunchCarveOut: 10_000_000,
    },
    script:
      '2704030001012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef5cc4d2d0104030201012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef54d03010100000021000000a6ef9ea235635e328124ff3429db9f9e91b64e2d056b6d657267a6ef9ea235635e328124ff3429db9f9e91b64e2da6ef9ea235635e328124ff3429db9f9e91b64e2d010000000100000000000000000000000000000000000000000000000000c5e540000010a5d4e800000000000000000000000002a6ef9ea235635e328124ff3429db9f9e91b64e2d6c4d1ff569d46ff39270b2b7059cbeaf44d8203f0280f0fa0280f0fa0202000000000000000000000000000000000200e40b540200000000f2052a01000000000200000000000000000000000000000000020000000000000000000000000000000000809698000000aed6c10003f9880075',
  },
];

describe('risky fractional definitions — byte-locked against live definecurrency', () => {
  for (const c of RISKY_CASES) {
    it(c.label, () => {
      expect(buildCurrencyDefinitionScript(c.input)).toBe(c.script);
    });
  }

  it('normalizes raw relative weights the way definecurrency does', () => {
    const raw = buildCurrencyDefinitionScript({
      ...RISKY_BASE,
      currencies: [VRSCTEST, SECOND],
      weights: [40_000_000n, 40_000_000n], // 0.4 / 0.4, sum 0.8
      minPreconversion: [10_000_000_000n, 5_000_000_000n],
      preLaunchDiscount: 5_000_000n,
    });
    const canonical = buildCurrencyDefinitionScript({
      ...RISKY_BASE,
      currencies: [VRSCTEST, SECOND],
      weights: [50_000_000n, 50_000_000n], // already 0.5 / 0.5
      minPreconversion: [10_000_000_000n, 5_000_000_000n],
      preLaunchDiscount: 5_000_000n,
    });
    expect(raw).toBe(canonical);
  });
});

// ── NFT (tokenized ID control), byte-locked against a live-accepted definecurrency
// (kmerg NFT, def tx 8d8671d4…). An NFT is a single-satoshi token the daemon maps
// to the native currency: currencies auto-set to [system], weights empty,
// maxPreconvert [0], proofProtocol PBAASMMR (a centralized CHAINID NFT is rejected
// on-chain: "may not also be a centralized currency"). ──
describe('NFT (tokenized ID control) — byte-locked + guards', () => {
  const NFT_OPTIONS = CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.SINGLECURRENCY | CURRENCY_OPTION.NFT_TOKEN; // 0x860
  const nftBase = {
    name: 'kmerg',
    parent: VRSCTEST,
    options: NFT_OPTIONS,
    proofProtocol: 1,
    notarizationProtocol: 1,
    startBlock: 1_156_183,
    preAllocations: [{ address: 'i4saPv8g6LPx7gmrZ37gX7ghinVv8JEATr', amount: 1n }],
    idRegistrationFees: 100_000_000n,
    idReferralLevels: 3,
  };

  it('reproduces a live-accepted NFT definition (native currency auto-mapped)', () => {
    expect(buildCurrencyDefinitionScript(nftBase)).toBe(
      '2704030001012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef5cc4d0c0104030201012102a0de91740d3d5a3a4a7990ae22315133d02f33716b339ebce88662d012224ef54ce30100000060080000a6ef9ea235635e328124ff3429db9f9e91b64e2d056b6d657267a6ef9ea235635e328124ff3429db9f9e91b64e2da6ef9ea235635e328124ff3429db9f9e91b64e2d010000000100000000000000000000000000000000000000000000000000c5c757000000000000000000010f542a851b1d74e4f391d3f4843bbd6b2bdc19300100000000000000000000000000000001a6ef9ea235635e328124ff3429db9f9e91b64e2d000100000000000000000001000000000000000001000000000000000001000000000000000000000000000000aed6c10003f9880075',
    );
  });

  it('rejects a centralized (CHAINID) proof protocol for an NFT', () => {
    expect(() => serializeCurrencyDefinition({ ...nftBase, proofProtocol: 2 })).toThrow(/may not use a centralized proof protocol/);
  });

  it('requires exactly 1 satoshi of pre-allocation', () => {
    expect(() => serializeCurrencyDefinition({ ...nftBase, preAllocations: [{ address: 'i4saPv8g6LPx7gmrZ37gX7ghinVv8JEATr', amount: 2n }] })).toThrow(/exactly 1 satoshi/);
    expect(() => serializeCurrencyDefinition({ ...nftBase, preAllocations: [] })).toThrow(/exactly 1 satoshi/);
  });

  it('rejects caller-supplied currencies/weights for an NFT (auto-mapped)', () => {
    expect(() => serializeCurrencyDefinition({ ...nftBase, currencies: [VRSCTEST] })).toThrow(/system currency is added automatically/);
  });

  it('rejects combining NFT with FRACTIONAL', () => {
    expect(() => serializeCurrencyDefinition({ ...nftBase, options: NFT_OPTIONS | CURRENCY_OPTION.FRACTIONAL })).toThrow(/cannot also be FRACTIONAL/);
  });
});

describe('normalize — scope and validation guards', () => {
  const base: CurrencyDefinitionInput = { name: 'X', parent: VRSCTEST, options: CURRENCY_OPTION.TOKEN };

  it('rejects a name containing "@"', () => {
    expect(() => serializeCurrencyDefinition({ ...base, name: 'X@' })).toThrow(/bare currency name/);
  });

  it('requires the TOKEN bit', () => {
    expect(() => serializeCurrencyDefinition({ ...base, options: CURRENCY_OPTION.FRACTIONAL })).toThrow(/TOKEN bit/);
  });

  it('rejects GATEWAY and PBAAS currencies (out of scope)', () => {
    expect(() => serializeCurrencyDefinition({ ...base, options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.GATEWAY })).toThrow(/out of scope/);
    expect(() => serializeCurrencyDefinition({ ...base, options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.PBAAS })).toThrow(/out of scope/);
  });

  it('requires reserve currencies for a fractional currency', () => {
    expect(() => serializeCurrencyDefinition({ ...base, options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL })).toThrow(/at least one reserve/);
  });

  it('rejects reserve currencies without the FRACTIONAL bit', () => {
    expect(() => serializeCurrencyDefinition({ ...base, currencies: [VRSCTEST] })).toThrow(/require the FRACTIONAL bit/);
  });

  it('rejects reserve vectors that mismatch the currency count', () => {
    expect(() =>
      serializeCurrencyDefinition({
        ...base,
        options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL,
        currencies: [VRSCTEST, 'iDMAoXEjZLkpofokBGsVwen7YEwo1iujMQ'],
        weights: [50_000_000n, 50_000_000n],
        initialSupply: 1n,
        minPreconversion: [0n], // only one, needs two
      }),
    ).toThrow(/one entry per reserve currency/);
  });

  it('rejects an explicit conversions field (always zero in a definition)', () => {
    expect(() =>
      serializeCurrencyDefinition({
        ...base,
        options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL,
        currencies: [VRSCTEST],
        weights: [100_000_000n],
        // @ts-expect-error conversions is no longer part of the input surface
        conversions: [250_000_000n],
      }),
    ).toThrow(/conversions are not supported/);
  });

  it('rejects initialContributions as out of scope', () => {
    expect(() =>
      serializeCurrencyDefinition({
        ...base,
        options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL,
        currencies: [VRSCTEST],
        weights: [100_000_000n],
        // @ts-expect-error initialContributions is no longer part of the input surface
        initialContributions: [1_000_000n],
      }),
    ).toThrow(/initialContributions are out of scope/);
  });

  it('rejects a maximum preconversion below its minimum', () => {
    expect(() =>
      serializeCurrencyDefinition({
        ...base,
        options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL,
        currencies: [VRSCTEST, 'iDMAoXEjZLkpofokBGsVwen7YEwo1iujMQ'],
        weights: [50_000_000n, 50_000_000n],
        initialSupply: 1n,
        minPreconversion: [100n, 50n],
        maxPreconversion: [100n, 40n], // second max < its min
      }),
    ).toThrow(/must be ≥ minPreconversion/);
  });

  it('rejects a non-positive reserve weight', () => {
    expect(() =>
      serializeCurrencyDefinition({
        ...base,
        options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL,
        currencies: [VRSCTEST, 'iDMAoXEjZLkpofokBGsVwen7YEwo1iujMQ'],
        weights: [100_000_000n, 0n],
        initialSupply: 1n,
      }),
    ).toThrow(/weight must be > 0/);
  });

  it('requires one weight per reserve currency for a fractional currency', () => {
    const frac = { ...base, options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL, currencies: [VRSCTEST, 'iDMAoXEjZLkpofokBGsVwen7YEwo1iujMQ'] };
    // omitted weights
    expect(() => serializeCurrencyDefinition({ ...frac, initialSupply: 1n })).toThrow(/one weight per reserve currency/);
    // short weights
    expect(() => serializeCurrencyDefinition({ ...frac, weights: [50_000_000n], initialSupply: 1n })).toThrow(/one weight per reserve currency/);
  });

  it('rejects a preLaunchDiscount outside int32 range', () => {
    // preLaunchDiscount only applies to a fractional currency, so isolate the
    // int32-range guard with an otherwise-valid fractional definition.
    const frac = {
      ...base,
      options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL,
      currencies: [VRSCTEST],
      weights: [100_000_000n],
      initialSupply: 1n,
    };
    expect(() => serializeCurrencyDefinition({ ...frac, preLaunchDiscount: 2_147_483_648n })).toThrow(/preLaunchDiscount must be in/);
    expect(() => serializeCurrencyDefinition({ ...frac, preLaunchDiscount: -1n })).toThrow(/preLaunchDiscount must be in/);
  });

  it('rejects a non-i-address reserve currency', () => {
    expect(() =>
      serializeCurrencyDefinition({
        ...base,
        options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL,
        currencies: ['RXhr5nLgQugQF84fHo5Rz39joVvNjQdGjm'],
      }),
    ).toThrow();
  });
});

describe('input-validation hardening', () => {
  const base: CurrencyDefinitionInput = { name: 'X', parent: VRSCTEST, options: CURRENCY_OPTION.TOKEN };
  const frac = (over: Partial<CurrencyDefinitionInput> = {}): CurrencyDefinitionInput => ({
    ...base,
    options: CURRENCY_OPTION.TOKEN | CURRENCY_OPTION.FRACTIONAL,
    currencies: [VRSCTEST],
    weights: [100_000_000n],
    initialSupply: 1_000_000_000_000n,
    ...over,
  });

  it('requires a positive initialSupply for a fractional currency', () => {
    expect(() => serializeCurrencyDefinition(frac({ initialSupply: 0n }))).toThrow(/positive initialSupply/);
    const { initialSupply: _omit, ...noSupply } = frac();
    void _omit;
    expect(() => serializeCurrencyDefinition(noSupply)).toThrow(/positive initialSupply/);
  });

  it('rejects initialSupply / preLaunchDiscount on a non-fractional token', () => {
    expect(() => serializeCurrencyDefinition({ ...base, initialSupply: 100n })).toThrow(/initialSupply applies only to a FRACTIONAL/);
    expect(() => serializeCurrencyDefinition({ ...base, preLaunchDiscount: 5n })).toThrow(/preLaunchDiscount applies only to a FRACTIONAL/);
  });

  it('rejects a non-positive pre-allocation amount', () => {
    expect(() => serializeCurrencyDefinition({ ...base, preAllocations: [{ address: VRSCTEST, amount: 0n }] })).toThrow(/must be positive/);
    expect(() => serializeCurrencyDefinition({ ...base, preAllocations: [{ address: VRSCTEST, amount: -1n }] })).toThrow(/must be positive/);
  });

  it('rejects negative reserve amounts (min/max preconversion, carve-out)', () => {
    expect(() => serializeCurrencyDefinition(frac({ minPreconversion: [-1n] }))).toThrow(/minPreconversion\[0\] must be non-negative/);
    expect(() => serializeCurrencyDefinition(frac({ maxPreconversion: [-1n] }))).toThrow(/maxPreconversion\[0\] must be non-negative/);
    expect(() => serializeCurrencyDefinition(frac({ preLaunchCarveOut: -1 }))).toThrow(/preLaunchCarveOut must be non-negative/);
  });

  it('catches a negative maxPreconversion even when minPreconversion is absent', () => {
    // The max ≥ min cross-check only runs when both arrays are present; the
    // non-negative guard must catch this independently.
    expect(() => serializeCurrencyDefinition(frac({ maxPreconversion: [-5n] }))).toThrow(/non-negative/);
  });

  it('rejects a non-integer start block', () => {
    expect(() => serializeCurrencyDefinition({ ...base, startBlock: 1.5 })).toThrow(/non-negative integer block height/);
    expect(() => serializeCurrencyDefinition({ ...base, startBlock: -1 })).toThrow(/non-negative integer block height/);
  });

  it('rejects a fee field beyond int64', () => {
    expect(() => serializeCurrencyDefinition({ ...base, idRegistrationFees: 2n ** 63n })).toThrow(/idRegistrationFees must be in/);
  });
});
