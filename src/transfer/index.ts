/**
 * Transfer orchestration
 *
 * Handles all types of Verus currency operations:
 * - Simple native (VRSC) transfers
 * - Token/currency transfers
 * - Currency conversions
 * - Reserve-to-reserve conversions
 * - Cross-chain transfers
 * - Simple P2PKH build+sign
 */

import { smarttxs, TransactionBuilder, Transaction } from '../fork/boundary.js';
import {
  TransferDestination,
  DEST_PKH,
  DEST_ID,
  DEST_ETH,
} from '../fork/boundary.js';
import BN from 'bn.js';
import bs58check from 'bs58check';
import { NETWORK_CONFIG, VERSION_GROUP_ID, PUBKEY_HASH_PREFIX, I_ADDR_VERSION } from '../constants/index.js';
import type { Network } from '../constants/index.js';
import { signTransactionSmart, getNetwork, validateFundedTransaction, resolveExpiryHeight } from '../signing/index.js';
import { assembleAndSign } from '../assemble/assembler.js';
import { addressToScriptPubKey, toSafeNumber } from '../utils/index.js';
import { InsufficientFundsError, InvalidAddressError, InvalidWifError, TransactionBuildError } from '../errors.js';
import { validateWif } from '../keys/index.js';
import type { TransferDestination as TransferDestinationType } from '../fork/boundary.js';
import type {
  Utxo,
  SendCurrencyParams,
  SendCurrencyResult,
  TransferParams,
  TransferTokenParams,
  ConvertParams,
  BuildAndSignParams,
  SignedTxResult,
} from '../types/index.js';

const { createUnfundedCurrencyTransfer } = smarttxs;

/** Validate common transfer parameters */
function validateTransferInputs(wif: string, utxos: Utxo[]): void {
  if (!wif || typeof wif !== 'string') {
    throw new InvalidWifError('WIF is required');
  }
  const wifCheck = validateWif(wif);
  if (!wifCheck.valid) {
    throw new InvalidWifError(wifCheck.error);
  }
  if (!utxos || utxos.length === 0) {
    throw new TransactionBuildError('At least one UTXO is required');
  }
}

/** Validate amount is a positive bigint */
function validateAmount(amount: bigint, label: string = 'amount'): void {
  if (typeof amount !== 'bigint' || amount <= 0n) {
    throw new TransactionBuildError(`Invalid ${label}: must be a positive bigint satoshi amount (got ${amount})`);
  }
}

/** bs58check-decode an address, rethrowing as a typed InvalidAddressError */
function decodeBase58Address(address: string): Buffer {
  try {
    return Buffer.from(bs58check.decode(address));
  } catch (err) {
    throw new InvalidAddressError(address, (err as Error).message);
  }
}

/**
 * Parse an address string into a TransferDestination
 */
function parseAddress(address: string, addressType: string): TransferDestinationType {
  let type: typeof DEST_PKH;
  let destinationBytes: Buffer;

  switch (addressType) {
    case 'PKH': {
      type = DEST_PKH;
      const decoded = decodeBase58Address(address);
      // Fail closed: the version byte must be the R-address (P2PKH) prefix.
      // Without this check an i-address (0x66) passed on the PKH path would be
      // stripped to its 20-byte hash and paid out as a P2PKH output to an
      // R-address nobody controls — a silent, unrecoverable loss.
      if (decoded.length !== 21 || decoded[0] !== PUBKEY_HASH_PREFIX) {
        throw new InvalidAddressError(
          address,
          "addressType 'PKH' requires an R-address (transparent P2PKH); got a different address version",
        );
      }
      destinationBytes = decoded.slice(1);
      break;
    }
    case 'ID': {
      type = DEST_ID;
      const decoded = decodeBase58Address(address);
      // Fail closed: the version byte must be the identity i-address prefix, so
      // an R-address can never be misrouted onto the identity-destination path.
      if (decoded.length !== 21 || decoded[0] !== I_ADDR_VERSION) {
        throw new InvalidAddressError(
          address,
          "addressType 'ID' requires an identity i-address; got a different address version",
        );
      }
      destinationBytes = decoded.slice(1);
      break;
    }
    case 'ETH': {
      type = DEST_ETH;
      const addr = address.startsWith('0x') ? address.substring(2) : address;
      // Validate the hex explicitly: Buffer.from(_, 'hex') truncates at the
      // first non-hex character, so a malformed address could otherwise pass the
      // length check with silently dropped bytes. Note: this checks the format
      // only — no EIP-55 checksum is enforced (that needs keccak256, a dependency
      // this SDK deliberately does not carry), so a mistyped but well-formed
      // 20-byte address is still accepted. Validate the ETH address upstream.
      if (!/^[0-9a-fA-F]{40}$/.test(addr)) {
        throw new InvalidAddressError(address, 'ETH destination must be exactly 20 bytes (40 hex chars)');
      }
      destinationBytes = Buffer.from(addr, 'hex');
      break;
    }
    default:
      throw new InvalidAddressError(address, `Unsupported address type: ${addressType}`);
  }

  return new TransferDestination({
    type,
    destination_bytes: destinationBytes,
    fees: new BN(0, 10),
  });
}

