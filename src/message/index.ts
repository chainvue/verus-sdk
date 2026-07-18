/**
 * VerusID message signing and verification (offline)
 *
 * Uses @bitgo/utxo-lib's IdentitySignature for:
 * - VerusID Login authentication
 * - Data attestation
 */

import { ECPair, IdentitySignature, networks } from '@bitgo/utxo-lib';
import { NETWORK_CONFIG, HASH_SHA256, I_ADDR_VERSION } from '../constants/index.js';
import type { Network } from '../constants/index.js';
import { assertAddressVersion } from '../identity/index.js';
import { TransactionBuildError } from '../errors.js';
import type {
  SignMessageParams,
  SignMessageResult,
  VerifyMessageParams,
  VerifyMessageResult,
} from '../types/index.js';

/**
 * Resolve the block height a message signature binds to, requiring an explicit
 * choice. The height is part of the signed preimage AND the height at which a
 * verifier (the daemon) resolves the identity's keys. Silently defaulting to 0
 * pins the signature to genesis — where the identity does not yet exist — so
 * the daemon's verifymessage fails. This SDK is offline and cannot read the
 * chain tip, so the caller must pass the current block height (or an explicit
 * 0 only for a signature never meant to be verified against the chain).
 */
function resolveBlockHeight(blockHeight: number | undefined): number {
  if (blockHeight === undefined) {
    throw new TransactionBuildError(
      'blockHeight is required: pass the current chain height so the signature resolves the ' +
        "identity's keys at the right block (this SDK is offline and cannot read the chain tip).",
    );
  }
  if (!Number.isInteger(blockHeight) || blockHeight < 0) {
    throw new TransactionBuildError(
      `Invalid blockHeight: must be a non-negative integer (got ${blockHeight})`,
    );
  }
  return blockHeight;
}

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
  // IdentitySignature launders the i-address to its hash; an R-address would
  // bind the signature to a hash naming no identity. Require an i-address.
  assertAddressVersion(params.identityAddress, I_ADDR_VERSION, 'identityAddress');
  const blockHeight = resolveBlockHeight(params.blockHeight);

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
  assertAddressVersion(params.identityAddress, I_ADDR_VERSION, 'identityAddress');

  const sigBytes = Buffer.from(params.signature, 'base64');

  // Two accepted signature encodings:
  //  - the raw 65-byte compact signature this SDK's signMessage returns, whose
  //    header byte is 31..34 — blockHeight/version come from the params; or
  //  - the full CIdentitySignature the daemon's signmessage returns (version +
  //    hashtype + blockHeight + signatures), whose first byte is the version
  //    (1 or 2) and which self-describes blockHeight/version. Previously this
  //    was misread as a raw signature and always failed to verify.
  const isDaemonFormat = sigBytes.length > 65 && (sigBytes[0] === 1 || sigBytes[0] === 2);

  let idSig: InstanceType<typeof IdentitySignature>;
  let blockHeight: number;
  let version: number;
  if (isDaemonFormat) {
    idSig = new IdentitySignature(
      verusNetwork,
      undefined,
      HASH_SHA256,
      undefined,
      undefined,
      chainId,
      params.identityAddress,
    );
    idSig.fromBuffer(sigBytes, 0, chainId, params.identityAddress);
    blockHeight = idSig.blockHeight;
    version = idSig.version;
  } else {
    version = params.version || 2;
    blockHeight = resolveBlockHeight(params.blockHeight);
    idSig = new IdentitySignature(
      verusNetwork,
      version,
      HASH_SHA256,
      blockHeight,
      [sigBytes],
      chainId,
      params.identityAddress,
    );
  }

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
