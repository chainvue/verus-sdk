import { describe, it, expect } from 'vitest';
import { signMessage, verifyMessage } from '../src/message/index.js';
import { wifToAddress } from '../src/keys/index.js';
import { deriveIdentityAddress } from '../src/identity/index.js';
import { NETWORK_CONFIG } from '../src/constants/index.js';

const TEST_WIF = 'UuRYh9nCVRvPgBEgF7tq4rYpfN2kgeZRKSaVWFVebsgsWWUzAEam';
const SYSTEM_ID = NETWORK_CONFIG.testnet.chainId;

describe('message', () => {
  it('should sign and verify a message (v2)', async () => {
    const signingAddress = await wifToAddress(TEST_WIF);
    const identityAddress = deriveIdentityAddress('testmsg', SYSTEM_ID);

    const signResult = signMessage({
      wif: TEST_WIF,
      message: 'Hello, Verus!',
      identityAddress,
      blockHeight: 100,
      version: 2,
    }, 'testnet');

    expect(signResult.signature).toBeTruthy();
    expect(signResult.signingAddress).toBe(signingAddress);
    expect(signResult.identitySignatureHex).toBeTruthy();

    const verifyResult = verifyMessage({
      message: 'Hello, Verus!',
      signature: signResult.signature,
      signingAddress: signResult.signingAddress,
      identityAddress,
      blockHeight: 100,
      version: 2,
    }, 'testnet');

    expect(verifyResult.valid).toBe(true);
  });

  it('should sign and verify a message (v1)', async () => {
    const signingAddress = await wifToAddress(TEST_WIF);
    const identityAddress = deriveIdentityAddress('testmsg', SYSTEM_ID);

    const signResult = signMessage({
      wif: TEST_WIF,
      message: 'Version 1 test',
      identityAddress,
      blockHeight: 0,
      version: 1,
    }, 'testnet');

    const verifyResult = verifyMessage({
      message: 'Version 1 test',
      signature: signResult.signature,
      signingAddress: signResult.signingAddress,
      identityAddress,
      blockHeight: 0,
      version: 1,
    }, 'testnet');

    expect(verifyResult.valid).toBe(true);
  });

  it('should fail verification with wrong message', async () => {
    const signingAddress = await wifToAddress(TEST_WIF);
    const identityAddress = deriveIdentityAddress('testmsg', SYSTEM_ID);

    const signResult = signMessage({
      wif: TEST_WIF,
      message: 'Original message',
      identityAddress,
      blockHeight: 50,
    }, 'testnet');

    const verifyResult = verifyMessage({
      message: 'Wrong message',
      signature: signResult.signature,
      signingAddress: signResult.signingAddress,
      identityAddress,
      blockHeight: 50,
    }, 'testnet');

    expect(verifyResult.valid).toBe(false);
  });

  it('should fail verification with wrong signing address', async () => {
    const identityAddress = deriveIdentityAddress('testmsg', SYSTEM_ID);

    const signResult = signMessage({
      wif: TEST_WIF,
      message: 'Test',
      identityAddress,
    }, 'testnet');

    const verifyResult = verifyMessage({
      message: 'Test',
      signature: signResult.signature,
      signingAddress: 'RQr2cUkF46n7y8WRzDkd1iV9gHusSSQuzX', // Different address
      identityAddress,
    }, 'testnet');

    expect(verifyResult.valid).toBe(false);
  });
});
