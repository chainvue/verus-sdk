declare module '@bitgo/utxo-lib' {
  import BN from 'bn.js';

  export const networks: {
    verus: any;
    verustest: any;
    bitcoin: any;
    testnet: any;
    [key: string]: any;
  };

  export class ECPair {
    static fromWIF(wif: string, network: any): ECPair;
    static fromPublicKeyBuffer(buffer: Buffer, network?: any): ECPair;
    getPublicKeyBuffer(): Buffer;
    sign(hash: Buffer): any;
    getAddress(): string;
    toWIF(): string;
    network: any;
    publicKey: Buffer;
  }

  export class Transaction {
    static SIGHASH_ALL: number;
    static fromHex(hex: string, network?: any): Transaction;
    toHex(): string;
    getId(): string;
    ins: Array<{ hash: Buffer; index: number; script: Buffer; sequence: number }>;
    outs: Array<{ value: number; script: Buffer }>;
  }

  export class TransactionBuilder {
    constructor(network?: any, maxFeeRate?: number);
    setVersion(version: number): void;
    setExpiryHeight(height: number): void;
    setVersionGroupId(id: number): void;
    addInput(txHash: string | Buffer, vout: number, sequence?: number, prevOutScript?: Buffer): number;
    addOutput(scriptPubKeyOrAddress: Buffer | string, value: number): number;
    sign(vin: number, keyPair: ECPair, redeemScript?: Buffer | null, hashType?: number, witnessValue?: number, witnessScript?: Buffer): void;
    build(): Transaction;
    buildIncomplete(): Transaction;
    inputs: any[];
    tx: Transaction;
  }

  export const smarttxs: {
    unpackOutput(
      output: { value: number; script: Buffer },
      systemId: string,
      isInput?: boolean,
      allowNonTransferEvals?: boolean
    ): {
      destinations: string[];
      values: Record<string, BN>;
      fees: Record<string, BN>;
      type: string;
      master?: any;
      params?: any[];
    };

    createUnfundedCurrencyTransfer(
      systemId: string,
      outputs: Array<{
        currency: string;
        satoshis: string;
        address: any;
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
        refundto?: any;
        vdxftag?: any;
      }>,
      network: any,
      expiryHeight?: number,
      version?: number,
      versionGroupId?: number
    ): string;

    createUnfundedIdentityUpdate(
      identityHex: string,
      network: any,
      expiryHeight?: number,
      version?: number,
      versionGroupId?: number
    ): string;

    completeFundedIdentityUpdate(
      fundedTxHex: string,
      network: any,
      prevOutScripts: Buffer[],
      prevIdentityOutput: {
        hash: Buffer;
        index: number;
        sequence: number;
        script: Buffer;
      }
    ): string;

    validateFundedCurrencyTransfer(
      systemId: string,
      fundedTxHex: string,
      unfundedTxHex: string,
      changeAddr: string,
      network: any,
      utxoList: Array<{
        txid: string;
        outputIndex: number;
        satoshis: number;
        script: string;
        height: number;
      }>
    ): {
      valid: boolean;
      message?: string;
      in?: Record<string, any>;
      out?: Record<string, any>;
      change?: Record<string, any>;
      fees?: Record<string, any>;
      sent?: Record<string, any>;
    };

    getFundedTxBuilder(
      txHex: string,
      network: any,
      prevOutScripts: Buffer[]
    ): TransactionBuilder;
  };

  export const script: {
    compile(chunks: Array<Buffer | number>): Buffer;
    decompile(buffer: Buffer): Array<Buffer | number> | null;
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
      network: any,
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
    network: any;
  }

  export class OptCCParams {
    constructor(
      version?: number,
      evalCode?: number,
      m?: number,
      n?: number,
      destinations?: any[],
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
    destinations: any[];
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
    static TYPE_INDEX: number;
    static TYPE_QUANTUM: number;
  }
}
