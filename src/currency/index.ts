/**
 * Currency helpers — all offline, byte-equivalent to the daemon.
 *
 * - `buildCurrencyDefinitionScript` / `serializeCurrencyDefinition`: the
 *   EVAL_CURRENCY_DEFINITION output script (token, fractional basket, or NFT).
 * - `buildCurrencyLaunchOutputs`: all seven outputs of a currency-definition tx.
 * - `buildCurrencyLaunchTransaction`: a complete, signed, broadcastable launch.
 * - `buildReserveTransferOutput`: the (pre)convert output for investing in a
 *   launching currency.
 *
 * `defineCurrency` is a narrower helper (identity-spend + a pre-built definition
 * output + change); prefer `buildCurrencyLaunchTransaction` for a full launch.
 */

// Re-export classification utilities
export { classifyCurrency, CURRENCY_TYPE_ORDER } from './classify.js';
export type { CurrencyType } from './classify.js';

// Structured currency-definition builder (token / fractional basket)
export {
  serializeCurrencyDefinition,
  buildCurrencyDefinitionScript,
  CURRENCY_OPTION,
  CURRENCY_DEFINITION_VERSION,
  NOTARIZATION_PROTOCOL,
  PROOF_PROTOCOL,
} from './definition.js';
export type { CurrencyDefinitionInput } from './definition.js';

// Full offline currency-launch output builder (all 7 outputs, byte-equivalent to
// definecurrency): identity update, currency def, import, notarization, export,
// reserve deposit, change.
export { buildCurrencyLaunchOutputs } from './outputs.js';
export type { CurrencyLaunchContext, CurrencyLaunchOutputs, CurrencyLaunchOutput } from './outputs.js';

// Full offline currency-launch transaction (outputs + funding + identity input + signing).
export { buildCurrencyLaunchTransaction } from './launch.js';
export type { CurrencyLaunchTxParams, CurrencyLaunchTxResult } from './launch.js';

// Reserve-transfer output: (pre)convert a reserve into a fractional currency
// ("invest at launch").
export { buildReserveTransferOutput } from './reserveTransfer.js';
export type { ReserveTransferParams, ReserveTransferBuildResult } from './reserveTransfer.js';

import { Identity, IdentityScript } from '../fork/boundary.js';
import BN from 'bn.js';
import { IDENTITY_FLAG_ACTIVECURRENCY } from '../constants/index.js';
import type { Network } from '../constants/index.js';
import { getNetwork } from '../signing/index.js';
import { assertWifIsPrimary } from '../identity/index.js';
import { validateWif } from '../keys/index.js';
import { TransactionBuildError, InvalidWifError } from '../errors.js';
import type { DefineCurrencyParams, DefineCurrencyResult } from '../types/index.js';

import { assembleFundedIdentityUpdate } from '../assemble/fundedIdentityUpdate.js';

/**
 * Build and sign a currency definition transaction (manual mode)
 *
 * Takes a pre-built currency definition script hex. No node RPC needed.
 */
export function defineCurrency(
  params: DefineCurrencyParams,
  network: Network
): DefineCurrencyResult {
  // Validate inputs at the boundary (this path previously skipped all of it and
  // failed later with a raw ECPair/selection error).
  const wifCheck = validateWif(params.wif);
  if (!wifCheck.valid) {
    throw new InvalidWifError(wifCheck.error);
  }
  if (!params.identityHex) {
    throw new TransactionBuildError('identityHex is required');
  }
  if (!params.utxos || params.utxos.length === 0) {
    throw new TransactionBuildError('At least one funding UTXO is required');
  }
  if (!params.currencyDefScript) {
    throw new TransactionBuildError('currencyDefScript is required');
  }
  const currencyDefScriptHex = params.currencyDefScript;

  const verusNetwork = getNetwork(network === 'testnet');
  const currencyDefValue = params.currencyDefValue || 0n;

  // Parse identity and set FLAG_ACTIVECURRENCY
  const identity = new Identity();
  identity.fromBuffer(Buffer.from(params.identityHex, 'hex'));

  // A currency definition spends the identity input under primary authority.
  // The fork signs it with whatever WIF it's handed, so a WIF that doesn't
  // control the identity yields a tx the daemon rejects only at broadcast.
  assertWifIsPrimary(params.wif, identity, verusNetwork);

  if (!identity.hasActiveCurrency()) {
    const currentFlags = identity.flags.toNumber();
    identity.flags = new BN(currentFlags | IDENTITY_FLAG_ACTIVECURRENCY);
  }

  const identityScript = IdentityScript.fromIdentity(identity);
  const identityOutputScript = identityScript.toBuffer();
  const currencyDefScript = Buffer.from(currencyDefScriptHex, 'hex');

  // Respend the identity UTXO, recreating its (value-0) definition output with
  // FLAG_ACTIVECURRENCY set, alongside the currency-definition output. The shared
  // assembler funds them, emits native change, grafts on the identity input
  // (re-signed last by the fork), and enforces native + token conservation.
  const assembled = assembleFundedIdentityUpdate({
    network,
    wif: params.wif,
    expiryHeight: params.expiryHeight,
    funding: params.utxos,
    identityUtxo: params.identityUtxo,
    outputs: [
      { script: identityOutputScript, nativeSat: 0n },
      { script: currencyDefScript, nativeSat: currencyDefValue },
    ],
    changeAddress: params.changeAddress,
    // The identity + currency-definition outputs can be large; size the fee from
    // their real byte length so the tx isn't estimated below the relay minimum.
    extraOutputBytes: identityOutputScript.length + currencyDefScript.length,
    label: 'currency definition',
  });

  return {
    signedTx: assembled.signedTx,
    txid: assembled.txid,
    fee: assembled.fee,
    identityAddress: identity.getIdentityAddress(),
    inputsUsed: assembled.inputsUsed,
    nativeChange: assembled.nativeChange,
  };
}
