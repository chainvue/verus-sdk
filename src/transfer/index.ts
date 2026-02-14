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

import { smarttxs, TransactionBuilder, Transaction } from '@bitgo/utxo-lib';
import {
  TransferDestination,
  DEST_PKH,
  DEST_ID,
  DEST_ETH,
} from 'verus-typescript-primitives';
import BN from 'bn.js';
import bs58check from 'bs58check';
import { NETWORK_CONFIG, VERSION_GROUP_ID } from '../constants/index.js';
import type { Network } from '../constants/index.js';
import { signTransactionSmart, getNetwork } from '../signing/index.js';
import { selectUtxos } from '../utxo/index.js';
import { buildTokenChangeOutput } from '../identity/index.js';
import { addressToScriptPubKey } from '../utils/index.js';
import { InvalidWifError, TransactionBuildError } from '../errors.js';
import { validateWif } from '../keys/index.js';
import type {
  Utxo,
  CurrencyOutput,
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

/** Validate amount is positive and finite */
function validateAmount(amount: number, label: string = 'amount'): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new TransactionBuildError(`Invalid ${label}: must be a positive finite number (got ${amount})`);
  }
}

/**
 * Parse an address string into a TransferDestination
 */
function parseAddress(address: string, addressType: string): any {
  let type: typeof DEST_PKH;
  let destinationBytes: Buffer;

  switch (addressType) {
    case 'PKH': {
      type = DEST_PKH;
      const decoded = bs58check.decode(address);
      destinationBytes = Buffer.from(decoded.slice(1));
      break;
    }
    case 'ID': {
      type = DEST_ID;
      const decoded = bs58check.decode(address);
      destinationBytes = Buffer.from(decoded.slice(1));
      break;
    }
    case 'ETH': {
      type = DEST_ETH;
      const addr = address.startsWith('0x') ? address.substring(2) : address;
      destinationBytes = Buffer.from(addr, 'hex');
      break;
    }
    default:
      throw new Error(`Unsupported address type: ${addressType}`);
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
  const networkConfig = NETWORK_CONFIG[network];
  const verusNetwork = getNetwork(network === 'testnet');
  const systemId = networkConfig.chainId;
  const expiryHeight = params.expiryHeight || 0;

  const txOutputs = params.outputs.map((out) => ({
    currency: out.currency,
    satoshis: out.satoshis,
    address: parseAddress(out.address, out.addressType || 'PKH'),
    convertto: out.convertTo,
    exportto: out.exportTo,
    via: out.via,
    bridgeid: out.bridgeId,
    feecurrency: out.feeCurrency,
    feesatoshis: out.feeSatoshis,
    preconvert: out.preconvert,
  }));

  const unfundedTxHex = createUnfundedCurrencyTransfer(
    systemId,
    txOutputs,
    verusNetwork,
    expiryHeight,
  );

  const unfundedTx = Transaction.fromHex(unfundedTxHex, verusNetwork);
  let requiredNative = 0;
  for (const out of unfundedTx.outs) {
    requiredNative += out.value;
  }

  const hasSmartOutputs = params.outputs.some(
    (o) => o.convertTo || o.exportTo || o.via || o.currency !== systemId
  );

  const requiredCurrencies = new Map<string, number>();
  for (const out of params.outputs) {
    if (out.currency !== systemId && !out.convertTo) {
      const amount = parseInt(out.satoshis, 10);
      requiredCurrencies.set(
        out.currency,
        (requiredCurrencies.get(out.currency) || 0) + amount,
      );
    }
  }

  const selection = selectUtxos(
    params.utxos,
    requiredNative,
    requiredCurrencies,
    unfundedTx.outs.length,
    systemId,
    undefined,
    hasSmartOutputs,
  );

  const txb = new TransactionBuilder(verusNetwork);
  txb.setVersion(4);
  txb.setExpiryHeight(expiryHeight);
  txb.setVersionGroupId(VERSION_GROUP_ID);

  for (const utxo of selection.selected) {
    txb.addInput(
      Buffer.from(utxo.txid, 'hex').reverse(),
      utxo.outputIndex,
      0xffffffff,
      Buffer.from(utxo.script, 'hex'),
    );
  }

  for (const out of unfundedTx.outs) {
    txb.addOutput(out.script, out.value);
  }

  if (selection.currencyChanges.size > 0) {
    const tokenChange = buildTokenChangeOutput(
      params.changeAddress,
      selection.currencyChanges,
    );
    txb.addOutput(tokenChange.script, tokenChange.nativeValue);
  }

  if (selection.nativeChange > 0) {
    txb.addOutput(params.changeAddress, selection.nativeChange);
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
    inputsUsed: selection.selected.length,
    nativeChange: selection.nativeChange,
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
      satoshis: params.amount.toString(),
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
      satoshis: params.amount.toString(),
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
      satoshis: params.amount.toString(),
      address: params.changeAddress, // Conversion output goes to self
      addressType: 'PKH',
      convertTo: params.convertTo,
      via: params.via,
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

  const totalInput = params.inputs.reduce((sum, i) => sum + i.amount, 0);
  const totalOutput = params.outputs.reduce((sum, o) => sum + o.amount, 0);
  const fee = params.fee || (totalInput - totalOutput);

  if (totalOutput + fee > totalInput) {
    throw new Error(`Insufficient funds. Input: ${totalInput}, Output: ${totalOutput}, Fee: ${fee}`);
  }

  // Use high maxFeeRate since callers explicitly control input/output amounts
  const txb = new TransactionBuilder(verusNetwork, Number.MAX_SAFE_INTEGER);
  txb.setVersion(4);
  txb.setExpiryHeight(params.expiryHeight || 0);
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
    txb.addOutput(script, out.amount);
  }

  const unsignedTx = txb.buildIncomplete();

  const utxos: Utxo[] = params.inputs.map((i) => ({
    txid: i.txid,
    outputIndex: i.vout,
    satoshis: i.amount,
    script: i.scriptPubKey,
  }));

  const { signedTx, txid } = signTransactionSmart(
    unsignedTx.toHex(),
    params.wif,
    utxos,
    verusNetwork,
  );

  return { signedTx, txid, fee };
}