/**
 * Build and sign a currency transfer transaction (full control)
 *
 * Supports native VRSC transfers, token transfers, conversions,
 * reserve-to-reserve, and cross-chain transfers.
 */
export function sendCurrency(
  params: SendCurrencyParams,
  network: Network
): SendCurrencyResult {
  validateTransferInputs(params.wif, params.utxos);
  if (!params.outputs || params.outputs.length === 0) {
    throw new TransactionBuildError('At least one output is required');
  }
  for (const out of params.outputs) {
    validateAmount(out.satoshis, `output satoshis (${out.currency})`);
    if (out.feeSatoshis !== undefined && out.feeSatoshis < 0n) {
      throw new TransactionBuildError(`Invalid feeSatoshis: must be non-negative (got ${out.feeSatoshis})`);
    }
  }
  if (!params.changeAddress || typeof params.changeAddress !== 'string') {
    throw new TransactionBuildError('changeAddress is required');
  }
  const networkConfig = NETWORK_CONFIG[network];
  const verusNetwork = getNetwork(network === 'testnet');
  const systemId = networkConfig.chainId;
  const expiryHeight = resolveExpiryHeight(params.expiryHeight);

  // A mint creates supply and cannot also convert, pre-convert, or burn in the
  // same output (reserves.h:369, pbaasrpc.cpp:11550) — fail early instead of
  // building a transaction the daemon rejects.
  for (const out of params.outputs) {
    if (out.mintnew && (out.convertTo !== undefined || out.preconvert || out.burn || out.burnweight)) {
      throw new TransactionBuildError('mintnew cannot be combined with convertTo, preconvert, or burn');
    }
  }

  const txOutputs = params.outputs.map((out) => {
    // mint/burn must be carried by a reserve transfer, but the fork only builds one
    // when a fee/convert/export/via field is present. A conversion field is wrong
    // here (mint/burn cannot convert), so trigger the reserve-transfer path with a
    // native fee currency when the caller didn't set one.
    const forcesReserveTransfer = out.mintnew || out.burn || out.burnweight;
    const feecurrency = out.feeCurrency ?? (forcesReserveTransfer ? systemId : undefined);
    return {
      currency: out.currency,
      satoshis: out.satoshis.toString(10),
      address: parseAddress(out.address, out.addressType || 'PKH'),
      ...(out.convertTo !== undefined ? { convertto: out.convertTo } : {}),
      ...(out.exportTo !== undefined ? { exportto: out.exportTo } : {}),
      ...(out.via !== undefined ? { via: out.via } : {}),
      ...(out.bridgeId !== undefined ? { bridgeid: out.bridgeId } : {}),
      ...(feecurrency !== undefined ? { feecurrency } : {}),
      ...(out.feeSatoshis !== undefined ? { feesatoshis: out.feeSatoshis.toString(10) } : {}),
      ...(out.preconvert !== undefined ? { preconvert: out.preconvert } : {}),
      ...(out.mintnew !== undefined ? { mintnew: out.mintnew } : {}),
      ...(out.burn !== undefined ? { burn: out.burn } : {}),
      ...(out.burnweight !== undefined ? { burnweight: out.burnweight } : {}),
    };
  });

  const unfundedTxHex = createUnfundedCurrencyTransfer(
    systemId,
    txOutputs,
    verusNetwork,
    expiryHeight,
  );

  const unfundedTx = Transaction.fromHex(unfundedTxHex, verusNetwork);

  const hasSmartOutputs = params.outputs.some(
    (o) => o.convertTo || o.exportTo || o.via || o.mintnew || o.burn || o.burnweight || o.currency !== systemId
  );

  const requiredCurrencies = new Map<string, bigint>();
  for (const out of params.outputs) {
    // A `mintnew` output CREATES new supply of a centralized currency; it is not
    // funded from inputs (the daemon authorizes the mint via an input controlled
    // by the currency id, not by spending that currency). Counting it as a
    // required input would demand token funding that, by definition, doesn't
    // exist — so exclude it from both selection and the conservation check.
    if (out.currency !== systemId && !out.mintnew) {
      requiredCurrencies.set(
        out.currency,
        (requiredCurrencies.get(out.currency) || 0n) + out.satoshis,
      );
    }
    // A non-native fee currency must be funded from that currency's own inputs.
    // It was omitted from selection, so a reserve transfer paying its fee in a
    // token was under-funded and rejected by the daemon.
    if (out.feeCurrency !== undefined && out.feeCurrency !== systemId && out.feeSatoshis !== undefined) {
      requiredCurrencies.set(
        out.feeCurrency,
        (requiredCurrencies.get(out.feeCurrency) || 0n) + out.feeSatoshis,
      );
    }
  }

  // The fork built the output scripts (createUnfundedCurrencyTransfer); the
  // assembler funds them (native summed from the outputs, tokens from the
  // explicit requiredCurrencies since the opaque scripts can't be read back),
  // emits change the fork's way (a token-change output plus a distinct native
  // one), and enforces native + token conservation.
  const assembled = assembleAndSign({
    network,
    wif: params.wif,
    expiryHeight: params.expiryHeight,
    funding: params.utxos,
    outputs: unfundedTx.outs.map((o) => ({ script: o.script, nativeSat: BigInt(o.value) })),
    changeAddress: params.changeAddress,
    hasSmartOutputs,
    requiredCurrencies,
    changeStrategy: 'separate',
    fee: { policy: 'estimate' },
    label: 'sendCurrency',
  });

  // Defense in depth: utxo-lib's own funded-transfer validator re-checks the
  // assembled tx against the unfunded intent (value conservation per
  // currency, change to the declared change address, fee sanity). A
  // selection/change bug here means money — refuse to hand out the hex.
  const validation = validateFundedTransaction(
    systemId,
    assembled.signedTx,
    unfundedTxHex,
    params.changeAddress,
    verusNetwork,
    assembled.selected,
  );
  if (!validation.valid) {
    throw new TransactionBuildError(
      `funded transaction failed validation: ${validation.message ?? 'no reason given'}`,
    );
  }

  return {
    signedTx: assembled.signedTx,
    txid: assembled.txid,
    fee: assembled.fee,
    inputsUsed: assembled.inputsUsed,
    nativeChange: assembled.nativeChange,
  };
}

