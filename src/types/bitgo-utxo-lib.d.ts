// RICH internal ambient types for the fork (imports bn.js + primitives). The
// dependency-free CONSUMER subset shipped to adopters is src/fork-shims.d.ts —
// keep the shared public surface (VerusNetworkConfig, networks,
// TransactionBuilder, Identity, nameAndParentAddrToIAddr) in sync between the two.
declare module '@bitgo/utxo-lib' {
  import BN from 'bn.js';
  import type { TransferDestination } from 'verus-typescript-primitives';

  /**
   * Runtime shape of a `networks` entry in the Verus fork (networks.js).
   * Fields verified against `networks.verus` / `networks.verustest` at
   * runtime; entries for non-PBaaS chains (e.g. `bitcoin`) omit the
   * Verus/Zcash-specific fields, hence the optionals.
   */
  export interface VerusNetworkConfig {
    messagePrefix: string;
    bech32?: string;
    bip32: { public: number; private: number };
    pubKeyHash: number;
    scriptHash: number;
    verusID?: number;
    wif: number;
    consensusBranchId?: Record<number, number>;
    coin: string;
    isPBaaS?: boolean;
    isZcashCompatible?: boolean;
  }

  export const networks: {
    verus: VerusNetworkConfig;
    verustest: VerusNetworkConfig;
    bitcoin: VerusNetworkConfig;
    testnet: VerusNetworkConfig;
    [key: string]: VerusNetworkConfig;
  };

  /** The fork's ECDSA signature object (bitcoinjs-era). */
  export class ECSignature {
    /** 65-byte compact [recovery, r(32), s(32)]; offers use `.slice(1)` (the 64-byte r||s). */
    toCompact(): Buffer;
    /** DER signature with the hashType byte appended — a P2PKH scriptSig element. */
    toScriptSignature(hashType: number): Buffer;
    r: unknown;
    s: unknown;
  }

  export class ECPair {
    static fromWIF(wif: string, network: VerusNetworkConfig): ECPair;
    static fromPublicKeyBuffer(buffer: Buffer, network?: VerusNetworkConfig): ECPair;
    getPublicKeyBuffer(): Buffer;
    sign(hash: Buffer): ECSignature;
    getAddress(): string;
    toWIF(): string;
    network: VerusNetworkConfig;
    publicKey: Buffer;
  }

  export class Transaction {
    static SIGHASH_ALL: number;
    static SIGHASH_SINGLE: number;
    static SIGHASH_ANYONECANPAY: number;
    static fromHex(hex: string, network?: VerusNetworkConfig): Transaction;
    toHex(): string;
    getId(): string;
    /**
     * Sighash for an input under a given hashType. Needed for offers, which sign
     * with SIGHASH_SINGLE|ANYONECANPAY; `isWitness` is false for Verus CC inputs.
     */
    hashForSignatureByNetwork(
      inIndex: number,
      prevOutScript: Buffer,
      amount: number,
      hashType: number,
      isWitness: boolean,
    ): Buffer;
    /** Append an input; scriptSig defaults to empty. Returns the input index. */
    addInput(hash: Buffer | string, index: number, sequence?: number, scriptSig?: Buffer): number;
    /** Append an output. Returns the output index. */
    addOutput(scriptPubKey: Buffer, value: number): number;
    ins: Array<{ hash: Buffer; index: number; script: Buffer; sequence: number }>;
    outs: Array<{ value: number; script: Buffer }>;
  }

  /** One CryptoCondition signature (`SmartTransactionSignature(version, m, pubKey, sig64)`). */
  export class SmartTransactionSignature {
    constructor(version: number, numSignatures: number, pubKey: Buffer, oneSignature: Buffer);
    /** The signer's compressed public key (as parsed/serialized in the fulfillment). */
    pubKeyData: Buffer;
    /** The 64-byte r||s signature. */
    oneSignature: Buffer;
  }

  /**
   * The CryptoCondition fulfillment for a smart-transaction input. The second
   * constructor argument is the sighash type embedded in the fulfillment — offers
   * set it to SIGHASH_SINGLE|ANYONECANPAY (the fork's txb.sign hardcodes it to
   * SIGHASH_ALL, which is why offers build this explicitly).
   */
  export class SmartTransactionSignatures {
    constructor(version: number, hashType: number, signatures: SmartTransactionSignature[]);
    toChunk(): Buffer;
    /** The parsed signature entries (populated by fromChunk). */
    signatures: SmartTransactionSignature[];
    /** Parse an existing fulfillment chunk into a signatures container. */
    static fromChunk(chunk: Buffer): SmartTransactionSignatures;
  }

  export class TransactionBuilder {
    constructor(network?: VerusNetworkConfig, maxFeeRate?: number);
    setVersion(version: number): void;
    setExpiryHeight(height: number): void;
    setVersionGroupId(id: number): void;
    addInput(txHash: string | Buffer, vout: number, sequence?: number, prevOutScript?: Buffer): number;
    addOutput(scriptPubKeyOrAddress: Buffer | string, value: number): number;
    sign(vin: number, keyPair: ECPair, redeemScript?: Buffer | null, hashType?: number, witnessValue?: number, witnessScript?: Buffer): void;
    build(): Transaction;
    buildIncomplete(): Transaction;
    /**
     * Last-resort absurd-fee-rate cap in sat/vbyte, enforced at build().
     * Exists at runtime (transaction_builder.js:
     * `this.maximumFeeRate = maximumFeeRate || 2500`) but is opaque to this
     * SDK beyond being assignable.
     */
    maximumFeeRate?: number;
    /** Opaque internal input state — not consumed by this SDK. */
    inputs: unknown[];
    tx: Transaction;
  }

