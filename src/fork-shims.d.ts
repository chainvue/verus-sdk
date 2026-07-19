// Ambient type shims for the bundled VerusCoin forks.
//
// The forks (@bitgo/utxo-lib, verus-typescript-primitives) are INLINED into
// dist/bundle.js and are not installable by consumers, yet a few of the SDK's
// public type signatures reference them (VerusNetwork, TransactionBuilder,
// Identity, nameAndParentAddrToIAddr). Without a shim, a consumer's `tsc`
// reports "Cannot find module '@bitgo/utxo-lib'" unless they set
// `skipLibCheck: true`.
//
// This file is copied to dist/ and referenced from dist/index.d.ts at build
// time (scripts/finalize-types.mjs), so the published declarations are
// self-contained: no fork packages required, no skipLibCheck. It declares only
// the surface the public API exposes — intentionally minimal, and free of any
// transitive type dependency (e.g. bn.js).
//
// TWO-FILE SPLIT (intentional, do NOT merge): the RICH internal ambient types
// live in src/types/bitgo-utxo-lib.d.ts and import bn.js + primitives; this
// CONSUMER shim must stay dependency-free, so it can only be a hand-kept minimal
// subset. When the public surface changes (VerusNetworkConfig, networks,
// TransactionBuilder, Identity, nameAndParentAddrToIAddr), update BOTH so they
// don't drift.

declare module "@bitgo/utxo-lib" {
  export interface VerusNetworkConfig {
    messagePrefix: string;
    bech32?: string;
    bip32: { public: number; private: number };
    pubKeyHash: number;
    scriptHash: number;
    wif: number;
    coin: string;
    [key: string]: unknown;
  }

  export const networks: {
    verus: VerusNetworkConfig;
    verustest: VerusNetworkConfig;
    [key: string]: VerusNetworkConfig;
  };

  export class TransactionBuilder {
    constructor(network?: VerusNetworkConfig, maximumFeeRate?: number);
    setVersion(version: number): void;
    setExpiryHeight(height: number): void;
    setVersionGroupId(id: number): void;
    addInput(txHash: string | Buffer, vout: number, sequence?: number, prevOutScript?: Buffer): number;
    addOutput(scriptPubKeyOrAddress: Buffer | string, value: number): number;
    build(): unknown;
    buildIncomplete(): unknown;
  }
}

declare module "verus-typescript-primitives" {
  /** Opaque VerusID object — construct via the SDK's identity helpers. */
  export class Identity {}
  export function nameAndParentAddrToIAddr(name: string, parentIAddress?: string): string;
}
