/**
 * Shared test fixtures and helpers for verus-sdk tests
 *
 * Extracts commonly duplicated test data and helper functions
 * so individual test files stay DRY.
 */

import { IdentityScript } from 'verus-typescript-primitives';
import BN from 'bn.js';
import { addressToScriptPubKey } from '../../src/utils/index.js';
import { NETWORK_CONFIG } from '../../src/constants/index.js';
import { deriveIdentityAddress, createIdentityObject } from '../../src/identity/index.js';
import { parseRAddress, parseIAddress } from '../../src/core/brands.js';
import type { Utxo } from '../../src/types/index.js';

// ─── Test Constants ──────────────────────────────────────

/** Valid testnet WIF (for offline signing — no funds needed) */
export const TEST_WIF = 'UusoQWsobQKUkezgBJa22D9G4t9Avo6k8wD5UUxmmfAEoTN8bawc';

/** R-address corresponding to TEST_WIF */
export const TEST_ADDRESS = 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX';

/** Second test address (different from TEST_ADDRESS) */
export const TEST_ADDRESS_B = 'RPsQDnaxXgrLjcVBh3SpvCpTabWxAdMdzu';

/** Third test address */
export const TEST_ADDRESS_C = 'RSS3Qz5hzEVSV6hziLXaD2xPbw9UVpJoXs';

/** Second valid WIF for multi-key tests */
export const TEST_WIF_B = 'UtJXdBipt7XKxSe3AKFYhXizA5cgCM1ztQLVDANwHtfERydFEnPG';

/** Default test network */
export const NETWORK = 'testnet' as const;

/** VRSCTEST system i-address */
export const VRSCTEST_SYSTEM_ID = NETWORK_CONFIG.testnet.chainId;

/** VRSC mainnet system i-address */
export const VRSC_SYSTEM_ID = NETWORK_CONFIG.mainnet.chainId;

// ─── Helpers ─────────────────────────────────────────────

/**
 * Build a P2PKH scriptPubKey hex for a given R-address.
 * Used to populate UTXO `script` fields in test data.
 */
export function makeP2PKHScript(address: string): string {
  return addressToScriptPubKey(address).toString('hex');
}

/** Cached script for the default TEST_ADDRESS */
export const TEST_SCRIPT = makeP2PKHScript(TEST_ADDRESS);

/**
 * Create a mock funding UTXO.
 *
 * @param txid    - 64-char hex txid (or a repeat character, e.g. 'aa')
 * @param satoshis - amount in satoshis
 * @param script   - scriptPubKey hex (defaults to TEST_SCRIPT)
 * @param vout     - output index (defaults to 0)
 */
export function makeFundingUtxo(
  txid: string,
  satoshis: bigint,
  script: string = TEST_SCRIPT,
  vout: number = 0,
): Utxo {
  // Allow short txid patterns like 'aa' → expand to 64 chars
  const fullTxid = txid.length === 64 ? txid : txid.repeat(Math.ceil(64 / txid.length)).slice(0, 64);
  return {
    txid: fullTxid,
    outputIndex: vout,
    satoshis,
    script,
  };
}

/**
 * Create a real Identity object, serialize it to hex, and return
 * both the hex and a mock identity UTXO that references it.
 *
 * This uses verus-typescript-primitives to build a valid binary
 * representation, so SDK functions that parse identityHex will work.
 */
export function createMockIdentityHex(opts: {
  name: string;
  primaryAddresses?: string[];
  revocationAuthority?: string;
  recoveryAuthority?: string;
  flags?: number;
  unlockAfter?: number;
  network?: 'mainnet' | 'testnet';
}): {
  identityHex: string;
  identityUtxo: Utxo;
  identityAddress: string;
  identityScript: Buffer;
} {
  const network = opts.network || NETWORK;
  const systemId = NETWORK_CONFIG[network].chainId;
  const identityAddress = deriveIdentityAddress(opts.name, systemId);

  const identity = createIdentityObject({
    name: opts.name,
    primaryAddresses: (opts.primaryAddresses || [TEST_ADDRESS]).map((a) => parseRAddress(a)),
    revocationAuthority: parseIAddress(opts.revocationAuthority || identityAddress),
    recoveryAuthority: parseIAddress(opts.recoveryAuthority || identityAddress),
    parentIAddress: parseIAddress(systemId),
    systemId: parseIAddress(systemId),
  });

  if (opts.flags !== undefined) {
    identity.flags = new BN(opts.flags);
  }
  if (opts.unlockAfter !== undefined) {
    identity.unlock_after = new BN(opts.unlockAfter);
  }

  const identityHex = identity.toBuffer().toString('hex');

  // Build the CC script that wraps this identity (needed for completeFundedIdentityUpdate)
  const idScript = IdentityScript.fromIdentity(identity);
  const identityScriptBuf = idScript.toBuffer();

  const identityUtxo: Utxo = {
    txid: 'ff'.repeat(32),
    outputIndex: 0,
    satoshis: 0n,
    script: identityScriptBuf.toString('hex'),
  };

  return {
    identityHex,
    identityUtxo,
    identityAddress,
    identityScript: identityScriptBuf,
  };
}