/**
 * Simple native VRSC transfer to an R-address
 */
export function transfer(
  params: TransferParams,
  network: Network
): SendCurrencyResult {
  validateAmount(params.amount);
  const systemId = NETWORK_CONFIG[network].chainId;
  return sendCurrency({
    wif: params.wif,
    outputs: [{
      currency: systemId,
      satoshis: params.amount,
      address: params.to,
      addressType: 'PKH',
    }],
    utxos: params.utxos,
    changeAddress: params.changeAddress,
    expiryHeight: params.expiryHeight,
  }, network);
}

/**
 * Token/currency transfer
 */
export function transferToken(
  params: TransferTokenParams,
  network: Network
): SendCurrencyResult {
  validateAmount(params.amount);
  return sendCurrency({
    wif: params.wif,
    outputs: [{
      currency: params.currency,
      satoshis: params.amount,
      address: params.to,
      addressType: params.addressType || 'PKH',
    }],
    utxos: params.utxos,
    changeAddress: params.changeAddress,
    expiryHeight: params.expiryHeight,
  }, network);
}

/**
 * Currency conversion
 */
export function convert(
  params: ConvertParams,
  network: Network
): SendCurrencyResult {
  validateAmount(params.amount);
  return sendCurrency({
    wif: params.wif,
    outputs: [{
      currency: params.currency,
      satoshis: params.amount,
      address: params.changeAddress, // Conversion output goes to self
      addressType: 'PKH',
      convertTo: params.convertTo,
      ...(params.via !== undefined ? { via: params.via } : {}),
    }],
    utxos: params.utxos,
    changeAddress: params.changeAddress,
    expiryHeight: params.expiryHeight,
  }, network);
}

