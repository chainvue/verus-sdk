/**
 * Currency definition (manual mode only — offline)
 *
 * Creates a currency definition transaction. Requires a pre-built
 * currency definition script hex (obtained externally).
 *
 * Currency creation requires:
 * 1. An existing identity with the same name
 * 2. The identity's FLAG_ACTIVECURRENCY must be set
 * 3. A currency definition output (EVAL_CURRENCY_DEFINITION)
 */

// Re-export classification utilities
export { classifyCurrency, CURRENCY_TYPE_ORDER } from './classify.js';
export type { CurrencyType } from './classify.js';

import { TransactionBuilder, smarttxs } from '@bitgo/utxo-lib';
import { Identity, IdentityScript } from 'verus-typescript-primitives';
import BN from 'bn.js';
import { NETWORK_CONFIG, VERSION_GROUP_ID, IDENTITY_FLAG_ACTIVECURRENCY } from '../constants/index.js';
import type { Network } from '../constants/index.js';
import { signTransactionSmart, getNetwork } from '../signing/index.js';
import { selectUtxos } from '../utxo/index.js';
import { toSafeNumber } from '../utils/index.js';
import type { Utxo, DefineCurrencyParams, DefineCurrencyResult } from '../types/index.js';

const { completeFundedIdentityUpdate } = smarttxs;

/**
 * Build and sign a currency definition transaction (manual mode)
 *
 * Takes a pre-built currency definition script hex. No node RPC needed.
 */
export function defineCurrency(
  params: DefineCurrencyParams,
  network: Network
): DefineCurrencyResult {
  const verusNetwork = getNetwork(network === 'testnet');
  const networkConfig = NETWORK_CONFIG[network];
  const systemId = networkConfig.chainId;
  const currencyDefValue = params.currencyDefValue || 0n;

  // Parse identity and set FLAG_ACTIVECURRENCY
  const identity = new Identity();
  identity.fromBuffer(Buffer.from(params.identityHex, 'hex'));

  if (!identity.hasActiveCurrency()) {
    const currentFlags = identity.flags.toNumber();
    identity.flags = new BN(currentFlags | IDENTITY_FLAG_ACTIVECURRENCY);
  }

  const identityScript = IdentityScript.fromIdentity(identity);
  const identityOutputScript = identityScript.toBuffer();
  const currencyDefScript = Buffer.from(params.currencyDefScript, 'hex');

  // Select funding UTXOs
  const selection = selectUtxos(
    params.utxos,
    currencyDefValue,
    new Map(),
    2,
    systemId,
    undefined,
    true,
  );

  // Build transaction
  const txb = new TransactionBuilder(verusNetwork);
  txb.setVersion(4);
  txb.setExpiryHeight(params.expiryHeight || 0);
  txb.setVersionGroupId(VERSION_GROUP_ID);

  for (const utxo of selection.selected) {
    txb.addInput(
      Buffer.from(utxo.txid, 'hex').reverse(),
      utxo.outputIndex,
      0xffffffff,
      Buffer.from(utxo.script, 'hex'),
    );
  }

  txb.addOutput(identityOutputScript, 0);
  txb.addOutput(currencyDefScript, toSafeNumber(currencyDefValue));

  if (selection.nativeChange > 0n) {
    txb.addOutput(params.changeAddress, toSafeNumber(selection.nativeChange));
  }

  const fundedTx = txb.buildIncomplete();
  const fundedHex = fundedTx.toHex();

  // Add the previous identity UTXO as last input
  const prevOutScripts = selection.selected.map(u => Buffer.from(u.script, 'hex'));
  const idUtxo = params.identityUtxo;
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
    inputsUsed: allUtxos.length,
    nativeChange: selection.nativeChange,
  };
}
