/**
 * Assemble a fully-signed, broadcastable currency-definition transaction offline.
 *
 * Composes {@link buildCurrencyLaunchOutputs} (the seven byte-locked output
 * scripts) with the funded-identity-update assembler: it spends the defining
 * identity's output (recreated with FLAG_ACTIVECURRENCY), funds the reserve
 * deposit and the miner fee from the supplied UTXOs, emits native change, and
 * signs — the identity input under primary authority, the funding inputs P2PKH.
 *
 * Only the change output differs from the daemon's own `definecurrency`
 * transaction, and it must: change value is a function of which UTXOs fund the
 * transaction, so no offline builder (nor the daemon) produces a byte-identical
 * whole transaction. The six consensus-checked outputs (indices 0–5), which the
 * daemon validates against chain state, ARE byte-identical — see
 * test/currency-outputs.test.ts.
 *
 * Inputs the caller gathers from a lite node: the defining identity
 * (`getidentity`), its controlling UTXO, funding UTXOs on the signer's address,
 * and the current block height.
 */
import { Identity } from '../fork/boundary.js';
import type { Network } from '../constants/index.js';
import type { Utxo } from '../types/index.js';
import { getNetwork } from '../signing/index.js';
import { assertWifIsPrimary } from '../identity/index.js';
import { validateWif } from '../keys/index.js';
import { InvalidWifError, TransactionBuildError } from '../errors.js';
import { assembleFundedIdentityUpdate } from '../assemble/fundedIdentityUpdate.js';
import { buildCurrencyLaunchOutputs } from './outputs.js';
import type { CurrencyDefinitionInput } from './definition.js';

export interface CurrencyLaunchTxParams {
  /** WIF of the identity's primary address (signs both the identity input and funding). */
  wif: string;
  /** The currency to define (token or fractional basket). */
  definition: CurrencyDefinitionInput;
  /** The `identity` object from the lite node's `getidentity` for the defining ID. */
  identity: Record<string, unknown>;
  /** The defining identity's controlling UTXO (its current EVAL_IDENTITY_PRIMARY output; value 0). */
  identityUtxo: Utxo;
  /** Funding UTXOs on the signer's address — cover the reserve deposit + miner fee. */
  fundingUtxos: Utxo[];
  /** Native change address. Defaults to the defining identity's i-address. */
  changeAddress?: string;
  /** Current chain tip height (embedded in the import/notarization/export outputs). */
  height: number;
  /**
   * Currency launch (registration) fee in native satoshis — query
   * `getcurrency <parent>` (200 native for a standard token/basket, 0.02 for an
   * NFT). Half funds the reserve deposit; the wrong value is rejected on broadcast.
   */
  launchFeeSats: bigint;
  /** Expiry height; defaults to a delta above the tip. */
  expiryHeight?: number;
}

export interface CurrencyLaunchTxResult {
  signedTx: string;
  txid: string;
  fee: bigint;
  nativeChange: bigint;
  inputsUsed: number;
  /** The new currency's i-address (equals the defining identity's address). */
  currencyAddress: string;
}

/**
 * Build and sign a currency-definition transaction. No node RPC is performed;
 * everything is derived from the passed inputs, so the signed hex can be handed
 * to any node for broadcast.
 */
export function buildCurrencyLaunchTransaction(
  params: CurrencyLaunchTxParams,
  network: Network,
): CurrencyLaunchTxResult {
  const wifCheck = validateWif(params.wif);
  if (!wifCheck.valid) {
    throw new InvalidWifError(wifCheck.error);
  }
  if (!params.fundingUtxos || params.fundingUtxos.length === 0) {
    throw new TransactionBuildError('at least one funding UTXO is required');
  }
  const identityAddress = params.identity.identityaddress;
  if (typeof identityAddress !== 'string' || !identityAddress) {
    throw new TransactionBuildError('identity.identityaddress is required');
  }

  // Fail closed if the WIF does not control the identity: the fork would sign the
  // identity input anyway, yielding a transaction the daemon rejects at broadcast.
  const verusNetwork = getNetwork(network === 'testnet');
  assertWifIsPrimary(params.wif, Identity.fromJson(params.identity), verusNetwork);

  const outputs = buildCurrencyLaunchOutputs(params.definition, {
    identity: params.identity,
    height: params.height,
    launchFeeSats: params.launchFeeSats,
  });

  // The six consensus outputs (identity update … reserve deposit), in order.
  // The assembler appends native change as output 6, standing in for the
  // daemon's identity-change output — see the module doc.
  const consensusOutputs = outputs.ordered.slice(0, 6).map((o) => ({
    script: Buffer.from(o.script, 'hex'),
    nativeSat: o.value,
  }));
  const extraOutputBytes = consensusOutputs.reduce((sum, o) => sum + o.script.length, 0);

  const assembled = assembleFundedIdentityUpdate({
    network,
    wif: params.wif,
    expiryHeight: params.expiryHeight ?? 0,
    funding: params.fundingUtxos,
    identityUtxo: params.identityUtxo,
    outputs: consensusOutputs,
    changeAddress: params.changeAddress ?? identityAddress,
    extraOutputBytes,
    label: 'currency launch',
  });

  return {
    signedTx: assembled.signedTx,
    txid: assembled.txid,
    fee: assembled.fee,
    nativeChange: assembled.nativeChange,
    inputsUsed: assembled.inputsUsed,
    currencyAddress: identityAddress,
  };
}