  /**
   * One processed OptCCParams entry as returned by `unpackOutput`
   * (smart_transactions.js `processOptCCParam`). Only `eval` (the eval code)
   * is consumed by this SDK; the remaining fields (version/m/n/data/values/
   * fees) stay untyped.
   */
  export interface UnpackedOptCCParam {
    eval: number;
    [key: string]: unknown;
  }

  export const smarttxs: {
    unpackOutput: (
      output: { value: number; script: Buffer },
      systemId: string,
      isInput?: boolean,
      allowNonTransferEvals?: boolean
    ) => {
      destinations: string[];
      values: Record<string, BN>;
      fees: Record<string, BN>;
      type: string;
      /** Processed master OptCCParams — opaque to this SDK. */
      master?: unknown;
      params?: UnpackedOptCCParam[];
    };

    createUnfundedCurrencyTransfer: (
      systemId: string,
      outputs: Array<{
        currency: string;
        satoshis: string;
        address: TransferDestination;
        convertto?: string;
        exportto?: string;
        feecurrency?: string;
        feesatoshis?: string;
        via?: string;
        preconvert?: boolean;
        burn?: boolean;
        burnweight?: boolean;
        mintnew?: boolean;
        importtosource?: boolean;
        bridgeid?: string;
        refundto?: TransferDestination;
        vdxftag?: unknown;
      }>,
      network: VerusNetworkConfig,
      expiryHeight?: number,
      version?: number,
      versionGroupId?: number
    ) => string;

    createUnfundedIdentityUpdate: (
      identityHex: string,
      network: VerusNetworkConfig,
      expiryHeight?: number,
      version?: number,
      versionGroupId?: number
    ) => string;

    completeFundedIdentityUpdate: (
      fundedTxHex: string,
      network: VerusNetworkConfig,
      prevOutScripts: Buffer[],
      prevIdentityOutput: {
        hash: Buffer;
        index: number;
        sequence: number;
        script: Buffer;
      }
    ) => string;

    /**
     * Return type covers only what this SDK consumes. At runtime the fork
     * also returns `in`/`out`/`change`/`fees`/`sent` records whose values
     * are decimal satoshi STRINGS (BN.toString()).
     */
    validateFundedCurrencyTransfer: (
      systemId: string,
      fundedTxHex: string,
      unfundedTxHex: string,
      changeAddr: string,
      network: VerusNetworkConfig,
      utxoList: Array<{
        txid: string;
        outputIndex: number;
        satoshis: number;
        script: string;
        height: number;
      }>
    ) => {
      valid: boolean;
      message?: string;
    };

    getFundedTxBuilder: (
      txHex: string,
      network: VerusNetworkConfig,
      prevOutScripts: Buffer[]
    ) => TransactionBuilder;
  };

  export const address: {
    fromOutputScript: (script: Buffer, network: VerusNetworkConfig) => string;
  };

  export const script: {
    compile: (chunks: Array<Buffer | number>) => Buffer;
    decompile: (buffer: Buffer) => Array<Buffer | number> | null;
  };

  export const opcodes: {
    OP_CHECKCRYPTOCONDITION: number;
    OP_DROP: number;
    OP_DUP: number;
    OP_HASH160: number;
    OP_EQUALVERIFY: number;
    OP_CHECKSIG: number;
    [key: string]: number;
  };

  export class IdentitySignature {
    constructor(
      network: VerusNetworkConfig,
      version?: number,
      hashType?: number,
      blockHeight?: number,
      signatures?: Buffer[],
      chainId?: string,
      iAddress?: string,
    );
    signMessageOffline(msg: string, keyPair: ECPair): Buffer;
    verifyMessageOffline(msg: string, signingAddress: string): boolean[];
    hashMessage(msg: string): Buffer;
    signHashOffline(hash: Buffer, keyPair: ECPair): Buffer;
    verifyHashOffline(hash: Buffer, signingAddress: string): boolean[];
    toBuffer(buffer?: Buffer, initialOffset?: number): Buffer | number;
    fromBuffer(buffer: Buffer, initialOffset?: number, chainId?: string, iAddress?: string): number;
    version: number;
    hashType: number;
    blockHeight: number;
    chainId: Buffer | null;
    identity: Buffer | null;
    signatures: Buffer[];
    network: VerusNetworkConfig;
  }

  export class OptCCParams {
    constructor(
      version?: number,
      evalCode?: number,
      m?: number,
      n?: number,
      destinations?: TxDestination[],
      serializedObjects?: Buffer[]
    );
    static fromChunk(chunk: Buffer): OptCCParams;
    toChunk(): Buffer;
    toBuffer(buffer?: Buffer, initialOffset?: number, asChunk?: boolean): Buffer;
    fromBuffer(buffer: Buffer, initialOffset?: number): number;
    isValid(): boolean;
    version: number;
    evalCode: number;
    m: number;
    n: number;
    destinations: TxDestination[];
    vData: Buffer[];
    error: Error | null;
  }

  export class TxDestination {
    constructor(destType: number, destinationBytes: Buffer);
    static fromChunk(chunk: Buffer): TxDestination;
    toChunk(): Buffer;
    isValid(): boolean;
    destType: number;
    destinationBytes: Buffer;

    static TYPE_PK: number;
    static TYPE_PKH: number;
    static TYPE_SH: number;
    static TYPE_ID: number;
    static TYPE_QUANTUM: number;
    static TYPE_INDEX: number;
  }
}