/**
 * Build and sign a simple P2PKH transaction from explicit inputs/outputs
 */
export function buildAndSign(
  params: BuildAndSignParams,
  network: Network
): SignedTxResult {
  if (!params.wif || typeof params.wif !== 'string') {
    throw new InvalidWifError('WIF is required');
  }
  const wifCheck = validateWif(params.wif);
  if (!wifCheck.valid) {
    throw new InvalidWifError(wifCheck.error);
  }
  if (!params.inputs || params.inputs.length === 0) {
    throw new TransactionBuildError('At least one input is required');
  }
  if (!params.outputs || params.outputs.length === 0) {
    throw new TransactionBuildError('At least one output is required');
  }
  const verusNetwork = getNetwork(network === 'testnet');

  const totalInput = params.inputs.reduce((sum, i) => sum + i.amount, 0n);
  const totalOutput = params.outputs.reduce((sum, o) => sum + o.amount, 0n);
  const impliedFee = totalInput - totalOutput;
  const fee = params.fee ?? impliedFee;

  if (totalOutput + fee > totalInput) {
    throw new InsufficientFundsError(totalOutput + fee, totalInput);
  }
  // Value conservation: every input satoshi is either an output or the
  // declared fee. A declared fee below the implied one means the difference
  // would be burned silently as extra miner fee — refuse.
  if (fee !== impliedFee) {
    throw new TransactionBuildError(
      `declared fee ${fee} does not match inputs minus outputs (${impliedFee}) — the difference would be burned`,
    );
  }

  const txb = new TransactionBuilder(verusNetwork);
  txb.setVersion(4);
  txb.setExpiryHeight(resolveExpiryHeight(params.expiryHeight));
  txb.setVersionGroupId(VERSION_GROUP_ID);

  for (const inp of params.inputs) {
    txb.addInput(
      Buffer.from(inp.txid, 'hex').reverse(),
      inp.vout,
      0xffffffff,
      Buffer.from(inp.scriptPubKey, 'hex'),
    );
  }

  for (const out of params.outputs) {
    const script = addressToScriptPubKey(out.address);
    txb.addOutput(script, toSafeNumber(out.amount));
  }

  const unsignedTx = txb.buildIncomplete();

  const utxos: Utxo[] = params.inputs.map((i) => ({
    txid: i.txid,
    outputIndex: i.vout,
    satoshis: i.amount,
    script: i.scriptPubKey,
  }));

  // The absurd-fee check runs at signing time; bound it to the fee this
  // transaction actually declares instead of disabling it.
  const { signedTx, txid } = signTransactionSmart(
    unsignedTx.toHex(),
    params.wif,
    utxos,
    verusNetwork,
    fee > 0n ? fee : undefined,
  );

  return { signedTx, txid, fee };
}
