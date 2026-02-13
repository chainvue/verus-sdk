/**
 * VerusID message signing and verification (offline)
 *
 * Uses @bitgo/utxo-lib's IdentitySignature for:
 * - VerusID Login authentication
 * - Data attestation
 */

import { ECPair, IdentitySignature, networks } from '@bitgo/utxo-lib';
import { NETWORK_CONFIG, HASH_SHA256 } from '../constants/index.js';
import type { Network } from '../constants/index.js';
import type {
  SignMessageParams,
  SignMessageResult,
  VerifyMessageParams,
  VerifyMessageResult,
} from '../types/index.js';

/**
 * Sign a message with a VerusID identity signature (offline)
 */
export function signMessage(
  params: SignMessageParams,
  network: Network
): SignMessageResult {
  const verusNetwork = network === 'testnet' ? networks.verustest : networks.verus;
  const networkConfig = NETWORK_CONFIG[network];
  const chainId = params.chainId || networkConfig.chainId;
  const version = params.version || 2;
  const blockHeight = params.blockHeight || 0;

  const keyPair = ECPair.fromWIF(params.wif, verusNetwork);

  const idSig = new IdentitySignature(
    verusNetwork,
    version,
    HASH_SHA256,
    blockHeight,
    [],
    chainId,
    params.identityAddress,
  );

  const signature = idSig.signMessageOffline(params.message, keyPair);
  const identitySignatureHex = (idSig.toBuffer() as Buffer).toString('hex');

  return {
    signature: signature.toString('base64'),
    identitySignatureHex,
    message: params.message,
    identityAddress: params.identityAddress,
    chainId,
    blockHeight,
    version,
    signingAddress: keyPair.getAddress(),
  };
}

/**
 * Verify a VerusID message signature (offline)
 */
export function verifyMessage(
  params: VerifyMessageParams,
  network: Network
): VerifyMessageResult {
  const verusNetwork = network === 'testnet' ? networks.verustest : networks.verus;
  const networkConfig = NETWORK_CONFIG[network];
  const chainId = params.chainId || networkConfig.chainId;
  const version = params.version || 2;
  const blockHeight = params.blockHeight || 0;

  const signatureBuffer = Buffer.from(params.signature, 'base64');

  const idSig = new IdentitySignature(
    verusNetwork,
    version,
    HASH_SHA256,
    blockHeight,
    [signatureBuffer],
    chainId,
    params.identityAddress,
  );

  const results = idSig.verifyMessageOffline(params.message, params.signingAddress);
  const valid = results.length > 0 && results[0] === true;

  return {
    valid,
    message: params.message,
    identityAddress: params.identityAddress,
    signingAddress: params.signingAddress,
    chainId,
    blockHeight,
    version,
  };
}
