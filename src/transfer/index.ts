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
import { NETWORK_CONFIG, VERSION_GROUP_ID, PUBKEY_HASH_PREFIX, I_ADDR_VERSION } from '../constants/index.js';
import type { Network } from '../constants/index.js';
import { signTransactionSmart, getNetwork, validateFundedTransaction } from '../signing/index.js';
import { selectUtxos } from '../utxo/index.js';
import { buildTokenChangeOutput, identityPaymentScript } from '../identity/index.js';
import { addressToScriptPubKey, toSafeNumber } from '../utils/index.js';
import { InsufficientFundsError, InvalidAddressError, InvalidWifError, TransactionBuildError } from '../errors.js';
import { validateWif } from '../keys/index.js';
import type { TransferDestination as TransferDestinationType } from 'verus-typescript-primitives';
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
      destinationBytes = Buffer.from(addr, 'hex');
      if (destinationBytes.length !== 20) {
        throw new InvalidAddressError(address, 'ETH destination must be 20 bytes of hex');
      }
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
  const expiryHeight = params.expiryHeight || 0;

  const txOutputs = params.outputs.map((out) => ({
    currency: out.currency,
    satoshis: out.satoshis.toString(10),
    address: parseAddress(out.address, out.addressType || 'PKH'),
    ...(out.convertTo !== undefined ? { convertto: out.convertTo } : {}),
    ...(out.exportTo !== undefined ? { exportto: out.exportTo } : {}),
    ...(out.via !== undefined ? { via: out.via } : {}),
    ...(out.bridgeId !== undefined ? { bridgeid: out.bridgeId } : {}),
    ...(out.feeCurrency !== undefined ? { feecurrency: out.feeCurrency } : {}),
    ...(out.feeSatoshis !== undefined ? { feesatoshis: out.feeSatoshis.toString(10) } : {}),
    ...(out.preconvert !== undefined ? { preconvert: out.preconvert } : {}),
  }));

  const unfundedTxHex = createUnfundedCurrencyTransfer(
    systemId,
    txOutputs,
    verusNetwork,
    expiryHeight,
  );

  const unfundedTx = Transaction.fromHex(unfundedTxHex, verusNetwork);
  let requiredNative = 0n;
  for (const out of unfundedTx.outs) {
    requiredNative += BigInt(out.value);
  }

  const hasSmartOutputs = params.outputs.some(
    (o) => o.convertTo || o.exportTo || o.via || o.currency !== systemId
  );

  const requiredCurrencies = new Map<string, bigint>();
  for (const out of params.outputs) {
    if (out.currency !== systemId) {
      requiredCurrencies.set(
        out.currency,
        (requiredCurrencies.get(out.currency) || 0n) + out.satoshis,
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
    txb.addOutput(tokenChange.script, toSafeNumber(tokenChange.nativeValue));
  }

  if (selection.nativeChange > 0n) {
    // utxo-lib's addOutput only resolves base58 R-addresses; identity
    // change (an i-address changeAddress) needs the explicit P2ID script —
    // byte-identical to the chain's own pay-to-identity outputs.
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

  // Defense in depth: utxo-lib's own funded-transfer validator re-checks the
  // assembled tx against the unfunded intent (value conservation per
  // currency, change to the declared change address, fee sanity). A
  // selection/change bug here means money — refuse to hand out the hex.
  const validation = validateFundedTransaction(
    systemId,
    signedTx,
    unfundedTxHex,
    params.changeAddress,
    verusNetwork,
    selection.selected,
  );
  if (!validation.valid) {
    throw new TransactionBuildError(
      `funded transaction failed validation: ${validation.message ?? 'no reason given'}`,
    );
  }

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
      satoshis: params.amount,
      address: params.to,
      addressType: 'PKH',
    }],
    utxos: params.utxos,
    changeAddress: params.changeAddress,
    ...(params.expiryHeight !== undefined ? { expiryHeight: params.expiryHeight } : {}),
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
    ...(params.expiryHeight !== undefined ? { expiryHeight: params.expiryHeight } : {}),
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
    ...(params.expiryHeight !== undefined ? { expiryHeight: params.expiryHeight } : {}),
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
